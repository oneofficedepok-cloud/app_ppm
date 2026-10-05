<?php
/**
 * Import data dari file Excel (.xlsx) sesuai template di download_template.php.
 *
 * POST multipart/form-data:
 *   type = karyawan | customers | suppliers | buyers | products | work_orders | pr_items | mtc | ar | ap | sj
 *   file = file .xlsx
 *
 * Response: { success, message, data: { berhasil, dilewati, gagal, errors: [{baris, pesan}] } }
 *
 * Prinsip:
 * - Kolom dicocokkan berdasarkan NAMA HEADER (baris 1), bukan posisi,
 *   jadi urutan kolom boleh berubah / ada kolom tambahan.
 * - Diproses per baris: baris yang error dilaporkan, baris lain tetap masuk.
 * - Data yang sudah ada (nama master / No WO / No PR + No Item) DILEWATI, tidak ditimpa.
 * - Kalkulasi PPN / total & auto-nomor WO/PR memakai fungsi yang SAMA dengan input manual.
 * - Baris contoh bawaan template & baris "Catatan: ..." otomatis diabaikan.
 */

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/xlsx_reader.php';
require_once __DIR__ . '/../includes/wo_functions.php';
require_once __DIR__ . '/../includes/pr_functions.php';
require_once __DIR__ . '/../includes/finance_calc.php';

// Import pekerjaan MTC / AR / AP / Surat Jalan boleh dilakukan role yang punya izin UBAH
// di menu terkait; import data lain (master, WO, PR) tetap khusus admin.
$IMPORT_MENU = ['mtc' => 'mtcdivisi', 'ar' => 'ar', 'ap' => 'ap', 'sj' => 'sj'];
if (isset($IMPORT_MENU[$_POST['type'] ?? ''])) {
    require_edit([$IMPORT_MENU[$_POST['type']]]);
} else {
    require_admin();
}

if (http_method() !== 'POST') json_error('Method tidak didukung.', 405);

@set_time_limit(300);

$pdo = db();
$type = $_POST['type'] ?? '';

// ---------------------------------------------------------
// Definisi kolom per tipe: key internal => [label header di template, wajib?]
// ---------------------------------------------------------
$MASTER_ALAMAT_COLS = [
    'nama' => ['Nama', true], 'alamat' => ['Alamat', false], 'kelurahan' => ['Kelurahan', false],
    'kecamatan' => ['Kecamatan', false], 'kota' => ['Kota', false], 'provinsi' => ['Provinsi', false],
    'kodepos' => ['Kode Pos', false], 'negara' => ['Negara', false], 'pic' => ['PIC', false],
    'cp' => ['Contact Person', false], 'telepon' => ['Telepon', false], 'npwp' => ['NPWP', false],
    'status' => ['Status', false],
];
$COLUMNS = [
    'customers' => $MASTER_ALAMAT_COLS,
    'suppliers' => $MASTER_ALAMAT_COLS,
    'karyawan'  => ['nama' => ['Nama', true], 'divisi' => ['Divisi', false], 'jabatan' => ['Jabatan', false], 'status' => ['Status', false]],
    'buyers'    => ['nama' => ['Nama', true]],
    'products'  => ['nama' => ['Nama', true]],
    'work_orders' => [
        'wo_number' => ['No WO', false], 'wo_category' => ['Kategori WO', false], 'project' => ['Nama Project', true],
        'customer' => ['Nama Customer', true], 'est_kirim' => ['Estimasi Kirim', false], 'po_no' => ['No PO', false],
        'qty' => ['Qty', false], 'satuan' => ['Satuan', false], 'harga_satuan' => ['Harga Satuan', false],
        'diskon' => ['Diskon', false], 'is_ppn' => ['PPN', false], 'is_pph23' => ['PPh23', false],
        'pph_lain_pct' => ['PPh Lain %', false], 'budget_prod' => ['Budget Produksi', false],
        'aktual_prod' => ['Aktual Produksi', false], 'budget_pem' => ['Budget Pembelian', false],
        'budget_lain' => ['Budget Lain-lain', false], 'total_lain' => ['Aktual Lain-lain', false],
        'status' => ['Status', false],
    ],
    'pr_items' => [
        'sheet' => ['Kategori', false], 'tanggal' => ['Tanggal', true], 'pr_number' => ['No PR', false],
        'item_no' => ['No Item', false], 'wo' => ['No WO', false], 'customer' => ['Nama Customer', false],
        'project' => ['Nama Project', false], 'product' => ['Nama Barang', true], 'type' => ['Type', false],
        'dimensi' => ['Dimensi', false], 'brand' => ['Brand', false], 'qty' => ['Qty', true],
        'uom' => ['Satuan', false], 'harga' => ['Harga Satuan', false], 'is_ppn' => ['Kena PPN', false],
        'ppn_rate' => ['Tarif PPN %', false], 'supplier' => ['Supplier', false], 'tgl_beli' => ['Tanggal Beli', false],
        'tgl_datang' => ['Tanggal Datang', false], 'penerima_barang' => ['Penerima Barang', false],
        'po_number' => ['No PO', false], 'invoice_number' => ['No Invoice', false], 'buyer' => ['Buyer', false],
        'user' => ['User Peminta', false], 'divisi' => ['Divisi', false], 'status' => ['Status', false],
        'keterangan' => ['Deskripsi', false],
    ],
    'mtc' => [
        'wo' => ['No WO', true], 'nama_item' => ['Item Pekerjaan', true], 'divisi' => ['Divisi', true],
        'status_workflow' => ['Status Workflow', false], 'pic' => ['PIC', false], 'surat_jalan' => ['No Surat Jalan', false],
        'pekerjaan' => ['Pekerjaan', true], 'deskripsi' => ['Deskripsi', false], 'qty' => ['Qty', true],
        'satuan' => ['Satuan', false], 'kode_mesin' => ['Kode Mesin', false], 'harga' => ['Harga Satuan', false],
        'status' => ['Status', false],
    ],
    'ar' => [
        'invoice_no' => ['No Invoice', true], 'tgl_invoice' => ['Tanggal Invoice', true], 'tgl_kirim' => ['Tanggal Kirim Invoice', false],
        'customer' => ['Nama Customer', true], 'po_no' => ['No PO', false], 'wo' => ['No WO', false],
        'deskripsi' => ['Deskripsi', false], 'penjualan' => ['Penjualan DPP', true], 'is_ppn' => ['PPN 11%', false],
        'is_ppn030' => ['PPN 030', false], 'pph23' => ['PPh23 Rp', false], 'biaya_lain' => ['Biaya Lain', false],
        'top_days' => ['TOP Hari', false], 'due_date' => ['Jatuh Tempo', false], 'faktur_pajak' => ['No Faktur Pajak', false],
        'terbayar' => ['Terbayar', false], 'tgl_bayar' => ['Tanggal Bayar', false],
    ],
    'ap' => [
        'invoice_no' => ['No Invoice', true], 'tgl_invoice' => ['Tanggal Invoice', true], 'tgl_terima' => ['Tanggal Terima Invoice', false],
        'supplier' => ['Nama Supplier', true], 'po_no' => ['No PO', false], 'deskripsi' => ['Deskripsi', false],
        'pembelian' => ['Pembelian DPP', true], 'is_ppn' => ['PPN 11%', false], 'is_pph23' => ['PPh23 2%', false],
        'biaya_lain' => ['Biaya Lain', false], 'top_days' => ['TOP Hari', false], 'due_date' => ['Jatuh Tempo', false],
        'faktur_pajak' => ['No Faktur Pajak', false], 'terbayar' => ['Terbayar', false], 'tgl_bayar' => ['Tanggal Bayar', false],
    ],
    'sj' => [
        'no_sj' => ['No Surat Jalan', true], 'tgl_kirim' => ['Tanggal Kirim', true], 'customer' => ['Nama Customer', false],
        'wo' => ['No WO', true], 'status' => ['Status', false], 'nomor_invoice' => ['Nomor Invoice', false],
        'keterangan' => ['Keterangan', false],
    ],
];

