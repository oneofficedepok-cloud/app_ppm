<?php
/**
 * Modul Finance - Surat Jalan (SJ). 1 SJ bisa untuk beberapa WO (tabel surat_jalan_wo).
 * Status SJ terbaru tiap WO tampil di tabel WO & Budget dan Dashboard MTC.
 */
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/wo_functions.php';

require_perm(['sj'], ['sj']);

$method = http_method();
$pdo = db();

if (!db_table_exists($pdo, 'surat_jalan') || !db_table_exists($pdo, 'surat_jalan_wo')) {
    json_error('Tabel Surat Jalan belum ada. Import database/migration_surat_jalan.sql lewat phpMyAdmin.', 500);
}

/** No SJ otomatis berikutnya: SJ-2026/001, SJ-2026/002, ... */
function next_sj_number(PDO $pdo): string
{
    $prefix = 'SJ-' . date('Y') . '/';
    $stmt = $pdo->prepare('SELECT no_sj FROM surat_jalan WHERE no_sj LIKE :p');
    $stmt->execute([':p' => $prefix . '%']);
    $max = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $no) {
        $max = max($max, (int) substr($no, strlen($prefix)));
    }
    return $prefix . str_pad((string) ($max + 1), 3, '0', STR_PAD_LEFT);
}

function sj_input(PDO $pdo, array $b): array
{
    $noSJ = strtoupper(clean_str(arr_val($b, 'no_sj', '')));
    $tgl = arr_val($b, 'tgl_kirim');
    if ($noSJ === '' || !$tgl) json_error('No. Surat Jalan dan Tanggal Kirim wajib diisi.', 422);
    [$woIds] = valid_wo_ids($pdo, arr_val($b, 'wo_ids', []));
    if (!$woIds) json_error('Pilih minimal 1 WO untuk Surat Jalan ini.', 422);
    $status = strtoupper((string) arr_val($b, 'status', 'DELIVERY'));
    if (!isset(SJ_STATUSES[$status])) json_error('Status Surat Jalan tidak dikenal.', 422);
    return [
        'fields' => [
            ':no' => $noSJ, ':tgl' => $tgl, ':cust' => to_int_or_null(arr_val($b, 'customer_id')),
            ':inv' => clean_str(arr_val($b, 'nomor_invoice', '')), ':status' => $status,
            ':ket' => trim((string) arr_val($b, 'keterangan', '')),
        ],
        'wo_ids' => $woIds,
    ];
}

function save_sj_links(PDO $pdo, int $sjId, array $woIds): void
{
    $pdo->prepare('DELETE FROM surat_jalan_wo WHERE sj_id = :sj')->execute([':sj' => $sjId]);
    $ins = $pdo->prepare('INSERT INTO surat_jalan_wo (sj_id, wo_id) VALUES (:sj, :wo)');
    foreach ($woIds as $woId) $ins->execute([':sj' => $sjId, ':wo' => $woId]);
}

