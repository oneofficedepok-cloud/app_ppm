-- =========================================================
-- Migration: AR (Invoice) bisa untuk BANYAK WO sekaligus
--   1 PO customer bisa berisi beberapa WO, jadi 1 invoice AR
--   dihubungkan ke beberapa WO lewat tabel account_receivable_wo.
-- Aman dijalankan berkali-kali. Jalankan lewat phpMyAdmin -> Import.
-- =========================================================

CREATE TABLE IF NOT EXISTS `account_receivable_wo` (
  `ar_id` INT UNSIGNED NOT NULL,
  `wo_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`ar_id`, `wo_id`),
  INDEX idx_arwo_wo (`wo_id`),
  CONSTRAINT fk_arwo_ar FOREIGN KEY (`ar_id`) REFERENCES `account_receivable`(`id`) ON DELETE CASCADE,
  CONSTRAINT fk_arwo_wo FOREIGN KEY (`wo_id`) REFERENCES `work_orders`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Data AR lama (1 invoice = 1 WO) dipindahkan ke tabel baru.
INSERT IGNORE INTO `account_receivable_wo` (`ar_id`, `wo_id`)
SELECT `id`, `wo_id` FROM `account_receivable` WHERE `wo_id` IS NOT NULL;
