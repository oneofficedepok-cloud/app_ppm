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

/** Kolom pr_items.buyer_user_id (Buyer = user Staff Purchasing) - ditambahkan otomatis bila belum ada. */
function pr_buyer_column_ensure(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $has = $pdo->query("SHOW COLUMNS FROM pr_items LIKE 'buyer_user_id'")->fetch();
    if (!$has) {
        $pdo->exec("ALTER TABLE pr_items ADD COLUMN buyer_user_id INT UNSIGNED NULL COMMENT 'Buyer (user Staff Purchasing) yang memproses PR' AFTER buyer_id, ADD INDEX idx_pr_buyer_user (buyer_user_id)");
    }
    $done = true;
}

/** Pilihan Buyer di form PR: user aktif dengan role Staff Purchasing (atau Buyer). */
function pr_buyer_users(PDO $pdo): array
{
    return $pdo->query(
        "SELECT u.id, u.full_name, u.username, COALESCE(r.label, u.role) AS role_label
         FROM users u LEFT JOIN roles r ON r.role_key = u.role
         WHERE u.status = 'AKTIF'
           AND (u.role = 'staff_purchasing' OR r.label LIKE '%staff purchasing%'
                OR u.role LIKE '%buyer%' OR r.label LIKE '%buyer%')
         ORDER BY u.full_name"
    )->fetchAll();
}

/** Validasi Buyer yang dipilih: harus user Staff Purchasing aktif (atau kosong). */
function pr_valid_buyer_user(PDO $pdo, $value, ?int $current = null): ?int
{
    $id = to_int_or_null($value);
    if (!$id) return null;
    if ($current !== null && $id === $current) return $id; // buyer lama tetap boleh walau role-nya sudah pindah
    if (!in_array($id, array_map('intval', array_column(pr_buyer_users($pdo), 'id')), true)) {
        json_error('Buyer yang dipilih harus user aktif dengan role Staff Purchasing.', 422);
    }
    return $id;
}
