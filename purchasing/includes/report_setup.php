<?php
/**
 * Report & Pivot Table: tabel report favorit + pemberian akses awal.
 * Dipanggil saat login, jadi tidak perlu import SQL manual.
 */

/**
 * Buat tabel report_presets bila belum ada. Saat tabel BARU dibuat (pertama kali fitur
 * ini dipasang), role Manager Purchasing otomatis diberi akses Report Purchasing (Ubah).
 * Report lain (MTC, AR, AP, Cash Flow) hanya untuk role yang dipilih Admin di Role Management.
 * Setelah itu pengaturan akses sepenuhnya lewat Role Management (tidak ditimpa lagi).
 */
function report_setup(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $done = true;
    try {
        // Versi awal memakai 1 izin 'report' untuk semua report. Sekarang dibagi per jenis report;
        // izin lama dialihkan ke Report Purchasing saja (report lain diberikan Admin sesuai kebutuhan).
        $pdo->exec("UPDATE roles SET modules = REPLACE(REPLACE(modules, 'report:edit', 'rpt_pr:edit'), 'report:view', 'rpt_pr:view')
                    WHERE modules LIKE '%report:%'");
        if ($pdo->query("SHOW TABLES LIKE 'report_presets'")->fetch()) return;
        $pdo->exec(
            "CREATE TABLE IF NOT EXISTS `report_presets` (
               `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
               `user_id`    INT UNSIGNED NOT NULL,
               `name`       VARCHAR(120) NOT NULL,
               `source`     VARCHAR(40) NOT NULL,
               `config`     TEXT NOT NULL,
               `is_shared`  TINYINT(1) NOT NULL DEFAULT 0,
               `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
               `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
               INDEX idx_rp_user (`user_id`)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
        $pdo->exec(
            "UPDATE roles SET modules = CONCAT(COALESCE(NULLIF(modules, ''), 'dashboard:view'), ',rpt_pr:edit')
             WHERE role_key = 'manager_purchasing' AND COALESCE(modules, '') NOT LIKE '%rpt_%'"
        );
    } catch (PDOException $e) {
        // Kolom roles.modules belum ada (migrasi lama belum jalan) - abaikan, login tetap jalan.
    }
}
