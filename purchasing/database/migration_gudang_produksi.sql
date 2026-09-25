-- =========================================================
--  MIGRASI: MODUL GUDANG & PRODUKSI
--  (Stok Material, Riwayat Pergerakan, Produksi & BOM)
--
--  AMAN dijalankan di database yang sudah online & sudah ada
--  datanya — file ini HANYA membuat 4 tabel baru, tidak
--  mengubah atau menghapus tabel yang sudah ada.
--
--  Cara pakai: phpMyAdmin -> pilih database Anda -> tab SQL
--  -> paste seluruh isi file ini -> Go.
-- =========================================================

-- Ganti nama database di bawah ini kalau nama DB Anda bukan
-- default `purchasing_cloud` (cek di config/database.php Anda).
USE `purchasing_cloud`;

-- =========================================================
-- 1. MASTER STOK MATERIAL (Gudang)
-- =========================================================
CREATE TABLE IF NOT EXISTS `inventory_items` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `sku`          VARCHAR(50)  NOT NULL UNIQUE,
  `nama`         VARCHAR(200) NOT NULL,
  `kategori`     VARCHAR(100) NULL,
  `satuan`       VARCHAR(30)  NOT NULL DEFAULT 'Pcs',
  `harga_satuan` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `stok_qty`     DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT 'saldo stok berjalan - HANYA diubah lewat inventory_movements (api/inventory_movements.php), jangan diedit manual dari form master',
  `stok_min`     DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT 'ambang batas untuk alert "stok menipis" di dashboard',
  `lokasi_rak`   VARCHAR(100) NULL,
  `barcode`      VARCHAR(100) NULL UNIQUE,
  `status`       ENUM('AKTIF','NON AKTIF') NOT NULL DEFAULT 'AKTIF',
  `created_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_inv_nama (`nama`),
  INDEX idx_inv_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 2. PRODUKSI (Progress Panel)
-- =========================================================
CREATE TABLE IF NOT EXISTS `production_orders` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `po_number`   VARCHAR(50) NOT NULL UNIQUE COMMENT 'nomor internal produksi, format PROD-000X (auto di server)',
  `wo_id`       INT UNSIGNED NULL,
  `product`     VARCHAR(200) NOT NULL,
  `qty_target`  DECIMAL(14,3) NOT NULL DEFAULT 0,
  `qty_selesai` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `tgl_mulai`   DATE NULL,
  `tgl_target`  DATE NULL,
  `status`      ENUM('DRAFT','ON PROGRESS','HOLD','SELESAI','CANCEL') NOT NULL DEFAULT 'DRAFT',
  `keterangan`  VARCHAR(255) NULL,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prodorder_wo FOREIGN KEY (`wo_id`) REFERENCES `work_orders`(`id`) ON DELETE SET NULL,
  INDEX idx_prodorder_wo (`wo_id`),
  INDEX idx_prodorder_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 3. BOM (Bill of Materials) per Production Order
--    "berapa material X dibutuhkan untuk 1 unit produk ini"
-- =========================================================
CREATE TABLE IF NOT EXISTS `production_bom_items` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `production_id`  INT UNSIGNED NOT NULL,
  `item_id`        INT UNSIGNED NOT NULL COMMENT 'FK ke inventory_items - material yang dipakai',
  `qty_per_unit`   DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT 'kebutuhan material per 1 unit produk jadi',
  `qty_dibutuhkan` DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT 'qty_per_unit x qty_target, dihitung ulang di server',
  `qty_terpakai`   DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT 'akumulasi qty dari inventory_movements (sumber=PRODUKSI) utk order ini',
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bom_production FOREIGN KEY (`production_id`) REFERENCES `production_orders`(`id`) ON DELETE CASCADE,
  CONSTRAINT fk_bom_item       FOREIGN KEY (`item_id`)       REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT,
  UNIQUE KEY uq_bom_prod_item (`production_id`, `item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 4. RIWAYAT PERGERAKAN STOK (mutasi masuk/keluar/opname)
--    Sumber kebenaran tunggal untuk saldo stok - inventory_items.stok_qty
--    selalu di-update dari sini (api/inventory_movements.php), tidak pernah
--    diedit langsung dari form master.
-- =========================================================
CREATE TABLE IF NOT EXISTS `inventory_movements` (
  `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `item_id`           INT UNSIGNED NOT NULL,
  `tanggal`           DATE NOT NULL,
  `tipe`              ENUM('IN','OUT','ADJUSTMENT') NOT NULL,
  `qty`               DECIMAL(14,3) NOT NULL COMMENT 'IN/OUT: selalu diisi qty positif. ADJUSTMENT: boleh negatif (koreksi stok turun, mis. opname ketemu barang hilang)',
  `harga_satuan`      DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'snapshot harga saat transaksi masuk',
  `sumber`            ENUM('PEMBELIAN','PRODUKSI','MANUAL','RETUR','OPNAME') NOT NULL DEFAULT 'MANUAL',
  `ref_pr_id`         INT UNSIGNED NULL COMMENT 'opsional: link ke pr_items kalau stok masuk dari PR yang sudah diterima',
  `ref_production_id` INT UNSIGNED NULL COMMENT 'opsional: link ke production_orders kalau stok keluar untuk konsumsi produksi',
  `wo_id`             INT UNSIGNED NULL,
  `keterangan`        VARCHAR(255) NULL,
  `user_id`           INT UNSIGNED NULL,
  `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mv_item       FOREIGN KEY (`item_id`)  REFERENCES `inventory_items`(`id`) ON DELETE CASCADE,
  CONSTRAINT fk_mv_pr         FOREIGN KEY (`ref_pr_id`) REFERENCES `pr_items`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_mv_production FOREIGN KEY (`ref_production_id`) REFERENCES `production_orders`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_mv_wo         FOREIGN KEY (`wo_id`) REFERENCES `work_orders`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_mv_user       FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX idx_mv_item (`item_id`),
  INDEX idx_mv_tanggal (`tanggal`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tidak ada data contoh disertakan (sama seperti migrasi Finance sebelumnya)
-- supaya tidak tercampur dengan data Anda yang sungguhan.
