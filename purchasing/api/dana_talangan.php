<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/cashflow.php';

require_module('finance');

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        $rows = $pdo->query('SELECT * FROM dana_talangan ORDER BY tanggal DESC, id DESC')->fetchAll();

        // Cocokkan pelunasan: cari transaksi cashflow TERBAYAR LUNAS yang kolom
        // invoice/ref-nya sama persis (case-insensitive, trim) dengan No. DT.
        // Persis logika modul Finance asli.
        $combined = get_combined_cashflow($pdo);
        foreach ($rows as &$t) {
            $noDT = strtoupper(trim($t['no_dt']));
            $pelunasan = 0.0;
            foreach ($combined as $c) {
                if ($c['status'] === 'TERBAYAR LUNAS' && $c['invoice'] && strtoupper(trim($c['invoice'])) === $noDT) {
                    $pelunasan += $c['debit'] > 0 ? $c['debit'] : $c['kredit'];
                }
            }
            $t['pelunasan'] = $pelunasan;
            $sisa = (float) $t['pinjaman'] - $pelunasan;
            $t['sisa'] = $sisa;
            if ($sisa <= 0 && $pelunasan > 0) $t['status'] = 'LUNAS';
            elseif ($pelunasan > 0) $t['status'] = 'PARTIAL';
            else $t['status'] = 'PENDING';
        }
        unset($t);

        json_success($rows);
        break;

    case 'POST':
        $b = get_json_input();
        $noDT = strtoupper(clean_str(arr_val($b, 'no_dt', '')));
        $tanggal = arr_val($b, 'tanggal');
        $pic = clean_str(arr_val($b, 'pic', ''));
        $pinjaman = to_float(arr_val($b, 'pinjaman', 0));
        $deskripsi = clean_str(arr_val($b, 'deskripsi', ''));
        if ($noDT === '' || !$tanggal || $pic === '' || $pinjaman <= 0 || $deskripsi === '') {
            json_error('No DT, Tanggal, PIC, Nilai Pinjaman, dan Deskripsi wajib diisi.', 422);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO dana_talangan (no_dt, tanggal, pic, deskripsi, pinjaman, tgl_penggantian)
             VALUES (:no, :tgl, :pic, :desk, :pinjaman, :tglganti)'
        );
        try {
            $stmt->execute([
                ':no' => $noDT, ':tgl' => $tanggal, ':pic' => $pic, ':desk' => $deskripsi,
                ':pinjaman' => $pinjaman, ':tglganti' => arr_val($b, 'tgl_penggantian') ?: null,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. DT ini sudah pernah dipakai.', 409);
            throw $e;
        }

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'dana_talangan', $newId, $noDT);
        json_success(['id' => $newId], 'Dana Talangan berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $noDT = strtoupper(clean_str(arr_val($b, 'no_dt', '')));
        if (!$id || $noDT === '') {
            json_error('ID dan No DT wajib diisi.', 422);
        }

        $stmt = $pdo->prepare(
            'UPDATE dana_talangan SET no_dt=:no, tanggal=:tgl, pic=:pic, deskripsi=:desk, pinjaman=:pinjaman, tgl_penggantian=:tglganti
             WHERE id = :id'
        );
        try {
            $stmt->execute([
                ':no' => $noDT, ':tgl' => arr_val($b, 'tanggal'), ':pic' => arr_val($b, 'pic', ''),
                ':desk' => arr_val($b, 'deskripsi', ''), ':pinjaman' => to_float(arr_val($b, 'pinjaman', 0)),
                ':tglganti' => arr_val($b, 'tgl_penggantian') ?: null, ':id' => $id,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. DT sudah dipakai record lain.', 409);
            throw $e;
        }

        log_activity('update', 'dana_talangan', $id, $noDT);
        json_success(['id' => $id], 'Dana Talangan berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $stmt = $pdo->prepare('DELETE FROM dana_talangan WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'dana_talangan', $id, '');
        json_success([], 'Dana Talangan berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