if (!isset($COLUMNS[$type])) json_error('Tipe import tidak valid.', 422);

// ---------------------------------------------------------
// Validasi file upload
// ---------------------------------------------------------
$f = $_FILES['file'] ?? null;
if (!$f || !isset($f['error'])) json_error('File belum dipilih.', 422);
if ($f['error'] !== UPLOAD_ERR_OK) {
    $msg = [
        UPLOAD_ERR_INI_SIZE => 'File melebihi batas upload server (upload_max_filesize).',
        UPLOAD_ERR_FORM_SIZE => 'File terlalu besar.',
        UPLOAD_ERR_PARTIAL => 'Upload file terputus, coba lagi.',
        UPLOAD_ERR_NO_FILE => 'File belum dipilih.',
    ][$f['error']] ?? 'Upload file gagal (kode ' . $f['error'] . ').';
    json_error($msg, 422);
}
if ($f['size'] > 10 * 1024 * 1024) json_error('Ukuran file maksimal 10 MB.', 422);
if (strtolower(pathinfo($f['name'], PATHINFO_EXTENSION)) !== 'xlsx') {
    json_error('Format file harus .xlsx (Excel Workbook). File .xls / .csv tidak didukung - buka di Excel lalu Save As .xlsx.', 422);
}

try {
    $rows = xlsx_read_rows($f['tmp_name']);
} catch (XlsxReadException $e) {
    json_error($e->getMessage(), 422);
}
if (!$rows) json_error('File kosong - tidak ada data yang bisa diimport.', 422);

// ---------------------------------------------------------
// Helper parsing nilai
// ---------------------------------------------------------
class ImportRowError extends RuntimeException {}

function norm_header($s): string
{
    return preg_replace('/[^a-z0-9]/', '', strtolower((string) $s));
}

function norm_key($s): string
{
    return preg_replace('/\s+/', ' ', strtoupper(trim((string) $s)));
}

/** Teks bersih. Angka bulat dari Excel (mis. kode pos 15710.0) dijadikan "15710". */
function cell_str($v): string
{
    if (is_float($v)) {
        return floor($v) == $v && abs($v) < 1e15 ? number_format($v, 0, '.', '') : rtrim(rtrim(sprintf('%.6F', $v), '0'), '.');
    }
    return trim((string) $v);
}

/**
 * Angka dari sel. Sel numerik Excel langsung dipakai. Untuk sel teks,
 * dukung format Indonesia (8.500.000,50) maupun internasional (8,500,000.50).
 */
function cell_num($v, string $label, float $default = 0.0): float
{
    if (is_float($v) || is_int($v)) return (float) $v;
    $s = trim((string) $v);
    if ($s === '' || $s === '-') return $default;
    $s = preg_replace('/^rp\.?\s*/i', '', $s);
    $s = str_replace([' ', "\u{00A0}"], '', $s);
    $neg = false;
    if (preg_match('/^\((.*)\)$/', $s, $m)) { $s = $m[1]; $neg = true; }

    $lastDot = strrpos($s, '.');
    $lastComma = strrpos($s, ',');
    if ($lastDot !== false && $lastComma !== false) {
        // Pemisah yang muncul paling akhir = desimal.
        if ($lastComma > $lastDot) { $s = str_replace('.', '', $s); $s = str_replace(',', '.', $s); }
        else { $s = str_replace(',', '', $s); }
    } elseif ($lastComma !== false) {
        $s = preg_match('/^-?\d{1,3}(,\d{3})+$/', $s) ? str_replace(',', '', $s) : str_replace(',', '.', $s);
    } elseif ($lastDot !== false) {
        if (preg_match('/^-?\d{1,3}(\.\d{3}){2,}$/', $s)) $s = str_replace('.', '', $s); // 8.500.000
    }
    if (!is_numeric($s)) throw new ImportRowError("Kolom \"$label\" harus berupa angka (isi: \"$v\").");
    return $neg ? -(float) $s : (float) $s;
}

/**
 * Angka UANG (harga, diskon, budget). Sama seperti cell_num, tapi titik dengan
 * kelompok 3 digit SELALU dianggap pemisah ribuan format Indonesia:
 * "12.500" = 12500 (bukan 12,5). Untuk Qty / persen tetap pakai cell_num.
 */
function cell_money($v, string $label, float $default = 0.0): float
{
    if (is_string($v)) {
        $s = trim(preg_replace('/^rp\.?\s*/i', '', trim($v)));
        if (preg_match('/^-?\d{1,3}(\.\d{3})+$/', $s)) return (float) str_replace('.', '', $s);
    }
    return cell_num($v, $label, $default);
}

/** Tanggal: serial Excel, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. Return 'Y-m-d' atau null. */
function cell_date($v, string $label): ?string
{
    if ($v === '' || $v === null) return null;
    if (is_float($v) || is_int($v)) {
        if ($v < 1 || $v > 2958465) throw new ImportRowError("Kolom \"$label\" bukan tanggal yang valid.");
        return gmdate('Y-m-d', (int) round(($v - 25569) * 86400));
    }
    $s = trim((string) $v);
    if (preg_match('/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/', $s, $m)) { [$y, $mo, $d] = [(int) $m[1], (int) $m[2], (int) $m[3]]; }
    elseif (preg_match('/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/', $s, $m)) { [$d, $mo, $y] = [(int) $m[1], (int) $m[2], (int) $m[3]]; }
    else throw new ImportRowError("Kolom \"$label\" format tanggalnya tidak dikenali (\"$s\"). Gunakan YYYY-MM-DD.");
    if (!checkdate($mo, $d, $y)) throw new ImportRowError("Kolom \"$label\" berisi tanggal yang tidak ada (\"$s\").");
    return sprintf('%04d-%02d-%02d', $y, $mo, $d);
}

