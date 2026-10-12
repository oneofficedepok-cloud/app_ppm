<?php
/**
 * Approver PR yang ditetapkan Admin, per Divisi pembuat PR (+ default semua divisi).
 * GET : semua user login (nama approver tampil otomatis di form PR).
 *       Admin juga mendapat daftar user aktif & daftar divisi untuk form pengaturan.
 * PUT : khusus Admin. Body {rules: [{divisi: '' | 'PRODUKSI', spv_user_id, mgr_user_id}, ...]}
 *       menggantikan seluruh aturan.
 */
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/pr_approval.php';

$user = require_login();
$method = http_method();
$pdo = db();
pr_approval_ensure_table($pdo);

switch ($method) {

    case 'GET':
        $rules = $pdo->query(
            "SELECT r.divisi, r.spv_user_id, r.mgr_user_id,
                    IF(us.status = 'AKTIF', us.full_name, NULL) AS spv_nama,
                    IF(um.status = 'AKTIF', um.full_name, NULL) AS mgr_nama
             FROM pr_approval_rules r
             LEFT JOIN users us ON us.id = r.spv_user_id
             LEFT JOIN users um ON um.id = r.mgr_user_id
             ORDER BY r.divisi = '' DESC, r.divisi"
        )->fetchAll();
        foreach ($rules as &$r) {
            // Approver yang sudah non-aktif / terhapus dianggap kosong.
            if (!$r['spv_nama']) $r['spv_user_id'] = null;
            if (!$r['mgr_nama']) $r['mgr_user_id'] = null;
            $r['spv_user_id'] = $r['spv_user_id'] ? (int) $r['spv_user_id'] : null;
            $r['mgr_user_id'] = $r['mgr_user_id'] ? (int) $r['mgr_user_id'] : null;
        }
        unset($r);
        $out = ['rules' => $rules];
        if (!empty($user['is_admin'])) {
            $out['users'] = $pdo->query(
                "SELECT u.id, u.full_name, u.username, u.divisi, COALESCE(r.label, u.role) AS role_label
                 FROM users u LEFT JOIN roles r ON r.role_key = u.role
                 WHERE u.status = 'AKTIF' ORDER BY u.full_name"
            )->fetchAll();
            $div = $pdo->query(
                "SELECT DISTINCT UPPER(TRIM(divisi)) FROM users WHERE TRIM(COALESCE(divisi, '')) <> ''
                 UNION SELECT DISTINCT UPPER(TRIM(divisi)) FROM pr_items WHERE TRIM(COALESCE(divisi, '')) <> ''
                 UNION SELECT divisi FROM pr_approval_rules WHERE divisi <> ''"
            )->fetchAll(PDO::FETCH_COLUMN);
            sort($div);
            $out['divisi'] = array_values(array_unique($div));
        }
        json_success($out);
        break;

    case 'PUT':
        $admin = require_admin();
        $b = get_json_input();
        $rules = arr_val($b, 'rules', []);
        if (!is_array($rules) || count($rules) > 200) json_error('Data aturan tidak valid.', 422);

        $active = array_map('intval', $pdo->query("SELECT id FROM users WHERE status = 'AKTIF'")->fetchAll(PDO::FETCH_COLUMN));
        $clean = [];
        foreach ($rules as $r) {
            if (!is_array($r)) continue;
            $div = pr_divisi_key(clean_str(arr_val($r, 'divisi', '')));
            if (mb_strlen($div) > 100) json_error('Nama divisi terlalu panjang.', 422);
            $spv = to_int_or_null(arr_val($r, 'spv_user_id'));
            $mgr = to_int_or_null(arr_val($r, 'mgr_user_id'));
            foreach ([$spv, $mgr] as $uid) {
                if ($uid && !in_array($uid, $active, true)) json_error('Approver yang dipilih tidak ditemukan / tidak aktif.', 422);
            }
            if (!$spv && !$mgr && $div !== '') continue; // baris divisi kosong = ikut default
            $clean[$div] = [$spv, $mgr];
        }

        $pdo->beginTransaction();
        try {
            $pdo->exec('DELETE FROM pr_approval_rules');
            $ins = $pdo->prepare('INSERT INTO pr_approval_rules (divisi, spv_user_id, mgr_user_id, updated_by) VALUES (:d, :s, :m, :by)');
            foreach ($clean as $div => [$spv, $mgr]) {
                $ins->execute([':d' => $div, ':s' => $spv, ':m' => $mgr, ':by' => $admin['id']]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $names = array_column($pdo->query('SELECT id, full_name FROM users')->fetchAll(), 'full_name', 'id');
        $desc = [];
        foreach ($clean as $div => [$spv, $mgr]) {
            $desc[] = ($div === '' ? 'DEFAULT' : $div) . ': SPV=' . ($names[$spv] ?? '-') . ', MGR=' . ($names[$mgr] ?? '-');
        }
        log_activity('update', 'pr_approval_rules', null, implode(' | ', $desc) ?: 'Semua aturan dikosongkan');
        json_success([], 'Pengaturan Approver PR tersimpan.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