switch ($method) {

    case 'GET':
        if (($_GET['action'] ?? '') === 'next_no') {
            json_success(['no_sj' => next_sj_number($pdo)]);
        }

        $rows = $pdo->query(
            'SELECT s.*, c.nama AS customer_nama, u.full_name AS created_by_nama
             FROM surat_jalan s
             LEFT JOIN customers c ON c.id = s.customer_id
             LEFT JOIN users u ON u.id = s.created_by
             ORDER BY s.tgl_kirim DESC, s.id DESC'
        )->fetchAll();

        // WO tiap SJ (No WO, project, PO, customer, nilai) dalam 1 query.
        $woRows = $pdo->query(
            'SELECT l.sj_id, w.id, w.wo_number, w.project, w.po_no, w.nilai_po, w.wo_total, c.nama AS customer_nama
             FROM surat_jalan_wo l
             JOIN work_orders w ON w.id = l.wo_id
             LEFT JOIN customers c ON c.id = w.customer_id
             ORDER BY w.wo_number'
        )->fetchAll();
        $invByWo = ar_invoices_by_wo($pdo);
        $bySj = [];
        foreach ($woRows as $w) {
            $bySj[(int) $w['sj_id']][] = [
                'id' => (int) $w['id'], 'wo_number' => $w['wo_number'], 'project' => $w['project'],
                'po_no' => $w['po_no'], 'customer_nama' => $w['customer_nama'],
                'nilai' => (float) $w['nilai_po'],
                'invoices' => $invByWo[(int) $w['id']] ?? [],
            ];
        }

        $canNilai = can_see_nilai_po(current_user());
        foreach ($rows as &$s) {
            $wos = $bySj[(int) $s['id']] ?? [];
            $s['wos'] = $wos;
            $s['wo_ids'] = array_column($wos, 'id');
            $s['wo_numbers'] = implode(', ', array_column($wos, 'wo_number'));
            $s['po_numbers'] = implode(', ', array_values(array_unique(array_filter(array_column($wos, 'po_no'), fn($p) => trim((string) $p) !== '' && $p !== '-'))));
            $s['projects'] = implode(' | ', array_column($wos, 'project'));
            if (!$s['customer_nama']) $s['customer_nama'] = implode(' / ', array_values(array_unique(array_filter(array_column($wos, 'customer_nama')))));
            $inv = [];
            foreach ($wos as $w) $inv = array_merge($inv, $w['invoices']);
            $s['auto_invoices'] = implode(', ', array_values(array_unique($inv))); // No Invoice AR dari WO-WO tsb
            $s['nilai_total'] = array_sum(array_column($wos, 'nilai'));
            if (!$canNilai) {
                $s['nilai_total'] = null;
                foreach ($s['wos'] as &$w) $w['nilai'] = null;
                unset($w);
            }
        }
        unset($s);
        json_success($rows);
        break;

    case 'POST':
        $in = sj_input($pdo, get_json_input());
        $pdo->beginTransaction();
        try {
            $pdo->prepare(
                'INSERT INTO surat_jalan (no_sj, tgl_kirim, customer_id, nomor_invoice, status, keterangan, created_by)
                 VALUES (:no, :tgl, :cust, :inv, :status, :ket, :by)'
            )->execute($in['fields'] + [':by' => current_user()['id'] ?? null]);
            $id = (int) $pdo->lastInsertId();
            save_sj_links($pdo, $id, $in['wo_ids']);
            $pdo->commit();
        } catch (PDOException $e) {
            $pdo->rollBack();
            if ($e->getCode() === '23000') json_error('No. Surat Jalan ini sudah pernah dipakai.', 409);
            throw $e;
        }
        log_activity('create', 'surat_jalan', $id, $in['fields'][':no']);
        json_success(['id' => $id], 'Surat Jalan berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        if (!$id) json_error('ID wajib diisi.', 422);
        $in = sj_input($pdo, $b);
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare(
                'UPDATE surat_jalan SET no_sj = :no, tgl_kirim = :tgl, customer_id = :cust, nomor_invoice = :inv,
                    status = :status, keterangan = :ket WHERE id = :id'
            );
            $stmt->execute($in['fields'] + [':id' => $id]);
            save_sj_links($pdo, $id, $in['wo_ids']);
            $pdo->commit();
        } catch (PDOException $e) {
            $pdo->rollBack();
            if ($e->getCode() === '23000') json_error('No. Surat Jalan sudah dipakai SJ lain.', 409);
            throw $e;
        }
        log_activity('update', 'surat_jalan', $id, $in['fields'][':no']);
        json_success(['id' => $id], 'Surat Jalan berhasil diperbarui.');
        break;

    case 'DELETE':
        if (!isset($_GET['id'])) {
            $ids = parse_id_list();
            if (!$ids) json_error('Tidak ada data yang dipilih.', 422);
            $ph = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("DELETE FROM surat_jalan WHERE id IN ($ph)");
            $stmt->execute($ids);
            log_activity('bulk_delete', 'surat_jalan', null, 'IDs: ' . implode(',', $ids));
            json_success(['deleted' => $stmt->rowCount()], $stmt->rowCount() . ' Surat Jalan berhasil dihapus.');
        }
        $id = to_int_or_null($_GET['id']);
        if (!$id) json_error('ID wajib diisi.', 422);
        $pdo->prepare('DELETE FROM surat_jalan WHERE id = :id')->execute([':id' => $id]);
        log_activity('delete', 'surat_jalan', $id, '');
        json_success([], 'Surat Jalan berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
