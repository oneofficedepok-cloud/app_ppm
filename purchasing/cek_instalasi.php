<?php
/**
 * CEK INSTALASI - diagnosa cepat setelah upload / update aplikasi.
 * Buka: http://localhost/<folder-aplikasi>/cek_instalasi.php
 *
 * Sengaja TIDAK memakai includes/auth.php, supaya tetap bisa jalan walaupun
 * file lain rusak / tercampur versi lama. Hanya bisa dibuka dari komputer
 * server itu sendiri (localhost), jadi info teknis tidak bocor ke luar.
 */

$remote = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($remote, ['127.0.0.1', '::1'], true)) {
    http_response_code(403);
    exit('Halaman cek instalasi hanya bisa dibuka dari komputer server (http://localhost/...).');
}
header('X-Robots-Tag: noindex');

$checks = []; // [grup, nama, ok(true/false/null=peringatan), detail, solusi]
function add_check(string $group, string $name, ?bool $ok, string $detail = '', string $fix = ''): void
{
    global $checks;
    $checks[] = [$group, $name, $ok, $detail, $fix];
}
function h($s): string { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

$base = __DIR__;

// ------------------------------------------------------------------ 1. PHP
add_check('PHP', 'Versi PHP ' . PHP_VERSION, version_compare(PHP_VERSION, '7.4.0', '>='),
    'Minimal 7.4, disarankan 8.x', 'Update XAMPP ke versi dengan PHP 8.x.');
foreach (['pdo_mysql' => true, 'mbstring' => true, 'json' => true, 'simplexml' => true, 'zip' => false] as $ext => $required) {
    $loaded = extension_loaded($ext);
    add_check('PHP', "Ekstensi {$ext}", $loaded ? true : ($required ? false : null),
        $required ? 'Wajib' : 'Opsional (import Excel punya pembaca cadangan)',
        "Aktifkan extension={$ext} di php.ini (XAMPP Control Panel → Apache → Config → php.ini), lalu restart Apache.");
}

// ------------------------------------------------------------------ 2. File aplikasi
if (is_file("{$base}/purchasing/index.php")) {
    add_check('File', 'Struktur folder', false,
        'Ditemukan folder "purchasing" DI DALAM folder aplikasi ini. Zip kemungkinan terekstrak ke dalam subfolder, sehingga file lama masih terpakai.',
        'Pindahkan SEMUA isi folder "' . basename($base) . '/purchasing/" naik satu tingkat ke "' . basename($base) . '/" (timpa file lama), lalu hapus subfolder "purchasing" tersebut.');
}
$parent = dirname($base);
if (basename($base) === 'purchasing' && is_file("{$parent}/index.php") && is_dir("{$parent}/api")) {
    add_check('File', 'Struktur folder', false,
        'Folder di atasnya ("' . basename($parent) . '") juga berisi aplikasi (kemungkinan versi lama). Zip terekstrak ke subfolder "purchasing".',
        'Kalau yang Anda buka sehari-hari adalah http://localhost/' . basename($parent) . '/ : pindahkan semua isi folder "purchasing" ini naik ke "'
        . basename($parent) . '" (timpa file lama). Atau pakai langsung http://localhost/' . basename($parent) . '/purchasing/');
}
$markers = [
    'index.php'                 => ['user-menu', 'Header versi baru (menu user dropdown)'],
    'assets/js/app.js'          => ['TABLE_SORTS', 'Fitur Urutkan & hak akses menu'],
    'assets/js/table-tools.js'  => ['TableTools', 'Sortir klik judul kolom'],
    'includes/auth.php'         => ['require_perm', 'Keamanan & hak akses'],
    'includes/permissions.php'  => ['APP_MODULES', 'Daftar menu & level akses'],
    'includes/helpers.php'      => ['json_success', 'Fungsi bantu'],
    'includes/db.php'           => ['function db', 'Koneksi database'],
    'api/account.php'           => ['change_password', 'Menu Akun Saya'],
    'api/mtc.php'               => ['mtc_auto_costs', 'Dashboard MTC (biaya otomatis)'],
    'api/roles.php'             => ['permissions_to_string', 'Role Management per menu'],
    'config/database.php'       => ['DB_NAME', 'Konfigurasi database'],
];
foreach ($markers as $file => [$needle, $desc]) {
    $path = "{$base}/{$file}";
    if (!is_file($path)) {
        add_check('File', $file, false, "{$desc} - file TIDAK ADA", 'Upload ulang file ini dari zip terbaru.');
        continue;
    }
    $isNew = strpos((string) file_get_contents($path), $needle) !== false;
    add_check('File', $file, $isNew, $desc . ($isNew ? '' : ' - masih VERSI LAMA'), 'Timpa file ini dengan versi dari zip terbaru.');
}

// Cek syntax semua file PHP (tanpa menjalankannya).
$phpFiles = array_merge(glob("{$base}/*.php") ?: [], glob("{$base}/api/*.php") ?: [], glob("{$base}/includes/*.php") ?: [], glob("{$base}/config/*.php") ?: []);
$syntaxErrors = [];
foreach ($phpFiles as $f) {
    try {
        token_get_all((string) file_get_contents($f), TOKEN_PARSE);
    } catch (Throwable $e) {
        $syntaxErrors[] = substr($f, strlen($base) + 1) . ' (baris ' . $e->getLine() . '): ' . $e->getMessage();
    }
}
add_check('File', 'Syntax ' . count($phpFiles) . ' file PHP', empty($syntaxErrors),
    $syntaxErrors ? implode(' | ', $syntaxErrors) : 'Tidak ada error syntax', 'Upload ulang file yang disebut dari zip terbaru.');

// ------------------------------------------------------------------ 3. Konfigurasi
$configOk = is_file("{$base}/config/database.php");
if ($configOk) {
    try {
        require_once "{$base}/config/database.php";
    } catch (Throwable $e) {
        $configOk = false;
        add_check('Konfigurasi', 'config/database.php', false, $e->getMessage(), 'Periksa isi file config/database.php.');
    }
}
if ($configOk && defined('DB_HOST')) {
    add_check('Konfigurasi', 'Database yang dipakai', true, 'Host: ' . DB_HOST . ' · Database: ' . DB_NAME . ' · User: ' . DB_USER);
    add_check('Konfigurasi', 'APP_DEBUG', !(defined('APP_DEBUG') && APP_DEBUG) ? true : null,
        (defined('APP_DEBUG') && APP_DEBUG) ? 'Aktif (true) - pesan error teknis bisa tampil ke user' : 'Nonaktif (aman)',
        "Set define('APP_DEBUG', false); di config/database.php untuk pemakaian sehari-hari.");
    if (defined('APP_SECRET_KEY') && strpos(APP_SECRET_KEY, 'GANTI_DENGAN') !== false) {
        add_check('Konfigurasi', 'APP_SECRET_KEY', null, 'Masih nilai contoh', 'Ganti dengan string acak di config/database.php.');
    }
}

// ------------------------------------------------------------------ 4. Database
$pdo = null;
if ($configOk && defined('DB_HOST')) {
    try {
        $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . (defined('DB_CHARSET') ? DB_CHARSET : 'utf8mb4'),
            DB_USER, DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $ver = $pdo->query('SELECT VERSION()')->fetchColumn();
        add_check('Database', 'Koneksi database', true, "Terhubung · {$ver}");
    } catch (Throwable $e) {
        add_check('Database', 'Koneksi database', false, $e->getMessage(),
            'Samakan DB_NAME / DB_USER / DB_PASS di config/database.php dengan database di phpMyAdmin. Pastikan MySQL di XAMPP sudah Start.');
    }
}
if ($pdo) {
    $tables = array_map('strtolower', $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));
    $need = [
        'schema.sql' => ['users', 'roles', 'customers', 'suppliers', 'work_orders', 'pr_items', 'seal_items', 'transport_items',
                         'master_products', 'master_buyers', 'activity_log', 'account_receivable', 'account_payable', 'dana_talangan', 'manual_cashflow'],
        'migration_gudang_produksi.sql' => ['inventory_items', 'inventory_movements', 'production_orders', 'production_bom_items'],
        'migration_sync_live.sql' => ['master_karyawan', 'work_order_budget_items', 'mtc_master_mesin', 'mtc_master_mp', 'mtc_divisi_records', 'mtc_divisi_items'],
        'migration_security_roles.sql' => ['login_attempts'],
    ];
    foreach ($need as $sqlFile => $list) {
        $missing = array_values(array_diff($list, $tables));
        add_check('Database', "Tabel dari {$sqlFile}", empty($missing),
            $missing ? 'Tabel belum ada: ' . implode(', ', $missing) : count($list) . ' tabel lengkap',
            "Import database/{$sqlFile} lewat phpMyAdmin (aman dijalankan ulang" . ($sqlFile === 'schema.sql' ? ' - HANYA untuk database kosong' : '') . ').');
    }
    $cols = function (string $table) use ($pdo, $tables): array {
        if (!in_array($table, $tables, true)) return [];
        return array_column($pdo->query("SHOW COLUMNS FROM `{$table}`")->fetchAll(), 'Type', 'Field');
    };
    $roleCols = $cols('roles');
    $modType = strtolower($roleCols['modules'] ?? '');
    add_check('Database', 'Kolom roles.modules (hak akses menu)', $modType === 'text',
        $modType ? "Tipe: {$modType}" : 'Kolom belum ada', 'Import database/migration_security_roles.sql (aman dijalankan ulang).');
    $prCols = $cols('pr_items');
    foreach (['approval_status', 'karyawan_id', 'penerima_barang'] as $c) {
        add_check('Database', "Kolom pr_items.{$c}", isset($prCols[$c]), isset($prCols[$c]) ? 'Ada' : 'Belum ada',
            $c === 'approval_status' ? 'Import database/migration_roles_and_approval.sql.' : 'Import database/migration_sync_live.sql.');
    }
    $woCols = $cols('work_orders');
    foreach (['wo_category', 'budget_lain', 'status'] as $c) {
        add_check('Database', "Kolom work_orders.{$c}", isset($woCols[$c]), isset($woCols[$c]) ? 'Ada' : 'Belum ada', 'Import database/migration_sync_live.sql.');
    }
    if (in_array('users', $tables, true) && in_array('roles', $tables, true)) {
        $admins = (int) $pdo->query("SELECT COUNT(*) FROM users u JOIN roles r ON r.role_key = u.role WHERE r.is_admin = 1 AND u.status = 'AKTIF'")->fetchColumn();
        add_check('Database', 'Akun admin aktif', $admins > 0, "{$admins} akun", 'Set role salah satu user ke "admin" lewat phpMyAdmin.');
    }
}

