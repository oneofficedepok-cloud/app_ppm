<?php
require_once __DIR__ . '/../includes/auth.php';

// Baca: semua user login (dropdown di form PR/WO/AR). Ubah: modul Master Data.
require_module_access(null, ['masterdata']);

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        $stmt = $pdo->query('SELECT * FROM customers ORDER BY nama ASC');
        json_success($stmt->fetchAll());
        break;

    case 'POST':
        $b = get_json_input();
        $nama = clean_str(arr_val($b, 'nama', ''));
        if ($nama === '') {
            json_error('Nama customer wajib diisi.', 422);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO customers
             (nama, alamat, kelurahan, kecamatan, kota, provinsi, kodepos, negara, pic, cp, telepon, npwp, status)
             VALUES (:nama, :alamat, :kelurahan, :kecamatan, :kota, :provinsi, :kodepos, :negara, :pic, :cp, :telepon, :npwp, :status)'
        );
        $stmt->execute([
            ':nama'      => $nama,
            ':alamat'    => arr_val($b, 'alamat', ''),
            ':kelurahan' => arr_val($b, 'kelurahan', ''),
            ':kecamatan' => arr_val($b, 'kecamatan', ''),
            ':kota'      => arr_val($b, 'kota', ''),
            ':provinsi'  => arr_val($b, 'provinsi', ''),
            ':kodepos'   => arr_val($b, 'kodepos', ''),
            ':negara'    => arr_val($b, 'negara', 'Indonesia'),
            ':pic'       => arr_val($b, 'pic', ''),
            ':cp'        => arr_val($b, 'cp', ''),
            ':telepon'   => arr_val($b, 'telepon', ''),
            ':npwp'      => arr_val($b, 'npwp', ''),
            ':status'    => arr_val($b, 'status', 'AKTIF'),
        ]);

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'customers', $newId, $nama);
        json_success(['id' => $newId], 'Customer berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $nama = clean_str(arr_val($b, 'nama', ''));
        if (!$id || $nama === '') {
            json_error('ID dan nama customer wajib diisi.', 422);
        }

        $stmt = $pdo->prepare(
            'UPDATE customers SET
                nama = :nama, alamat = :alamat, kelurahan = :kelurahan, kecamatan = :kecamatan,
                kota = :kota, provinsi = :provinsi, kodepos = :kodepos, negara = :negara,
                pic = :pic, cp = :cp, telepon = :telepon, npwp = :npwp, status = :status
             WHERE id = :id'
        );
        $stmt->execute([
            ':nama'      => $nama,
            ':alamat'    => arr_val($b, 'alamat', ''),
            ':kelurahan' => arr_val($b, 'kelurahan', ''),
            ':kecamatan' => arr_val($b, 'kecamatan', ''),
            ':kota'      => arr_val($b, 'kota', ''),
            ':provinsi'  => arr_val($b, 'provinsi', ''),
            ':kodepos'   => arr_val($b, 'kodepos', ''),
            ':negara'    => arr_val($b, 'negara', 'Indonesia'),
            ':pic'       => arr_val($b, 'pic', ''),
            ':cp'        => arr_val($b, 'cp', ''),
            ':telepon'   => arr_val($b, 'telepon', ''),
            ':npwp'      => arr_val($b, 'npwp', ''),
            ':status'    => arr_val($b, 'status', 'AKTIF'),
            ':id'        => $id,
        ]);

        log_activity('update', 'customers', $id, $nama);
        json_success(['id' => $id], 'Customer berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) {
            json_error('ID wajib diisi.', 422);
        }

        // Cegah hapus customer yang masih dipakai di WO/PR (jaga integritas data).
        $check = $pdo->prepare('SELECT COUNT(*) c FROM work_orders WHERE customer_id = :id');
        $check->execute([':id' => $id]);
        if ((int) $check->fetch()['c'] > 0) {
            json_error('Customer ini masih dipakai di data Work Order, tidak bisa dihapus.', 409);
        }

        $stmt = $pdo->prepare('DELETE FROM customers WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'customers', $id, '');
        json_success([], 'Customer berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
