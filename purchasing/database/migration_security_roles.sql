-- =========================================================
--  MIGRASI: Hak Akses per Modul + Keamanan Login
--
--  Isi:
--   1. Kolom roles.modules  -> daftar menu + level (Lihat/Ubah) yang boleh
--      diakses role (dicentang admin di Administrator -> Role Management)
--   2. Tabel login_attempts -> pembatas percobaan login (anti brute-force)
--   3. Role baru "Staff Purchasing" & "Staff Gudang" + hak akses default tiap role
--
--  AMAN dijalankan di database LIVE: tidak menghapus data apapun,
--  dan boleh dijalankan berulang (IF NOT EXISTS / hanya mengisi
--  modul untuk role yang belum pernah diatur).
--
--  Cara pakai: phpMyAdmin -> pilih database -> tab SQL -> paste -> Go.
--  Butuh MariaDB 10.0.2+ (XAMPP & hosting cPanel umumnya sudah MariaDB).
--
--  Format isi kolom roles.modules (diatur otomatis lewat UI, tidak perlu diketik manual):
--    "menu:level,menu:level"  contoh: "dashboard:edit,transport:view,stok:edit"
--    level: view = hanya lihat, edit = boleh tambah/ubah/hapus
--    Nama modul saja (mis. "purchasing,gudang") juga diterima = semua menu di modul itu level edit.
--  Role dengan "Akses Admin Penuh" otomatis boleh SEMUA menu.
--
--  Sudah pernah menjalankan versi sebelumnya file ini? Jalankan lagi saja -
--  aman, dan kolom modules akan diperbesar ke TEXT.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Kolom daftar modul per role
-- ---------------------------------------------------------
ALTER TABLE `roles`
  ADD COLUMN IF NOT EXISTS `modules` TEXT NULL AFTER `is_system`;
ALTER TABLE `roles`
  MODIFY COLUMN `modules` TEXT NULL
  COMMENT 'hak akses: menu:level dipisah koma, mis. dashboard:edit,stok:view (diabaikan jika is_admin=1)';

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
('staff_purchasing', 'Staff Purchasing', 0, 0, 'purchasing,gudang'),
('staff_gudang', 'Staff Gudang', 0, 0,
 'stok:edit,incoming:edit,receiving:edit,produksi:edit,riwayat:edit,tracking:view,seal:view,dashboard:view')
ON DUPLICATE KEY UPDATE `role_key` = `role_key`;

-- Manager Purchasing: semua modul (tanpa menu Administrator / kelola user)
UPDATE `roles` SET `modules` = 'purchasing,produksi,masterdata,gudang,finance,mtc'
  WHERE `role_key` = 'manager_purchasing' AND (`modules` IS NULL OR `modules` = '');

-- Leader & Buyer: sama seperti staff purchasing
UPDATE `roles` SET `modules` = 'purchasing,gudang'
  WHERE `role_key` IN ('leader', 'buyer') AND (`modules` IS NULL OR `modules` = '');

-- User (Pemohon): hanya bisa buat & pantau PR
UPDATE `roles` SET `modules` = 'dashboard:edit'
  WHERE `role_key` = 'user' AND (`modules` IS NULL OR `modules` = '');

-- Role lain buatan Anda sendiri yang belum diatur: TIDAK diberi modul apapun
-- (aman secara default). Atur lewat menu Administrator -> Role Management.
