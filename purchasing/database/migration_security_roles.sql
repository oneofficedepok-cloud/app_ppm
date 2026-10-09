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


-- ---------------------------------------------------------
-- 4. Izin data sensitif (Nilai PO, Profit/Loss, Margin)
--    Default: hanya Admin (otomatis) & Manager Purchasing.
--    Role lain bisa diberi lewat Administrator -> Role Management
--    (centang "Lihat Nilai PO, Profit/Loss & Margin").
--    Hanya diberikan SEKALI (saat belum ada role yang punya izin ini), jadi kalau
--    Admin sudah mengatur/mencabutnya lewat UI, menjalankan ulang file ini tidak
--    mengembalikannya.
-- ---------------------------------------------------------
UPDATE `roles` SET `modules` = CONCAT(`modules`, ',cap_nilai_po:view')
  WHERE `role_key` = 'manager_purchasing' AND `modules` IS NOT NULL AND `modules` <> ''
    AND `modules` NOT LIKE '%cap_nilai_po%'
    AND (SELECT COUNT(*) FROM (SELECT `id` FROM `roles` WHERE `modules` LIKE '%cap_nilai_po%') AS t) = 0;

-- ---------------------------------------------------------
-- 5. Approval PR: Supervisor (tahap 1) -> Manager Produksi (tahap 2 / final)
--    Siapa yang boleh approve diatur di Role Management -> Akses Data Sensitif
--    (centang "Approval PR Tahap 1 / Tahap 2"). Role baru dibuat kalau belum ada;
--    izin approval hanya diberikan SEKALI (saat belum ada role yang memilikinya),
--    jadi pengaturan Admin tidak tertimpa saat file ini dijalankan ulang.
-- ---------------------------------------------------------
INSERT INTO `roles` (`role_key`, `label`, `is_admin`, `is_system`, `modules`) VALUES
('supervisor', 'Supervisor', 0, 0, 'dashboard:view,tracking:view,seal:view'),
('manager_produksi', 'Manager Produksi', 0, 0, 'dashboard:view,transport:view,tracking:edit,seal:edit,mtcdash:edit,mtcdivisi:edit,mtcmaster:view')
ON DUPLICATE KEY UPDATE `role_key` = `role_key`;

UPDATE `roles` SET `modules` = CONCAT(COALESCE(NULLIF(`modules`, ''), 'dashboard:view'), ',cap_pr_approve_spv:view')
  WHERE `role_key` = 'supervisor' AND COALESCE(`modules`, '') NOT LIKE '%cap_pr_approve_spv%'
    AND (SELECT COUNT(*) FROM (SELECT `id` FROM `roles` WHERE `modules` LIKE '%cap_pr_approve_spv%') AS t) = 0;

UPDATE `roles` SET `modules` = CONCAT(COALESCE(NULLIF(`modules`, ''), 'dashboard:view'), ',cap_pr_approve_mgr:view')
  WHERE `role_key` = 'manager_produksi' AND COALESCE(`modules`, '') NOT LIKE '%cap_pr_approve_mgr%'
    AND (SELECT COUNT(*) FROM (SELECT `id` FROM `roles` WHERE `modules` LIKE '%cap_pr_approve_mgr%') AS t) = 0;

-- ---------------------------------------------------------
-- 6. Proses PR (Staff Purchasing): yang boleh mengisi Harga, PO, Supplier, Status, dll.
--    Pembuat PR hanya mengisi data barang. Diberikan ke semua role Purchasing / Buyer
--    (Staff & Manager Purchasing). Catatan: aplikasi juga otomatis memberi izin ini ke
--    role bernama Purchasing / Buyer yang bisa membuka menu PR.
-- ---------------------------------------------------------
UPDATE `roles` SET `modules` = CONCAT(COALESCE(NULLIF(`modules`, ''), 'dashboard:edit'), ',cap_pr_proses:view')
  WHERE (`role_key` IN ('staff_purchasing', 'buyer', 'manager_purchasing')
         OR `role_key` LIKE '%purchas%' OR `label` LIKE '%purchas%' OR `role_key` LIKE '%buyer%' OR `label` LIKE '%buyer%')
    AND COALESCE(`is_admin`, 0) = 0
    AND COALESCE(`modules`, '') NOT LIKE '%cap_pr_proses%';
