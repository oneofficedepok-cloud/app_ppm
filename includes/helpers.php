<?php
/**
 * Helper functions umum dipakai di seluruh endpoint API.
 */

/**
 * Kirim response JSON standar lalu hentikan eksekusi.
 */
function json_response(array $data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_success($data = [], string $message = 'OK'): void
{
    json_response(['success' => true, 'message' => $message, 'data' => $data]);
}

function json_error(string $message = 'Terjadi kesalahan', int $statusCode = 400): void
{
    json_response(['success' => false, 'message' => $message], $statusCode);
}

/**
 * Ambil JSON body dari request (untuk POST/PUT dari fetch()).
 */
function get_json_input(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Sanitasi string dasar - trim + escape untuk output HTML (mencegah XSS).
 * Dipakai saat data ditampilkan kembali ke HTML (bukan untuk query, karena
 * query SELALU pakai prepared statement PDO).
 */
function clean_str($value): string
{
    return trim((string) ($value ?? ''));
}

function esc_html($value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
}

/**
 * Ambil nilai dari array dengan default, sekaligus trim jika string.
 */
function arr_val(array $arr, string $key, $default = null)
{
    if (!isset($arr[$key]) || $arr[$key] === '') {
        return $default;
    }
    $v = $arr[$key];
    return is_string($v) ? trim($v) : $v;
}

/**
 * Konversi ke integer atau null (untuk foreign key opsional).
 */
function to_int_or_null($value): ?int
{
    if ($value === null || $value === '' || $value === 'null') {
        return null;
    }
    return (int) $value;
}

/**
 * Konversi ke float aman (default 0).
 */
function to_float($value): float
{
    if ($value === null || $value === '') {
        return 0.0;
    }
    return (float) $value;
}

/**
 * Ubah teks bebas jadi slug snake_case aman untuk role_key
 * (dipakai supaya admin cukup mengetik "Nama Role" di UI,
 * tanpa perlu mikirin format teknis di baliknya).
 */
function slugify(string $text): string
{
    $text = strtolower(trim($text));
    $text = preg_replace('/[^a-z0-9]+/', '_', $text);
    $text = trim($text, '_');
    return $text !== '' ? $text : 'role';
}

/**
 * Catat aktivitas user ke tabel activity_log (audit trail).
 */
function log_activity(string $action, string $module, ?int $recordId = null, string $detail = ''): void
{
    try {
        $userId = current_user()['id'] ?? null;
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        $stmt = db()->prepare(
            'INSERT INTO activity_log (user_id, action, module, record_id, detail, ip_address)
             VALUES (:user_id, :action, :module, :record_id, :detail, :ip)'
        );
        $stmt->execute([
            ':user_id'   => $userId,
            ':action'    => $action,
            ':module'    => $module,
            ':record_id' => $recordId,
            ':detail'    => $detail,
            ':ip'        => $ip,
        ]);
    } catch (Throwable $e) {
        // Jangan sampai gagal log menghentikan proses utama.
    }
}

/**
 * Ambil hanya method HTTP saat ini (untuk router sederhana per-file).
 */
function http_method(): string
{
    return $_SERVER['REQUEST_METHOD'] ?? 'GET';
}

/**
 * Ambil daftar ID untuk hapus massal dari query string ?ids=1,2,3
 * atau dari JSON body {"ids":[1,2,3]}. Hasil: array int unik > 0.
 */
function parse_id_list(): array
{
    $raw = $_GET['ids'] ?? null;
    if ($raw === null) {
        $body = get_json_input();
        $raw = $body['ids'] ?? [];
    }
    if (is_string($raw)) $raw = explode(',', $raw);
    if (!is_array($raw)) return [];
    $ids = array_values(array_unique(array_filter(array_map('intval', $raw), fn($v) => $v > 0)));
    return array_slice($ids, 0, 1000);
}
