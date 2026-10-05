<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/wo_functions.php';

// Baca: menu AR + Finance Dashboard & Cash Flow (rekap). Ubah: menu AR.
require_perm(['ar', 'findash', 'cashflow'], ['ar']);

$method = http_method();
$pdo = db();

/**
 * Hitung PPN/PPN030/Sisa Piutang di SERVER - meniru formula calcAR() asli:
 * ppn = penjualan*11% kalau YA; ppn030 = penjualan*11% kalau YA (pajak terpisah);
 * totalPiutang = penjualan + ppn; sisa = totalPiutang - terbayar - pph23 - ppn030 - biayaLain.
 */
function calc_ar(float $penjualan, bool $isPpn, bool $isPpn030, float $pph23, float $biayaLain, float $terbayar): array
{
    $ppn = $isPpn ? round($penjualan * 0.11, 2) : 0.0;
    $ppn030 = $isPpn030 ? round($penjualan * 0.11, 2) : 0.0;
    $totalPiutang = $penjualan + $ppn;
    $sisa = $totalPiutang - $terbayar - $pph23 - $ppn030 - $biayaLain;
    return [$ppn, $ppn030, $sisa];
}

/** Fallback: kalau due_date tidak dikirim client, hitung dari tgl_kirim + TOP hari. */
function resolve_due_date(?string $dueDate, ?string $baseDate, int $topDays): ?string
{
    if ($dueDate) return $dueDate;
    if (!$baseDate) return null;
    $ts = strtotime($baseDate);
    if ($ts === false) return null;
    return date('Y-m-d', strtotime("+{$topDays} days", $ts));
}

/**
 * WO yang termasuk invoice AR ini = WO yang dicentang user di form (wo_ids).
 * Pemanggil lama yang masih mengirim wo_id tunggal tetap didukung.
 */
function resolve_ar_wos(PDO $pdo, array $b): array
{
    $raw = arr_val($b, 'wo_ids', null);
    if (!is_array($raw)) {
        $legacy = to_int_or_null(arr_val($b, 'wo_id'));
        $raw = $legacy ? [$legacy] : [];
    }
    [$ids] = valid_wo_ids($pdo, $raw);
    if (count($ids) > 1 && !ar_wo_link_ready($pdo)) {
        json_error('Untuk 1 invoice dengan beberapa WO, jalankan dulu database/migration_ar_multi_wo.sql.', 422);
    }
    return [$ids];
}

/** Simpan daftar WO sebuah invoice AR (hapus yang lama, isi yang baru). */
function save_ar_wo_links(PDO $pdo, int $arId, array $woIds): void
{
    if (!ar_wo_link_ready($pdo)) return;
    $pdo->prepare('DELETE FROM account_receivable_wo WHERE ar_id = :ar')->execute([':ar' => $arId]);
    $ins = $pdo->prepare('INSERT INTO account_receivable_wo (ar_id, wo_id) VALUES (:ar, :wo)');
    foreach ($woIds as $woId) $ins->execute([':ar' => $arId, ':wo' => $woId]);
}

