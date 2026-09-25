<?php
/**
 * Modul Autentikasi & Otorisasi (session-based, real password check).
 * Menggantikan "login palsu" pada versi front-end-only sebelumnya.
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';

function start_secure_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        // Pengaturan cookie session yang lebih aman.
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'secure'   => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', // wajib true kalau sudah pakai HTTPS
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }
}

/**
 * Cek kredensial ke tabel users lalu buat session jika valid.
 * Return array user (tanpa password) jika berhasil, null jika gagal.
 */
function attempt_login(string $username, string $password): ?array
{
    // JOIN roles supaya is_admin & label role selalu ambil dari tabel roles
    // (dinamis, bisa diubah admin lewat UI) — bukan hardcode string di kode.
    $stmt = db()->prepare(
        'SELECT u.id, u.username, u.password, u.full_name, u.divisi, u.role, u.status,
                COALESCE(r.is_admin, 0) AS is_admin, COALESCE(r.label, u.role) AS role_label
         FROM users u
         LEFT JOIN roles r ON r.role_key = u.role
         WHERE u.username = :u LIMIT 1'
    );
    $stmt->execute([':u' => $username]);
    $user = $stmt->fetch();

    if (!$user) {
        return null;
    }
    if ($user['status'] !== 'AKTIF') {
        return null; // akun dinonaktifkan
    }
    if (!password_verify($password, $user['password'])) {
        return null;
    }

    unset($user['password']);
    $user['is_admin'] = (bool) $user['is_admin'];

    start_secure_session();
    session_regenerate_id(true); // cegah session fixation
    $_SESSION['user'] = $user;

    return $user;
}

function do_logout(): void
{
    start_secure_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
    }
    session_destroy();
}

function current_user(): ?array
{
    start_secure_session();
    return $_SESSION['user'] ?? null;
}

/**
 * Panggil di awal setiap endpoint API yang WAJIB login.
 * Menghentikan eksekusi dengan 401 jika belum login.
 */
function require_login(): array
{
    $user = current_user();
    if (!$user) {
        json_error('Sesi Anda telah berakhir. Silakan login kembali.', 401);
    }
    return $user;
}

/**
 * Panggil untuk endpoint yang HANYA boleh diakses role dengan
 * akses admin penuh (mis. hapus data master, hapus user, kelola role).
 * Dicek dari flag is_admin di tabel roles (bukan hardcode nama role),
 * supaya role baru yang dibuat admin lewat UI otomatis ikut aturan ini
 * kalau dicentang "Akses Admin Penuh".
 */
function require_admin(): array
{
    $user = require_login();
    if (empty($user['is_admin'])) {
        json_error('Anda tidak memiliki akses untuk aksi ini (khusus Admin).', 403);
    }
    return $user;
}

/**
 * Panggil untuk endpoint yang hanya boleh diakses role tertentu
 * (mis. ['leader'] untuk aksi cek PR, ['manager_purchasing'] untuk approve).
 * Role dengan akses admin penuh (is_admin) SELALU boleh lewat, apapun
 * daftar role yang diminta — supaya admin bisa selalu turun tangan.
 */
function require_role(array $allowedRoleKeys): array
{
    $user = require_login();
    if (!empty($user['is_admin'])) {
        return $user; // admin selalu boleh
    }
    if (!in_array($user['role'], $allowedRoleKeys, true)) {
        json_error('Anda tidak memiliki akses untuk aksi ini.', 403);
    }
    return $user;
}

/**
 * Versi untuk HALAMAN (bukan API): redirect ke login.php jika belum login,
 * bukan mengembalikan JSON 401.
 */
function require_login_redirect(): array
{
    $user = current_user();
    if (!$user) {
        header('Location: login.php');
        exit;
    }
    return $user;
}
