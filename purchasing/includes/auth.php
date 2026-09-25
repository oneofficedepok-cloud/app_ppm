<?php
/**
 * Modul Autentikasi & Otorisasi (session-based, real password check).
 * Menggantikan "login palsu" pada versi front-end-only sebelumnya.
 *
 * Lapisan keamanan di file ini:
 *  - Session cookie HttpOnly + SameSite + Secure (otomatis di HTTPS), strict mode
 *  - Session idle timeout (auto logout kalau lama tidak dipakai)
 *  - Data user & hak akses DIBACA ULANG dari database setiap request,
 *    jadi user yang dinonaktifkan / diganti role-nya langsung berlaku
 *    tanpa perlu menunggu dia logout
 *  - Batas percobaan login (anti brute-force)
 *  - Token CSRF wajib untuk semua request yang mengubah data
 *  - Hak akses per MODUL berdasarkan role (lihat includes/permissions.php)
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/permissions.php';

// Lama sesi boleh menganggur sebelum otomatis logout (detik). Bisa di-override di config/database.php.
if (!defined('SESSION_IDLE_TIMEOUT')) define('SESSION_IDLE_TIMEOUT', 2 * 60 * 60);
// Batas gagal login: per (username + IP) dan per IP dalam jendela waktu tertentu.
if (!defined('LOGIN_MAX_FAILS_PER_USER')) define('LOGIN_MAX_FAILS_PER_USER', 5);
if (!defined('LOGIN_MAX_FAILS_PER_IP')) define('LOGIN_MAX_FAILS_PER_IP', 20);
if (!defined('LOGIN_LOCK_MINUTES')) define('LOGIN_LOCK_MINUTES', 15);
// Panjang minimal password baru.
if (!defined('PASSWORD_MIN_LENGTH')) define('PASSWORD_MIN_LENGTH', 8);

send_security_headers();
install_error_handler();

/**
 * Header keamanan dasar. Juga di-set di .htaccess, tapi diulang di sini
 * supaya tetap aktif di hosting Nginx / yang mod_headers-nya mati.
 */
