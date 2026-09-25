<?php
require_once __DIR__ . '/../includes/auth.php';

// Baca: Purchasing (+ Produksi & Finance untuk rekap biaya WO). Ubah: modul Purchasing.
require_module_access(['purchasing', 'produksi', 'finance'], ['purchasing']);

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        $sql = "
            SELECT ti.*, wo.wo_number, c.nama AS customer_nama
            FROM transport_items ti
            LEFT JOIN work_orders wo ON wo.id = ti.wo_id
            LEFT JOIN customers c ON c.id = ti.customer_id
            ORDER BY ti.created_at DESC
        ";
        json_success($pdo->query($sql)->fetchAll());
        break;

    case 'POST':
        $b = get_json_input();
        $woId = to_int_or_null(arr_val($b, 'wo_id'));
        if (!$woId) json_error('WO wajib dipilih.', 422);

        $qty = to_float(arr_val($b, 'qty', 1));
        $harga = to_float(arr_val($b, 'harga', 0));
        $total = $qty * $harga;

        $stmt = $pdo->prepare(
            'INSERT INTO transport_items (wo_id, project, customer_id, deskripsi, asal, tujuan, qty, harga, total)
             VALUES (:wo, :proj, :cust, :desk, :asal, :tuju, :qty, :harga, :total)'
        );
        $stmt->execute([
            ':wo'    => $woId,
            ':proj'  => arr_val($b, 'project', ''),
            ':cust'  => to_int_or_null(arr_val($b, 'customer_id')),
            ':desk'  => arr_val($b, 'deskripsi', ''),
            ':asal'  => arr_val($b, 'asal', ''),
            ':tuju'  => arr_val($b, 'tujuan', ''),
            ':qty'   => $qty,
            ':harga' => $harga,
            ':total' => $total,
        ]);

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'transport_items', $newId, '');
        json_success(['id' => $newId, 'total' => $total], 'Data Transportasi berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        if (!$id) json_error('ID wajib diisi.', 422);

        $qty = to_float(arr_val($b, 'qty', 1));
        $harga = to_float(arr_val($b, 'harga', 0));
        $total = $qty * $harga;

        $stmt = $pdo->prepare(
            'UPDATE transport_items SET wo_id=:wo, project=:proj, customer_id=:cust, deskripsi=:desk,
                asal=:asal, tujuan=:tuju, qty=:qty, harga=:harga, total=:total
             WHERE id = :id'
        );
        $stmt->execute([
            ':wo'    => to_int_or_null(arr_val($b, 'wo_id')),
            ':proj'  => arr_val($b, 'project', ''),
            ':cust'  => to_int_or_null(arr_val($b, 'customer_id')),
            ':desk'  => arr_val($b, 'deskripsi', ''),
            ':asal'  => arr_val($b, 'asal', ''),
            ':tuju'  => arr_val($b, 'tujuan', ''),
            ':qty'   => $qty,
            ':harga' => $harga,
            ':total' => $total,
            ':id'    => $id,
        ]);

        log_activity('update', 'transport_items', $id, '');
        json_success(['id' => $id, 'total' => $total], 'Data Transportasi berhasil diperbarui.');
        break;

    case 'DELETE':
        // Hapus massal: ?ids=1,2,3 (dari checkbox / tombol Hapus Semua)
        if (!isset($_GET['id'])) {
            $ids = parse_id_list();
            if (!$ids) json_error('Tidak ada data yang dipilih.', 422);
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $pdo->beginTransaction();
            $stmt = $pdo->prepare("DELETE FROM transport_items WHERE id IN ($ph)");
            $stmt->execute($ids);
            $deleted = $stmt->rowCount();
            $pdo->commit();
            log_activity('bulk_delete', 'transport_items', null, 'IDs: ' . implode(',', $ids));
            json_success(['deleted' => $deleted, 'skipped' => []], "$deleted data Transportasi berhasil dihapus.");
        }

        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $stmt = $pdo->prepare('DELETE FROM transport_items WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'transport_items', $id, '');
        json_success([], 'Data Transportasi berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
