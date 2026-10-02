<?php
/**
 * Fungsi bersama Work Order - dipakai api/work_orders.php (input manual)
 * DAN api/import.php (import Excel), supaya rumus & penomoran selalu sama.
 */

/**
 * Hitung DPP/PPN/PPh23/PPh Lain/Total nilai jual WO di SERVER
 * (jangan percaya angka dari browser) - meniru persis formula calcWO()
 * dari modul Finance asli: dpp = qty*harga - diskon; ppn = dpp*11% kalau YA;
 * pph23 = dpp*2% kalau YA; pphLain = dpp*(pct/100); total = dpp+ppn-pph23-pphLain.
 */
function calc_wo_finance(float $qty, float $harga, float $diskon, bool $isPpn, bool $isPph23, float $pphLainPct): array
{
    $dpp = ($qty * $harga) - $diskon;
    $ppn = $isPpn ? round($dpp * 0.11, 2) : 0.0;
    $pph23 = $isPph23 ? round($dpp * 0.02, 2) : 0.0;
    $pphLain = round($dpp * ($pphLainPct / 100), 2);
    $total = $dpp + $ppn - $pph23 - $pphLain;
    return [$dpp, $ppn, $pph23, $pphLain, $total];
}

/** Prefix No. WO otomatis mengikuti Kategori WO: PROJECT polos, MAINTENANCE "M-", INVENTARIS "A-". */
function wo_category_prefix(string $category): string
{
    if ($category === 'MAINTENANCE') return 'WO-M-';
    if ($category === 'INVENTARIS') return 'WO-A-';
    return 'WO-' . date('Y') . '-';
}

/** Generate No. WO otomatis & unik untuk kategori terkait (auto, tapi tetap boleh diedit manual di form). */
function generate_wo_number(PDO $pdo, string $category): string
{
    $prefix = wo_category_prefix($category);
    $stmt = $pdo->prepare("SELECT wo_number FROM work_orders WHERE wo_number LIKE :like ORDER BY wo_number DESC LIMIT 1");
    $stmt->execute([':like' => $prefix . '%']);
    $last = $stmt->fetchColumn();

    $nextNum = 1;
    if ($last) {
        $numPart = (int) substr($last, strlen($prefix));
        $nextNum = $numPart + 1;
    }
    return $prefix . str_pad((string) $nextNum, 3, '0', STR_PAD_LEFT);
}

/**
 * Total biaya MTC (Modul Divisi Produksi) per Item Pekerjaan sebuah WO.
 * Return: [nama_item (huruf kecil, tanpa spasi tepi) => ['total' => float, 'records' => int]]
 * Hanya item yang SUDAH punya record MTC yang muncul di hasil.
 */
function mtc_totals_per_item(PDO $pdo, int $woId): array
{
    try {
        $stmt = $pdo->prepare(
            'SELECT r.nama_item, COUNT(DISTINCT r.id) AS records, COALESCE(SUM(i.total), 0) AS total
             FROM mtc_divisi_records r
             LEFT JOIN mtc_divisi_items i ON i.record_id = r.id
             WHERE r.wo_id = :wo
             GROUP BY r.nama_item'
        );
        $stmt->execute([':wo' => $woId]);
    } catch (PDOException $e) {
        return []; // tabel MTC belum ada (migration_sync_live.sql belum dijalankan)
    }
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $key = mb_strtolower(trim((string) $row['nama_item']));
        $out[$key] = [
            'total'   => ($out[$key]['total'] ?? 0) + (float) $row['total'],
            'records' => ($out[$key]['records'] ?? 0) + (int) $row['records'],
        ];
    }
    return $out;
}

/**
 * Terapkan total MTC ke baris Item Pekerjaan (kolom "actual"): item yang sudah
 * punya record di Modul Divisi Produksi memakai total MTC-nya, item lain tetap
 * memakai angka manual. Menandai 'actual_from_mtc' untuk tampilan form WO.
 */
function apply_mtc_actuals(array $items, array $mtcTotals): array
{
    foreach ($items as &$it) {
        $key = mb_strtolower(trim((string) $it['nama_item']));
        $it['actual_from_mtc'] = isset($mtcTotals[$key]);
        if ($it['actual_from_mtc']) {
            $it['actual'] = $mtcTotals[$key]['total'];
        }
    }
    unset($it);
    return $items;
}

/**
 * Simpan total MTC ke database: kolom actual tiap Item Pekerjaan dan
 * work_orders.aktual_prod (= jumlah actual semua Item Pekerjaan).
 * Dipanggil setiap kali record MTC atau WO disimpan, supaya angka di semua
 * menu (WO & Budget, P/L, Finance) selalu sama dengan Modul Divisi Produksi.
 */
function sync_wo_actual_from_mtc(PDO $pdo, int $woId): void
{
    $stmt = $pdo->prepare('SELECT id, nama_item, actual FROM work_order_budget_items WHERE wo_id = :wo');
    $stmt->execute([':wo' => $woId]);
    $items = $stmt->fetchAll();
    if (!$items) return; // WO tanpa Item Pekerjaan: aktual_prod tetap input manual

    $items = apply_mtc_actuals($items, mtc_totals_per_item($pdo, $woId));
    $upd = $pdo->prepare('UPDATE work_order_budget_items SET actual = :a WHERE id = :id');
    $sum = 0.0;
    foreach ($items as $it) {
        if ($it['actual_from_mtc']) $upd->execute([':a' => $it['actual'], ':id' => $it['id']]);
        $sum += (float) $it['actual'];
    }
    $pdo->prepare('UPDATE work_orders SET aktual_prod = :a WHERE id = :id')->execute([':a' => $sum, ':id' => $woId]);
}