/** YA/TIDAK -> bool. Kosong -> $default. */
function cell_bool($v, string $label, bool $default): bool
{
    $s = norm_key(cell_str($v));
    if ($s === '') return $default;
    if (in_array($s, ['YA', 'Y', 'YES', 'TRUE', '1', 'IYA'], true)) return true;
    if (in_array($s, ['TIDAK', 'T', 'NO', 'N', 'FALSE', '0', 'TDK', 'GAK', 'ENGGAK'], true)) return false;
    throw new ImportRowError("Kolom \"$label\" harus diisi YA atau TIDAK (isi: \"$v\").");
}

/** Nilai pilihan (enum). Kosong -> $default. */
function cell_enum($v, string $label, array $allowed, string $default): string
{
    $s = norm_key(cell_str($v));
    if ($s === '') return $default;
    $s = str_replace('NONAKTIF', 'NON AKTIF', $s);
    if (!in_array($s, $allowed, true)) {
        throw new ImportRowError("Kolom \"$label\" tidak valid (\"$v\"). Pilihan: " . implode(' / ', $allowed) . '.');
    }
    return $s;
}

/** Map [UPPER(nama) => id] dari sebuah tabel master. */
function name_map(PDO $pdo, string $sql): array
{
    $map = [];
    foreach ($pdo->query($sql)->fetchAll() as $r) $map[norm_key($r['nama'])] = $r;
    return $map;
}

// ---------------------------------------------------------
// Petakan header -> index kolom
// ---------------------------------------------------------
$cols = $COLUMNS[$type];
$headerRowNum = array_key_first($rows);
$header = $rows[$headerRowNum];
unset($rows[$headerRowNum]);

$headerIdx = [];
foreach ($header as $i => $label) $headerIdx[norm_header($label)] = $i;

$colIdx = [];
$missing = [];
foreach ($cols as $key => [$label, $required]) {
    $n = norm_header($label);
    if (isset($headerIdx[$n])) $colIdx[$key] = $headerIdx[$n];
    elseif ($required) $missing[] = $label;
}
if ($missing) {
    json_error('Format file tidak sesuai template "' . $type . '". Kolom wajib tidak ditemukan di baris pertama: '
        . implode(', ', $missing) . '. Silakan download template terbaru lalu isi ulang.', 422);
}

// Ambil baris contoh bawaan template supaya tidak ikut terimport kalau lupa dihapus.
$exampleSig = null;
try {
    $tpls = require __DIR__ . '/../includes/import_templates.php';
    if (isset($tpls[$type])) {
        $tmp = tempnam(sys_get_temp_dir(), 'tpl');
        file_put_contents($tmp, base64_decode($tpls[$type]['data']));
        $tplRows = xlsx_read_rows($tmp);
        @unlink($tmp);
        $tplHeader = array_shift($tplRows);
        $ex = array_shift($tplRows);
        if ($tplHeader && $ex) {
            $sig = [];
            foreach ($tplHeader as $i => $lbl) $sig[norm_header($lbl)] = norm_key(cell_str($ex[$i] ?? ''));
            $exampleSig = $sig;
        }
    }
} catch (Throwable $e) {
    $exampleSig = null; // tidak kritis
}

function row_matches_example(array $row, array $headerIdx, ?array $sig): bool
{
    if (!$sig) return false;
    foreach ($sig as $h => $val) {
        $idx = $headerIdx[$h] ?? null;
        $cur = $idx === null ? '' : norm_key(cell_str($row[$idx] ?? ''));
        if ($cur !== $val) return false;
    }
    return true;
}

// ---------------------------------------------------------
// Data referensi (lookup nama -> id)
// ---------------------------------------------------------
$ref = [];
if (in_array($type, ['work_orders', 'pr_items'], true)) {
    $ref['customers'] = name_map($pdo, 'SELECT id, nama FROM customers');
}
if ($type === 'pr_items') {
    $ref['suppliers'] = name_map($pdo, 'SELECT id, nama FROM suppliers');
    $ref['buyers']    = name_map($pdo, 'SELECT id, nama FROM master_buyers');
    $ref['karyawan']  = name_map($pdo, 'SELECT id, nama, divisi FROM master_karyawan');
    $ref['users']     = name_map($pdo, 'SELECT id, full_name AS nama, divisi FROM users');
    $ref['wo'] = [];
    foreach ($pdo->query('SELECT id, wo_number, customer_id, project FROM work_orders')->fetchAll() as $w) {
        $ref['wo'][norm_key($w['wo_number'])] = $w;
    }
}

if ($type === 'mtc') {
    $ref['wo'] = [];
    foreach ($pdo->query('SELECT id, wo_number FROM work_orders')->fetchAll() as $w) {
        $ref['wo'][norm_key($w['wo_number'])] = (int) $w['id'];
    }
    $ref['items'] = []; // wo_id => [NAMA ITEM => nama asli]
    foreach ($pdo->query('SELECT wo_id, nama_item FROM work_order_budget_items')->fetchAll() as $it) {
        $ref['items'][(int) $it['wo_id']][norm_key($it['nama_item'])] = $it['nama_item'];
    }
    $ref['divisi'] = [];
    foreach (MTC_DIVISI_LIST as $d) $ref['divisi'][norm_key($d)] = $d;
    $ref['mesin'] = [];
    $ref['mp'] = [];
    try {
        foreach ($pdo->query("SELECT kode, harga FROM mtc_master_mesin")->fetchAll() as $m) $ref['mesin'][norm_key($m['kode'])] = $m;
        foreach ($pdo->query("SELECT divisi, harga FROM mtc_master_mp WHERE status = 'AKTIF' ORDER BY id")->fetchAll() as $m) {
            $ref['mp'][norm_key($m['divisi'])] = $ref['mp'][norm_key($m['divisi'])] ?? (float) $m['harga'];
        }
    } catch (PDOException $e) {
        // master MTC belum ada: harga wajib diisi manual di file
    }
}
if (in_array($type, ['ar', 'sj'], true)) {
    $ref['customers'] = name_map($pdo, 'SELECT id, nama FROM customers');
    $ref['wo'] = [];
    foreach ($pdo->query('SELECT id, wo_number, customer_id FROM work_orders')->fetchAll() as $w) {
        $ref['wo'][norm_key($w['wo_number'])] = $w;
    }
}
if ($type === 'ap') {
    $ref['suppliers'] = name_map($pdo, 'SELECT id, nama FROM suppliers');
}
if ($type === 'sj' && !db_table_exists($pdo, 'surat_jalan_wo')) {
    json_error('Tabel Surat Jalan belum ada. Import database/migration_surat_jalan.sql lewat phpMyAdmin dulu.', 422);
}

/**
 * Kolom "No WO" (boleh beberapa, pisahkan koma / titik koma / baris baru) -> daftar baris WO.
 * No WO yang tidak ada = error supaya tidak ada salah ketik.
 */