switch ($method) {

    case 'GET':
        if (isset($_GET['action']) && $_GET['action'] === 'auto_fill') {
            // Dipakai form AR: WO yang dicentang -> auto-isi Penjualan (jumlah DPP), PPN & PPh23.
            $ids = array_filter(array_map('intval', explode(',', (string) ($_GET['wo_ids'] ?? ''))));
            [$woIds] = valid_wo_ids($pdo, array_values($ids));
            $wos = [];
            if ($woIds) {
                $ph = implode(',', array_fill(0, count($woIds), '?'));
                $stmt = $pdo->prepare("SELECT nilai_po, project, is_ppn, pph23 FROM work_orders WHERE id IN ($ph) ORDER BY wo_number");
                $stmt->execute($woIds);
                $wos = $stmt->fetchAll();
            }
            // Role tanpa izin "Lihat Nilai PO": nilai PO WO tidak dikirim (Penjualan diisi manual).
            $canNilai = can_see_nilai_po(current_user());
            json_success([
                'penjualan' => $canNilai ? array_sum(array_map(fn($w) => (float) $w['nilai_po'], $wos)) : null,
                'pph23'     => $canNilai ? array_sum(array_map(fn($w) => (float) $w['pph23'], $wos)) : null,
                'is_ppn'    => (int) ($wos[0]['is_ppn'] ?? 1),
                'deskripsi' => implode(' / ', array_values(array_unique(array_filter(array_column($wos, 'project'))))),
            ]);
        }

        $woList = ar_wo_link_ready($pdo)
            ? "(SELECT GROUP_CONCAT(w2.wo_number ORDER BY w2.wo_number SEPARATOR ', ')
                FROM account_receivable_wo l JOIN work_orders w2 ON w2.id = l.wo_id WHERE l.ar_id = ar.id)"
            : 'wo.wo_number';
        $woIdList = ar_wo_link_ready($pdo)
            ? '(SELECT GROUP_CONCAT(l2.wo_id) FROM account_receivable_wo l2 WHERE l2.ar_id = ar.id)'
            : 'ar.wo_id';
        $sql = "
            SELECT ar.*, c.nama AS customer_nama, wo.wo_number, $woList AS wo_numbers, $woIdList AS wo_id_list
            FROM account_receivable ar
            LEFT JOIN customers c ON c.id = ar.customer_id
            LEFT JOIN work_orders wo ON wo.id = ar.wo_id
            ORDER BY ar.tgl_invoice DESC, ar.id DESC
        ";
        $rows = $pdo->query($sql)->fetchAll();
        foreach ($rows as &$a) {
            [$ppn, $ppn030, $sisa] = calc_ar(
                (float) $a['penjualan'], (bool) $a['is_ppn'], (bool) $a['is_ppn030'],
                (float) $a['pph23'], (float) $a['biaya_lain'], (float) $a['terbayar']
            );
            $a['sisa_piutang'] = $sisa;
            $a['wo_ids'] = $a['wo_id_list'] ? array_map('intval', explode(',', (string) $a['wo_id_list'])) : [];
            unset($a['wo_id_list']);
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

        $penjualan = to_float(arr_val($b, 'penjualan', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', true);
        $isPpn030 = (bool) arr_val($b, 'is_ppn030', false);
        $pph23 = to_float(arr_val($b, 'pph23', 0));
        $biayaLain = to_float(arr_val($b, 'biaya_lain', 0));
        $terbayar = to_float(arr_val($b, 'terbayar', 0));
        [$ppn, $ppn030, $sisa] = calc_ar($penjualan, $isPpn, $isPpn030, $pph23, $biayaLain, $terbayar);
        [$woIds] = resolve_ar_wos($pdo, $b);

        $stmt = $pdo->prepare(
            'INSERT INTO account_receivable
             (invoice_no, tgl_invoice, tgl_kirim, customer_id, wo_id, po_no, deskripsi, penjualan,
              is_ppn, ppn, is_ppn030, ppn030, pph23, biaya_lain, top_days, due_date, faktur_pajak, terbayar, tgl_bayar)
             VALUES (:inv, :tgl, :tglkirim, :cust, :wo, :po, :desk, :penjualan,
              :isppn, :ppn, :isppn030, :ppn030, :pph23, :biayalain, :top, :due, :faktur, :terbayar, :tglbayar)'
        );
        try {
            $topDays = (int) to_float(arr_val($b, 'top_days', 30));
            $dueDate = resolve_due_date(arr_val($b, 'due_date') ?: null, arr_val($b, 'tgl_kirim') ?: null, $topDays);
            $stmt->execute([
                ':inv' => $invoice, ':tgl' => $tglInv, ':tglkirim' => arr_val($b, 'tgl_kirim') ?: null,
                ':cust' => to_int_or_null(arr_val($b, 'customer_id')), ':wo' => $woIds[0] ?? null,
                ':po' => arr_val($b, 'po_no', ''), ':desk' => arr_val($b, 'deskripsi', ''), ':penjualan' => $penjualan,
                ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn, ':isppn030' => $isPpn030 ? 1 : 0, ':ppn030' => $ppn030,
                ':pph23' => $pph23, ':biayalain' => $biayaLain, ':top' => $topDays,
                ':due' => $dueDate, ':faktur' => arr_val($b, 'faktur_pajak', ''),
                ':terbayar' => $terbayar, ':tglbayar' => arr_val($b, 'tgl_bayar') ?: null,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. Invoice ini sudah pernah dipakai.', 409);
            throw $e;
        }

        $newId = (int) $pdo->lastInsertId();
        save_ar_wo_links($pdo, $newId, $woIds);
        log_activity('create', 'account_receivable', $newId, $invoice);
        json_success(['id' => $newId, 'sisa_piutang' => $sisa], 'Record AR berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $invoice = clean_str(arr_val($b, 'invoice_no', ''));
        if (!$id || $invoice === '') {
            json_error('ID dan No. Invoice wajib diisi.', 422);
        }

        $penjualan = to_float(arr_val($b, 'penjualan', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', true);
        $isPpn030 = (bool) arr_val($b, 'is_ppn030', false);
        $pph23 = to_float(arr_val($b, 'pph23', 0));
        $biayaLain = to_float(arr_val($b, 'biaya_lain', 0));
        $terbayar = to_float(arr_val($b, 'terbayar', 0));
        [$ppn, $ppn030, $sisa] = calc_ar($penjualan, $isPpn, $isPpn030, $pph23, $biayaLain, $terbayar);
        [$woIds] = resolve_ar_wos($pdo, $b);

        $stmt = $pdo->prepare(
            'UPDATE account_receivable SET
                invoice_no = :inv, tgl_invoice = :tgl, tgl_kirim = :tglkirim, customer_id = :cust, wo_id = :wo,
                po_no = :po, deskripsi = :desk, penjualan = :penjualan, is_ppn = :isppn, ppn = :ppn,
                is_ppn030 = :isppn030, ppn030 = :ppn030, pph23 = :pph23, biaya_lain = :biayalain,
                top_days = :top, due_date = :due, faktur_pajak = :faktur, terbayar = :terbayar, tgl_bayar = :tglbayar
             WHERE id = :id'
        );
        try {
            $topDays = (int) to_float(arr_val($b, 'top_days', 30));
            $dueDate = resolve_due_date(arr_val($b, 'due_date') ?: null, arr_val($b, 'tgl_kirim') ?: null, $topDays);
            $stmt->execute([
                ':inv' => $invoice, ':tgl' => arr_val($b, 'tgl_invoice'), ':tglkirim' => arr_val($b, 'tgl_kirim') ?: null,
                ':cust' => to_int_or_null(arr_val($b, 'customer_id')), ':wo' => $woIds[0] ?? null,
                ':po' => arr_val($b, 'po_no', ''), ':desk' => arr_val($b, 'deskripsi', ''), ':penjualan' => $penjualan,
                ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn, ':isppn030' => $isPpn030 ? 1 : 0, ':ppn030' => $ppn030,
                ':pph23' => $pph23, ':biayalain' => $biayaLain, ':top' => $topDays,
                ':due' => $dueDate, ':faktur' => arr_val($b, 'faktur_pajak', ''),
                ':terbayar' => $terbayar, ':tglbayar' => arr_val($b, 'tgl_bayar') ?: null, ':id' => $id,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. Invoice sudah dipakai record lain.', 409);
            throw $e;
        }

        save_ar_wo_links($pdo, $id, $woIds);
        log_activity('update', 'account_receivable', $id, $invoice);
        json_success(['id' => $id, 'sisa_piutang' => $sisa], 'Record AR berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $stmt = $pdo->prepare('DELETE FROM account_receivable WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'account_receivable', $id, '');
        json_success([], 'Record AR berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