function send_security_headers(): void
{
    if (headers_sent()) return;
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    if (is_https()) {
        header('Strict-Transport-Security: max-age=31536000');
    }
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

/**
 * Error tak terduga (mis. query gagal) jangan sampai menampilkan pesan
 * teknis / path file / isi SQL ke browser. Detailnya dicatat ke error log
 * server, user hanya melihat pesan umum.
 */
function install_error_handler(): void
{
    if (defined('APP_DEBUG') && APP_DEBUG) return;
    ini_set('display_errors', '0');
    set_exception_handler(function (Throwable $e) {
        error_log('[' . APP_NAME . '] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['success' => false, 'message' => 'Terjadi kesalahan di server. Silakan coba lagi atau hubungi administrator.']);
    });
}

function start_secure_session(): void
{
    if (session_status() !== PHP_SESSION_NONE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('PPMSESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();

    // Auto logout kalau sesi terlalu lama menganggur.
    $now = time();
    if (isset($_SESSION['last_activity']) && ($now - (int) $_SESSION['last_activity']) > SESSION_IDLE_TIMEOUT) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['last_activity'] = $now;
}

// ---------------------------------------------------------------------
// USER & HAK AKSES
// ---------------------------------------------------------------------

/**
 * Ambil data user + role + daftar modul dari database.
 * Return null kalau user tidak ada / tidak aktif.
 */
function load_user(string $where, array $params, bool $withPassword = false): ?array
{
    $cols = 'u.id, u.username, u.full_name, u.divisi, u.role, u.status,
             COALESCE(r.is_admin, 0) AS is_admin, COALESCE(r.label, u.role) AS role_label';
    if ($withPassword) $cols .= ', u.password';

    try {
        $stmt = db()->prepare("SELECT {$cols}, r.modules AS modules FROM users u LEFT JOIN roles r ON r.role_key = u.role WHERE {$where} LIMIT 1");
        $stmt->execute($params);
    } catch (PDOException $e) {
        // Kolom roles.modules belum ada (migration_security_roles.sql belum dijalankan).
        // Tetap bisa login, tapi non-admin tidak dapat modul apapun (fail-closed)
        // sampai migrasi dijalankan.
        $stmt = db()->prepare("SELECT {$cols}, NULL AS modules FROM users u LEFT JOIN roles r ON r.role_key = u.role WHERE {$where} LIMIT 1");
        $stmt->execute($params);
    }
    $user = $stmt->fetch();
    if (!$user) return null;

    $user['id'] = (int) $user['id'];
    $user['is_admin'] = (bool) $user['is_admin'];
    // perms  : ['menu' => PERM_VIEW|PERM_EDIT] (dipakai server)
    // access : {"menu": "view"|"edit"}        (dikirim ke browser untuk tampilan menu)
    // modules: modul level-1 yang punya minimal 1 menu boleh dilihat
    $user['perms'] = $user['is_admin'] ? full_permissions() : parse_permissions($user['modules'] ?? '');
    $user['access'] = permissions_for_client($user['perms']);
    $user['modules'] = visible_modules($user['perms']);
    return $user;
}

/**
 * Cek kredensial ke tabel users lalu buat session jika valid.
 * Return array user (tanpa password) jika berhasil, null jika gagal.
 * Melempar RuntimeException kalau sedang dikunci karena terlalu banyak gagal login.
 */
function attempt_login(string $username, string $password): ?array
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (login_is_locked($username, $ip)) {
        throw new RuntimeException('Terlalu banyak percobaan login gagal. Coba lagi dalam ' . LOGIN_LOCK_MINUTES . ' menit.');
    }

    $user = load_user('u.username = :u', [':u' => $username], true);

    // password_verify tetap dijalankan walau user tidak ada, supaya waktu respons
    // sama dan tidak bisa dipakai menebak username mana yang valid.
    $hash = $user['password'] ?? password_hash('dummy-' . bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
    $passwordOk = password_verify($password, $hash);

    if (!$user || !$passwordOk || $user['status'] !== 'AKTIF') {
        record_login_failure($username, $ip);
        return null;
    }

    // Upgrade hash lama otomatis kalau algoritma/cost default PHP berubah.
    if (password_needs_rehash($user['password'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET password = :p WHERE id = :id')
            ->execute([':p' => password_hash($password, PASSWORD_DEFAULT), ':id' => $user['id']]);
    }
    unset($user['password']);
    clear_login_failures($username, $ip);

    start_secure_session();
    session_regenerate_id(true); // cegah session fixation
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    $_SESSION['weak_password'] = is_weak_password($password, $username);

    return $user;
}

/** Password yang terlalu umum / masih default instalasi. */
function is_weak_password(string $password, string $username = ''): bool
{
    $common = ['admin123', 'admin', 'password', '123456', '12345678', 'qwerty', '111111', 'user123'];
    return strlen($password) < PASSWORD_MIN_LENGTH
        || in_array(strtolower($password), $common, true)
        || ($username !== '' && strcasecmp($password, $username) === 0);
}

/** Validasi password baru. Return pesan error, atau null kalau OK. */
function password_policy_error(string $password, string $username = ''): ?string
{
    if (strlen($password) < PASSWORD_MIN_LENGTH) {
        return 'Password minimal ' . PASSWORD_MIN_LENGTH . ' karakter.';
    }
    if (!preg_match('/[A-Za-z]/', $password) || !preg_match('/[0-9]/', $password)) {
        return 'Password harus mengandung huruf dan angka.';
    }
    if (is_weak_password($password, $username)) {
        return 'Password terlalu mudah ditebak. Gunakan kombinasi lain.';
    }
    return null;
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

/**
 * User yang sedang login, dibaca ulang dari database (sekali per request).
 * Kalau akun sudah dihapus / dinonaktifkan admin, sesi langsung diputus.
 */
function current_user(): ?array
{
    static $cached = false;
    if ($cached !== false) return $cached;

    start_secure_session();
    // Sesi dari versi lama menyimpan seluruh data user di $_SESSION['user'].
    $id = (int) ($_SESSION['user_id'] ?? ($_SESSION['user']['id'] ?? 0));
    if ($id <= 0) {
        return $cached = null;
    }
    $user = load_user('u.id = :id', [':id' => $id]);
    if (!$user || $user['status'] !== 'AKTIF') {
        $_SESSION = [];
        return $cached = null;
    }
    $user['weak_password'] = !empty($_SESSION['weak_password']);
    return $cached = $user;
}

/** Level izin user untuk satu menu: PERM_NONE / PERM_VIEW / PERM_EDIT. */
function user_level(?array $user, string $menu): int
{
    if (!$user) return PERM_NONE;
    if (!empty($user['is_admin'])) return PERM_EDIT;
    return (int) ($user['perms'][$menu] ?? PERM_NONE);
}

/** Boleh MELIHAT minimal salah satu menu yang disebut. */
function can_view(?array $user, array $menus): bool
{
    foreach ($menus as $m) {
        if (user_level($user, $m) >= PERM_VIEW) return true;
    }
    return false;
}

/** Boleh MENGUBAH minimal salah satu menu yang disebut. */
function can_edit(?array $user, array $menus): bool
{
    foreach ($menus as $m) {
        if (user_level($user, $m) >= PERM_EDIT) return true;
    }
    return false;
}

/** Punya akses ke modul level-1 (minimal 1 menu di dalamnya boleh dilihat). */
function user_can(?array $user, string $module): bool
{
    if (!$user) return false;
    return !empty($user['is_admin']) || in_array($module, $user['modules'] ?? [], true);
}

function menu_labels(array $menus): string
{
    $labels = [];
    foreach ($menus as $m) {
        $mod = all_menus()[$m] ?? null;
        $labels[] = $mod ? APP_MODULES[$mod]['menus'][$m] : $m;
    }
    return implode(' / ', $labels);
}

// ---------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------

function csrf_token(): string
{
    start_secure_session();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/**
 * Request yang mengubah data (POST/PUT/DELETE) wajib membawa header
 * X-CSRF-Token (atau field csrf_token untuk upload form) yang cocok
 * dengan token di sesi. Ini mencegah situs lain "menumpang" sesi login
 * user untuk menghapus/mengubah data diam-diam.
 */
function verify_csrf(): void
{
    $method = http_method();
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) return;

    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf_token'] ?? '');
    $expected = $_SESSION['csrf_token'] ?? '';
    if ($expected === '' || !is_string($sent) || !hash_equals($expected, $sent)) {
        json_error('Token keamanan tidak valid atau kedaluwarsa. Muat ulang halaman lalu coba lagi.', 419);
    }
}

// ---------------------------------------------------------------------
// GUARD UNTUK ENDPOINT API
// ---------------------------------------------------------------------

/**
 * Panggil di awal setiap endpoint API yang WAJIB login.
 * Menghentikan eksekusi dengan 401 jika belum login, dan 419 jika
 * request tulis tanpa token CSRF yang valid.
 */
function require_login(): array
{
    $user = current_user();
    if (!$user) {
        json_error('Sesi Anda telah berakhir. Silakan login kembali.', 401);
    }
    verify_csrf();
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

/** Wajib boleh MELIHAT minimal satu menu yang disebut. */
function require_view(array $menus): array
{
    $user = require_login();
    if (!can_view($user, $menus)) {
        json_error('Anda tidak memiliki akses ke menu ' . menu_labels($menus) . '. Hubungi admin untuk menambah hak akses role Anda.', 403);
    }
    return $user;
}

/** Wajib boleh MENGUBAH minimal satu menu yang disebut. */
function require_edit(array $menus): array
{
    $user = require_login();
    if (!can_edit($user, $menus)) {
        json_error('Role Anda hanya boleh MELIHAT menu ' . menu_labels($menus) . ', tidak boleh menambah/mengubah/menghapus. Hubungi admin untuk menambah hak akses.', 403);
    }
    return $user;
}

/**
 * Aturan akses umum per endpoint:
 *  - GET (baca)             : wajib boleh melihat salah satu $viewMenus
 *                             (null = semua user login boleh baca, untuk data referensi/dropdown)
 *  - POST/PUT/DELETE (ubah) : wajib boleh mengubah salah satu $editMenus
 */
function require_perm(?array $viewMenus, array $editMenus): array
{
    if (http_method() === 'GET') {
        return $viewMenus === null ? require_login() : require_view($viewMenus);
    }
    return require_edit($editMenus);
}

// ---------------------------------------------------------------------
// ANTI BRUTE-FORCE LOGIN
// ---------------------------------------------------------------------

function login_is_locked(string $username, string $ip): bool
{
    try {
        $stmt = db()->prepare(
            'SELECT
                SUM(username = :u) AS by_user,
                COUNT(*) AS by_ip
             FROM login_attempts
             WHERE attempted_at > (NOW() - INTERVAL ' . (int) LOGIN_LOCK_MINUTES . ' MINUTE)
               AND ip_address = :ip'
        );
        // by_user dihitung per (username + IP) - bukan username saja - supaya orang
        // lain tidak bisa sengaja mengunci akun seseorang dari komputer lain.
        $stmt->execute([':u' => strtolower($username), ':ip' => $ip]);
        $row = $stmt->fetch();
        return (int) ($row['by_user'] ?? 0) >= LOGIN_MAX_FAILS_PER_USER
            || (int) ($row['by_ip'] ?? 0) >= LOGIN_MAX_FAILS_PER_IP;
    } catch (PDOException $e) {
        return false; // tabel belum dibuat (migrasi belum dijalankan) - jangan blokir login
    }
}

function record_login_failure(string $username, string $ip): void
{
    try {
        db()->prepare('INSERT INTO login_attempts (username, ip_address) VALUES (:u, :ip)')
            ->execute([':u' => strtolower($username), ':ip' => $ip]);
        // Bersihkan catatan lama supaya tabel tidak membengkak.
        db()->exec('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL 1 DAY)');
    } catch (PDOException $e) {
        // abaikan
    }
    log_activity('login_failed', 'auth', null, 'Login gagal: ' . substr($username, 0, 100));
}

function clear_login_failures(string $username, string $ip): void
{
    try {
        db()->prepare('DELETE FROM login_attempts WHERE username = :u AND ip_address = :ip')
            ->execute([':u' => strtolower($username), ':ip' => $ip]);
    } catch (PDOException $e) {
        // abaikan
    }
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
