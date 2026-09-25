<?php
/**
 * Fungsi bersama Purchase Request - dipakai api/pr_items.php (input manual)
 * DAN api/import.php (import Excel), supaya rumus & penomoran selalu sama.
 */

/**
 * Hitung ulang DPP / PPN / Total di SERVER (jangan percaya angka dari client).
 * Ini best practice penting: di versi front-end lama, semua kalkulasi
 * dilakukan di browser sehingga user teknis bisa memanipulasi Total lewat console.
 */
function calc_ppn(float $qty, float $harga, bool $isPpn, float $ppnRate): array
{
    $dpp = $qty * $harga;
    $ppnAmount = $isPpn ? round($dpp * ($ppnRate / 100), 2) : 0.0;
    $total = $dpp + $ppnAmount;
    return [$dpp, $ppnAmount, $total];
}

/** Generate nomor PR otomatis sesuai Kategori: P-/G-/STR-/M-/A- + YY + NNNN */
function generate_pr_number(PDO $pdo, string $sheet): string
{
    $prefixMap = [
        'PROJECT'     => 'P-',
        'GENERAL'     => 'G-',
        'CONSUMABLE'  => 'STR-',
        'MAINTENANCE' => 'M-',
        'INVENTARIS'  => 'A-',
    ];
    $prefix = $prefixMap[$sheet] ?? 'P-';
    $year = date('y');
    $like = $prefix . $year . '%';

    $stmt = $pdo->prepare("SELECT pr_number FROM pr_items WHERE pr_number LIKE :like ORDER BY pr_number DESC LIMIT 1");
    $stmt->execute([':like' => $like]);
    $last = $stmt->fetchColumn();

    $nextNum = 1;
    if ($last) {
        $numPart = (int) substr($last, strlen($prefix . $year));
        $nextNum = $numPart + 1;
    }
    return $prefix . $year . str_pad((string) $nextNum, 4, '0', STR_PAD_LEFT);
}

const PR_SHEET_VALUES = ['PROJECT', 'GENERAL', 'CONSUMABLE', 'MAINTENANCE', 'INVENTARIS'];
