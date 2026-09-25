<?php
require_once __DIR__ . '/../includes/auth.php';

$method = http_method();
$action = $_GET['action'] ?? '';

if ($method === 'POST' && $action === 'login') {
    $body = get_json_input();
    $username = clean_str(arr_val($body, 'username', ''));
    $password = (string) arr_val($body, 'password', '');

    if ($username === '' || $password === '' || strlen($username) > 100 || strlen($password) > 200) {
        json_error('Username dan password wajib diisi.', 422);
    }

    try {
        $user = attempt_login($username, $password);
    } catch (RuntimeException $e) {
        json_error($e->getMessage(), 429);
    }

    if (!$user) {
        // Pesan sengaja generik (tidak bilang "user tidak ada" / "password salah")
        // supaya tidak membantu percobaan brute-force menebak username valid.
        json_error('Username atau password salah, atau akun tidak aktif.', 401);
    }

    log_activity('login', 'auth', (int) $user['id'], 'User login: ' . $user['username']);
    json_success($user, 'Login berhasil.');
}

if ($method === 'POST' && $action === 'logout') {
    $user = current_user();
    if ($user) {
        log_activity('logout', 'auth', (int) $user['id'], 'User logout: ' . $user['username']);
    }
    do_logout();
    json_success([], 'Logout berhasil.');
}

if ($method === 'GET' && $action === 'me') {
    $user = current_user();
    if (!$user) {
        json_error('Belum login.', 401);
    }
    json_success($user);
}

json_error('Aksi tidak ditemukan.', 404);
