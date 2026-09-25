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
