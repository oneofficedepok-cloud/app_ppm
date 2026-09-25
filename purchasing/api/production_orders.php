<?php
require_once __DIR__ . '/../includes/auth.php';

// Baca: Produksi & BOM + menu Gudang terkait + WO. Ubah: menu Produksi & BOM.
require_perm(['produksi', 'riwayat', 'stok', 'tracking'], ['produksi']);

$method = http_method();
$pdo = db();
$action = $_GET['action'] ?? '';

function fetch_bom_items(PDO $pdo, int $productionId): array
{
    $stmt = $pdo->prepare(
        'SELECT bi.*, ii.sku, ii.nama AS item_nama, ii.satuan, ii.stok_qty AS item_stok_qty
         FROM production_bom_items bi
         JOIN inventory_items ii ON ii.id = bi.item_id
         WHERE bi.production_id = :pid
         ORDER BY bi.id ASC'
    );
    $stmt->execute([':pid' => $productionId]);
    return $stmt->fetchAll();
}

function next_po_number(PDO $pdo): string
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM production_orders')->fetchColumn();
    return 'PROD-' . str_pad((string) ($count + 1), 4, '0', STR_PAD_LEFT);
}

// ---------------------------------------------------------
// action=consume : catat konsumsi material (sisa kebutuhan
// BOM yang belum terpakai) sebagai movement OUT sekaligus.
// ---------------------------------------------------------
if ($method === 'POST' && $action === 'consume') {
    $b = get_json_input();
    $productionId = to_int_or_null(arr_val($b, 'id'));
    if (!$productionId) json_error('ID Produksi wajib diisi.', 422);

    $prod = $pdo->prepare('SELECT * FROM production_orders WHERE id = :id');
    $prod->execute([':id' => $productionId]);
    $prodRow = $prod->fetch();
    if (!$prodRow) json_error('Data Produksi tidak ditemukan.', 404);

    $bomItems = fetch_bom_items($pdo, $productionId);
    $user = current_user();
    $results = [];
    $errors = [];

    foreach ($bomItems as $bi) {
        $sisa = (float) $bi['qty_dibutuhkan'] - (float) $bi['qty_terpakai'];
        if ($sisa <= 0.0001) continue; // sudah terpenuhi, lewati

        $pdo->beginTransaction();
        try {
            $item = $pdo->prepare('SELECT * FROM inventory_items WHERE id = :id FOR UPDATE');
            $item->execute([':id' => $bi['item_id']]);
            $itemRow = $item->fetch();

            if ((float) $itemRow['stok_qty'] < $sisa) {
                $pdo->rollBack();
                $errors[] = "{$itemRow['nama']}: stok kurang (butuh {$sisa}, tersedia {$itemRow['stok_qty']})";
                continue;
            }

            $mv = $pdo->prepare(
                'INSERT INTO inventory_movements (item_id, tanggal, tipe, qty, harga_satuan, sumber, ref_production_id, wo_id, keterangan, user_id)
                 VALUES (:item, CURDATE(), \'OUT\', :qty, :harga, \'PRODUKSI\', :pid, :wo, :ket, :uid)'
            );
            $mv->execute([
                ':item'  => $bi['item_id'],
                ':qty'   => $sisa,
                ':harga' => $itemRow['harga_satuan'],
                ':pid'   => $productionId,
                ':wo'    => $prodRow['wo_id'],
                ':ket'   => 'Konsumsi BOM Produksi ' . $prodRow['po_number'],
                ':uid'   => $user['id'] ?? null,
            ]);

            $newStok = (float) $itemRow['stok_qty'] - $sisa;
            $pdo->prepare('UPDATE inventory_items SET stok_qty = :s WHERE id = :id')
                ->execute([':s' => $newStok, ':id' => $bi['item_id']]);

            $pdo->prepare('UPDATE production_bom_items SET qty_terpakai = qty_terpakai + :q WHERE id = :id')
                ->execute([':q' => $sisa, ':id' => $bi['id']]);

            $pdo->commit();
            $results[] = $itemRow['nama'];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }

    log_activity('consume', 'production_orders', $productionId, implode(', ', $results));

    if (!empty($errors) && empty($results)) {
        json_error('Gagal konsumsi material: ' . implode('; ', $errors), 422);
    }
    $msg = count($results) . ' material berhasil dikonsumsi dari Gudang.';
    if (!empty($errors)) $msg .= ' (sebagian gagal: ' . implode('; ', $errors) . ')';
    json_success(['consumed' => $results, 'errors' => $errors], $msg);
    exit;
}

switch ($method) {

    case 'GET':
        $sql = "
            SELECT po.*, wo.wo_number, wo.project AS wo_project, c.nama AS customer_nama
            FROM production_orders po
            LEFT JOIN work_orders wo ON wo.id = po.wo_id
            LEFT JOIN customers c ON c.id = wo.customer_id
            ORDER BY po.created_at DESC
        ";
        $rows = $pdo->query($sql)->fetchAll();
        foreach ($rows as &$r) {
            $r['bom_items'] = fetch_bom_items($pdo, (int) $r['id']);
        }
        unset($r);
        json_success($rows);
        break;

    case 'POST':
        $b = get_json_input();
        $product = arr_val($b, 'product', '');
        if ($product === '') json_error('Nama produk wajib diisi.', 422);
        $qtyTarget = to_float(arr_val($b, 'qty_target', 0));
        $bomItems = is_array($b['bom_items'] ?? null) ? $b['bom_items'] : [];

        $pdo->beginTransaction();
        try {
            $poNumber = arr_val($b, 'po_number', '') ?: next_po_number($pdo);

            $stmt = $pdo->prepare(
                'INSERT INTO production_orders (po_number, wo_id, product, qty_target, qty_selesai, tgl_mulai, tgl_target, status, keterangan)
                 VALUES (:po, :wo, :prod, :qtarget, 0, :mulai, :target, :status, :ket)'
            );
            $stmt->execute([
                ':po'      => $poNumber,
                ':wo'      => to_int_or_null(arr_val($b, 'wo_id')),
                ':prod'    => $product,
                ':qtarget' => $qtyTarget,
                ':mulai'   => arr_val($b, 'tgl_mulai') ?: null,
                ':target'  => arr_val($b, 'tgl_target') ?: null,
                ':status'  => arr_val($b, 'status', 'DRAFT'),
                ':ket'     => arr_val($b, 'keterangan', ''),
            ]);
            $newId = (int) $pdo->lastInsertId();

            $bomStmt = $pdo->prepare(
                'INSERT INTO production_bom_items (production_id, item_id, qty_per_unit, qty_dibutuhkan)
                 VALUES (:pid, :item, :perunit, :butuh)'
            );
            foreach ($bomItems as $bi) {
                $itemId = to_int_or_null($bi['item_id'] ?? null);
                if (!$itemId) continue;
                $perUnit = to_float($bi['qty_per_unit'] ?? 0);
                $bomStmt->execute([
                    ':pid'     => $newId,
                    ':item'    => $itemId,
                    ':perunit' => $perUnit,
                    ':butuh'   => $perUnit * $qtyTarget,
                ]);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($e instanceof PDOException && $e->getCode() === '23000') {
                json_error('No. Produksi sudah dipakai, atau ada material BOM yang dipilih dobel.', 409);
            }
            throw $e;
        }

        log_activity('create', 'production_orders', $newId, $product);
        json_success(['id' => $newId, 'po_number' => $poNumber], 'Data Produksi berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        if (!$id) json_error('ID wajib diisi.', 422);
        $qtyTarget = to_float(arr_val($b, 'qty_target', 0));
        $bomItems = is_array($b['bom_items'] ?? null) ? $b['bom_items'] : null;

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'UPDATE production_orders SET po_number=:po, wo_id=:wo, product=:prod, qty_target=:qtarget,
                    qty_selesai=:qselesai, tgl_mulai=:mulai, tgl_target=:target, status=:status, keterangan=:ket
                 WHERE id = :id'
            );
            $stmt->execute([
                ':po'       => arr_val($b, 'po_number', ''),
                ':wo'       => to_int_or_null(arr_val($b, 'wo_id')),
                ':prod'     => arr_val($b, 'product', ''),
                ':qtarget'  => $qtyTarget,
                ':qselesai' => to_float(arr_val($b, 'qty_selesai', 0)),
                ':mulai'    => arr_val($b, 'tgl_mulai') ?: null,
                ':target'   => arr_val($b, 'tgl_target') ?: null,
                ':status'   => arr_val($b, 'status', 'DRAFT'),
                ':ket'      => arr_val($b, 'keterangan', ''),
                ':id'       => $id,
            ]);

            // Kalau bom_items dikirim, ganti seluruh baris BOM (qty_terpakai yang
            // sudah tercatat ikut hilang kalau materialnya dihapus dari daftar -
            // untuk order yang sudah jalan konsumsinya, sebaiknya jangan edit BOM lagi).
            if ($bomItems !== null) {
                $pdo->prepare('DELETE FROM production_bom_items WHERE production_id = :pid')->execute([':pid' => $id]);
                $bomStmt = $pdo->prepare(
                    'INSERT INTO production_bom_items (production_id, item_id, qty_per_unit, qty_dibutuhkan)
                     VALUES (:pid, :item, :perunit, :butuh)'
                );
                foreach ($bomItems as $bi) {
                    $itemId = to_int_or_null($bi['item_id'] ?? null);
                    if (!$itemId) continue;
                    $perUnit = to_float($bi['qty_per_unit'] ?? 0);
                    $bomStmt->execute([
                        ':pid'     => $id,
                        ':item'    => $itemId,
                        ':perunit' => $perUnit,
                        ':butuh'   => $perUnit * $qtyTarget,
                    ]);
                }
            } else {
                // qty_target berubah tapi BOM tidak dikirim ulang -> hitung ulang qty_dibutuhkan saja
                $pdo->prepare(
                    'UPDATE production_bom_items SET qty_dibutuhkan = qty_per_unit * :qtarget WHERE production_id = :pid'
                )->execute([':qtarget' => $qtyTarget, ':pid' => $id]);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }

        log_activity('update', 'production_orders', $id, '');
        json_success(['id' => $id], 'Data Produksi berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $stmt = $pdo->prepare('DELETE FROM production_orders WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'production_orders', $id, '');
        json_success([], 'Data Produksi berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