// ------------------------------------------------------------------ Tampilan
$fail = count(array_filter($checks, function ($c) { return $c[2] === false; }));
$warn = count(array_filter($checks, function ($c) { return $c[2] === null; }));
?>
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cek Instalasi</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f1f5f9; color: #1e293b; margin: 0; padding: 24px 16px; }
    .wrap { max-width: 980px; margin: 0 auto; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sum { padding: 14px 16px; border-radius: 12px; font-weight: 700; margin: 16px 0; }
    .sum.ok { background: #dcfce7; color: #166534; } .sum.bad { background: #fee2e2; color: #991b1b; } .sum.warn { background: #fef3c7; color: #92400e; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; font-size: 13px; }
    th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    th { background: #0f172a; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    td.st { width: 28px; font-size: 16px; text-align: center; }
    .grp { background: #f8fafc; font-weight: 700; color: #475569; }
    .fix { color: #b45309; font-size: 12px; margin-top: 3px; }
    .muted { color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
<div class="wrap">
  <h1>Cek Instalasi Aplikasi</h1>
  <div class="muted">Folder: <?= h($base) ?> · <?= h(date('d/m/Y H:i')) ?></div>

  <?php if ($fail): ?>
    <div class="sum bad">❌ Ada <?= $fail ?> masalah yang perlu diperbaiki<?= $warn ? " dan {$warn} peringatan" : '' ?>. Ikuti petunjuk di kolom kanan, lalu muat ulang halaman ini.</div>
  <?php elseif ($warn): ?>
    <div class="sum warn">⚠️ Aplikasi siap dipakai, dengan <?= $warn ?> peringatan.</div>
  <?php else: ?>
    <div class="sum ok">✅ Semua pengecekan lolos. Aplikasi siap dipakai.</div>
  <?php endif; ?>

  <table>
    <tr><th></th><th>Pengecekan</th><th>Hasil / Cara memperbaiki</th></tr>
    <?php $lastGroup = ''; foreach ($checks as [$group, $name, $ok, $detail, $fix]): ?>
      <?php if ($group !== $lastGroup): $lastGroup = $group; ?>
        <tr><td colspan="3" class="grp"><?= h($group) ?></td></tr>
      <?php endif; ?>
      <tr>
        <td class="st"><?= $ok === true ? '✅' : ($ok === false ? '❌' : '⚠️') ?></td>
        <td><?= h($name) ?></td>
        <td><?= h($detail) ?><?php if ($ok !== true && $fix): ?><div class="fix">👉 <?= h($fix) ?></div><?php endif; ?></td>
      </tr>
    <?php endforeach; ?>
  </table>
  <p class="muted">Halaman ini hanya bisa dibuka dari komputer server. Tidak mengubah data apapun.</p>
</div>
</body>
</html>
