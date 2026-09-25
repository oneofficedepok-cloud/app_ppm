<?php
require_once __DIR__ . '/../includes/auth.php';

require_module('finance');

$method = http_method();
$pdo = db();

/** Hitung PPN/PPh23/Sisa Hutang di SERVER - meniru formula calcAP() asli. */
function calc_ap(float $pembelian, bool $isPpn, bool $isPph23, float $biayaLain, float $terbayar): array
{
    $ppn = $isPpn ? round($pembelian * 0.11, 2) : 0.0;
    $pph23 = $isPph23 ? round($pembelian * 0.02, 2) : 0.0;
    $totalHutang = $pembelian + $ppn;
    $sisa = $totalHutang - $terbayar - $pph23 - $biayaLain;
    return [$ppn, $pph23, $sisa];
}

/** Fallback: kalau due_date tidak dikirim client, hitung dari tgl_terima + TOP hari. */
function resolve_due_date(?string $dueDate, ?string $baseDate, int $topDays): ?string
{
    if ($dueDate) return $dueDate;
    if (!$baseDate) return null;
    $ts = strtotime($baseDate);
    if ($ts === false) return null;
    return date('Y-m-d', strtotime("+{$topDays} days", $ts));
}

switch ($method) {

    case 'GET':
        $sql = "
            SELECT ap.*, s.nama AS supplier_nama
            FROM account_payable ap
            LEFT JOIN suppliers s ON s.id = ap.supplier_id
            ORDER BY ap.tgl_invoice DESC, ap.id DESC
        ";
        $rows = $pdo->query($sql)->fetchAll();
        foreach ($rows as &$a) {
            [$ppn, $pph23, $sisa] = calc_ap(
                (float) $a['pembelian'], (bool) $a['is_ppn'], (bool) $a['is_pph23'],
                (float) $a['biaya_lain'], (float) $a['terbayar']
            );
            $a['sisa_hutang'] = $sisa;
            if ($sisa <= 0 && (float) $a['terbayar'] > 0) $a['status'] = 'TERBAYAR LUNAS';
            elseif ((float) $a['terbayar'] > 0) $a['status'] = 'PARTIAL';
            else $a['status'] = 'PENDING';
        }
        unset($a);
        json_success($rows);
        break;

    case 'POST':
        $b = get_json_input();
        $invoice = clean_str(arr_val($b, 'invoice_no', ''));
        $tglInv = arr_val($b, 'tgl_invoice');
        if ($invoice === '' || !$tglInv) {
            json_error('No. Invoice dan Tanggal Invoice wajib diisi.', 422);
        }

        $pembelian = to_float(arr_val($b, 'pembelian', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', true);
        $isPph23 = (bool) arr_val($b, 'is_pph23', true);
        $biayaLain = to_float(arr_val($b, 'biaya_lain', 0));
        $terbayar = to_float(arr_val($b, 'terbayar', 0));
        [$ppn, $pph23, $sisa] = calc_ap($pembelian, $isPpn, $isPph23, $biayaLain, $terbayar);

        $stmt = $pdo->prepare(
            'INSERT INTO account_payable
             (invoice_no, tgl_invoice, tgl_terima, supplier_id, po_no, deskripsi, pembelian,
              is_ppn, ppn, is_pph23, pph23, biaya_lain, top_days, due_date, faktur_pajak, terbayar, tgl_bayar)
             VALUES (:inv, :tgl, :tglterima, :supp, :po, :desk, :pembelian,
              :isppn, :ppn, :ispph23, :pph23, :biayalain, :top, :due, :faktur, :terbayar, :tglbayar)'
        );
        try {
            $topDays = (int) to_float(arr_val($b, 'top_days', 30));
            $dueDate = resolve_due_date(arr_val($b, 'due_date') ?: null, arr_val($b, 'tgl_terima') ?: null, $topDays);
            $stmt->execute([
                ':inv' => $invoice, ':tgl' => $tglInv, ':tglterima' => arr_val($b, 'tgl_terima') ?: null,
                ':supp' => to_int_or_null(arr_val($b, 'supplier_id')), ':po' => arr_val($b, 'po_no', ''),
                ':desk' => arr_val($b, 'deskripsi', ''), ':pembelian' => $pembelian,
                ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn, ':ispph23' => $isPph23 ? 1 : 0, ':pph23' => $pph23,
                ':biayalain' => $biayaLain, ':top' => $topDays,
                ':due' => $dueDate, ':faktur' => arr_val($b, 'faktur_pajak', ''),
                ':terbayar' => $terbayar, ':tglbayar' => arr_val($b, 'tgl_bayar') ?: null,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. Invoice ini sudah pernah dipakai.', 409);
            throw $e;
        }

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'account_payable', $newId, $invoice);
        json_success(['id' => $newId, 'sisa_hutang' => $sisa], 'Record AP berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $invoice = clean_str(arr_val($b, 'invoice_no', ''));
        if (!$id || $invoice === '') {
            json_error('ID dan No. Invoice wajib diisi.', 422);
        }

        $pembelian = to_float(arr_val($b, 'pembelian', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', true);
        $isPph23 = (bool) arr_val($b, 'is_pph23', true);
        $biayaLain = to_float(arr_val($b, 'biaya_lain', 0));
        $terbayar = to_float(arr_val($b, 'terbayar', 0));
        [$ppn, $pph23, $sisa] = calc_ap($pembelian, $isPpn, $isPph23, $biayaLain, $terbayar);

        $stmt = $pdo->prepare(
            'UPDATE account_payable SET
                invoice_no = :inv, tgl_invoice = :tgl, tgl_terima = :tglterima, supplier_id = :supp,
                po_no = :po, deskripsi = :desk, pembelian = :pembelian, is_ppn = :isppn, ppn = :ppn,
                is_pph23 = :ispph23, pph23 = :pph23, biaya_lain = :biayalain,
                top_days = :top, due_date = :due, faktur_pajak = :faktur, terbayar = :terbayar, tgl_bayar = :tglbayar
             WHERE id = :id'
        );
        try {
            $topDays = (int) to_float(arr_val($b, 'top_days', 30));
            $dueDate = resolve_due_date(arr_val($b, 'due_date') ?: null, arr_val($b, 'tgl_terima') ?: null, $topDays);
            $stmt->execute([
                ':inv' => $invoice, ':tgl' => arr_val($b, 'tgl_invoice'), ':tglterima' => arr_val($b, 'tgl_terima') ?: null,
                ':supp' => to_int_or_null(arr_val($b, 'supplier_id')), ':po' => arr_val($b, 'po_no', ''),
                ':desk' => arr_val($b, 'deskripsi', ''), ':pembelian' => $pembelian,
                ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn, ':ispph23' => $isPph23 ? 1 : 0, ':pph23' => $pph23,
                ':biayalain' => $biayaLain, ':top' => $topDays,
                ':due' => $dueDate, ':faktur' => arr_val($b, 'faktur_pajak', ''),
                ':terbayar' => $terbayar, ':tglbayar' => arr_val($b, 'tgl_bayar') ?: null, ':id' => $id,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. Invoice sudah dipakai record lain.', 409);
            throw $e;
        }

        log_activity('update', 'account_payable', $id, $invoice);
        json_success(['id' => $id, 'sisa_hutang' => $sisa], 'Record AP berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $stmt = $pdo->prepare('DELETE FROM account_payable WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'account_payable', $id, '');
        json_success([], 'Record AP berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
