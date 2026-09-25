-- =========================================================
--  PURCHASING CLOUD - DATABASE SCHEMA (MariaDB / MySQL)
--  Duplikasi dari Dashboard Purchasing (PPM 2026)
--  Import file ini via phpMyAdmin / Adminer / CLI mysql
-- =========================================================

CREATE DATABASE IF NOT EXISTS `purchasing_cloud`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `purchasing_cloud`;

-- =========================================================
-- 0. ROLES
--    Dikelola penuh lewat UI (menu Master Directory > Role
--    Management) oleh admin — tambah/edit/hapus role TANPA
--    perlu ubah kode. role_key = admin dan user adalah role
--    sistem (is_system=1) yang tidak bisa dihapus, supaya
--    aplikasi tidak pernah kehilangan role default/fallback.
-- =========================================================
CREATE TABLE `roles` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `role_key`   VARCHAR(50) NOT NULL UNIQUE COMMENT 'slug teknis, auto-generate dari label, permanen setelah dibuat',
  `label`      VARCHAR(100) NOT NULL COMMENT 'nama yang tampil di UI, boleh diubah kapan saja',
  `is_admin`   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = akses penuh setara admin (boleh hapus data master/user)',
  `is_system`  TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = role bawaan sistem, tidak bisa dihapus',
  `modules`    TEXT NULL COMMENT 'hak akses: menu:level dipisah koma, mis. dashboard:edit,stok:view (diabaikan jika is_admin=1)',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `roles` (`role_key`,`label`,`is_admin`,`is_system`,`modules`) VALUES
('admin', 'Admin', 1, 1, NULL),
('manager_purchasing', 'Manager Purchasing', 0, 0, 'purchasing,produksi,masterdata,gudang,finance,mtc'),
('staff_purchasing', 'Staff Purchasing', 0, 0, 'purchasing,gudang'),
('staff_gudang', 'Staff Gudang', 0, 0, 'stok:edit,incoming:edit,receiving:edit,produksi:edit,riwayat:edit,tracking:view,seal:view,dashboard:view'),
('leader', 'Leader', 0, 0, 'purchasing,gudang'),
('buyer', 'Buyer', 0, 0, 'purchasing,gudang'),
('user', 'User (Pemohon)', 0, 1, 'dashboard:edit');

