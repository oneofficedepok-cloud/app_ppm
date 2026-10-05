<?php
/**
 * Rumus Finance bersama - dipakai input manual (api/account_receivable.php,
 * api/account_payable.php) DAN import Excel (api/import.php), supaya hasilnya selalu sama.
 */

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

/** Hitung PPN/PPh23/Sisa Hutang di SERVER - meniru formula calcAP() asli. */
function calc_ap(float $pembelian, bool $isPpn, bool $isPph23, float $biayaLain, float $terbayar): array
{
    $ppn = $isPpn ? round($pembelian * 0.11, 2) : 0.0;
    $pph23 = $isPph23 ? round($pembelian * 0.02, 2) : 0.0;
    $totalHutang = $pembelian + $ppn;
    $sisa = $totalHutang - $terbayar - $pph23 - $biayaLain;
    return [$ppn, $pph23, $sisa];
}

/** Fallback: kalau due_date tidak dikirim client, hitung dari tgl_kirim (AR) / tgl_terima (AP) + TOP hari. */
function resolve_due_date(?string $dueDate, ?string $baseDate, int $topDays): ?string
{
    if ($dueDate) return $dueDate;
    if (!$baseDate) return null;
    $ts = strtotime($baseDate);
    if ($ts === false) return null;
    return date('Y-m-d', strtotime("+{$topDays} days", $ts));
}
