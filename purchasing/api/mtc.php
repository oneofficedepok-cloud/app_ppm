<?php
require_once __DIR__ . '/../includes/auth.php';

switch ($_GET['resource'] ?? 'dashboard') {
    case 'divisi_list':
        require_login(); // daftar divisi baku = data referensi umum
        break;
    case 'mesin':
    case 'mp':
        require_perm(['mtcmaster', 'mtcdivisi', 'mtcdash'], ['mtcmaster']);
        break;
    case 'records':
        require_perm(['mtcdivisi', 'mtcdash'], ['mtcdivisi', 'mtcdash']);
        break;
    default: // dashboard
        require_view(['mtcdash', 'mtcdivisi']);
}

$pdo = db();
$method = http_method();
$resource = $_GET['resource'] ?? 'dashboard';

/** 16 divisi produksi baku (sama seperti prototype MTC) - tidak diedit lewat UI, cuma daftar pilihan. */
const MTC_DIVISI_LIST = [
    'Pembelian Material', 'Disassembling', 'Observasi', 'Engineering',
    'Machining', 'Brass Plating', 'Honing', 'Chrome',
    'Welding', 'Painting', 'QC', 'Assy',
    'HPU Test (Assy)', 'CNC Seal', 'Gudang', 'Transportasi',
];

function fetch_divisi_items(PDO $pdo, int $recordId): array
{
    $stmt = $pdo->prepare('SELECT * FROM mtc_divisi_items WHERE record_id = :id ORDER BY id ASC');
    $stmt->execute([':id' => $recordId]);
    return $stmt->fetchAll();
}

function fetch_records_for_wo(PDO $pdo, int $woId): array
{
    $stmt = $pdo->prepare('SELECT * FROM mtc_divisi_records WHERE wo_id = :wo ORDER BY created_at ASC');
    $stmt->execute([':wo' => $woId]);
    $records = $stmt->fetchAll();
    foreach ($records as &$r) {
        $r['items'] = fetch_divisi_items($pdo, (int) $r['id']);
        $r['total_biaya'] = array_sum(array_map(fn($i) => (float) $i['total'], $r['items']));
    }
    unset($r);
    return $records;
}

// ---------------------------------------------------------
// resource=divisi_list : daftar 16 divisi baku (untuk dropdown)
// ---------------------------------------------------------
if ($resource === 'divisi_list' && $method === 'GET') {
    json_success(MTC_DIVISI_LIST);
    exit;
}

