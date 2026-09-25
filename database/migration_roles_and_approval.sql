-- =========================================================
--  MIGRASI: Role Management + Alur Approval PR
--  (Buyer buat -> Leader cek -> Manager Purchasing approve)
--
--  AMAN dijalankan di database yang SUDAH ADA datanya.
--  TIDAK menghapus data apapun.
--
--  Cara pakai: phpMyAdmin -> pilih database Anda -> tab SQL ->
--  paste seluruh isi file ini -> Go.
-- =========================================================

-- ---------------------------------------------------------
-- BAGIAN 1: Tabel roles (dikelola lewat menu Role Management)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `roles` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `role_key`   VARCHAR(50) NOT NULL UNIQUE,
  `label`      VARCHAR(100) NOT NULL,
  `is_admin`   TINYINT(1) NOT NULL DEFAULT 0,
  `is_system`  TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `roles` (`role_key`,`label`,`is_admin`,`is_system`) VALUES
('admin', 'Admin', 1, 1),
('manager_purchasing', 'Manager Purchasing', 0, 0),
('leader', 'Leader', 0, 0),
('buyer', 'Buyer', 0, 0),
('user', 'User (Pemohon)', 0, 1)
ON DUPLICATE KEY UPDATE label = VALUES(label);

-- Ubah kolom users.role dari ENUM kaku jadi VARCHAR dinamis + hubungkan ke tabel roles.
-- Aman: nilai role yang sudah ada (admin/user/leader/dst) otomatis cocok dengan role_key di atas.
ALTER TABLE `users` MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'user';

-- Kalau constraint ini sudah pernah dibuat sebelumnya (misal Anda sudah jalankan migrasi role
-- di sesi sebelumnya), baris ALTER di bawah akan gagal dengan error "duplicate key name" —
-- itu NORMAL, artinya sudah terpasang, lewati saja error tersebut dan lanjut ke BAGIAN 2.
ALTER TABLE `users` ADD CONSTRAINT `fk_users_role` FOREIGN KEY (`role`) REFERENCES `roles`(`role_key`) ON UPDATE CASCADE;


-- ---------------------------------------------------------
-- BAGIAN 2: Kolom alur approval PR (Buyer -> Leader -> Manager)
-- ---------------------------------------------------------
ALTER TABLE `pr_items`
  ADD COLUMN `approval_status` ENUM('PENDING_LEADER','PENDING_MANAGER','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING_LEADER' AFTER `keterangan`,
  ADD COLUMN `leader_id` INT UNSIGNED NULL AFTER `approval_status`,
  ADD COLUMN `leader_checked_at` TIMESTAMP NULL AFTER `leader_id`,
  ADD COLUMN `leader_note` VARCHAR(255) NULL AFTER `leader_checked_at`,
  ADD COLUMN `manager_id` INT UNSIGNED NULL AFTER `leader_note`,
  ADD COLUMN `manager_approved_at` TIMESTAMP NULL AFTER `manager_id`,
  ADD COLUMN `manager_note` VARCHAR(255) NULL AFTER `manager_approved_at`;

ALTER TABLE `pr_items`
  ADD CONSTRAINT `fk_pr_leader` FOREIGN KEY (`leader_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_pr_manager` FOREIGN KEY (`manager_id`) REFERENCES `users`(`id`) ON DELETE SET NULL;

-- PR LAMA yang statusnya sudah lanjut (RECEIVED/PO ISSUED/STORE ROOM) dianggap sudah
-- selesai/approved secara otomatis, supaya data lama tidak tiba-tiba nyangkut di
-- antrian approval. PR lama yang masih 'ON PROSES' akan tetap di 'PENDING_LEADER'
-- (perlu di-cek/approve manual, atau Anda proses massal lewat query sendiri kalau perlu).
UPDATE `pr_items` SET `approval_status` = 'APPROVED' WHERE `status` IN ('RECEIVED','PO ISSUED','STORE ROOM');


-- ---------------------------------------------------------
-- BAGIAN 3 (OPSIONAL): Contoh assign role Leader/Manager Purchasing/Buyer
-- ke user yang sudah ada. EDIT username-nya sesuai user Anda, lalu jalankan
-- baris yang relevan saja (hapus tanda -- di depannya untuk mengaktifkan).
-- Atau, lebih mudah: lakukan ini lewat menu Master User & Divisi di aplikasi.
-- ---------------------------------------------------------
-- UPDATE users SET role = 'leader' WHERE username = 'GANTI_USERNAME_LEADER';
-- UPDATE users SET role = 'manager_purchasing' WHERE username = 'GANTI_USERNAME_MANAGER';
-- UPDATE users SET role = 'buyer' WHERE username = 'GANTI_USERNAME_BUYER';
