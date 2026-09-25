-- =========================================================
--  MIGRASI: Hak Akses per Modul + Keamanan Login
--
--  Isi:
--   1. Kolom roles.modules  -> daftar modul yang boleh diakses role
--      (dicentang admin di menu Administrator -> Role Management)
--   2. Tabel login_attempts -> pembatas percobaan login (anti brute-force)
--   3. Role baru "Staff Purchasing" + hak akses default tiap role
--
--  AMAN dijalankan di database LIVE: tidak menghapus data apapun,
--  dan boleh dijalankan berulang (IF NOT EXISTS / hanya mengisi
--  modul untuk role yang belum pernah diatur).
--
--  Cara pakai: phpMyAdmin -> pilih database -> tab SQL -> paste -> Go.
--  Butuh MariaDB 10.0.2+ (XAMPP & hosting cPanel umumnya sudah MariaDB).
--
--  Kode modul yang valid:
--    purchasing, produksi, masterdata, gudang, finance, mtc
--  Role dengan "Akses Admin Penuh" otomatis boleh SEMUA modul.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Kolom daftar modul per role
-- ---------------------------------------------------------
ALTER TABLE `roles`
  ADD COLUMN IF NOT EXISTS `modules` VARCHAR(255) NULL
  COMMENT 'daftar modul dipisah koma, mis. purchasing,gudang (diabaikan jika is_admin=1)'
  AFTER `is_system`;

-- ---------------------------------------------------------
-- 2. Catatan percobaan login gagal (dibersihkan otomatis > 1 hari)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `username`     VARCHAR(100) NOT NULL,
  `ip_address`   VARCHAR(45) NOT NULL,
  `attempted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_user (`username`, `attempted_at`),
  INDEX idx_login_ip (`ip_address`, `attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- 3. Role & hak akses default
--    (hanya diisi untuk role yang modules-nya masih kosong/NULL,
--     jadi pengaturan yang sudah Anda ubah lewat UI tidak ditimpa)
-- ---------------------------------------------------------
INSERT INTO `roles` (`role_key`, `label`, `is_admin`, `is_system`, `modules`) VALUES
('staff_purchasing', 'Staff Purchasing', 0, 0, 'purchasing,gudang')
ON DUPLICATE KEY UPDATE `role_key` = `role_key`;

-- Manager Purchasing: semua modul (tanpa menu Administrator / kelola user)
UPDATE `roles` SET `modules` = 'purchasing,produksi,masterdata,gudang,finance,mtc'
  WHERE `role_key` = 'manager_purchasing' AND (`modules` IS NULL OR `modules` = '');

-- Leader & Buyer: sama seperti staff purchasing
UPDATE `roles` SET `modules` = 'purchasing,gudang'
  WHERE `role_key` IN ('leader', 'buyer') AND (`modules` IS NULL OR `modules` = '');

-- User (Pemohon): hanya bisa buat & pantau PR
UPDATE `roles` SET `modules` = 'purchasing'
  WHERE `role_key` = 'user' AND (`modules` IS NULL OR `modules` = '');

-- Role lain buatan Anda sendiri yang belum diatur: TIDAK diberi modul apapun
-- (aman secara default). Atur lewat menu Administrator -> Role Management.
