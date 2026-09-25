<?php
require_once __DIR__ . '/../includes/auth.php';

// Baca: menu-menu Gudang. Ubah (stok masuk/keluar manual): menu Riwayat Pergerakan.
require_perm(['riwayat', 'stok', 'receiving', 'produksi'], ['riwayat']);

$method = http_method();
$pdo = db();

/**
 * Hitung delta perubahan stok dari sebuah movement.
 * IN -> +qty | OUT -> -qty | ADJUSTMENT -> +qty (qty boleh negatif utk koreksi turun)
 */
function movement_delta(string $tipe, float $qty): float
{
    if ($tipe === 'OUT') return -abs($qty);
    if ($tipe === 'IN') return abs($qty);
    return $qty; // ADJUSTMENT: pakai tanda aslinya
}

switch ($method) {

    case 'GET':
        $sql = "
            SELECT mv.*, ii.sku, ii.nama AS item_nama, ii.satuan,
                   wo.wo_number, u.full_name AS user_nama
            FROM inventory_movements mv
            JOIN inventory_items ii ON ii.id = mv.item_id
            LEFT JOIN work_orders wo ON wo.id = mv.wo_id
            LEFT JOIN users u ON u.id = mv.user_id
        ";
        $params = [];
        if (!empty($_GET['item_id'])) {
            $sql .= " WHERE mv.item_id = :item_id";
            $params[':item_id'] = (int) $_GET['item_id'];
        }
        $sql .= " ORDER BY mv.tanggal DESC, mv.id DESC";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        json_success($stmt->fetchAll());
        break;

    case 'POST':
        $b = get_json_input();
        $itemId = to_int_or_null(arr_val($b, 'item_id'));
        $tipe = arr_val($b, 'tipe', '');
        $qty = to_float(arr_val($b, 'qty', 0));

        if (!$itemId) json_error('Material wajib dipilih.', 422);
        if (!in_array($tipe, ['IN', 'OUT', 'ADJUSTMENT'], true)) json_error('Tipe pergerakan tidak valid.', 422);
        if ($qty == 0.0) json_error('Qty tidak boleh 0.', 422);
        if ($tipe !== 'ADJUSTMENT' && $qty < 0) json_error('Qty untuk tipe IN/OUT harus lebih besar dari 0.', 422);

        $user = current_user();
        $refProductionId = to_int_or_null(arr_val($b, 'ref_production_id'));

        $pdo->beginTransaction();
        try {
            $item = $pdo->prepare('SELECT * FROM inventory_items WHERE id = :id FOR UPDATE');
            $item->execute([':id' => $itemId]);
            $itemRow = $item->fetch();
            if (!$itemRow) {
                $pdo->rollBack();
                json_error('Material tidak ditemukan.', 404);
            }

            $delta = movement_delta($tipe, $qty);
            $newStok = (float) $itemRow['stok_qty'] + $delta;
            if ($newStok < -0.0001) {
                $pdo->rollBack();
                json_error('Stok tidak cukup. Saldo saat ini: ' . $itemRow['stok_qty'] . ' ' . $itemRow['satuan'], 422);
            }

            $stmt = $pdo->prepare(
                'INSERT INTO inventory_movements
                    (item_id, tanggal, tipe, qty, harga_satuan, sumber, ref_pr_id, ref_production_id, wo_id, keterangan, user_id)
                 VALUES (:item, :tgl, :tipe, :qty, :harga, :sumber, :refpr, :refprod, :wo, :ket, :uid)'
            );
            $stmt->execute([
                ':item'    => $itemId,
                ':tgl'     => arr_val($b, 'tanggal', date('Y-m-d')),
                ':tipe'    => $tipe,
                ':qty'     => $qty,
                ':harga'   => to_float(arr_val($b, 'harga_satuan', $itemRow['harga_satuan'])),
                ':sumber'  => arr_val($b, 'sumber', 'MANUAL'),
                ':refpr'   => to_int_or_null(arr_val($b, 'ref_pr_id')),
                ':refprod' => $refProductionId,
                ':wo'      => to_int_or_null(arr_val($b, 'wo_id')),
                ':ket'     => arr_val($b, 'keterangan', ''),
                ':uid'     => $user['id'] ?? null,
            ]);
            $movementId = (int) $pdo->lastInsertId();

            $upd = $pdo->prepare('UPDATE inventory_items SET stok_qty = :stok WHERE id = :id');
            $upd->execute([':stok' => $newStok, ':id' => $itemId]);

            // Kalau movement ini konsumsi material untuk produksi (OUT + ref_production_id),
            // akumulasikan ke qty_terpakai di baris BOM yang sesuai (kalau ada).
            if ($refProductionId && $tipe === 'OUT') {
                $bomUpd = $pdo->prepare(
                    'UPDATE production_bom_items SET qty_terpakai = qty_terpakai + :qty
                     WHERE production_id = :pid AND item_id = :item'
                );
                $bomUpd->execute([':qty' => abs($qty), ':pid' => $refProductionId, ':item' => $itemId]);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }

        log_activity('create', 'inventory_movements', $movementId, "{$tipe} {$qty} item#{$itemId}");
        json_success(['id' => $movementId, 'stok_qty_baru' => $newStok], 'Pergerakan stok berhasil dicatat.');
        break;

    case 'DELETE':
        // Batalkan movement: kembalikan efeknya ke stok, lalu hapus baris riwayatnya.
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $pdo->beginTransaction();
        try {
            $mv = $pdo->prepare('SELECT * FROM inventory_movements WHERE id = :id');
            $mv->execute([':id' => $id]);
            $mvRow = $mv->fetch();
            if (!$mvRow) {
                $pdo->rollBack();
                json_error('Data pergerakan tidak ditemukan.', 404);
            }

            $item = $pdo->prepare('SELECT * FROM inventory_items WHERE id = :id FOR UPDATE');
            $item->execute([':id' => $mvRow['item_id']]);
            $itemRow = $item->fetch();

            $reverseDelta = -movement_delta($mvRow['tipe'], (float) $mvRow['qty']);
            $newStok = (float) $itemRow['stok_qty'] + $reverseDelta;
            if ($newStok < -0.0001) {
                $pdo->rollBack();
                json_error('Tidak bisa membatalkan: saldo stok akan menjadi negatif.', 422);
            }

            if ($mvRow['ref_production_id'] && $mvRow['tipe'] === 'OUT') {
                $bomUpd = $pdo->prepare(
                    'UPDATE production_bom_items SET qty_terpakai = GREATEST(0, qty_terpakai - :qty)
                     WHERE production_id = :pid AND item_id = :item'
                );
                $bomUpd->execute([':qty' => abs($mvRow['qty']), ':pid' => $mvRow['ref_production_id'], ':item' => $mvRow['item_id']]);
            }

            $upd = $pdo->prepare('UPDATE inventory_items SET stok_qty = :stok WHERE id = :id');
            $upd->execute([':stok' => $newStok, ':id' => $mvRow['item_id']]);

            $del = $pdo->prepare('DELETE FROM inventory_movements WHERE id = :id');
            $del->execute([':id' => $id]);

            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }

        log_activity('delete', 'inventory_movements', $id, '');
        json_success([], 'Pergerakan stok berhasil dibatalkan & saldo dikembalikan.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
