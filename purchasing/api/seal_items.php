<?php
require_once __DIR__ . '/../includes/auth.php';

require_login();

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        $sql = "
            SELECT si.*, wo.wo_number, c.nama AS customer_nama
            FROM seal_items si
            LEFT JOIN work_orders wo ON wo.id = si.wo_id
            LEFT JOIN customers c ON c.id = si.customer_id
            ORDER BY si.created_at DESC
        ";
        json_success($pdo->query($sql)->fetchAll());
        break;

    case 'POST':
        $b = get_json_input();
        $woId = to_int_or_null(arr_val($b, 'wo_id'));
        if (!$woId) json_error('WO wajib dipilih.', 422);

        $qty = to_float(arr_val($b, 'qty', 0));
        $harga = to_float(arr_val($b, 'harga', 0));
        $total = $qty * $harga;

        $stmt = $pdo->prepare(
            'INSERT INTO seal_items (wo_id, project, customer_id, product, type, dimensi, brand, qty, harga, total)
             VALUES (:wo, :proj, :cust, :prod, :type, :dim, :brand, :qty, :harga, :total)'
        );
        $stmt->execute([
            ':wo'    => $woId,
            ':proj'  => arr_val($b, 'project', ''),
            ':cust'  => to_int_or_null(arr_val($b, 'customer_id')),
            ':prod'  => arr_val($b, 'product', ''),
            ':type'  => arr_val($b, 'type', ''),
            ':dim'   => arr_val($b, 'dimensi', ''),
            ':brand' => arr_val($b, 'brand', ''),
            ':qty'   => $qty,
            ':harga' => $harga,
            ':total' => $total,
        ]);

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'seal_items', $newId, '');
        json_success(['id' => $newId, 'total' => $total], 'Data Seal CNC berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        if (!$id) json_error('ID wajib diisi.', 422);

        $qty = to_float(arr_val($b, 'qty', 0));
        $harga = to_float(arr_val($b, 'harga', 0));
        $total = $qty * $harga;

        $stmt = $pdo->prepare(
            'UPDATE seal_items SET wo_id=:wo, project=:proj, customer_id=:cust, product=:prod,
                type=:type, dimensi=:dim, brand=:brand, qty=:qty, harga=:harga, total=:total
             WHERE id = :id'
        );
        $stmt->execute([
            ':wo'    => to_int_or_null(arr_val($b, 'wo_id')),
            ':proj'  => arr_val($b, 'project', ''),
            ':cust'  => to_int_or_null(arr_val($b, 'customer_id')),
            ':prod'  => arr_val($b, 'product', ''),
            ':type'  => arr_val($b, 'type', ''),
            ':dim'   => arr_val($b, 'dimensi', ''),
            ':brand' => arr_val($b, 'brand', ''),
            ':qty'   => $qty,
            ':harga' => $harga,
            ':total' => $total,
            ':id'    => $id,
        ]);

        log_activity('update', 'seal_items', $id, '');
        json_success(['id' => $id, 'total' => $total], 'Data Seal CNC berhasil diperbarui.');
        break;

    case 'DELETE':
        // Hapus massal: ?ids=1,2,3 (dari checkbox / tombol Hapus Semua)
        if (!isset($_GET['id'])) {
            $ids = parse_id_list();
            if (!$ids) json_error('Tidak ada data yang dipilih.', 422);
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $pdo->beginTransaction();
            $stmt = $pdo->prepare("DELETE FROM seal_items WHERE id IN ($ph)");
            $stmt->execute($ids);
            $deleted = $stmt->rowCount();
            $pdo->commit();
            log_activity('bulk_delete', 'seal_items', null, 'IDs: ' . implode(',', $ids));
            json_success(['deleted' => $deleted, 'skipped' => []], "$deleted data Seal CNC berhasil dihapus.");
        }

        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $stmt = $pdo->prepare('DELETE FROM seal_items WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'seal_items', $id, '');
        json_success([], 'Data Seal CNC berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
