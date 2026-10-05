-- =========================================================
-- Migration: Modul Finance - Surat Jalan (SJ), 1 SJ bisa untuk beberapa WO
-- Aman dijalankan berkali-kali. Jalankan lewat phpMyAdmin -> Import.
-- (Jalankan juga migration_ar_multi_wo.sql kalau belum.)
-- =========================================================

CREATE TABLE IF NOT EXISTS `surat_jalan` (
  `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `no_sj`         VARCHAR(100) NOT NULL UNIQUE,
  `tgl_kirim`     DATE NOT NULL,
  `customer_id`   INT UNSIGNED NULL,
  `nomor_invoice` VARCHAR(255) NULL,
  `status`        VARCHAR(20) NOT NULL DEFAULT 'DELIVERY' COMMENT 'DELIVERY / DONE / HOLD / WARRANTY / CANCEL',
  `keterangan`    TEXT NULL,
  `created_by`    INT UNSIGNED NULL,
  `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sj_customer FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  INDEX idx_sj_tgl (`tgl_kirim`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `surat_jalan_wo` (
  `sj_id` INT UNSIGNED NOT NULL,
  `wo_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`sj_id`, `wo_id`),
  INDEX idx_sjwo_wo (`wo_id`),
  CONSTRAINT fk_sjwo_sj FOREIGN KEY (`sj_id`) REFERENCES `surat_jalan`(`id`) ON DELETE CASCADE,
  CONSTRAINT fk_sjwo_wo FOREIGN KEY (`wo_id`) REFERENCES `work_orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
