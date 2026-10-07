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
