<?php
/**
 * Helper functions umum dipakai di seluruh endpoint API.
 */

/**
 * URL file statis + versi (tanggal ubah file), supaya browser boleh menyimpan file di cache
 * lama-lama tapi tetap otomatis mengambil yang baru setelah file diganti / update.
 */
function asset_url(string $path): string
{
    $file = dirname(__DIR__) . '/' . $path;
    return esc_html($path . (is_file($file) ? '?v=' . filemtime($file) : ''));
}

/**
 * Kirim response JSON standar lalu hentikan eksekusi.
 */
function json_response(array $data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    // Kompres data besar (mis. ribuan PR: ~5 MB -> ~0,4 MB) supaya cepat terkirim lewat WiFi.
    if (strlen($json) > 2048 && function_exists('gzencode') && !ini_get('zlib.output_compression')
        && stripos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false && !headers_sent()) {
        $gz = gzencode($json, 5);
        if ($gz !== false) {
            header('Content-Encoding: gzip');
            header('Vary: Accept-Encoding');
            $json = $gz;
        }
    }
    header('Content-Length: ' . strlen($json));
    echo $json;
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
 * Teks referensi yang mudah dicari untuk sebuah data (No PR, No WO, No Invoice, nama, dst.),
 * disimpan di log supaya menu Riwayat / Log bisa dicari berdasarkan nomor dokumen.
 * Return '' kalau data tidak ditemukan / modul tidak dikenal.
 */
function activity_ref(string $module, int $id): string
{
    static $sql = [
        'pr_items'            => "SELECT CONCAT('PR ', pr_number, ' #', item_no, ' · ', COALESCE(product, ''), ' · ', status) FROM pr_items WHERE id = ?",
        'work_orders'         => "SELECT CONCAT('WO ', wo_number, ' · ', COALESCE(project, ''), IF(COALESCE(po_no, '') <> '', CONCAT(' · PO ', po_no), '')) FROM work_orders WHERE id = ?",
        'seal_items'          => "SELECT CONCAT('Seal WO ', COALESCE(w.wo_number, '-'), ' · ', COALESCE(s.product, ''), ' ', COALESCE(s.type, '')) FROM seal_items s LEFT JOIN work_orders w ON w.id = s.wo_id WHERE s.id = ?",
        'transport_items'     => "SELECT CONCAT('Transport WO ', COALESCE(w.wo_number, '-'), ' · ', COALESCE(t.deskripsi, ''), ' ', COALESCE(t.asal, ''), '-', COALESCE(t.tujuan, '')) FROM transport_items t LEFT JOIN work_orders w ON w.id = t.wo_id WHERE t.id = ?",
        'account_receivable'  => "SELECT CONCAT('AR ', invoice_no, IF(COALESCE(po_no, '') <> '', CONCAT(' · PO ', po_no), '')) FROM account_receivable WHERE id = ?",
        'account_payable'     => "SELECT CONCAT('AP ', invoice_no, IF(COALESCE(po_no, '') <> '', CONCAT(' · PO ', po_no), '')) FROM account_payable WHERE id = ?",
        'dana_talangan'       => "SELECT CONCAT('DT ', no_dt, ' · ', COALESCE(pic, '')) FROM dana_talangan WHERE id = ?",
        'manual_cashflow'     => "SELECT CONCAT('Cash Flow ', tanggal, ' · ', COALESCE(invoice_ref, ''), ' · ', COALESCE(deskripsi, '')) FROM manual_cashflow WHERE id = ?",
        'surat_jalan'         => "SELECT CONCAT('SJ ', no_sj, ' · ', status) FROM surat_jalan WHERE id = ?",
        'customers'           => "SELECT CONCAT('Customer ', nama) FROM customers WHERE id = ?",
        'suppliers'           => "SELECT CONCAT('Supplier ', nama) FROM suppliers WHERE id = ?",
        'inventory_items'     => "SELECT CONCAT('Stok ', COALESCE(sku, ''), ' · ', nama) FROM inventory_items WHERE id = ?",
        'inventory_movements' => "SELECT CONCAT('Movement ', m.tipe, ' ', m.qty, ' · ', COALESCE(i.nama, '')) FROM inventory_movements m LEFT JOIN inventory_items i ON i.id = m.item_id WHERE m.id = ?",
        'production_orders'   => "SELECT CONCAT('Produksi ', po_number, ' · ', COALESCE(product, '')) FROM production_orders WHERE id = ?",
        'mtc_divisi_records'  => "SELECT CONCAT('MTC WO ', COALESCE(w.wo_number, '-'), ' · ', r.nama_item, ' · ', r.divisi) FROM mtc_divisi_records r LEFT JOIN work_orders w ON w.id = r.wo_id WHERE r.id = ?",
        'mtc_master_mesin'    => "SELECT CONCAT('Mesin ', kode, ' · ', COALESCE(nama, '')) FROM mtc_master_mesin WHERE id = ?",
        'mtc_master_mp'       => "SELECT CONCAT('Tarif MP ', divisi) FROM mtc_master_mp WHERE id = ?",
        'master_products'     => "SELECT CONCAT('Product ', nama) FROM master_products WHERE id = ?",
        'master_buyers'       => "SELECT CONCAT('Buyer ', nama) FROM master_buyers WHERE id = ?",
        'master_karyawan'     => "SELECT CONCAT('Karyawan ', nama) FROM master_karyawan WHERE id = ?",
        'master_users'        => "SELECT CONCAT('User ', username) FROM users WHERE id = ?",
        'roles'               => "SELECT CONCAT('Role ', label) FROM roles WHERE id = ?",
    ];
    if (!isset($sql[$module]) || $id <= 0) return '';
    try {
        $stmt = db()->prepare($sql[$module]);
        $stmt->execute([$id]);
        return (string) ($stmt->fetchColumn() ?: '');
    } catch (Throwable $e) {
        return '';
    }
}

/**
 * Dipanggil SEBELUM data dihapus (lihat includes/auth.php): simpan referensinya dulu,
 * supaya log "delete" tetap mencatat No PR / No WO dsb. walaupun datanya sudah hilang.
 */
function activity_ref_capture(string $module, array $ids): void
{
    foreach ($ids as $id) {
        $id = (int) $id;
        if ($id > 0) $GLOBALS['__activity_refs'][$module][$id] = activity_ref($module, $id);
    }
}

/** Catat aktivitas user ke tabel activity_log (audit trail, dilihat di Administrator -> Riwayat / Log). */
function log_activity(string $action, string $module, ?int $recordId = null, string $detail = ''): void
{
    try {
        // Referensi data (No PR, No WO, ...) - dari data yang masih ada, atau dari tangkapan sebelum dihapus.
        $ref = '';
        if ($recordId) {
            $ref = $GLOBALS['__activity_refs'][$module][$recordId] ?? '';
            if ($ref === '') $ref = activity_ref($module, $recordId);
        } elseif (preg_match('/IDs:\s*([\d,]+)/', $detail, $m)) {
            $refs = [];
            foreach (explode(',', $m[1]) as $bid) {
                $r = $GLOBALS['__activity_refs'][$module][(int) $bid] ?? '';
                if ($r !== '') $refs[] = $r;
            }
            if ($refs) $ref = implode(' ; ', array_slice($refs, 0, 50));
        }
        if ($ref !== '' && $detail !== '' && stripos($ref, $detail) !== false) $detail = '';
        $full = trim($ref . ($ref !== '' && $detail !== '' ? ' | ' : '') . $detail);

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
            ':detail'    => mb_substr($full, 0, 60000),
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

/**
 * Tambah kolom yang belum ada di tabel (dipakai untuk fitur baru, supaya tidak perlu import SQL manual).
 * $cols = ['nama_kolom' => 'DEFINISI SQL', ...]. Dicek sekali per request per tabel.
 */
function db_ensure_columns(PDO $pdo, string $table, array $cols): void
{
    static $done = [];
    if (isset($done[$table])) return;
    $done[$table] = true;
    $have = array_column($pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(), 'Field');
    foreach ($cols as $name => $ddl) {
        if (!in_array($name, $have, true)) $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$name` $ddl");
    }
}

/** Status Seal CNC yang valid. CANCEL tidak dihitung sebagai biaya WO. */
const SEAL_STATUSES = ['ON PROSES', 'DONE', 'CANCEL'];

/** Kolom baru Seal CNC (tanggal permintaan/proses + status) & Transportasi (tanggal + invoice). */
function ensure_seal_transport_columns(PDO $pdo): void
{
    db_ensure_columns($pdo, 'seal_items', [
        'tgl_permintaan' => "DATE NULL COMMENT 'Tanggal permintaan seal' AFTER `customer_id`",
        'tgl_proses'     => "DATE NULL COMMENT 'Tanggal seal diproses' AFTER `tgl_permintaan`",
        'status'         => "VARCHAR(20) NOT NULL DEFAULT 'ON PROSES' COMMENT 'ON PROSES / DONE / CANCEL' AFTER `tgl_proses`",
    ]);
    db_ensure_columns($pdo, 'transport_items', [
        'tanggal'    => "DATE NULL COMMENT 'Tanggal transportasi' AFTER `customer_id`",
        'invoice_no' => "VARCHAR(100) NULL COMMENT 'No. invoice vendor transportasi' AFTER `tanggal`",
    ]);
}

/** Kolom Kode Customer (customers.kode) - ditambahkan otomatis bila belum ada. */
function ensure_customer_kode(PDO $pdo): void
{
    db_ensure_columns($pdo, 'customers', [
        'kode' => "VARCHAR(30) NULL COMMENT 'Kode customer (unik)' AFTER `id`",
    ]);
}

/** Validasi Kode Customer: huruf besar, unik (kosong boleh). */
function customer_kode_input(PDO $pdo, array $b, ?int $id = null): ?string
{
    $kode = strtoupper(clean_str(arr_val($b, 'kode', '')));
    if ($kode === '') return null;
    if (mb_strlen($kode) > 30) json_error('Kode Customer maksimal 30 karakter.', 422);
    $q = $pdo->prepare('SELECT nama FROM customers WHERE UPPER(kode) = :k AND id <> :id LIMIT 1');
    $q->execute([':k' => $kode, ':id' => $id ?? 0]);
    $dup = $q->fetchColumn();
    if ($dup !== false) json_error("Kode Customer $kode sudah dipakai customer $dup.", 409);
    return $kode;
}

