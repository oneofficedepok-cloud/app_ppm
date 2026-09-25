<?php
/**
 * Import data dari file Excel (.xlsx) sesuai template di download_template.php.
 *
 * POST multipart/form-data:
 *   type = karyawan | customers | suppliers | buyers | products | work_orders | pr_items
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

require_admin();

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
    $harga = cell_num($r['harga_satuan'], 'Harga Satuan');
    $diskon = cell_num($r['diskon'], 'Diskon');
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
        ':bprod' => cell_num($r['budget_prod'], 'Budget Produksi'), ':aprod' => cell_num($r['aktual_prod'], 'Aktual Produksi'),
        ':bpem' => cell_num($r['budget_pem'], 'Budget Pembelian'), ':blain' => cell_num($r['budget_lain'], 'Budget Lain-lain'),
        ':lain' => cell_num($r['total_lain'], 'Aktual Lain-lain'),
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

    $harga = cell_num($r['harga'], 'Harga Satuan');
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

if ($berhasil + $dilewati + $gagal === 0) {
    json_error('Tidak ada baris data yang diimport (file hanya berisi header / baris contoh template).', 422);
}

log_activity('import_summary', $type, null, "berhasil=$berhasil dilewati=$dilewati gagal=$gagal");
json_success(
    ['berhasil' => $berhasil, 'dilewati' => $dilewati, 'gagal' => $gagal, 'errors' => array_slice($errors, 0, 200)],
    "Import selesai: $berhasil berhasil, $dilewati dilewati, $gagal gagal."
);
