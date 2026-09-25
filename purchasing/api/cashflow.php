<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/cashflow.php';

require_login();

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        // Mengembalikan gabungan AR+AP+manual, sudah terurut + saldo berjalan.
        json_success(get_combined_cashflow($pdo));
        break;

    case 'POST':
        // Hanya untuk transaksi MANUAL (AR/AP dikelola lewat modulnya masing-masing).
        $b = get_json_input();
        $tanggal = arr_val($b, 'tanggal');
        $deskripsi = clean_str(arr_val($b, 'deskripsi', ''));
        $nominal = to_float(arr_val($b, 'nominal', 0));
        if (!$tanggal || $deskripsi === '' || $nominal <= 0) {
            json_error('Tanggal, Deskripsi, dan Nominal wajib diisi.', 422);
        }

        $kode = in_array(arr_val($b, 'kode'), ['Piutang','Hutang','Inventaris','Beban','Pendapatan','Dana Talangan'], true) ? arr_val($b, 'kode') : 'Beban';
        $tp = arr_val($b, 'tp') === 'OUT' ? 'OUT' : 'IN';
        $status = arr_val($b, 'status') === 'PENDING' ? 'PENDING' : 'TERBAYAR LUNAS';

        $stmt = $pdo->prepare(
            'INSERT INTO manual_cashflow (tanggal, kode, tp, nominal, deskripsi, invoice_ref, pic, wo_no, po_no, dpp, pph23, status)
             VALUES (:tgl, :kode, :tp, :nominal, :desk, :inv, :pic, :wo, :po, :dpp, :pph23, :status)'
        );
        $stmt->execute([
            ':tgl' => $tanggal, ':kode' => $kode, ':tp' => $tp, ':nominal' => $nominal, ':desk' => $deskripsi,
            ':inv' => arr_val($b, 'invoice_ref', ''), ':pic' => arr_val($b, 'pic', ''),
            ':wo' => arr_val($b, 'wo_no', ''), ':po' => arr_val($b, 'po_no', ''),
            ':dpp' => $nominal, ':pph23' => to_float(arr_val($b, 'pph23', 0)), ':status' => $status,
        ]);

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'manual_cashflow', $newId, $deskripsi);
        json_success(['id' => $newId], 'Transaksi Cash Flow berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $tanggal = arr_val($b, 'tanggal');
        $deskripsi = clean_str(arr_val($b, 'deskripsi', ''));
        $nominal = to_float(arr_val($b, 'nominal', 0));
        if (!$id || !$tanggal || $deskripsi === '' || $nominal <= 0) {
            json_error('Tanggal, Deskripsi, dan Nominal wajib diisi.', 422);
        }

        $kode = in_array(arr_val($b, 'kode'), ['Piutang','Hutang','Inventaris','Beban','Pendapatan','Dana Talangan'], true) ? arr_val($b, 'kode') : 'Beban';
        $tp = arr_val($b, 'tp') === 'OUT' ? 'OUT' : 'IN';
        $status = arr_val($b, 'status') === 'PENDING' ? 'PENDING' : 'TERBAYAR LUNAS';

        $stmt = $pdo->prepare(
            'UPDATE manual_cashflow SET tanggal=:tgl, kode=:kode, tp=:tp, nominal=:nominal, deskripsi=:desk,
                invoice_ref=:inv, pic=:pic, wo_no=:wo, po_no=:po, dpp=:dpp, pph23=:pph23, status=:status
             WHERE id = :id'
        );
        $stmt->execute([
            ':tgl' => $tanggal, ':kode' => $kode, ':tp' => $tp, ':nominal' => $nominal, ':desk' => $deskripsi,
            ':inv' => arr_val($b, 'invoice_ref', ''), ':pic' => arr_val($b, 'pic', ''),
            ':wo' => arr_val($b, 'wo_no', ''), ':po' => arr_val($b, 'po_no', ''),
            ':dpp' => $nominal, ':pph23' => to_float(arr_val($b, 'pph23', 0)), ':status' => $status, ':id' => $id,
        ]);

        log_activity('update', 'manual_cashflow', $id, $deskripsi);
        json_success(['id' => $id], 'Transaksi Cash Flow berhasil diperbarui.');
        break;

    case 'DELETE':
        // id di sini adalah id gabungan (CF-MAN-x / CF-AR-x / CF-AP-x) dari getCombinedCashflow.
        $rawId = $_GET['id'] ?? '';
        if (str_starts_with($rawId, 'CF-MAN-')) {
            $realId = (int) str_replace('CF-MAN-', '', $rawId);
            $stmt = $pdo->prepare('DELETE FROM manual_cashflow WHERE id = :id');
            $stmt->execute([':id' => $realId]);
            log_activity('delete', 'manual_cashflow', $realId, '');
            json_success([], 'Transaksi Cash Flow berhasil dihapus.');
        } elseif (str_starts_with($rawId, 'CF-AR-')) {
            $realId = (int) str_replace('CF-AR-', '', $rawId);
            $stmt = $pdo->prepare('DELETE FROM account_receivable WHERE id = :id');
            $stmt->execute([':id' => $realId]);
            log_activity('delete', 'account_receivable', $realId, '');
            json_success([], 'Record AR terkait berhasil dihapus.');
        } elseif (str_starts_with($rawId, 'CF-AP-')) {
            $realId = (int) str_replace('CF-AP-', '', $rawId);
            $stmt = $pdo->prepare('DELETE FROM account_payable WHERE id = :id');
            $stmt->execute([':id' => $realId]);
            log_activity('delete', 'account_payable', $realId, '');
            json_success([], 'Record AP terkait berhasil dihapus.');
        } else {
            json_error('ID tidak valid.', 422);
        }
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
