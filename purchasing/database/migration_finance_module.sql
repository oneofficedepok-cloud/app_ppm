-- =========================================================
--  MIGRASI: Modul Finance (Cash Flow, WO Nilai Jual, AR, AP, Dana Talangan)
--
--  AMAN dijalankan di database yang SUDAH ADA datanya.
--  TIDAK menghapus data apapun. TIDAK menyertakan data contoh
--  (supaya tidak tercampur dengan data WO/customer Anda yang sungguhan).
--
--  Cara pakai: phpMyAdmin -> pilih database Anda -> tab SQL ->
--  paste seluruh isi file ini -> Go.
-- =========================================================

-- ---------------------------------------------------------
-- BAGIAN 1: Tambah kolom "Nilai Jual" (sisi Finance) ke work_orders
--           yang sudah ada, di samping kolom biaya (sisi Purchasing)
--           yang sudah lebih dulu ada.
-- ---------------------------------------------------------
ALTER TABLE `work_orders`
  ADD COLUMN `po_no`         VARCHAR(100) NULL COMMENT 'No. PO dari customer' AFTER `est_kirim`,
  ADD COLUMN `qty`           DECIMAL(14,3) NOT NULL DEFAULT 1 AFTER `po_no`,
  ADD COLUMN `satuan`        VARCHAR(50) NOT NULL DEFAULT 'Unit' AFTER `qty`,
  ADD COLUMN `harga_satuan`  DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `satuan`,
  ADD COLUMN `diskon`        DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `harga_satuan`,
  ADD COLUMN `is_ppn`        TINYINT(1) NOT NULL DEFAULT 1 AFTER `diskon`,
  ADD COLUMN `ppn`           DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `is_ppn`,
  ADD COLUMN `is_pph23`      TINYINT(1) NOT NULL DEFAULT 1 AFTER `ppn`,
  ADD COLUMN `pph23`         DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `is_pph23`,
  ADD COLUMN `pph_lain_pct`  DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `pph23`,
  ADD COLUMN `pph_lain`      DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `pph_lain_pct`,
  ADD COLUMN `wo_total`      DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Total nilai jual setelah PPN dikurangi PPh23 & PPh Lain' AFTER `pph_lain`;

-- ---------------------------------------------------------
-- BAGIAN 2: Tabel baru - Account Receivable (Piutang Customer)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `account_receivable` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_no`     VARCHAR(100) NOT NULL UNIQUE,
  `tgl_invoice`    DATE NOT NULL,
  `tgl_kirim`      DATE NULL,
  `customer_id`    INT UNSIGNED NULL,
  `wo_id`          INT UNSIGNED NULL,
  `po_no`          VARCHAR(100) NULL,
  `deskripsi`      VARCHAR(255) NULL,
  `penjualan`      DECIMAL(18,2) NOT NULL DEFAULT 0,
  `is_ppn`         TINYINT(1) NOT NULL DEFAULT 1,
  `ppn`            DECIMAL(18,2) NOT NULL DEFAULT 0,
  `is_ppn030`      TINYINT(1) NOT NULL DEFAULT 0,
  `ppn030`         DECIMAL(18,2) NOT NULL DEFAULT 0,
  `pph23`          DECIMAL(18,2) NOT NULL DEFAULT 0,
  `biaya_lain`     DECIMAL(18,2) NOT NULL DEFAULT 0,
  `top_days`       SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `due_date`       DATE NULL,
  `faktur_pajak`   VARCHAR(100) NULL,
  `terbayar`       DECIMAL(18,2) NOT NULL DEFAULT 0,
  `tgl_bayar`      DATE NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ar_customer FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_ar_wo FOREIGN KEY (`wo_id`) REFERENCES `work_orders`(`id`) ON DELETE SET NULL,
  INDEX idx_ar_due (`due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- BAGIAN 3: Tabel baru - Account Payable (Hutang ke Supplier)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `account_payable` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_no`     VARCHAR(100) NOT NULL UNIQUE,
  `tgl_invoice`    DATE NOT NULL,
  `tgl_terima`     DATE NULL,
  `supplier_id`    INT UNSIGNED NULL,
  `po_no`          VARCHAR(100) NULL,
  `deskripsi`      VARCHAR(255) NULL,
  `pembelian`      DECIMAL(18,2) NOT NULL DEFAULT 0,
  `is_ppn`         TINYINT(1) NOT NULL DEFAULT 1,
  `ppn`            DECIMAL(18,2) NOT NULL DEFAULT 0,
  `is_pph23`       TINYINT(1) NOT NULL DEFAULT 1,
  `pph23`          DECIMAL(18,2) NOT NULL DEFAULT 0,
  `biaya_lain`     DECIMAL(18,2) NOT NULL DEFAULT 0,
  `top_days`       SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  `due_date`       DATE NULL,
  `faktur_pajak`   VARCHAR(100) NULL,
  `terbayar`       DECIMAL(18,2) NOT NULL DEFAULT 0,
  `tgl_bayar`      DATE NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ap_supplier FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL,
  INDEX idx_ap_due (`due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- BAGIAN 4: Tabel baru - Dana Talangan
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dana_talangan` (
  `id`               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `no_dt`            VARCHAR(100) NOT NULL UNIQUE,
  `tanggal`          DATE NOT NULL,
  `pic`              VARCHAR(150) NOT NULL,
  `deskripsi`        VARCHAR(255) NOT NULL,
  `pinjaman`         DECIMAL(18,2) NOT NULL DEFAULT 0,
  `tgl_penggantian`  DATE NULL,
  `created_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------
-- BAGIAN 5: Tabel baru - Manual Cashflow (transaksi kas input manual)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `manual_cashflow` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tanggal`     DATE NOT NULL,
  `kode`        ENUM('Piutang','Hutang','Inventaris','Beban','Pendapatan','Dana Talangan') NOT NULL DEFAULT 'Beban',
  `tp`          ENUM('IN','OUT') NOT NULL,
  `nominal`     DECIMAL(18,2) NOT NULL DEFAULT 0,
  `deskripsi`   VARCHAR(255) NOT NULL,
  `invoice_ref` VARCHAR(100) NULL,
  `pic`         VARCHAR(150) NULL,
  `wo_no`       VARCHAR(100) NULL,
  `po_no`       VARCHAR(100) NULL,
  `dpp`         DECIMAL(18,2) NOT NULL DEFAULT 0,
  `pph23`       DECIMAL(18,2) NOT NULL DEFAULT 0,
  `status`      ENUM('TERBAYAR LUNAS','PENDING') NOT NULL DEFAULT 'TERBAYAR LUNAS',
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mc_tanggal (`tanggal`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