function import_wo_list($raw, array $woRef): array
{
    $tokens = array_values(array_unique(array_filter(array_map('trim', preg_split('/[,;\n]+/', cell_str($raw))))));
    $found = []; $missing = [];
    foreach ($tokens as $t) {
        $w = $woRef[norm_key($t)] ?? null;
        if ($w) $found[(int) $w['id']] = $w; else $missing[] = $t;
    }
    if ($missing) throw new ImportRowError('No WO tidak ditemukan: ' . implode(', ', $missing) . '.');
    return array_values($found);
}

$touchedWo = []; // WO yang record MTC-nya berubah -> Aktual Item Pekerjaan disinkronkan di akhir

// ---------------------------------------------------------
// Handler per tipe. Return 'ok' | 'skip'. Lempar ImportRowError kalau baris salah.
// ---------------------------------------------------------
$lastAutoPr = null; // [sheet, pr_number] untuk mengelompokkan item PR yang No PR-nya dikosongkan

$handlers = [];

$handlers['customers'] = $handlers['suppliers'] = function (array $r) use ($pdo, $type): string {
    $table = $type; // customers | suppliers
    $nama = cell_str($r['nama']);
    if ($nama === '') throw new ImportRowError('Nama wajib diisi.');

    $chk = $pdo->prepare("SELECT id FROM $table WHERE UPPER(TRIM(nama)) = :n LIMIT 1");
    $chk->execute([':n' => norm_key($nama)]);
    if ($chk->fetch()) return 'skip';

    $pdo->prepare(
        "INSERT INTO $table (nama, alamat, kelurahan, kecamatan, kota, provinsi, kodepos, negara, pic, cp, telepon, npwp, status)
         VALUES (:nama, :alamat, :kel, :kec, :kota, :prov, :kodepos, :negara, :pic, :cp, :telepon, :npwp, :status)"
    )->execute([
        ':nama' => $nama, ':alamat' => cell_str($r['alamat']), ':kel' => cell_str($r['kelurahan']),
        ':kec' => cell_str($r['kecamatan']), ':kota' => cell_str($r['kota']), ':prov' => cell_str($r['provinsi']),
        ':kodepos' => cell_str($r['kodepos']), ':negara' => cell_str($r['negara']) ?: 'Indonesia',
        ':pic' => cell_str($r['pic']), ':cp' => cell_str($r['cp']), ':telepon' => cell_str($r['telepon']),
        ':npwp' => cell_str($r['npwp']), ':status' => cell_enum($r['status'], 'Status', ['AKTIF', 'NON AKTIF'], 'AKTIF'),
    ]);
    log_activity('import', $table, (int) $pdo->lastInsertId(), $nama);
    return 'ok';
};

$simpleMaster = function (string $table, string $label) use ($pdo) {
    return function (array $r) use ($pdo, $table, $label): string {
        $nama = norm_key(cell_str($r['nama']));
        if ($nama === '') throw new ImportRowError("Nama $label wajib diisi.");
        $chk = $pdo->prepare("SELECT id FROM $table WHERE UPPER(TRIM(nama)) = :n LIMIT 1");
        $chk->execute([':n' => $nama]);
        if ($chk->fetch()) return 'skip';
        $pdo->prepare("INSERT INTO $table (nama) VALUES (:n)")->execute([':n' => $nama]);
        log_activity('import', $table, (int) $pdo->lastInsertId(), $nama);
        return 'ok';
    };
};
$handlers['buyers'] = $simpleMaster('master_buyers', 'Buyer');
$handlers['products'] = $simpleMaster('master_products', 'Product');

$handlers['karyawan'] = function (array $r) use ($pdo): string {
    $nama = norm_key(cell_str($r['nama']));
    if ($nama === '') throw new ImportRowError('Nama karyawan wajib diisi.');
    $chk = $pdo->prepare('SELECT id FROM master_karyawan WHERE UPPER(TRIM(nama)) = :n LIMIT 1');
    $chk->execute([':n' => $nama]);
    if ($chk->fetch()) return 'skip';
    $pdo->prepare('INSERT INTO master_karyawan (nama, divisi, jabatan, status) VALUES (:n, :d, :j, :s)')->execute([
        ':n' => $nama,
        ':d' => norm_key(cell_str($r['divisi'])) ?: 'GENERAL',
        ':j' => cell_str($r['jabatan']),
        ':s' => cell_enum($r['status'], 'Status', ['AKTIF', 'NON AKTIF'], 'AKTIF'),
    ]);
    log_activity('import', 'master_karyawan', (int) $pdo->lastInsertId(), $nama);
    return 'ok';
};

$handlers['work_orders'] = function (array $r) use ($pdo, &$ref): string {
    $category = cell_enum($r['wo_category'], 'Kategori WO', ['PROJECT', 'MAINTENANCE', 'INVENTARIS'], 'PROJECT');
    $project = cell_str($r['project']);
    if ($project === '') throw new ImportRowError('Nama Project wajib diisi.');

    $custName = cell_str($r['customer']);
    if ($custName === '') throw new ImportRowError('Nama Customer wajib diisi.');
    $cust = $ref['customers'][norm_key($custName)] ?? null;
    if (!$cust) throw new ImportRowError("Customer \"$custName\" belum ada di Master Customer. Import / tambahkan customer-nya dulu.");

    $woNumber = cell_str($r['wo_number']);
    if ($woNumber !== '') {
        $chk = $pdo->prepare('SELECT id FROM work_orders WHERE wo_number = :w LIMIT 1');
        $chk->execute([':w' => $woNumber]);
        if ($chk->fetch()) return 'skip';
    } else {
        $woNumber = generate_wo_number($pdo, $category);
    }

    $qty = cell_num($r['qty'], 'Qty', 1);
    $harga = cell_money($r['harga_satuan'], 'Harga Satuan');
    $diskon = cell_money($r['diskon'], 'Diskon');
    $isPpn = cell_bool($r['is_ppn'], 'PPN', true);
    $isPph23 = cell_bool($r['is_pph23'], 'PPh23', true);
    $pphLainPct = cell_num($r['pph_lain_pct'], 'PPh Lain %');
    [$dpp, $ppn, $pph23, $pphLain, $woTotal] = calc_wo_finance($qty, $harga, $diskon, $isPpn, $isPph23, $pphLainPct);

    $pdo->prepare(
        'INSERT INTO work_orders
         (wo_number, wo_category, project, customer_id, est_kirim, nilai_po, budget_prod, aktual_prod, budget_pem,
          budget_lain, total_lain, status, po_no, qty, satuan, harga_satuan, diskon, is_ppn, ppn, is_pph23, pph23,
          pph_lain_pct, pph_lain, wo_total)
         VALUES (:wo, :cat, :proj, :cust, :est, :nilai, :bprod, :aprod, :bpem, :blain, :lain, :status, :pono, :qty,
          :satuan, :harga, :diskon, :isppn, :ppn, :ispph23, :pph23, :pphlainpct, :pphlain, :wototal)'
    )->execute([
        ':wo' => $woNumber, ':cat' => $category, ':proj' => $project, ':cust' => $cust['id'],
        ':est' => cell_date($r['est_kirim'], 'Estimasi Kirim'), ':nilai' => $dpp,
        ':bprod' => cell_money($r['budget_prod'], 'Budget Produksi'), ':aprod' => cell_money($r['aktual_prod'], 'Aktual Produksi'),
        ':bpem' => cell_money($r['budget_pem'], 'Budget Pembelian'), ':blain' => cell_money($r['budget_lain'], 'Budget Lain-lain'),
        ':lain' => cell_money($r['total_lain'], 'Aktual Lain-lain'),
        ':status' => cell_enum($r['status'], 'Status', ['ON PROGRESS', 'HOLD', 'CANCEL', 'DELIVERY', 'FINISHED'], 'ON PROGRESS'),
        ':pono' => cell_str($r['po_no']), ':qty' => $qty, ':satuan' => cell_str($r['satuan']) ?: 'Unit',
        ':harga' => $harga, ':diskon' => $diskon, ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn,
        ':ispph23' => $isPph23 ? 1 : 0, ':pph23' => $pph23, ':pphlainpct' => $pphLainPct, ':pphlain' => $pphLain,
        ':wototal' => $woTotal,
    ]);
    $newId = (int) $pdo->lastInsertId();
    log_activity('import', 'work_orders', $newId, $woNumber);

    // Supaya baris PR di import berikutnya (file yang sama tidak, tapi berguna kalau handler dipakai ulang) kenal WO ini.
    if (isset($ref['wo'])) $ref['wo'][norm_key($woNumber)] = ['id' => $newId, 'wo_number' => $woNumber, 'customer_id' => $cust['id'], 'project' => $project];
    return 'ok';
};

