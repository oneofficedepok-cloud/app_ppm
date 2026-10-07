<?php
/**
 * Riwayat / Log Aplikasi (audit trail) - khusus Admin, hanya-baca.
 * GET ?q=&module=&action=&user_id=&from=&to=&page=1&size=50
 *   q  : dicari di referensi/detail (No PR, No WO, No Invoice, No SJ, nama, ...), modul & nama user.
 */
require_once __DIR__ . '/../includes/auth.php';

require_admin();
if (http_method() !== 'GET') json_error('Log hanya bisa dilihat, tidak bisa diubah / dihapus.', 405);

$pdo = db();

if (($_GET['action'] ?? '') === 'facets') {
    // Pilihan filter: modul, aksi & user yang pernah tercatat.
    json_success([
        'modules' => $pdo->query('SELECT DISTINCT module FROM activity_log ORDER BY module')->fetchAll(PDO::FETCH_COLUMN),
        'actions' => $pdo->query('SELECT DISTINCT action FROM activity_log ORDER BY action')->fetchAll(PDO::FETCH_COLUMN),
        'users'   => $pdo->query('SELECT DISTINCT u.id, u.full_name, u.username FROM activity_log l JOIN users u ON u.id = l.user_id ORDER BY u.full_name')->fetchAll(),
    ]);
}

$where = [];
$params = [];
$q = trim((string) ($_GET['q'] ?? ''));
if ($q !== '') {
    // Setiap kata harus ada (mis. "P-260001 approve").
    foreach (array_slice(preg_split('/\s+/', $q), 0, 6) as $i => $word) {
        // Placeholder harus unik per pemakaian (prepared statement asli tidak menerima nama yang sama 2x).
        $cols = ['l.detail', 'l.module', 'l.action', 'u.full_name', 'u.username'];
        $ors = [];
        foreach ($cols as $c => $col) {
            $ors[] = "$col LIKE :q{$i}_{$c}";
            $params[":q{$i}_{$c}"] = '%' . $word . '%';
        }
        $where[] = '(' . implode(' OR ', $ors) . ')';
    }
}
foreach (['module' => 'l.module', 'action' => 'l.action'] as $key => $col) {
    $v = trim((string) ($_GET[$key] ?? ''));
    if ($v !== '') { $where[] = "$col = :$key"; $params[":$key"] = $v; }
}
if (($uid = to_int_or_null($_GET['user_id'] ?? null))) { $where[] = 'l.user_id = :uid'; $params[':uid'] = $uid; }
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? ''))) { $where[] = 'l.created_at >= :from'; $params[':from'] = $_GET['from'] . ' 00:00:00'; }
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? ''))) { $where[] = 'l.created_at <= :to'; $params[':to'] = $_GET['to'] . ' 23:59:59'; }
$whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

$size = (int) ($_GET['size'] ?? 50);
$size = in_array($size, [25, 50, 100, 200, 1000], true) ? $size : 50;
$page = max(1, (int) ($_GET['page'] ?? 1));

$count = $pdo->prepare("SELECT COUNT(*) FROM activity_log l LEFT JOIN users u ON u.id = l.user_id $whereSql");
$count->execute($params);
$total = (int) $count->fetchColumn();

$offset = ($page - 1) * $size;
$stmt = $pdo->prepare(
    "SELECT l.id, l.created_at, l.action, l.module, l.record_id, l.detail, l.ip_address,
            u.full_name AS user_nama, u.username
     FROM activity_log l LEFT JOIN users u ON u.id = l.user_id
     $whereSql
     ORDER BY l.id DESC
     LIMIT $size OFFSET $offset"
);
$stmt->execute($params);

json_success(['rows' => $stmt->fetchAll(), 'total' => $total, 'page' => $page, 'size' => $size]);
