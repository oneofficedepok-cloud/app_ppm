<?php
/**
 * Approver PR yang ditetapkan Admin (Administrator -> Approver PR).
 *
 * Aturan per Divisi pembuat PR, plus 1 baris default (divisi = '') untuk semua divisi:
 *   Tahap 1 (Supervisor) & Tahap 2 (Manager) masing-masing 1 user.
 * Kalau tahap tidak diisi untuk divisi itu -> pakai default; kalau default juga kosong ->
 * kembali ke izin khusus di Role Management (cap_pr_approve_spv / cap_pr_approve_mgr).
 * Approver dihitung saat dibaca (bukan disimpan di PR), jadi PR yang masih menunggu
 * langsung ikut kalau Admin mengganti approver (mis. karena orangnya resign/cuti).
 */

/** Buat tabel aturan bila belum ada (tidak perlu import SQL manual). */
function pr_approval_ensure_table(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS `pr_approval_rules` (
           `divisi`      VARCHAR(100) NOT NULL PRIMARY KEY COMMENT '\"\" = default semua divisi',
           `spv_user_id` INT UNSIGNED NULL COMMENT 'Approver tahap 1 (Supervisor)',
           `mgr_user_id` INT UNSIGNED NULL COMMENT 'Approver tahap 2 (Manager)',
           `updated_by`  INT UNSIGNED NULL,
           `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    $done = true;
}

function pr_divisi_key(?string $divisi): string
{
    return strtoupper(trim((string) $divisi));
}

/** ['DIVISI' => ['spv' => id|null, 'mgr' => id|null]] - hanya user yang masih aktif. */
function pr_approval_rules(PDO $pdo): array
{
    static $cache = null;
    if ($cache !== null) return $cache;
    pr_approval_ensure_table($pdo);
    $rows = $pdo->query(
        "SELECT r.divisi,
                IF(us.id IS NOT NULL AND us.status = 'AKTIF', r.spv_user_id, NULL) AS spv,
                IF(um.id IS NOT NULL AND um.status = 'AKTIF', r.mgr_user_id, NULL) AS mgr
         FROM pr_approval_rules r
         LEFT JOIN users us ON us.id = r.spv_user_id
         LEFT JOIN users um ON um.id = r.mgr_user_id"
    )->fetchAll();
    $cache = [];
    foreach ($rows as $r) {
        $cache[pr_divisi_key($r['divisi'])] = ['spv' => $r['spv'] ? (int) $r['spv'] : null, 'mgr' => $r['mgr'] ? (int) $r['mgr'] : null];
    }
    return $cache;
}

/** Divisi penentu approver: divisi akun pembuat PR (tidak bisa diakali dari form), atau divisi di PR untuk data lama/import. */
function pr_approval_divisi(array $row): string
{
    $d = trim((string) ($row['user_divisi'] ?? ''));
    return $d !== '' ? $d : (string) ($row['divisi'] ?? '');
}

/** Approver tahap 1 & 2 untuk PR dari divisi ini: ['spv' => id|null, 'mgr' => id|null]. */
function pr_resolve_approvers(array $rules, ?string $divisi): array
{
    $own = $rules[pr_divisi_key($divisi)] ?? [];
    $def = $rules[''] ?? [];
    return [
        'spv' => $own['spv'] ?? $def['spv'] ?? null,
        'mgr' => $own['mgr'] ?? $def['mgr'] ?? null,
    ];
}

/**
 * Boleh approve tahap ini? Admin selalu boleh. Kalau tahap punya approver yang
 * ditetapkan -> hanya user itu. Kalau tidak -> siapa saja yang punya izin khusus tahap tsb.
 */
function pr_can_approve_stage(array $user, string $stage, array $approvers): bool
{
    if (!empty($user['is_admin'])) return true;
    $assigned = $approvers[$stage] ?? null;
    if ($assigned) return (int) $user['id'] === (int) $assigned;
    $cap = $stage === 'spv' ? 'cap_pr_approve_spv' : 'cap_pr_approve_mgr';
    return user_level($user, $cap) >= PERM_VIEW;
}

/** User ini ditetapkan sebagai approver di salah satu aturan? */
function pr_is_assigned_approver(array $rules, int $userId): bool
{
    foreach ($rules as $r) {
        if ($r['spv'] === $userId || $r['mgr'] === $userId) return true;
    }
    return false;
}
