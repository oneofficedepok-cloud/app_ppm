<?php
require_once __DIR__ . '/../includes/auth.php';

require_login();

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        $stmt = $pdo->query('SELECT * FROM suppliers ORDER BY nama ASC');
        json_success($stmt->fetchAll());
        break;

    case 'POST':
        $b = get_json_input();
        $nama = clean_str(arr_val($b, 'nama', ''));
        if ($nama === '') {
            json_error('Nama supplier wajib diisi.', 422);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO suppliers
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
        log_activity('create', 'suppliers', $newId, $nama);
        json_success(['id' => $newId], 'Supplier berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $nama = clean_str(arr_val($b, 'nama', ''));
        if (!$id || $nama === '') {
            json_error('ID dan nama supplier wajib diisi.', 422);
        }

        $stmt = $pdo->prepare(
            'UPDATE suppliers SET
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

        log_activity('update', 'suppliers', $id, $nama);
        json_success(['id' => $id], 'Supplier berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) {
            json_error('ID wajib diisi.', 422);
        }

        $check = $pdo->prepare('SELECT COUNT(*) c FROM pr_items WHERE supplier_id = :id');
        $check->execute([':id' => $id]);
        if ((int) $check->fetch()['c'] > 0) {
            json_error('Supplier ini masih dipakai di data PR, tidak bisa dihapus.', 409);
        }

        $stmt = $pdo->prepare('DELETE FROM suppliers WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'suppliers', $id, '');
        json_success([], 'Supplier berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
