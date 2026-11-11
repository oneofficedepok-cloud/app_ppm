<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/sealkit.php';

// Baca: semua user login (dipakai form WO & PR untuk mengisi item sealkit otomatis).
// Ubah: menu Produksi -> Master Sealkit. Hapus: hanya Admin (aturan global DELETE).
require_perm(null, ['sealkit']);

$method = http_method();
$pdo = db();
ensure_customer_kode($pdo);
sealkit_ensure($pdo);

/** Baca & validasi header + item dari input form. */
function sealkit_input(PDO $pdo, array $b): array
{
    $type = strtoupper((string) arr_val($b, 'cyl_type', ''));
    if (!isset(SEALKIT_TYPES[$type])) json_error('Pilih Type Cylinder: H (Hydraulic) atau P (Pneumatic).', 422);

    $custId = to_int_or_null(arr_val($b, 'customer_id'));
    if (!$custId) json_error('Kode Customer wajib dipilih.', 422);
    $c = $pdo->prepare('SELECT id, kode, nama FROM customers WHERE id = :id');
    $c->execute([':id' => $custId]);
    $cust = $c->fetch();
    if (!$cust) json_error('Customer tidak ditemukan.', 422);
    if (trim((string) $cust['kode']) === '') json_error('Customer ' . $cust['nama'] . ' belum punya Kode Customer. Isi dulu di Master Data -> Customer.', 422);

    $cyl = mb_substr(clean_str(arr_val($b, 'cylinder_name', '')), 0, 200);
    if ($cyl === '') json_error('Cylinder Name wajib diisi.', 422);

    $tgl = (string) (arr_val($b, 'tanggal') ?: date('Y-m-d'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $tgl)) json_error('Tanggal tidak valid.', 422);

    $raw = arr_val($b, 'items', []);
    if (!is_array($raw)) $raw = [];
    if (count($raw) > 300) json_error('Maksimal 300 item per sealkit.', 422);
    $items = [];
    foreach ($raw as $i => $it) {
        if (!is_array($it)) continue;
        $f = fn($k, $max) => mb_substr(clean_str(arr_val($it, $k, '')), 0, $max);
        $row = [
            'part_name' => $f('part_name', 150), 'part_type' => $f('part_type', 100), 'part_no' => $f('part_no', 100),
            'material' => $f('material', 100), 'dimension' => $f('dimension', 150), 'unit' => $f('unit', 30) ?: 'Pc',
            'keterangan' => $f('keterangan', 255), 'qty' => round(to_float(arr_val($it, 'qty', 0)), 2),
        ];
        $blank = $row['part_name'] === '' && $row['part_type'] === '' && $row['part_no'] === '' && $row['material'] === '' && $row['dimension'] === '';
        if ($blank) continue; // baris kosong diabaikan
        $no = $i + 1;
        if ($row['part_name'] === '') json_error("Item ke-{$no}: Part Name wajib diisi.", 422);
        if ($row['qty'] <= 0) json_error("Item ke-{$no} ({$row['part_name']}): Qty harus lebih dari 0.", 422);
        $items[] = $row;
    }
    if (!$items) json_error('Tambahkan minimal 1 item sealkit.', 422);

    return [
        'cyl_type' => $type, 'customer_id' => $custId, 'kode' => (string) $cust['kode'], 'tanggal' => $tgl,
        'cylinder_name' => $cyl, 'catatan' => mb_substr(trim((string) arr_val($b, 'catatan', '')), 0, 2000), 'items' => $items,
    ];
}

function sealkit_save_items(PDO $pdo, int $id, array $items): void
{
    $pdo->prepare('DELETE FROM sealkit_items WHERE sealkit_id = :id')->execute([':id' => $id]);
    $ins = $pdo->prepare(
        'INSERT INTO sealkit_items (sealkit_id, urut, part_name, part_type, part_no, material, dimension, qty, unit, keterangan)
         VALUES (:sk, :urut, :pn, :pt, :pno, :mat, :dim, :qty, :unit, :ket)'
    );
    foreach (array_values($items) as $i => $it) {
        $ins->execute([
            ':sk' => $id, ':urut' => $i + 1, ':pn' => $it['part_name'], ':pt' => $it['part_type'], ':pno' => $it['part_no'],
            ':mat' => $it['material'], ':dim' => $it['dimension'], ':qty' => $it['qty'], ':unit' => $it['unit'], ':ket' => $it['keterangan'],
        ]);
    }
}