$handlers['pr_items'] = function (array $r) use ($pdo, &$ref, &$lastAutoPr): string {
    $sheet = cell_enum($r['sheet'], 'Kategori', PR_SHEET_VALUES, 'PROJECT');
    $tanggal = cell_date($r['tanggal'], 'Tanggal');
    if (!$tanggal) throw new ImportRowError('Tanggal wajib diisi (format YYYY-MM-DD).');

    $product = cell_str($r['product']);
    if ($product === '') throw new ImportRowError('Nama Barang wajib diisi.');
    $qty = cell_num($r['qty'], 'Qty');
    if ($qty <= 0) throw new ImportRowError('Qty harus lebih dari 0.');
    $itemNo = (int) cell_num($r['item_no'], 'No Item', 1);
    if ($itemNo < 1) $itemNo = 1;

    // WO -> otomatis isi customer & project kalau kolomnya kosong.
    $woId = null; $wo = null;
    $woNum = cell_str($r['wo']);
    if ($woNum !== '') {
        $wo = $ref['wo'][norm_key($woNum)] ?? null;
        if (!$wo) throw new ImportRowError("No WO \"$woNum\" tidak ditemukan. Buat / import WO-nya dulu.");
        $woId = (int) $wo['id'];
    }

    $customerId = $wo['customer_id'] ?? null;
    $custName = cell_str($r['customer']);
    if ($custName !== '') {
        $c = $ref['customers'][norm_key($custName)] ?? null;
        if (!$c) throw new ImportRowError("Customer \"$custName\" belum ada di Master Customer.");
        $customerId = $c['id'];
    }
    $project = cell_str($r['project']) ?: ($wo['project'] ?? '');

    $supplierId = null;
    $supName = cell_str($r['supplier']);
    if ($supName !== '') {
        $s = $ref['suppliers'][norm_key($supName)] ?? null;
        if (!$s) throw new ImportRowError("Supplier \"$supName\" belum ada di Master Supplier.");
        $supplierId = $s['id'];
    }

    $buyerId = null;
    $buyerName = cell_str($r['buyer']);
    if ($buyerName !== '') {
        $b = $ref['buyers'][norm_key($buyerName)] ?? null;
        if (!$b) throw new ImportRowError("Buyer \"$buyerName\" belum ada di Master Buyer.");
        $buyerId = $b['id'];
    }

    // User Peminta: cari di Master Karyawan dulu, lalu di akun User login.
    $karyawanId = null; $userId = null; $divisiDefault = '';
    $userName = cell_str($r['user']);
    if ($userName !== '') {
        if ($k = $ref['karyawan'][norm_key($userName)] ?? null) { $karyawanId = $k['id']; $divisiDefault = $k['divisi'] ?? ''; }
        elseif ($u = $ref['users'][norm_key($userName)] ?? null) { $userId = $u['id']; $divisiDefault = $u['divisi'] ?? ''; }
        else throw new ImportRowError("User Peminta \"$userName\" tidak ditemukan di Master Karyawan maupun daftar User.");
    }

    // No PR kosong -> auto-generate. Item berikutnya (No Item > 1, kategori sama)
    // yang No PR-nya juga kosong digabung ke PR auto yang sama.
    $prNumber = cell_str($r['pr_number']);
    if ($prNumber === '') {
        if ($itemNo > 1 && $lastAutoPr && $lastAutoPr[0] === $sheet) {
            $prNumber = $lastAutoPr[1];
        } else {
            $prNumber = generate_pr_number($pdo, $sheet);
        }
        $lastAutoPr = [$sheet, $prNumber];
    } else {
        $lastAutoPr = null;
        $chk = $pdo->prepare('SELECT id FROM pr_items WHERE pr_number = :p AND item_no = :i LIMIT 1');
        $chk->execute([':p' => $prNumber, ':i' => $itemNo]);
        if ($chk->fetch()) return 'skip';
    }

    $harga = cell_money($r['harga'], 'Harga Satuan');
    $isPpn = cell_bool($r['is_ppn'], 'Kena PPN', false);
    $ppnRate = cell_num($r['ppn_rate'], 'Tarif PPN %', 11);
    [$dpp, $ppnAmount, $total] = calc_ppn($qty, $harga, $isPpn, $ppnRate);

    try {
        $pdo->prepare(
            'INSERT INTO pr_items
             (sheet, tanggal, pr_number, item_no, customer_id, project, wo_id, product, type, dimensi, brand,
              qty, uom, harga, is_ppn, ppn_rate, ppn_amount, dpp, total, supplier_id, tgl_beli, tgl_datang, penerima_barang,
              po_number, invoice_number, buyer_id, user_id, karyawan_id, divisi, status, lampiran, keterangan, approval_status)
             VALUES
             (:sheet, :tanggal, :pr, :item, :cust, :project, :wo, :product, :type, :dimensi, :brand,
              :qty, :uom, :harga, :isppn, :rate, :ppn, :dpp, :total, :sup, :beli, :datang, :penerima,
              :po, :inv, :buyer, :user, :karyawan, :divisi, :status, \'\', :ket, \'PENDING_LEADER\')'
        )->execute([
            ':sheet' => $sheet, ':tanggal' => $tanggal, ':pr' => $prNumber, ':item' => $itemNo, ':cust' => $customerId,
            ':project' => $project, ':wo' => $woId, ':product' => $product, ':type' => cell_str($r['type']),
            ':dimensi' => cell_str($r['dimensi']), ':brand' => cell_str($r['brand']), ':qty' => $qty,
            ':uom' => cell_str($r['uom']), ':harga' => $harga, ':isppn' => $isPpn ? 1 : 0, ':rate' => $ppnRate,
            ':ppn' => $ppnAmount, ':dpp' => $dpp, ':total' => $total, ':sup' => $supplierId,
            ':beli' => cell_date($r['tgl_beli'], 'Tanggal Beli'), ':datang' => cell_date($r['tgl_datang'], 'Tanggal Datang'),
            ':penerima' => cell_str($r['penerima_barang']), ':po' => cell_str($r['po_number']),
            ':inv' => cell_str($r['invoice_number']), ':buyer' => $buyerId, ':user' => $userId, ':karyawan' => $karyawanId,
            ':divisi' => norm_key(cell_str($r['divisi'])) ?: $divisiDefault,
            ':status' => cell_enum($r['status'], 'Status', ['RECEIVED', 'PO ISSUED', 'ON PROSES', 'STORE ROOM', 'CANCEL'], 'ON PROSES'),
            ':ket' => cell_str($r['keterangan']),
        ]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') return 'skip'; // No PR + No Item sudah ada
        throw $e;
    }
    log_activity('import', 'pr_items', (int) $pdo->lastInsertId(), "$prNumber #$itemNo");
    return 'ok';
};

// Import pekerjaan MTC: 1 baris = 1 baris pekerjaan. Item Pekerjaan yang belum ada di WO
// dibuat otomatis (Item Pekerjaan diisi dari MTC, lalu muncul di Edit WO). Baris dengan No WO + Item Pekerjaan +
// Divisi + No Surat Jalan yang sama masuk ke 1 record divisi (record lama dipakai ulang kalau
// sudah ada). Pekerjaan yang sama persis (pekerjaan + qty + harga) di record itu dilewati,
// jadi file yang sama aman di-upload ulang.
$handlers['mtc'] = function (array $r) use ($pdo, &$ref, &$touchedWo): string {
    $woNo = cell_str($r['wo']);
    if ($woNo === '') throw new ImportRowError('No WO wajib diisi.');
    $woId = $ref['wo'][norm_key($woNo)] ?? null;
    if (!$woId) throw new ImportRowError("No WO \"$woNo\" tidak ditemukan di menu WO & Budget.");

    $itemInput = cell_str($r['nama_item']);
    if ($itemInput === '') throw new ImportRowError('Item Pekerjaan wajib diisi.');
    // Item Pekerjaan diisi dari MTC: kalau belum ada di WO, otomatis dibuat.
    $namaItem = $ref['items'][$woId][norm_key($itemInput)] ?? null;
    $itemBaru = $namaItem === null;

    $divInput = cell_str($r['divisi']);
    $divisi = $ref['divisi'][norm_key($divInput)] ?? null;
    if ($divisi === null) throw new ImportRowError("Divisi \"$divInput\" tidak valid. Pilihan: " . implode(', ', MTC_DIVISI_LIST) . '.');

    $pekerjaan = cell_str($r['pekerjaan']);
    if ($pekerjaan === '') throw new ImportRowError('Pekerjaan wajib diisi.');
    if (cell_str($r['qty']) === '') throw new ImportRowError('Qty wajib diisi.');
    $qty = cell_num($r['qty'], 'Qty');
    if ($qty < 0) throw new ImportRowError('Qty tidak boleh negatif.');

    $kodeMesin = cell_str($r['kode_mesin']);
    $mesin = $kodeMesin !== '' ? ($ref['mesin'][norm_key($kodeMesin)] ?? null) : null;
    if ($kodeMesin !== '' && !$mesin) throw new ImportRowError("Kode Mesin \"$kodeMesin\" tidak ada di MTC > Master Data Mesin.");
    if (cell_str($r['harga']) !== '') {
        $harga = cell_money($r['harga'], 'Harga Satuan');
    } elseif ($mesin) {
        $harga = (float) $mesin['harga'];
    } else {
        $harga = (float) ($ref['mp'][norm_key($divisi)] ?? 0);
    }
    if ($harga < 0) throw new ImportRowError('Harga Satuan tidak boleh negatif.');

    $workflow = cell_enum($r['status_workflow'], 'Status Workflow', ['NORMAL', 'REWORK', 'CLAIM', 'REJECT'], 'NORMAL');
    $status = cell_enum($r['status'], 'Status', ['ON PROCESS', 'FINISH'], 'ON PROCESS');
    $sj = cell_str($r['surat_jalan']);

    if ($itemBaru) {
        $namaItem = ensure_wo_item($pdo, $woId, $itemInput);
        $ref['items'][$woId][norm_key($namaItem)] = $namaItem;
    }

    // Cari / buat record divisi.
    $find = $pdo->prepare(
        "SELECT id FROM mtc_divisi_records
         WHERE wo_id = :wo AND nama_item = :item AND divisi = :div AND COALESCE(surat_jalan, '') = :sj
         ORDER BY id LIMIT 1"
    );
    $find->execute([':wo' => $woId, ':item' => $namaItem, ':div' => $divisi, ':sj' => $sj]);
    $recordId = (int) $find->fetchColumn();
    if (!$recordId) {
        $pdo->prepare(
            'INSERT INTO mtc_divisi_records (wo_id, nama_item, divisi, status_workflow, pic, surat_jalan)
             VALUES (:wo, :item, :div, :wf, :pic, :sj)'
        )->execute([':wo' => $woId, ':item' => $namaItem, ':div' => $divisi, ':wf' => $workflow, ':pic' => cell_str($r['pic']), ':sj' => $sj]);
        $recordId = (int) $pdo->lastInsertId();
    } else {
        $dup = $pdo->prepare(
            'SELECT COUNT(*) FROM mtc_divisi_items WHERE record_id = :rid AND pekerjaan = :pek AND ABS(qty - :qty) < 0.0005 AND ABS(harga - :harga) < 0.005'
        );
        $dup->execute([':rid' => $recordId, ':pek' => $pekerjaan, ':qty' => $qty, ':harga' => $harga]);
        if ((int) $dup->fetchColumn() > 0) return 'skip';
    }

    $pdo->prepare(
        'INSERT INTO mtc_divisi_items (record_id, pekerjaan, deskripsi, qty, satuan, kode_mesin, harga, total, status)
         VALUES (:rid, :pek, :desk, :qty, :satuan, :mesin, :harga, :total, :status)'
    )->execute([
        ':rid' => $recordId, ':pek' => $pekerjaan, ':desk' => cell_str($r['deskripsi']), ':qty' => $qty,
        ':satuan' => cell_str($r['satuan']) ?: 'Jam', ':mesin' => $mesin ? $mesin['kode'] : null,
        ':harga' => $harga, ':total' => round($qty * $harga, 2), ':status' => $status,
    ]);
    $touchedWo[$woId] = true;
    log_activity('import', 'mtc_divisi_items', (int) $pdo->lastInsertId(), "$woNo / $namaItem / $divisi / $pekerjaan");
    return 'ok';
};

// ---------------------------------------------------------
// AR (Piutang) - 1 baris = 1 invoice. No Invoice yang sudah ada DILEWATI.
// ---------------------------------------------------------
$handlers['ar'] = function (array $r) use ($pdo, &$ref): string {
    $inv = strtoupper(cell_str($r['invoice_no']));
    if ($inv === '') throw new ImportRowError('No Invoice wajib diisi.');
    $chk = $pdo->prepare('SELECT COUNT(*) FROM account_receivable WHERE invoice_no = :inv');
    $chk->execute([':inv' => $inv]);
    if ((int) $chk->fetchColumn() > 0) return 'skip';

    $tglInv = cell_date($r['tgl_invoice'], 'Tanggal Invoice');
    if (!$tglInv) throw new ImportRowError('Tanggal Invoice wajib diisi.');
    $custName = cell_str($r['customer']);
    $cust = $ref['customers'][norm_key($custName)] ?? null;
    if (!$cust) throw new ImportRowError("Customer \"$custName\" tidak ada di Master Customer.");
    $wos = import_wo_list($r['wo'], $ref['wo']);
    if (count($wos) > 1 && !ar_wo_link_ready($pdo)) {
        throw new ImportRowError('Untuk 1 invoice dengan beberapa WO, jalankan dulu database/migration_ar_multi_wo.sql.');
    }
    if (cell_str($r['penjualan']) === '') throw new ImportRowError('Penjualan (DPP) wajib diisi.');
    $penjualan = cell_money($r['penjualan'], 'Penjualan DPP');
    $pph23 = cell_money($r['pph23'], 'PPh23 Rp');
    $biayaLain = cell_money($r['biaya_lain'], 'Biaya Lain');
    $terbayar = cell_money($r['terbayar'], 'Terbayar');
    foreach (['Penjualan' => $penjualan, 'PPh23' => $pph23, 'Biaya Lain' => $biayaLain, 'Terbayar' => $terbayar] as $lbl => $v) {
        if ($v < 0) throw new ImportRowError("$lbl tidak boleh negatif.");
    }
    $isPpn = cell_bool($r['is_ppn'], 'PPN 11%', true);
    $isPpn030 = cell_bool($r['is_ppn030'], 'PPN 030', false);
    $top = (int) cell_num($r['top_days'], 'TOP Hari', 30);
    $tglKirim = cell_date($r['tgl_kirim'], 'Tanggal Kirim Invoice') ?: $tglInv;
    $due = resolve_due_date(cell_date($r['due_date'], 'Jatuh Tempo'), $tglKirim, $top);
    [$ppn, $ppn030] = calc_ar($penjualan, $isPpn, $isPpn030, $pph23, $biayaLain, $terbayar);

    $pdo->prepare(
        'INSERT INTO account_receivable
         (invoice_no, tgl_invoice, tgl_kirim, customer_id, wo_id, po_no, deskripsi, penjualan,
          is_ppn, ppn, is_ppn030, ppn030, pph23, biaya_lain, top_days, due_date, faktur_pajak, terbayar, tgl_bayar)
         VALUES (:inv, :tgl, :tglkirim, :cust, :wo, :po, :desk, :penjualan,
          :isppn, :ppn, :isppn030, :ppn030, :pph23, :biayalain, :top, :due, :faktur, :terbayar, :tglbayar)'
    )->execute([
        ':inv' => $inv, ':tgl' => $tglInv, ':tglkirim' => $tglKirim, ':cust' => $cust['id'],
        ':wo' => $wos[0]['id'] ?? null, ':po' => cell_str($r['po_no']), ':desk' => cell_str($r['deskripsi']),
        ':penjualan' => $penjualan, ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn, ':isppn030' => $isPpn030 ? 1 : 0,
        ':ppn030' => $ppn030, ':pph23' => $pph23, ':biayalain' => $biayaLain, ':top' => $top, ':due' => $due,
        ':faktur' => cell_str($r['faktur_pajak']), ':terbayar' => $terbayar,
        ':tglbayar' => cell_date($r['tgl_bayar'], 'Tanggal Bayar'),
    ]);
    $arId = (int) $pdo->lastInsertId();
    if (ar_wo_link_ready($pdo)) {
        $ins = $pdo->prepare('INSERT INTO account_receivable_wo (ar_id, wo_id) VALUES (:ar, :wo)');
        foreach ($wos as $w) $ins->execute([':ar' => $arId, ':wo' => $w['id']]);
    }
    log_activity('import', 'account_receivable', $arId, $inv);
    return 'ok';
};

// ---------------------------------------------------------
// AP (Hutang) - 1 baris = 1 invoice supplier. No Invoice yang sudah ada DILEWATI.
// ---------------------------------------------------------
$handlers['ap'] = function (array $r) use ($pdo, &$ref): string {
    $inv = strtoupper(cell_str($r['invoice_no']));
    if ($inv === '') throw new ImportRowError('No Invoice wajib diisi.');
    $chk = $pdo->prepare('SELECT COUNT(*) FROM account_payable WHERE invoice_no = :inv');
    $chk->execute([':inv' => $inv]);
    if ((int) $chk->fetchColumn() > 0) return 'skip';

    $tglInv = cell_date($r['tgl_invoice'], 'Tanggal Invoice');
    if (!$tglInv) throw new ImportRowError('Tanggal Invoice wajib diisi.');
    $suppName = cell_str($r['supplier']);
    $supp = $ref['suppliers'][norm_key($suppName)] ?? null;
    if (!$supp) throw new ImportRowError("Supplier \"$suppName\" tidak ada di Master Supplier.");
    if (cell_str($r['pembelian']) === '') throw new ImportRowError('Pembelian (DPP) wajib diisi.');
    $pembelian = cell_money($r['pembelian'], 'Pembelian DPP');
    $biayaLain = cell_money($r['biaya_lain'], 'Biaya Lain');
    $terbayar = cell_money($r['terbayar'], 'Terbayar');
    foreach (['Pembelian' => $pembelian, 'Biaya Lain' => $biayaLain, 'Terbayar' => $terbayar] as $lbl => $v) {
        if ($v < 0) throw new ImportRowError("$lbl tidak boleh negatif.");
    }
    $isPpn = cell_bool($r['is_ppn'], 'PPN 11%', true);
    $isPph23 = cell_bool($r['is_pph23'], 'PPh23 2%', true);
    $top = (int) cell_num($r['top_days'], 'TOP Hari', 30);
    $tglTerima = cell_date($r['tgl_terima'], 'Tanggal Terima Invoice') ?: $tglInv;
    $due = resolve_due_date(cell_date($r['due_date'], 'Jatuh Tempo'), $tglTerima, $top);
    [$ppn, $pph23] = calc_ap($pembelian, $isPpn, $isPph23, $biayaLain, $terbayar);

    $pdo->prepare(
        'INSERT INTO account_payable
         (invoice_no, tgl_invoice, tgl_terima, supplier_id, po_no, deskripsi, pembelian,
          is_ppn, ppn, is_pph23, pph23, biaya_lain, top_days, due_date, faktur_pajak, terbayar, tgl_bayar)
         VALUES (:inv, :tgl, :tglterima, :supp, :po, :desk, :pembelian,
          :isppn, :ppn, :ispph23, :pph23, :biayalain, :top, :due, :faktur, :terbayar, :tglbayar)'
    )->execute([
        ':inv' => $inv, ':tgl' => $tglInv, ':tglterima' => $tglTerima, ':supp' => $supp['id'],
        ':po' => cell_str($r['po_no']), ':desk' => cell_str($r['deskripsi']), ':pembelian' => $pembelian,
        ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn, ':ispph23' => $isPph23 ? 1 : 0, ':pph23' => $pph23,
        ':biayalain' => $biayaLain, ':top' => $top, ':due' => $due, ':faktur' => cell_str($r['faktur_pajak']),
        ':terbayar' => $terbayar, ':tglbayar' => cell_date($r['tgl_bayar'], 'Tanggal Bayar'),
    ]);
    log_activity('import', 'account_payable', (int) $pdo->lastInsertId(), $inv);
    return 'ok';
};

// ---------------------------------------------------------
// Surat Jalan - 1 baris = 1 SJ (No WO boleh beberapa). No SJ yang sudah ada DILEWATI.
// ---------------------------------------------------------
$handlers['sj'] = function (array $r) use ($pdo, &$ref): string {
    $noSJ = strtoupper(cell_str($r['no_sj']));
    if ($noSJ === '') throw new ImportRowError('No Surat Jalan wajib diisi.');
    $chk = $pdo->prepare('SELECT COUNT(*) FROM surat_jalan WHERE no_sj = :no');
    $chk->execute([':no' => $noSJ]);
    if ((int) $chk->fetchColumn() > 0) return 'skip';

    $tgl = cell_date($r['tgl_kirim'], 'Tanggal Kirim');
    if (!$tgl) throw new ImportRowError('Tanggal Kirim wajib diisi.');
    $wos = import_wo_list($r['wo'], $ref['wo']);
    if (!$wos) throw new ImportRowError('No WO wajib diisi (minimal 1).');
    $custName = cell_str($r['customer']);
    if ($custName !== '') {
        $cust = $ref['customers'][norm_key($custName)] ?? null;
        if (!$cust) throw new ImportRowError("Customer \"$custName\" tidak ada di Master Customer.");
        $custId = (int) $cust['id'];
    } else {
        $custId = $wos[0]['customer_id'] ? (int) $wos[0]['customer_id'] : null; // ikut customer WO pertama
    }
    $status = cell_enum($r['status'], 'Status', array_keys(SJ_STATUSES), 'DELIVERY');

    $pdo->prepare(
        'INSERT INTO surat_jalan (no_sj, tgl_kirim, customer_id, nomor_invoice, status, keterangan, created_by)
         VALUES (:no, :tgl, :cust, :inv, :status, :ket, :by)'
    )->execute([
        ':no' => $noSJ, ':tgl' => $tgl, ':cust' => $custId, ':inv' => cell_str($r['nomor_invoice']),
        ':status' => $status, ':ket' => cell_str($r['keterangan']), ':by' => current_user()['id'] ?? null,
    ]);
    $sjId = (int) $pdo->lastInsertId();
    $ins = $pdo->prepare('INSERT INTO surat_jalan_wo (sj_id, wo_id) VALUES (:sj, :wo)');
    foreach ($wos as $w) $ins->execute([':sj' => $sjId, ':wo' => $w['id']]);
    log_activity('import', 'surat_jalan', $sjId, $noSJ);
    return 'ok';
};

// ---------------------------------------------------------
// Proses semua baris
// ---------------------------------------------------------
$berhasil = 0; $dilewati = 0; $gagal = 0; $errors = [];
$handler = $handlers[$type];

foreach ($rows as $rowNum => $cells) {
    $first = cell_str(reset($cells));
    if (count(array_filter($cells, fn($v) => $v !== '' && $v !== null)) === 1 && stripos($first, 'catatan') === 0) {
        continue; // baris "Catatan: ..." dari template
    }
    if (row_matches_example($cells, $headerIdx, $exampleSig)) {
        $dilewati++;
        $errors[] = ['baris' => $rowNum, 'pesan' => 'Dilewati karena sama persis dengan baris CONTOH bawaan template. Kalau ini memang data asli, tambahkan lewat form input.'];
        continue;
    }

    $r = [];
    foreach ($cols as $key => $_) $r[$key] = isset($colIdx[$key]) ? ($cells[$colIdx[$key]] ?? '') : '';

    try {
        $pdo->beginTransaction();
        $res = $handler($r);
        $pdo->commit();
        if ($res === 'ok') $berhasil++; else $dilewati++;
    } catch (ImportRowError $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $gagal++;
        $errors[] = ['baris' => $rowNum, 'pesan' => $e->getMessage()];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $gagal++;
        error_log('[import] baris ' . $rowNum . ': ' . $e->getMessage());
        $errors[] = ['baris' => $rowNum, 'pesan' => 'Kesalahan database: ' . ($e instanceof PDOException ? 'data tidak valid / duplikat.' : $e->getMessage())];
    }
}

// Aktual Item Pekerjaan & Aktual Produksi WO mengikuti total MTC terbaru.
foreach (array_keys($touchedWo) as $woId) {
    sync_wo_actual_from_mtc($pdo, (int) $woId);
}

if ($berhasil + $dilewati + $gagal === 0) {
    json_error('Tidak ada baris data yang diimport (file hanya berisi header / baris contoh template).', 422);
}

log_activity('import_summary', $type, null, "berhasil=$berhasil dilewati=$dilewati gagal=$gagal");
json_success(
    ['berhasil' => $berhasil, 'dilewati' => $dilewati, 'gagal' => $gagal, 'errors' => array_slice($errors, 0, 200)],
    "Import selesai: $berhasil berhasil, $dilewati dilewati, $gagal gagal."
);
