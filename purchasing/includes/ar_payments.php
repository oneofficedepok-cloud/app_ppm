<?php
/**
 * Pembayaran AR bertahap (partial): 1 invoice AR bisa dibayar customer 2x, 3x, dst.
 *
 * Tabel ar_payments menyimpan tiap pembayaran (tanggal + jumlah). Kolom lama
 * account_receivable.terbayar / tgl_bayar tetap diisi otomatis (= total & tanggal
 * terakhir) supaya laporan/dashboard yang sudah ada tetap jalan.
 * Data lama (atau hasil import) yang punya terbayar tapi belum punya baris di
 * ar_payments dibaca sebagai 1 pembayaran.
 */

/** Buat tabel bila belum ada (tidak perlu import SQL manual). */
function ar_payments_ensure(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `ar_payments` (
           `id`         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           `ar_id`      INT UNSIGNED NOT NULL,
           `tgl_bayar`  DATE NOT NULL,
           `jumlah`     DECIMAL(18,2) NOT NULL DEFAULT 0,
           `keterangan` VARCHAR(255) NULL,
           `created_by` INT UNSIGNED NULL,
           `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
           INDEX idx_arpay_ar (`ar_id`),
           CONSTRAINT fk_arpay_ar FOREIGN KEY (`ar_id`) REFERENCES `account_receivable`(`id`) ON DELETE CASCADE
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $done = true;
}

/** [ar_id => [ ['id','tgl_bayar','jumlah','keterangan'], ... ]] urut tanggal. */
function ar_payments_map(PDO $pdo): array
{
    ar_payments_ensure($pdo);
    $map = [];
    $rows = $pdo->query('SELECT id, ar_id, tgl_bayar, jumlah, keterangan FROM ar_payments ORDER BY tgl_bayar, id')->fetchAll();
    foreach ($rows as $r) {
        $map[(int) $r['ar_id']][] = [
            'id' => (int) $r['id'], 'tgl_bayar' => $r['tgl_bayar'],
            'jumlah' => (float) $r['jumlah'], 'keterangan' => (string) ($r['keterangan'] ?? ''),
        ];
    }
    return $map;
}

/** Daftar pembayaran 1 AR. Data lama tanpa baris ar_payments -> 1 pembayaran dari kolom terbayar. */
function ar_payments_of(array $ar, array $map): array
{
    $list = $map[(int) $ar['id']] ?? [];
    if (!$list && (float) $ar['terbayar'] > 0) {
        $list[] = ['id' => 0, 'tgl_bayar' => $ar['tgl_bayar'] ?: ($ar['tgl_invoice'] ?? null),
            'jumlah' => (float) $ar['terbayar'], 'keterangan' => ''];
    }
    return $list;
}

/**
 * Baca & validasi daftar pembayaran dari input form.
 * Form lama / import yang hanya kirim terbayar + tgl_bayar -> 1 pembayaran.
 * Return [payments, totalTerbayar, tglBayarTerakhir].
 */
function ar_payments_from_input(array $b): array
{
    $raw = arr_val($b, 'payments', null);
    if (!is_array($raw)) {
        $amt = to_float(arr_val($b, 'terbayar', 0));
        $raw = $amt > 0 ? [['tgl_bayar' => arr_val($b, 'tgl_bayar'), 'jumlah' => $amt]] : [];
    }
    if (count($raw) > 100) json_error('Maksimal 100 kali pembayaran per invoice.', 422);
    $list = [];
    foreach ($raw as $i => $p) {
        if (!is_array($p)) continue;
        $amt = to_float(arr_val($p, 'jumlah', 0));
        $tgl = (string) (arr_val($p, 'tgl_bayar') ?? '');
        if ($amt == 0 && $tgl === '') continue; // baris kosong diabaikan
        $no = $i + 1;
        if ($amt <= 0) json_error("Pembayaran ke-{$no}: jumlah harus lebih dari 0.", 422);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $tgl)) json_error("Pembayaran ke-{$no}: tanggal bayar wajib diisi.", 422);
        $list[] = ['tgl_bayar' => $tgl, 'jumlah' => round($amt, 2), 'keterangan' => mb_substr(clean_str(arr_val($p, 'keterangan', '')), 0, 255)];
    }
    usort($list, fn($a, $b) => strcmp($a['tgl_bayar'], $b['tgl_bayar']));
    $total = round(array_sum(array_column($list, 'jumlah')), 2);
    $last = $list ? end($list)['tgl_bayar'] : null;
    return [$list, $total, $last];
}

/** Simpan ulang seluruh pembayaran 1 AR (hapus lama, isi baru). */
function ar_payments_save(PDO $pdo, int $arId, array $payments): void
{
    ar_payments_ensure($pdo);
    $pdo->prepare('DELETE FROM ar_payments WHERE ar_id = :ar')->execute([':ar' => $arId]);
    $ins = $pdo->prepare('INSERT INTO ar_payments (ar_id, tgl_bayar, jumlah, keterangan, created_by) VALUES (:ar, :tgl, :amt, :ket, :by)');
    $by = current_user()['id'] ?? null;
    foreach ($payments as $p) {
        $ins->execute([':ar' => $arId, ':tgl' => $p['tgl_bayar'], ':amt' => $p['jumlah'], ':ket' => $p['keterangan'], ':by' => $by]);
    }
}

/** Samakan kolom ringkasan AR (terbayar & tgl bayar terakhir) dengan tabel ar_payments. */
function ar_payments_sync_totals(PDO $pdo, int $arId): void
{
    $q = $pdo->prepare('SELECT COALESCE(SUM(jumlah), 0) AS total, MAX(tgl_bayar) AS last FROM ar_payments WHERE ar_id = :ar');
    $q->execute([':ar' => $arId]);
    $r = $q->fetch();
    $pdo->prepare('UPDATE account_receivable SET terbayar = :t, tgl_bayar = :d WHERE id = :id')
        ->execute([':t' => $r['total'], ':d' => $r['last'], ':id' => $arId]);
}