switch ($method) {
    case 'GET':
        if (($_GET['action'] ?? '') === 'next_number') {
            $type = strtoupper((string) ($_GET['type'] ?? 'H'));
            if (!isset(SEALKIT_TYPES[$type])) $type = 'H';
            $year = preg_match('/^\d{4}$/', (string) ($_GET['year'] ?? '')) ? $_GET['year'] : date('Y');
            json_success(['sealkit_no' => sealkit_next_number($pdo, $type, (string) ($_GET['kode'] ?? ''), $year)]);
        }
        json_success(sealkit_list($pdo));
        break;

    case 'POST':
        $d = sealkit_input($pdo, get_json_input());
        $pdo->beginTransaction();
        try {
            // Nomor dibuat di server (urut berikutnya) supaya tidak bentrok bila 2 user menyimpan bersamaan.
            $no = sealkit_next_number($pdo, $d['cyl_type'], $d['kode'], substr($d['tanggal'], 0, 4));
            $pdo->prepare(
                'INSERT INTO sealkits (sealkit_no, cyl_type, customer_id, tanggal, cylinder_name, catatan, created_by)
                 VALUES (:no, :t, :c, :tgl, :cyl, :cat, :by)'
            )->execute([
                ':no' => $no, ':t' => $d['cyl_type'], ':c' => $d['customer_id'], ':tgl' => $d['tanggal'],
                ':cyl' => $d['cylinder_name'], ':cat' => $d['catatan'], ':by' => current_user()['id'] ?? null,
            ]);
            $id = (int) $pdo->lastInsertId();
            sealkit_save_items($pdo, $id, $d['items']);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            if ($e instanceof PDOException && $e->getCode() === '23000') json_error('No. Sealkit bentrok, silakan simpan ulang.', 409);
            throw $e;
        }
        log_activity('create', 'sealkits', $id, $no . ' - ' . $d['cylinder_name'] . ' (' . count($d['items']) . ' item)');
        json_success(['id' => $id, 'sealkit_no' => $no], "Sealkit $no berhasil disimpan.");
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        if (!$id) json_error('ID sealkit wajib diisi.', 422);
        $cur = $pdo->prepare('SELECT * FROM sealkits WHERE id = :id');
        $cur->execute([':id' => $id]);
        $old = $cur->fetch();
        if (!$old) json_error('Sealkit tidak ditemukan.', 404);
        $d = sealkit_input($pdo, $b);

        $pdo->beginTransaction();
        try {
            // Type / Customer / Tahun berubah -> nomor ikut diganti supaya tetap sesuai format.
            $parts = explode('.', $old['sealkit_no']);
            $same = count($parts) === 4 && $parts[1] === $d['cyl_type'] && $parts[2] === strtoupper(preg_replace('/[^A-Za-z0-9\-]/', '', $d['kode'])) && $parts[3] === substr($d['tanggal'], 0, 4);
            $no = $same ? $old['sealkit_no'] : sealkit_next_number($pdo, $d['cyl_type'], $d['kode'], substr($d['tanggal'], 0, 4));
            $pdo->prepare(
                'UPDATE sealkits SET sealkit_no = :no, cyl_type = :t, customer_id = :c, tanggal = :tgl,
                        cylinder_name = :cyl, catatan = :cat WHERE id = :id'
            )->execute([
                ':no' => $no, ':t' => $d['cyl_type'], ':c' => $d['customer_id'], ':tgl' => $d['tanggal'],
                ':cyl' => $d['cylinder_name'], ':cat' => $d['catatan'], ':id' => $id,
            ]);
            sealkit_save_items($pdo, $id, $d['items']);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            if ($e instanceof PDOException && $e->getCode() === '23000') json_error('No. Sealkit bentrok, silakan simpan ulang.', 409);
            throw $e;
        }
        log_activity('update', 'sealkits', $id, $no . ' - ' . $d['cylinder_name'] . ' (' . count($d['items']) . ' item)'
            . ($no !== $old['sealkit_no'] ? ' | No. lama: ' . $old['sealkit_no'] : ''));
        json_success(['id' => $id, 'sealkit_no' => $no], "Sealkit $no berhasil diperbarui.");
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);
        $q = $pdo->prepare('SELECT sealkit_no FROM sealkits WHERE id = :id');
        $q->execute([':id' => $id]);
        $no = $q->fetchColumn();
        if ($no === false) json_error('Sealkit tidak ditemukan.', 404);
        $used = $pdo->prepare('SELECT GROUP_CONCAT(wo_number SEPARATOR ", ") FROM work_orders WHERE sealkit_id = :id');
        $used->execute([':id' => $id]);
        if ($wos = $used->fetchColumn()) json_error("Sealkit $no masih dipakai di WO: $wos. Lepas dulu dari WO tsb.", 409);
        $pdo->prepare('DELETE FROM sealkits WHERE id = :id')->execute([':id' => $id]);
        log_activity('delete', 'sealkits', $id, (string) $no);
        json_success([], "Sealkit $no berhasil dihapus.");
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
