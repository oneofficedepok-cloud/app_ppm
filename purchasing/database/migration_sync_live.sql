-- =========================================================
--  MIGRASI SINKRON: menyamakan struktur database dengan kode aplikasi
--
--  Kenapa file ini ada:
--  Beberapa tabel & kolom yang DIPAKAI kode (Master Karyawan, Item
--  Pekerjaan WO, modul MTC, kolom approval/karyawan di PR & WO) tidak
--  tercatat di schema.sql / migration_*.sql, kemungkinan dulu dibuat
--  langsung lewat phpMyAdmin di server. Tanpa file ini, instalasi baru
--  dari nol akan error di modul-modul tersebut.
--
--  AMAN dijalankan di database LIVE yang sudah ada:
--  semua perintah memakai IF NOT EXISTS, jadi tabel/kolom yang sudah
--  ada TIDAK diubah dan data TIDAK tersentuh. Boleh dijalankan berulang.
--
--  Butuh MariaDB 10.0.2+ (XAMPP & hampir semua hosting cPanel sudah MariaDB).
--
--  Urutan instalasi baru dari nol:
--    1. schema.sql
--    2. migration_gudang_produksi.sql
--    3. migration_sync_live.sql   (file ini)
--  (migration_roles_and_approval.sql & migration_finance_module.sql hanya
--   untuk upgrade database versi lama - isinya sudah termasuk di schema.sql)
-- =========================================================

-- ---------------------------------------------------------
-- 1. MASTER KARYAWAN (nama tanpa akun login, untuk dropdown
--    User Peminta / Atasan / Manager di form PR & WO)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `master_karyawan` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `nama`       VARCHAR(150) NOT NULL,
  `divisi`     VARCHAR(100) NOT NULL DEFAULT 'GENERAL',
  `jabatan`    VARCHAR(100) NULL,
  `status`     ENUM('AKTIF','NON AKTIF') NOT NULL DEFAULT 'AKTIF',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_karyawan_nama (`nama`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- 2. KOLOM TAMBAHAN: pr_items
-- ---------------------------------------------------------
ALTER TABLE `pr_items`
  ADD COLUMN IF NOT EXISTS `penerima_barang`     VARCHAR(150) NULL AFTER `tgl_datang`,
  ADD COLUMN IF NOT EXISTS `karyawan_id`         INT UNSIGNED NULL AFTER `user_id`,
  ADD COLUMN IF NOT EXISTS `atasan_karyawan_id`  INT UNSIGNED NULL AFTER `karyawan_id`,
  ADD COLUMN IF NOT EXISTS `manager_karyawan_id` INT UNSIGNED NULL AFTER `atasan_karyawan_id`;

-- ---------------------------------------------------------
-- 3. KOLOM TAMBAHAN: work_orders
-- ---------------------------------------------------------
ALTER TABLE `work_orders`
  ADD COLUMN IF NOT EXISTS `wo_category`           ENUM('PROJECT','MAINTENANCE','INVENTARIS') NOT NULL DEFAULT 'PROJECT' AFTER `wo_number`,
  ADD COLUMN IF NOT EXISTS `requester_karyawan_id` INT UNSIGNED NULL AFTER `customer_id`,
  ADD COLUMN IF NOT EXISTS `atasan_karyawan_id`    INT UNSIGNED NULL AFTER `requester_karyawan_id`,
  ADD COLUMN IF NOT EXISTS `manager_karyawan_id`   INT UNSIGNED NULL AFTER `atasan_karyawan_id`,
  ADD COLUMN IF NOT EXISTS `budget_lain`           DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `budget_pem`,
  ADD COLUMN IF NOT EXISTS `status`                ENUM('ON PROGRESS','HOLD','CANCEL','DELIVERY','FINISHED') NOT NULL DEFAULT 'ON PROGRESS' AFTER `total_lain`;

-- ---------------------------------------------------------
-- 4. ITEM PEKERJAAN / BUDGET PER WO
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `work_order_budget_items` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `wo_id`      INT UNSIGNED NOT NULL,
  `nama_item`  VARCHAR(255) NOT NULL,
  `qty`        DECIMAL(15,3) NOT NULL DEFAULT 0,
  `budget`     DECIMAL(18,2) NOT NULL DEFAULT 0,
  `actual`     DECIMAL(18,2) NOT NULL DEFAULT 0,
  `status`     ENUM('ON PROCESS','FINISH') NOT NULL DEFAULT 'ON PROCESS',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_wobi_wo (`wo_id`),
  CONSTRAINT fk_wobi_wo FOREIGN KEY (`wo_id`) REFERENCES `work_orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- 5. MODUL MTC PRODUKSI
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mtc_master_mesin` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `kode`       VARCHAR(50) NOT NULL UNIQUE,
  `nama`       VARCHAR(150) NOT NULL,
  `harga`      DECIMAL(18,2) NOT NULL DEFAULT 0,
  `status`     ENUM('AKTIF','NON AKTIF') NOT NULL DEFAULT 'AKTIF',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mtc_master_mp` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `kode`       VARCHAR(50) NOT NULL UNIQUE,
  `divisi`     VARCHAR(100) NOT NULL,
  `harga`      DECIMAL(18,2) NOT NULL DEFAULT 0,
  `status`     ENUM('AKTIF','NON AKTIF') NOT NULL DEFAULT 'AKTIF',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mtc_divisi_records` (
  `id`              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `wo_id`           INT UNSIGNED NOT NULL,
  `nama_item`       VARCHAR(255) NOT NULL,
  `divisi`          VARCHAR(100) NOT NULL,
  `status_workflow` ENUM('NORMAL','REWORK','CLAIM','REJECT') NOT NULL DEFAULT 'NORMAL',
  `pic`             VARCHAR(150) NULL,
  `surat_jalan`     VARCHAR(150) NULL,
  `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mtcrec_wo (`wo_id`),
  CONSTRAINT fk_mtcrec_wo FOREIGN KEY (`wo_id`) REFERENCES `work_orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mtc_divisi_items` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `record_id`  INT UNSIGNED NOT NULL,
  `pekerjaan`  VARCHAR(255) NOT NULL,
  `deskripsi`  TEXT NULL,
  `qty`        DECIMAL(15,3) NOT NULL DEFAULT 0,
  `satuan`     VARCHAR(30) NULL,
  `kode_mesin` VARCHAR(50) NULL,
  `harga`      DECIMAL(18,2) NOT NULL DEFAULT 0,
  `total`      DECIMAL(18,2) NOT NULL DEFAULT 0,
  `status`     VARCHAR(30) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mtcitem_rec (`record_id`),
  CONSTRAINT fk_mtcitem_rec FOREIGN KEY (`record_id`) REFERENCES `mtc_divisi_records`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
