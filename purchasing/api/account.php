<?php
/**
 * Menu "Akun Saya" - setiap user yang login (role apapun) bisa:
 *   GET                       : lihat profil + daftar hak akses menunya
 *   POST ?action=change_password : ganti password sendiri (wajib isi password lama)
 */
require_once __DIR__ . '/../includes/auth.php';

$user = require_login();
$method = http_method();
$action = $_GET['action'] ?? '';

if ($method === 'GET') {
    // Hak akses dikelompokkan per modul supaya mudah dibaca user.
    $groups = [];
    foreach (APP_MODULES as $moduleKey => $module) {
        $items = [];
        foreach ($module['menus'] as $menuKey => $label) {
            $lvl = user_level($user, $menuKey);
            if ($lvl >= PERM_VIEW) {
                $items[] = ['menu' => $label, 'level' => $lvl >= PERM_EDIT ? 'edit' : 'view'];
            }
        }
        if ($items) $groups[] = ['module' => $module['label'], 'menus' => $items];
    }
    json_success([
        'username'   => $user['username'],
        'full_name'  => $user['full_name'],
        'divisi'     => $user['divisi'],
        'role_label' => $user['role_label'],
        'is_admin'   => $user['is_admin'],
        'access'     => $groups,
    ]);
}

if ($method === 'POST' && $action === 'change_password') {
    $b = get_json_input();
    $current = (string) arr_val($b, 'current_password', '');
    $new     = (string) arr_val($b, 'new_password', '');
    $confirm = (string) arr_val($b, 'confirm_password', '');

    if ($current === '' || $new === '') {
        json_error('Password lama dan password baru wajib diisi.', 422);
    }
    if ($new !== $confirm) {
        json_error('Konfirmasi password baru tidak sama.', 422);
    }
    if ($new === $current) {
        json_error('Password baru harus berbeda dari password lama.', 422);
    }
    if ($err = password_policy_error($new, $user['username'])) {
        json_error($err, 422);
    }

    // Salah password lama dihitung sebagai percobaan gagal, supaya fitur ini
    // tidak bisa dipakai menebak password orang yang lupa logout.
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (login_is_locked($user['username'], $ip)) {
        json_error('Terlalu banyak percobaan salah. Coba lagi dalam ' . LOGIN_LOCK_MINUTES . ' menit.', 429);
    }
    $stmt = db()->prepare('SELECT password FROM users WHERE id = :id');
    $stmt->execute([':id' => $user['id']]);
    $hash = (string) $stmt->fetchColumn();
    if (!password_verify($current, $hash)) {
        record_login_failure($user['username'], $ip);
        json_error('Password lama salah.', 422);
    }

    db()->prepare('UPDATE users SET password = :p WHERE id = :id')
        ->execute([':p' => password_hash($new, PASSWORD_DEFAULT), ':id' => $user['id']]);

    // Sesi baru + token baru setelah ganti password.
    session_regenerate_id(true);
    $_SESSION['weak_password'] = false;
    log_activity('change_password', 'account', $user['id'], 'Ganti password sendiri');
    json_success([], 'Password berhasil diganti.');
}

json_error('Aksi tidak ditemukan.', 404);
