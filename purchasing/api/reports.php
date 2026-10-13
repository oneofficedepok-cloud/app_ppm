<?php
/**
 * Report favorit (Report & Pivot Table).
 * GET                 : report milik saya + report yang dibagikan.
 * POST action=save    : {id?, name, source, config, shared} - simpan / perbarui milik sendiri.
 *                       Membagikan ke semua pengguna Report butuh akses Ubah menu Report.
 * POST action=delete  : {id} - hapus milik sendiri (Admin: semua).
 * (Hapus lewat POST karena method DELETE di aplikasi ini khusus Admin.)
 */
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/report_setup.php';

$user = require_view(['report']);
$pdo = db();
report_setup($pdo);

$method = http_method();
$uid = (int) $user['id'];
$isAdmin = !empty($user['is_admin']);

if ($method === 'GET') {
    $stmt = $pdo->prepare(
        'SELECT p.id, p.user_id, p.name, p.source, p.config, p.is_shared, p.updated_at, u.full_name AS owner_nama
         FROM report_presets p LEFT JOIN users u ON u.id = p.user_id
         WHERE p.user_id = :me OR p.is_shared = 1
         ORDER BY p.is_shared DESC, p.name'
    );
    $stmt->execute([':me' => $uid]);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['config'] = json_decode($r['config'], true) ?: [];
        $r['is_shared'] = (int) $r['is_shared'];
        $r['mine'] = (int) $r['user_id'] === $uid;
    }
    unset($r);
    json_success($rows);
}

if ($method !== 'POST') json_error('Method tidak didukung.', 405);
$b = get_json_input();
$action = $_GET['action'] ?? '';

if ($action === 'save') {
    $name = mb_substr(clean_str(arr_val($b, 'name', '')), 0, 120);
    $source = (string) arr_val($b, 'source', '');
    $config = arr_val($b, 'config', []);
    if ($name === '' || !preg_match('/^[a-z_]{2,40}$/', $source) || !is_array($config)) {
        json_error('Nama report dan sumber data wajib diisi.', 422);
    }
    $json = json_encode($config, JSON_UNESCAPED_UNICODE);
    if (strlen($json) > 20000) json_error('Pengaturan report terlalu besar.', 422);
    $shared = (bool) arr_val($b, 'shared', false);
    if ($shared && !can_edit($user, ['report'])) json_error('Membagikan report butuh akses Ubah pada menu Report.', 403);

    $id = to_int_or_null(arr_val($b, 'id'));
    if ($id) {
        $own = $pdo->prepare('SELECT user_id FROM report_presets WHERE id = :id');
        $own->execute([':id' => $id]);
        $owner = $own->fetchColumn();
        if ($owner === false) json_error('Report tidak ditemukan.', 404);
        if ((int) $owner !== $uid && !$isAdmin) json_error('Hanya pembuat report yang bisa mengubahnya.', 403);
        $pdo->prepare('UPDATE report_presets SET name = :n, source = :s, config = :c, is_shared = :sh WHERE id = :id')
            ->execute([':n' => $name, ':s' => $source, ':c' => $json, ':sh' => $shared ? 1 : 0, ':id' => $id]);
        log_activity('update', 'report_presets', $id, $name);
        json_success(['id' => $id], 'Report favorit diperbarui.');
    }
    $cnt = $pdo->prepare('SELECT COUNT(*) FROM report_presets WHERE user_id = :me');
    $cnt->execute([':me' => $uid]);
    if ((int) $cnt->fetchColumn() >= 100) json_error('Maksimal 100 report favorit per user.', 422);
    $pdo->prepare('INSERT INTO report_presets (user_id, name, source, config, is_shared) VALUES (:u, :n, :s, :c, :sh)')
        ->execute([':u' => $uid, ':n' => $name, ':s' => $source, ':c' => $json, ':sh' => $shared ? 1 : 0]);
    $id = (int) $pdo->lastInsertId();
    log_activity('create', 'report_presets', $id, $name);
    json_success(['id' => $id], 'Report favorit disimpan.');
}

if ($action === 'delete') {
    $id = to_int_or_null(arr_val($b, 'id'));
    if (!$id) json_error('ID wajib diisi.', 422);
    $own = $pdo->prepare('SELECT user_id, name FROM report_presets WHERE id = :id');
    $own->execute([':id' => $id]);
    $row = $own->fetch();
    if (!$row) json_error('Report tidak ditemukan.', 404);
    if ((int) $row['user_id'] !== $uid && !$isAdmin) json_error('Hanya pembuat report (atau Admin) yang bisa menghapusnya.', 403);
    $pdo->prepare('DELETE FROM report_presets WHERE id = :id')->execute([':id' => $id]);
    log_activity('delete', 'report_presets', $id, $row['name']);
    json_success([], 'Report favorit dihapus.');
}

json_error('Aksi tidak dikenali.', 400);