// ---------------------------------------------------------
// resource=mesin : Master Mesin CRUD
// ---------------------------------------------------------
if ($resource === 'mesin') {
    switch ($method) {
        case 'GET':
            json_success($pdo->query('SELECT * FROM mtc_master_mesin ORDER BY kode ASC')->fetchAll());
            break;
        case 'POST':
            $b = get_json_input();
            $kode = clean_str(arr_val($b, 'kode', ''));
            $nama = clean_str(arr_val($b, 'nama', ''));
            if ($kode === '' || $nama === '') json_error('Kode dan Nama Mesin wajib diisi.', 422);
            try {
                $stmt = $pdo->prepare('INSERT INTO mtc_master_mesin (kode, nama, harga, status) VALUES (:k,:n,:h,:s)');
                $stmt->execute([':k' => $kode, ':n' => $nama, ':h' => to_float(arr_val($b, 'harga', 0)), ':s' => arr_val($b, 'status', 'AKTIF')]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') json_error('Kode Mesin sudah dipakai.', 409);
                throw $e;
            }
            json_success(['id' => (int) $pdo->lastInsertId()], 'Master Mesin berhasil ditambahkan.');
            break;
        case 'PUT':
            $b = get_json_input();
            $id = to_int_or_null(arr_val($b, 'id'));
            if (!$id) json_error('ID wajib diisi.', 422);
            try {
                $stmt = $pdo->prepare('UPDATE mtc_master_mesin SET kode=:k, nama=:n, harga=:h, status=:s WHERE id=:id');
                $stmt->execute([':k' => arr_val($b, 'kode', ''), ':n' => arr_val($b, 'nama', ''), ':h' => to_float(arr_val($b, 'harga', 0)), ':s' => arr_val($b, 'status', 'AKTIF'), ':id' => $id]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') json_error('Kode Mesin sudah dipakai mesin lain.', 409);
                throw $e;
            }
            json_success(['id' => $id], 'Master Mesin berhasil diperbarui.');
            break;
        case 'DELETE':
            $id = to_int_or_null($_GET['id'] ?? null);
            if (!$id) json_error('ID wajib diisi.', 422);
            $pdo->prepare('DELETE FROM mtc_master_mesin WHERE id = :id')->execute([':id' => $id]);
            json_success([], 'Master Mesin berhasil dihapus.');
            break;
        default:
            json_error('Method tidak didukung.', 405);
    }
    exit;
}

// ---------------------------------------------------------
// resource=mp : Master Tarif Divisi CRUD
// ---------------------------------------------------------
if ($resource === 'mp') {
    switch ($method) {
        case 'GET':
            json_success($pdo->query('SELECT * FROM mtc_master_mp ORDER BY kode ASC')->fetchAll());
            break;
        case 'POST':
            $b = get_json_input();
            $kode = clean_str(arr_val($b, 'kode', ''));
            $divisi = clean_str(arr_val($b, 'divisi', ''));
            if ($kode === '' || $divisi === '') json_error('Kode dan Divisi wajib diisi.', 422);
            try {
                $stmt = $pdo->prepare('INSERT INTO mtc_master_mp (kode, divisi, harga, status) VALUES (:k,:d,:h,:s)');
                $stmt->execute([':k' => $kode, ':d' => $divisi, ':h' => to_float(arr_val($b, 'harga', 0)), ':s' => arr_val($b, 'status', 'AKTIF')]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') json_error('Kode sudah dipakai.', 409);
                throw $e;
            }
            json_success(['id' => (int) $pdo->lastInsertId()], 'Tarif Divisi berhasil ditambahkan.');
            break;
        case 'PUT':
            $b = get_json_input();
            $id = to_int_or_null(arr_val($b, 'id'));
            if (!$id) json_error('ID wajib diisi.', 422);
            try {
                $stmt = $pdo->prepare('UPDATE mtc_master_mp SET kode=:k, divisi=:d, harga=:h, status=:s WHERE id=:id');
                $stmt->execute([':k' => arr_val($b, 'kode', ''), ':d' => arr_val($b, 'divisi', ''), ':h' => to_float(arr_val($b, 'harga', 0)), ':s' => arr_val($b, 'status', 'AKTIF'), ':id' => $id]);
            } catch (PDOException $e) {
                if ($e->getCode() === '23000') json_error('Kode sudah dipakai baris lain.', 409);
                throw $e;
            }
            json_success(['id' => $id], 'Tarif Divisi berhasil diperbarui.');
            break;
        case 'DELETE':
            $id = to_int_or_null($_GET['id'] ?? null);
            if (!$id) json_error('ID wajib diisi.', 422);
            $pdo->prepare('DELETE FROM mtc_master_mp WHERE id = :id')->execute([':id' => $id]);
            json_success([], 'Tarif Divisi berhasil dihapus.');
            break;
        default:
            json_error('Method tidak didukung.', 405);
    }
    exit;
}

// ---------------------------------------------------------
// resource=records : Record Divisi Produksi (per WO + Item Pekerjaan)
// ---------------------------------------------------------
if ($resource === 'records') {
    switch ($method) {
        case 'GET':
            $woId = to_int_or_null($_GET['wo_id'] ?? null);
            if (!$woId) json_error('wo_id wajib diisi.', 422);
            json_success(fetch_records_for_wo($pdo, $woId));
            break;

        case 'POST': {
            $b = get_json_input();
            $woId = to_int_or_null(arr_val($b, 'wo_id'));
            $namaItem = clean_str(arr_val($b, 'nama_item', ''));
            $divisi = clean_str(arr_val($b, 'divisi', ''));
            if (!$woId || $namaItem === '' || $divisi === '') {
                json_error('WO, Item Pekerjaan, dan Divisi wajib diisi.', 422);
            }
            if (!in_array($divisi, MTC_DIVISI_LIST, true)) json_error('Divisi tidak valid.', 422);

            $items = is_array($b['items'] ?? null) ? $b['items'] : [];

            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare(
                    'INSERT INTO mtc_divisi_records (wo_id, nama_item, divisi, status_workflow, pic, surat_jalan)
                     VALUES (:wo,:item,:div,:status,:pic,:sj)'
                );
                $stmt->execute([
                    ':wo' => $woId, ':item' => $namaItem, ':div' => $divisi,
                    ':status' => in_array(arr_val($b, 'status_workflow', 'NORMAL'), ['NORMAL', 'REWORK', 'CLAIM', 'REJECT'], true) ? arr_val($b, 'status_workflow', 'NORMAL') : 'NORMAL',
                    ':pic' => arr_val($b, 'pic', ''), ':sj' => arr_val($b, 'surat_jalan', ''),
                ]);
                $recordId = (int) $pdo->lastInsertId();

                $itemStmt = $pdo->prepare(
                    'INSERT INTO mtc_divisi_items (record_id, pekerjaan, deskripsi, qty, satuan, kode_mesin, harga, total, status)
                     VALUES (:rid,:pek,:desk,:qty,:satuan,:mesin,:harga,:total,:status)'
                );
                foreach ($items as $it) {
                    $pekerjaan = clean_str($it['pekerjaan'] ?? '');
                    if ($pekerjaan === '') continue;
                    $qty = to_float($it['qty'] ?? 0);
                    $harga = to_float($it['harga'] ?? 0);
                    $itemStmt->execute([
                        ':rid' => $recordId, ':pek' => $pekerjaan, ':desk' => $it['deskripsi'] ?? '',
                        ':qty' => $qty, ':satuan' => $it['satuan'] ?? 'Jam', ':mesin' => $it['kode_mesin'] ?? null,
                        ':harga' => $harga, ':total' => $qty * $harga,
                        ':status' => in_array($it['status'] ?? '', ['ON PROCESS', 'FINISH'], true) ? $it['status'] : 'ON PROCESS',
                    ]);
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

            log_activity('create', 'mtc_divisi_records', $recordId, "{$divisi} - {$namaItem}");
            json_success(['id' => $recordId], 'Data Divisi Produksi berhasil disimpan.');
            break;
        }

        case 'PUT': {
            $b = get_json_input();
            $id = to_int_or_null(arr_val($b, 'id'));
            if (!$id) json_error('ID wajib diisi.', 422);
            $items = is_array($b['items'] ?? null) ? $b['items'] : [];

            $pdo->beginTransaction();
            try {
                $stmt = $pdo->prepare(
                    'UPDATE mtc_divisi_records SET nama_item=:item, divisi=:div, status_workflow=:status, pic=:pic, surat_jalan=:sj WHERE id=:id'
                );
                $stmt->execute([
                    ':item' => arr_val($b, 'nama_item', ''), ':div' => arr_val($b, 'divisi', ''),
                    ':status' => in_array(arr_val($b, 'status_workflow', 'NORMAL'), ['NORMAL', 'REWORK', 'CLAIM', 'REJECT'], true) ? arr_val($b, 'status_workflow', 'NORMAL') : 'NORMAL',
                    ':pic' => arr_val($b, 'pic', ''), ':sj' => arr_val($b, 'surat_jalan', ''), ':id' => $id,
                ]);

                $pdo->prepare('DELETE FROM mtc_divisi_items WHERE record_id = :id')->execute([':id' => $id]);
                $itemStmt = $pdo->prepare(
                    'INSERT INTO mtc_divisi_items (record_id, pekerjaan, deskripsi, qty, satuan, kode_mesin, harga, total, status)
                     VALUES (:rid,:pek,:desk,:qty,:satuan,:mesin,:harga,:total,:status)'
                );
                foreach ($items as $it) {
                    $pekerjaan = clean_str($it['pekerjaan'] ?? '');
                    if ($pekerjaan === '') continue;
                    $qty = to_float($it['qty'] ?? 0);
                    $harga = to_float($it['harga'] ?? 0);
                    $itemStmt->execute([
                        ':rid' => $id, ':pek' => $pekerjaan, ':desk' => $it['deskripsi'] ?? '',
                        ':qty' => $qty, ':satuan' => $it['satuan'] ?? 'Jam', ':mesin' => $it['kode_mesin'] ?? null,
                        ':harga' => $harga, ':total' => $qty * $harga,
                        ':status' => in_array($it['status'] ?? '', ['ON PROCESS', 'FINISH'], true) ? $it['status'] : 'ON PROCESS',
                    ]);
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            }

            log_activity('update', 'mtc_divisi_records', $id, '');
            json_success(['id' => $id], 'Data Divisi Produksi berhasil diperbarui.');
            break;
        }

        case 'DELETE':
            $id = to_int_or_null($_GET['id'] ?? null);
            if (!$id) json_error('ID wajib diisi.', 422);
            $pdo->prepare('DELETE FROM mtc_divisi_records WHERE id = :id')->execute([':id' => $id]);
            log_activity('delete', 'mtc_divisi_records', $id, '');
            json_success([], 'Data Divisi Produksi berhasil dihapus.');
            break;

        default:
            json_error('Method tidak didukung.', 405);
    }
    exit;
}

// ---------------------------------------------------------
// resource=dashboard (default) : matrix WO -> Item Pekerjaan -> total biaya per divisi
// ---------------------------------------------------------
if ($resource === 'dashboard' && $method === 'GET') {
    $wos = $pdo->query(
        "SELECT wo.id, wo.wo_number, wo.project, wo.wo_total, wo.nilai_po, wo.status, c.nama AS customer_nama
         FROM work_orders wo LEFT JOIN customers c ON c.id = wo.customer_id
         WHERE wo.status != 'CANCEL'
         ORDER BY wo.created_at DESC"
    )->fetchAll();

    $budgetStmt = $pdo->prepare('SELECT * FROM work_order_budget_items WHERE wo_id = :wo ORDER BY id ASC');
    $recStmt = $pdo->prepare(
        "SELECT r.*, COALESCE(SUM(i.total),0) AS total_biaya
         FROM mtc_divisi_records r LEFT JOIN mtc_divisi_items i ON i.record_id = r.id
         WHERE r.wo_id = :wo AND r.nama_item = :item
         GROUP BY r.id"
    );

    $result = [];
    foreach ($wos as $w) {
        $budgetStmt->execute([':wo' => $w['id']]);
        $items = $budgetStmt->fetchAll();

        $totalBiayaWO = 0;
        $itemsWithDivisi = [];
        foreach ($items as $item) {
            $recStmt->execute([':wo' => $w['id'], ':item' => $item['nama_item']]);
            $records = $recStmt->fetchAll();
            $itemTotal = array_sum(array_map(fn($r) => (float) $r['total_biaya'], $records));
            $totalBiayaWO += $itemTotal;
            $itemsWithDivisi[] = [
                'nama_item' => $item['nama_item'],
                'qty' => $item['qty'],
                'budget' => $item['budget'],
                'status' => $item['status'],
                'aktual' => $itemTotal,
                'divisi_records' => $records,
            ];
        }

        if (empty($items)) continue; // WO tanpa Item Pekerjaan tidak relevan ditampilkan di matrix MTC

        $result[] = [
            'wo_id' => $w['id'], 'wo_number' => $w['wo_number'], 'project' => $w['project'], 'status' => $w['status'],
            'customer_nama' => $w['customer_nama'], 'nilai_po' => $w['wo_total'] ?: $w['nilai_po'],
            'total_biaya' => $totalBiayaWO, 'margin' => (float) ($w['wo_total'] ?: $w['nilai_po']) - $totalBiayaWO,
            'items' => $itemsWithDivisi,
        ];
    }

    json_success($result);
    exit;
}

json_error('Resource tidak dikenali.', 404);
