<?php
/**
 * Cash Flow BUKAN tabel tersendiri - ini gabungan otomatis dari:
 * 1. AR yang sudah dibayar (atau masih pending, pakai due_date)
 * 2. AP yang sudah dibayar (atau masih pending, pakai due_date)
 * 3. Transaksi manual_cashflow
 * Meniru persis logika getCombinedCashflow() dari modul Finance asli,
 * termasuk saldo berjalan (running balance).
 */
function get_combined_cashflow(PDO $pdo): array
{
    $list = [];

    // 1. AR -> Cashflow
    $arRows = $pdo->query("
        SELECT ar.*, c.nama AS customer_nama, wo.wo_number
        FROM account_receivable ar
        LEFT JOIN customers c ON c.id = ar.customer_id
        LEFT JOIN work_orders wo ON wo.id = ar.wo_id
    ")->fetchAll();

    foreach ($arRows as $ar) {
        $ppn = (bool) $ar['is_ppn'] ? round((float) $ar['penjualan'] * 0.11, 2) : (float) $ar['ppn'];
        $ppn030 = (bool) $ar['is_ppn030'] ? round((float) $ar['penjualan'] * 0.11, 2) : (float) $ar['ppn030'];
        $sisa = ((float) $ar['penjualan'] + $ppn) - (float) $ar['terbayar'] - (float) $ar['pph23'] - $ppn030 - (float) $ar['biaya_lain'];

        $tgl = $ar['due_date'];
        $status = 'PENDING';
        $nominal = (float) $ar['penjualan'] + $ppn;
        if ((float) $ar['terbayar'] > 0 && $ar['tgl_bayar']) {
            $tgl = $ar['tgl_bayar'];
            $status = $sisa <= 0 ? 'TERBAYAR LUNAS' : 'PARTIAL';
            $nominal = (float) $ar['terbayar'];
        }

        $list[] = [
            'id' => 'CF-AR-' . $ar['id'],
            'tanggal' => $tgl,
            'kode' => 'Piutang',
            'tp' => 'IN',
            'deskripsi' => '[AR] ' . ($ar['deskripsi'] ?: 'Invoice Piutang') . ' (' . ($ar['customer_nama'] ?: '-') . ')',
            'invoice' => $ar['invoice_no'],
            'pic' => $ar['customer_nama'] ?: '-',
            'wo' => $ar['wo_number'] ?: '-',
            'po' => $ar['po_no'] ?: '-',
            'dpp' => (float) $ar['penjualan'],
            'pph23' => (float) $ar['pph23'],
            'debit' => $nominal,
            'kredit' => 0,
            'status' => $status,
            'is_auto' => true,
            'ref_id' => (int) $ar['id'],
            'source' => 'AR',
        ];
    }

    // 2. AP -> Cashflow
    $apRows = $pdo->query("
        SELECT ap.*, s.nama AS supplier_nama
        FROM account_payable ap
        LEFT JOIN suppliers s ON s.id = ap.supplier_id
    ")->fetchAll();

    foreach ($apRows as $ap) {
        $ppn = (bool) $ap['is_ppn'] ? round((float) $ap['pembelian'] * 0.11, 2) : (float) $ap['ppn'];
        $pph23 = (bool) $ap['is_pph23'] ? round((float) $ap['pembelian'] * 0.02, 2) : (float) $ap['pph23'];
        $sisa = ((float) $ap['pembelian'] + $ppn) - (float) $ap['terbayar'] - $pph23 - (float) $ap['biaya_lain'];

        $tgl = $ap['due_date'];
        $status = 'PENDING';
        $nominal = (float) $ap['pembelian'] + $ppn;
        if ((float) $ap['terbayar'] > 0 && $ap['tgl_bayar']) {
            $tgl = $ap['tgl_bayar'];
            $status = $sisa <= 0 ? 'TERBAYAR LUNAS' : 'PARTIAL';
            $nominal = (float) $ap['terbayar'];
        }

        $list[] = [
            'id' => 'CF-AP-' . $ap['id'],
            'tanggal' => $tgl,
            'kode' => 'Hutang',
            'tp' => 'OUT',
            'deskripsi' => '[AP] ' . ($ap['deskripsi'] ?: 'Tagihan Supplier') . ' (' . ($ap['supplier_nama'] ?: '-') . ')',
            'invoice' => $ap['invoice_no'],
            'pic' => $ap['supplier_nama'] ?: '-',
            'wo' => '-',
            'po' => $ap['po_no'] ?: '-',
            'dpp' => (float) $ap['pembelian'],
            'pph23' => $pph23,
            'debit' => 0,
            'kredit' => $nominal,
            'status' => $status,
            'is_auto' => true,
            'ref_id' => (int) $ap['id'],
            'source' => 'AP',
        ];
    }

    // 3. Manual Cashflow
    $manualRows = $pdo->query("SELECT * FROM manual_cashflow")->fetchAll();
    foreach ($manualRows as $m) {
        $list[] = [
            'id' => 'CF-MAN-' . $m['id'],
            'tanggal' => $m['tanggal'],
            'kode' => $m['kode'],
            'tp' => $m['tp'],
            'deskripsi' => $m['deskripsi'],
            'invoice' => $m['invoice_ref'] ?: '-',
            'pic' => $m['pic'] ?: '-',
            'wo' => $m['wo_no'] ?: '-',
            'po' => $m['po_no'] ?: '-',
            'dpp' => (float) $m['dpp'],
            'pph23' => (float) $m['pph23'],
            'debit' => $m['tp'] === 'IN' ? (float) $m['nominal'] : 0,
            'kredit' => $m['tp'] === 'OUT' ? (float) $m['nominal'] : 0,
            'status' => $m['status'],
            'is_auto' => false,
            'ref_id' => (int) $m['id'],
            'source' => 'MANUAL',
        ];
    }

    // Urutkan kronologis (tanggal kosong/null taruh di akhir), hitung saldo berjalan.
    usort($list, function ($a, $b) {
        if (!$a['tanggal'] && !$b['tanggal']) return 0;
        if (!$a['tanggal']) return 1;
        if (!$b['tanggal']) return -1;
        return strcmp((string) $a['tanggal'], (string) $b['tanggal']);
    });

    $runningSaldo = 0.0;
    foreach ($list as &$item) {
        $runningSaldo += ($item['debit'] - $item['kredit']);
        $item['saldo'] = $runningSaldo;
    }
    unset($item);

    return $list;
}
