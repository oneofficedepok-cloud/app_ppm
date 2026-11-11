<?php
/**
 * Master Sealkit Cylinder (menu Produksi -> Master Sealkit).
 *
 * 1 sealkit = header (No. Sealkit, Type H/P, Customer, Cylinder Name) + daftar item seal.
 * WO bisa menunjuk 1 sealkit (work_orders.sealkit_id); saat PR dibuat dengan WO tsb,
 * semua item sealkit otomatis masuk ke daftar barang PR (Qty x jumlah cylinder di WO).
 * Tabel & kolom dibuat otomatis (tidak perlu import SQL manual).
 */

const SEALKIT_TYPES = ['H' => 'Hydraulic', 'P' => 'Pneumatic'];

function sealkit_ensure(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `sealkits` (
           `id`            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           `sealkit_no`    VARCHAR(60) NOT NULL,
           `cyl_type`      CHAR(1) NOT NULL DEFAULT 'H' COMMENT 'H = Hydraulic, P = Pneumatic',
           `customer_id`   INT UNSIGNED NULL,
           `tanggal`       DATE NULL,
           `cylinder_name` VARCHAR(200) NOT NULL DEFAULT '',
           `catatan`       TEXT NULL,
           `created_by`    INT UNSIGNED NULL,
           `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
           `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           UNIQUE KEY uq_sealkit_no (`sealkit_no`),
           INDEX idx_sealkit_cust (`customer_id`)
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `sealkit_items` (
           `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           `sealkit_id` INT UNSIGNED NOT NULL,
           `urut`       INT UNSIGNED NOT NULL DEFAULT 1,
           `part_name`  VARCHAR(150) NOT NULL,
           `part_type`  VARCHAR(100) NOT NULL DEFAULT '',
           `part_no`    VARCHAR(100) NOT NULL DEFAULT '',
           `material`   VARCHAR(100) NOT NULL DEFAULT '',
           `dimension`  VARCHAR(150) NOT NULL DEFAULT '',
           `qty`        DECIMAL(12,2) NOT NULL DEFAULT 1,
           `unit`       VARCHAR(30) NOT NULL DEFAULT 'Pc',
           `keterangan` VARCHAR(255) NOT NULL DEFAULT '',
           INDEX idx_skitem_sk (`sealkit_id`),
           CONSTRAINT fk_skitem_sk FOREIGN KEY (`sealkit_id`) REFERENCES `sealkits`(`id`) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    db_ensure_columns($pdo, 'work_orders', ['sealkit_id' => "INT UNSIGNED NULL COMMENT 'Master Sealkit untuk WO ini'"]);
    $done = true;
}

/** No. Sealkit berikutnya: NoUrut.Type.KodeCustomer.Tahun, mis. 0002.H.AMNT.2026 (urut per Type+Customer+Tahun). */
function sealkit_next_number(PDO $pdo, string $type, string $kode, string $year): string
{
    $kode = strtoupper(preg_replace('/[^A-Za-z0-9\-]/', '', $kode)) ?: 'NOCUST';
    $suffix = ".$type.$kode.$year";
    $q = $pdo->prepare('SELECT sealkit_no FROM sealkits WHERE sealkit_no LIKE :s');
    $q->execute([':s' => '%' . $suffix]);
    $max = 0;
    foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $no) {
        if (substr($no, -strlen($suffix)) === $suffix) $max = max($max, (int) substr($no, 0, -strlen($suffix)));
    }
    return str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT) . $suffix;
}

/** Semua sealkit + item-nya (urut terbaru dulu). */
function sealkit_list(PDO $pdo): array
{
    sealkit_ensure($pdo);
    $rows = $pdo->query(
        "SELECT s.*, c.kode AS customer_kode, c.nama AS customer_nama, u.full_name AS created_by_nama
         FROM sealkits s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = s.created_by
         ORDER BY s.created_at DESC, s.id DESC"
    )->fetchAll();
    $items = [];
    foreach ($pdo->query('SELECT * FROM sealkit_items ORDER BY sealkit_id, urut, id')->fetchAll() as $it) {
        $items[(int) $it['sealkit_id']][] = $it;
    }
    foreach ($rows as &$r) {
        $r['items'] = $items[(int) $r['id']] ?? [];
    }
    return $rows;
}