-- Catatan percobaan login gagal (anti brute-force)
CREATE TABLE `login_attempts` (
  `id`           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `username`     VARCHAR(100) NOT NULL,
  `ip_address`   VARCHAR(45) NOT NULL,
  `attempted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_user (`username`, `attempted_at`),
  INDEX idx_login_ip (`ip_address`, `attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 1. USERS
--    Menggabungkan akun login + master "User/Peminta" (pemohon)
--    agar tidak ada 2 sumber data terpisah seperti versi lama.
-- =========================================================
CREATE TABLE `users` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `username`   VARCHAR(100) NOT NULL UNIQUE,
  `password`   VARCHAR(255) NOT NULL COMMENT 'hasil password_hash()',
  `full_name`  VARCHAR(150) NOT NULL,
  `divisi`     VARCHAR(100) NOT NULL DEFAULT 'GENERAL',
  `role`       VARCHAR(50) NOT NULL DEFAULT 'user' COMMENT 'FK ke roles.role_key',
  `status`     ENUM('AKTIF','NON AKTIF') NOT NULL DEFAULT 'AKTIF',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (`role`) REFERENCES `roles`(`role_key`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 2. MASTER BUYERS (Purchasing officer)
-- =========================================================
CREATE TABLE `master_buyers` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `nama`       VARCHAR(150) NOT NULL UNIQUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 3. MASTER PRODUCTS
-- =========================================================
CREATE TABLE `master_products` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `nama`       VARCHAR(200) NOT NULL UNIQUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 4. CUSTOMERS
-- =========================================================
CREATE TABLE `customers` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `nama`       VARCHAR(200) NOT NULL,
  `alamat`     TEXT NULL,
  `kelurahan`  VARCHAR(100) NULL,
  `kecamatan`  VARCHAR(100) NULL,
  `kota`       VARCHAR(100) NULL,
  `provinsi`   VARCHAR(100) NULL,
  `kodepos`    VARCHAR(20)  NULL,
  `negara`     VARCHAR(100) NOT NULL DEFAULT 'Indonesia',
  `pic`        VARCHAR(150) NULL,
  `cp`         VARCHAR(150) NULL,
  `telepon`    VARCHAR(50)  NULL,
  `npwp`       VARCHAR(50)  NULL,
  `status`     ENUM('AKTIF','NON AKTIF') NOT NULL DEFAULT 'AKTIF',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cust_nama (`nama`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 5. SUPPLIERS
-- =========================================================
CREATE TABLE `suppliers` (
  `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `nama`       VARCHAR(200) NOT NULL,
  `alamat`     TEXT NULL,
  `kelurahan`  VARCHAR(100) NULL,
  `kecamatan`  VARCHAR(100) NULL,
  `kota`       VARCHAR(100) NULL,
  `provinsi`   VARCHAR(100) NULL,
  `kodepos`    VARCHAR(20)  NULL,
  `negara`     VARCHAR(100) NOT NULL DEFAULT 'Indonesia',
  `pic`        VARCHAR(150) NULL,
  `cp`         VARCHAR(150) NULL,
  `telepon`    VARCHAR(50)  NULL,
  `npwp`       VARCHAR(50)  NULL,
  `status`     ENUM('AKTIF','NON AKTIF') NOT NULL DEFAULT 'AKTIF',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_supp_nama (`nama`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 6. WORK ORDERS
--    Satu tabel untuk KEDUA sisi: biaya (Purchasing) dan nilai jual (Finance),
--    supaya Profit/Loss per WO bisa dihitung riil (Nilai Jual - Biaya Aktual).
-- =========================================================
CREATE TABLE `work_orders` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `wo_number`   VARCHAR(100) NOT NULL UNIQUE,
  `project`     VARCHAR(200) NOT NULL,
  `customer_id` INT UNSIGNED NULL,
  `est_kirim`   DATE NULL,
  -- --- Sisi BIAYA (Purchasing) ---
  `nilai_po`    DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'DPP nilai jual ke customer (pre-tax); auto dari qty x harga_satuan - diskon kalau diisi lewat form Finance',
  `budget_prod` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `aktual_prod` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `budget_pem`  DECIMAL(18,2) NOT NULL DEFAULT 0,
  `total_lain`  DECIMAL(18,2) NOT NULL DEFAULT 0,
  -- --- Sisi NILAI JUAL (Finance) ---
  `po_no`         VARCHAR(100) NULL COMMENT 'No. PO dari customer',
  `qty`           DECIMAL(14,3) NOT NULL DEFAULT 1,
  `satuan`        VARCHAR(50) NOT NULL DEFAULT 'Unit',
  `harga_satuan`  DECIMAL(18,2) NOT NULL DEFAULT 0,
  `diskon`        DECIMAL(18,2) NOT NULL DEFAULT 0,
  `is_ppn`        TINYINT(1) NOT NULL DEFAULT 1,
  `ppn`           DECIMAL(18,2) NOT NULL DEFAULT 0,
  `is_pph23`      TINYINT(1) NOT NULL DEFAULT 1,
  `pph23`         DECIMAL(18,2) NOT NULL DEFAULT 0,
  `pph_lain_pct`  DECIMAL(5,2) NOT NULL DEFAULT 0,
  `pph_lain`      DECIMAL(18,2) NOT NULL DEFAULT 0,
  `wo_total`      DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Total nilai jual WO setelah PPN dikurangi PPh23 & PPh Lain',
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wo_customer FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  INDEX idx_wo_number (`wo_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 6b. ACCOUNT RECEIVABLE (AR) - Piutang Customer
-- =========================================================
CREATE TABLE `account_receivable` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_no`     VARCHAR(100) NOT NULL UNIQUE,
  `tgl_invoice`    DATE NOT NULL,
  `tgl_kirim`      DATE NULL,
  `customer_id`    INT UNSIGNED NULL,
  `wo_id`          INT UNSIGNED NULL COMMENT 'Opsional: link ke WO asal (auto-isi Penjualan/PPN/PPh23)',
  `po_no`          VARCHAR(100) NULL,
  `deskripsi`      VARCHAR(255) NULL,
  `penjualan`      DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'DPP',
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

-- =========================================================
-- 6c. ACCOUNT PAYABLE (AP) - Hutang ke Supplier
-- =========================================================
CREATE TABLE `account_payable` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `invoice_no`     VARCHAR(100) NOT NULL UNIQUE,
  `tgl_invoice`    DATE NOT NULL,
  `tgl_terima`     DATE NULL,
  `supplier_id`    INT UNSIGNED NULL,
  `po_no`          VARCHAR(100) NULL,
  `deskripsi`      VARCHAR(255) NULL,
  `pembelian`      DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'DPP',
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

-- =========================================================
-- 6d. DANA TALANGAN
-- =========================================================
CREATE TABLE `dana_talangan` (
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

-- =========================================================
-- 6e. MANUAL CASHFLOW
--    Transaksi kas yang diinput manual (bukan otomatis dari AR/AP).
--    Cash Flow yang ditampilkan di UI = gabungan tabel ini + AR (saat
--    dibayar) + AP (saat dibayar), dihitung on-the-fly di api/cashflow.php.
-- =========================================================
CREATE TABLE `manual_cashflow` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `tanggal`     DATE NOT NULL,
  `kode`        ENUM('Piutang','Hutang','Inventaris','Beban','Pendapatan','Dana Talangan') NOT NULL DEFAULT 'Beban',
  `tp`          ENUM('IN','OUT') NOT NULL,
  `nominal`     DECIMAL(18,2) NOT NULL DEFAULT 0,
  `deskripsi`   VARCHAR(255) NOT NULL,
  `invoice_ref` VARCHAR(100) NULL COMMENT 'No Invoice/Ref/No DT bebas - dipakai utk cocokkan pelunasan Dana Talangan',
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

-- =========================================================
-- 7. PR ITEMS (Purchasing Request) - tabel inti
-- =========================================================
CREATE TABLE `pr_items` (
  `id`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `sheet`          ENUM('PROJECT','GENERAL') NOT NULL DEFAULT 'PROJECT',
  `tanggal`        DATE NOT NULL,
  `pr_number`      VARCHAR(50) NOT NULL,
  `item_no`        INT UNSIGNED NOT NULL DEFAULT 1,
  `customer_id`    INT UNSIGNED NULL,
  `project`        VARCHAR(200) NULL,
  `wo_id`          INT UNSIGNED NULL,
  `product`        VARCHAR(200) NULL,
  `type`           VARCHAR(150) NULL,
  `dimensi`        VARCHAR(150) NULL,
  `brand`          VARCHAR(150) NULL,
  `qty`            DECIMAL(14,3) NOT NULL DEFAULT 0,
  `uom`            VARCHAR(30) NULL,
  `harga`          DECIMAL(18,2) NOT NULL DEFAULT 0,
  `is_ppn`         TINYINT(1) NOT NULL DEFAULT 0,
  `ppn_rate`       DECIMAL(5,2) NOT NULL DEFAULT 11,
  `ppn_amount`     DECIMAL(18,2) NOT NULL DEFAULT 0,
  `dpp`            DECIMAL(18,2) NOT NULL DEFAULT 0,
  `total`          DECIMAL(18,2) NOT NULL DEFAULT 0,
  `supplier_id`    INT UNSIGNED NULL,
  `tgl_beli`       DATE NULL,
  `tgl_datang`     DATE NULL,
  `po_number`      VARCHAR(100) NULL,
  `invoice_number` VARCHAR(100) NULL,
  `buyer_id`       INT UNSIGNED NULL,
  `user_id`        INT UNSIGNED NULL,
  `divisi`         VARCHAR(100) NULL,
  `status`         ENUM('RECEIVED','PO ISSUED','ON PROSES','STORE ROOM','CANCEL') NOT NULL DEFAULT 'ON PROSES',
  `lampiran`       VARCHAR(500) NULL,
  `keterangan`     TEXT NULL,
  `approval_status`      ENUM('PENDING_LEADER','PENDING_MANAGER','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING_LEADER' COMMENT 'Alur approval: Buyer buat -> Leader cek -> Manager Purchasing approve',
  `leader_id`            INT UNSIGNED NULL COMMENT 'User (role leader/admin) yang melakukan pengecekan',
  `leader_checked_at`    TIMESTAMP NULL,
  `leader_note`          VARCHAR(255) NULL,
  `manager_id`           INT UNSIGNED NULL COMMENT 'User (role manager_purchasing/admin) yang approve final',
  `manager_approved_at`  TIMESTAMP NULL,
  `manager_note`         VARCHAR(255) NULL,
  `created_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pr_customer FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_pr_wo       FOREIGN KEY (`wo_id`)       REFERENCES `work_orders`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_pr_supplier FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_pr_buyer    FOREIGN KEY (`buyer_id`)    REFERENCES `master_buyers`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_pr_user     FOREIGN KEY (`user_id`)     REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_pr_leader   FOREIGN KEY (`leader_id`)   REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT fk_pr_manager  FOREIGN KEY (`manager_id`)  REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX idx_pr_number (`pr_number`),
  UNIQUE KEY uq_pr_number_item (`pr_number`, `item_no`),
  INDEX idx_pr_status (`status`),
  INDEX idx_pr_approval_status (`approval_status`),
  INDEX idx_pr_wo (`wo_id`),
  INDEX idx_pr_tanggal (`tanggal`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 8. SEAL CNC ITEMS
-- =========================================================
CREATE TABLE `seal_items` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `wo_id`       INT UNSIGNED NULL,
  `project`     VARCHAR(200) NULL,
  `customer_id` INT UNSIGNED NULL,
  `product`     VARCHAR(200) NULL,
  `type`        VARCHAR(150) NULL,
  `dimensi`     VARCHAR(150) NULL,
  `brand`       VARCHAR(150) NULL,
  `qty`         DECIMAL(14,3) NOT NULL DEFAULT 0,
  `harga`       DECIMAL(18,2) NOT NULL DEFAULT 0,
  `total`       DECIMAL(18,2) NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_seal_wo       FOREIGN KEY (`wo_id`)       REFERENCES `work_orders`(`id`) ON DELETE CASCADE,
  CONSTRAINT fk_seal_customer FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 9. TRANSPORT / LOGISTIK ITEMS
-- =========================================================
CREATE TABLE `transport_items` (
  `id`          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `wo_id`       INT UNSIGNED NULL,
  `project`     VARCHAR(200) NULL,
  `customer_id` INT UNSIGNED NULL,
  `deskripsi`   VARCHAR(255) NULL,
  `asal`        VARCHAR(150) NULL,
  `tujuan`      VARCHAR(150) NULL,
  `qty`         DECIMAL(14,3) NOT NULL DEFAULT 1,
  `harga`       DECIMAL(18,2) NOT NULL DEFAULT 0,
  `total`       DECIMAL(18,2) NOT NULL DEFAULT 0,
  `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_trans_wo       FOREIGN KEY (`wo_id`)       REFERENCES `work_orders`(`id`) ON DELETE CASCADE,
  CONSTRAINT fk_trans_customer FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================
-- 10. ACTIVITY LOG (audit trail sederhana - rekomendasi best practice)
-- =========================================================
CREATE TABLE `activity_log` (
  `id`         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT UNSIGNED NULL,
  `action`     VARCHAR(50) NOT NULL COMMENT 'create/update/delete',
  `module`     VARCHAR(50) NOT NULL COMMENT 'pr_items/work_orders/dst',
  `record_id`  INT UNSIGNED NULL,
  `detail`     TEXT NULL,
  `ip_address` VARCHAR(45) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_user FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
--  SEED DATA (sama persis dengan contoh data di aplikasi asli)
-- =========================================================

-- User admin default -> username: admin | password: admin123
-- (WAJIB diganti setelah instalasi pertama! lihat README.md)
INSERT INTO `users` (`username`,`password`,`full_name`,`divisi`,`role`,`status`) VALUES
('admin', '$2b$10$Sq700ByIpWwWXZKeaS0oZeM3gcq5TUabZe0XoaOB1hUPBiotcRNNG', 'Admin System', 'MANAGEMENT', 'admin', 'AKTIF'),
('abdus.somad', '$2b$10$Sq700ByIpWwWXZKeaS0oZeM3gcq5TUabZe0XoaOB1hUPBiotcRNNG', 'ABDUS SOMAD', 'MAINTENANCE', 'user', 'AKTIF'),
('budi', '$2b$10$Sq700ByIpWwWXZKeaS0oZeM3gcq5TUabZe0XoaOB1hUPBiotcRNNG', 'BUDI', 'STORE ROOM', 'user', 'AKTIF');

INSERT INTO `master_buyers` (`nama`) VALUES ('TASYA'), ('RAIHAN'), ('HARRY');

INSERT INTO `master_products` (`nama`) VALUES
('HYDRAULIC SEAL NBR 70'), ('JACK CYLINDER FRONT CS'), ('BEARING 6205'), ('O-RING KIT');

INSERT INTO `customers`
(`nama`,`alamat`,`kelurahan`,`kecamatan`,`kota`,`provinsi`,`kodepos`,`negara`,`pic`,`cp`,`telepon`,`npwp`,`status`) VALUES
('PT AMNT','Jl. Raya Batu Hijau No. 12','Sekongkang','Sekongkang','Sumbawa Barat','Nusa Tenggara Barat','84457','Indonesia','Bpk. Hendra','Procurement Manager','0812-3456-7890','01.234.567.8-901.000','AKTIF');

INSERT INTO `suppliers`
(`nama`,`alamat`,`kelurahan`,`kecamatan`,`kota`,`provinsi`,`kodepos`,`negara`,`pic`,`cp`,`telepon`,`npwp`,`status`) VALUES
('MULTI PRIMA SEAL','LTC Glodok Lantai GF 1 Blok B No. 5','Glodok','Taman Sari','Jakarta Barat','DKI Jakarta','11180','Indonesia','Bpk. Alex','Sales Manager','021-6234567','02.111.222.3-444.000','AKTIF');

INSERT INTO `work_orders`
(`wo_number`,`project`,`customer_id`,`est_kirim`,`nilai_po`,`budget_prod`,`aktual_prod`,`budget_pem`,`total_lain`,
 `po_no`,`qty`,`satuan`,`harga_satuan`,`diskon`,`is_ppn`,`ppn`,`is_pph23`,`pph23`,`pph_lain_pct`,`pph_lain`,`wo_total`) VALUES
('WO-2026-001','PR Jack Cyl Front CS',1,'2026-10-15',150000000,50000000,45000000,80000000,2000000,
 'PO-AMNT-889-X12',1,'Package',150000000,0,1,16500000,1,3000000,0,0,163500000);

INSERT INTO `account_receivable`
(`invoice_no`,`tgl_invoice`,`tgl_kirim`,`customer_id`,`wo_id`,`po_no`,`deskripsi`,`penjualan`,`is_ppn`,`ppn`,`is_ppn030`,`ppn030`,`pph23`,`biaya_lain`,`top_days`,`due_date`,`faktur_pajak`,`terbayar`,`tgl_bayar`) VALUES
('INV/2026/001','2026-10-15','2026-10-16',1,1,'PO-AMNT-889-X12','PR Jack Cyl Front CS',150000000,1,16500000,0,0,3000000,0,30,'2026-11-15','010.000-26.00000001',0,NULL);

INSERT INTO `account_payable`
(`invoice_no`,`tgl_invoice`,`tgl_terima`,`supplier_id`,`po_no`,`deskripsi`,`pembelian`,`is_ppn`,`ppn`,`is_pph23`,`pph23`,`biaya_lain`,`top_days`,`due_date`,`faktur_pajak`,`terbayar`,`tgl_bayar`) VALUES
('INV-SUPP-889','2026-07-16','2026-07-18',1,'PO-88712','Hydraulic Seal & Material',5550000,0,0,1,111000,0,30,'2026-08-17','010.000-26.99999999',0,NULL);

INSERT INTO `dana_talangan`
(`no_dt`,`tanggal`,`pic`,`deskripsi`,`pinjaman`,`tgl_penggantian`) VALUES
('DT-2026-001','2026-08-15','Budi - Ops','Biaya Transport & Bensin Tim Lapangan',2000000,'2026-09-20');

INSERT INTO `manual_cashflow`
(`tanggal`,`kode`,`tp`,`nominal`,`deskripsi`,`invoice_ref`,`pic`,`wo_no`,`po_no`,`dpp`,`pph23`,`status`) VALUES
('2026-09-01','Dana Talangan','IN',1000000,'Pelunasan Dana Talangan Tahap 1','DT-2026-001','Budi - Ops','-','-',1000000,0,'TERBAYAR LUNAS');

INSERT INTO `pr_items`
(`sheet`,`tanggal`,`pr_number`,`item_no`,`customer_id`,`project`,`wo_id`,`product`,`type`,`dimensi`,`brand`,`qty`,`uom`,`harga`,`is_ppn`,`ppn_rate`,`ppn_amount`,`dpp`,`total`,`supplier_id`,`tgl_beli`,`tgl_datang`,`po_number`,`invoice_number`,`buyer_id`,`user_id`,`divisi`,`status`,`lampiran`,`keterangan`) VALUES
('PROJECT','2026-07-15','P-260001',1,1,'PR Jack Cyl Front CS',1,'JACK CYLINDER FRONT CS','Hydraulic Seal','NBR 70 / 50x60mm','NOK / Komatsu',10,'Pc',500000,1,11,550000,5000000,5550000,1,'2026-07-16','2026-07-20','PO-88712','INV-9902',1,2,'MAINTENANCE','RECEIVED','https://drive.google.com','Pengiriman via Udara');

INSERT INTO `seal_items`
(`wo_id`,`project`,`customer_id`,`product`,`type`,`dimensi`,`brand`,`qty`,`harga`,`total`) VALUES
(1,'PR Jack Cyl Front CS',1,'HYDRAULIC SEAL NBR 70','Rod Seal','50x65x10 mm','NOK',5,150000,750000);

INSERT INTO `transport_items`
(`wo_id`,`project`,`customer_id`,`deskripsi`,`asal`,`tujuan`,`qty`,`harga`,`total`) VALUES
(1,'PR Jack Cyl Front CS',1,'Sewa Truck Engkel Box','Jakarta','Surabaya',1,3500000,3500000);
