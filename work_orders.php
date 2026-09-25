<?php
require_once __DIR__ . '/../includes/auth.php';

require_login();

$method = http_method();
$pdo = db();
$action = $_GET['action'] ?? '';

/**
 * Hitung DPP/PPN/PPh23/PPh Lain/Total nilai jual WO di SERVER
 * (jangan percaya angka dari browser) - meniru persis formula calcWO()
 * dari modul Finance asli: dpp = qty*harga - diskon; ppn = dpp*11% kalau YA;
 * pph23 = dpp*2% kalau YA; pphLain = dpp*(pct/100); total = dpp+ppn-pph23-pphLain.
 */
function calc_wo_finance(float $qty, float $harga, float $diskon, bool $isPpn, bool $isPph23, float $pphLainPct): array
{
    $dpp = ($qty * $harga) - $diskon;
    $ppn = $isPpn ? round($dpp * 0.11, 2) : 0.0;
    $pph23 = $isPph23 ? round($dpp * 0.02, 2) : 0.0;
    $pphLain = round($dpp * ($pphLainPct / 100), 2);
    $total = $dpp + $ppn - $pph23 - $pphLain;
    return [$dpp, $ppn, $pph23, $pphLain, $total];
}

/** Prefix No. WO otomatis mengikuti Kategori WO: PROJECT polos, MAINTENANCE "M-", INVENTARIS "A-". */
function wo_category_prefix(string $category): string
{
    if ($category === 'MAINTENANCE') return 'WO-M-';
    if ($category === 'INVENTARIS') return 'WO-A-';
    return 'WO-' . date('Y') . '-';
}

/** Generate No. WO otomatis & unik untuk kategori terkait (auto, tapi tetap boleh diedit manual di form). */
function generate_wo_number(PDO $pdo, string $category): string
{
    $prefix = wo_category_prefix($category);
    $stmt = $pdo->prepare("SELECT wo_number FROM work_orders WHERE wo_number LIKE :like ORDER BY wo_number DESC LIMIT 1");
    $stmt->execute([':like' => $prefix . '%']);
    $last = $stmt->fetchColumn();

    $nextNum = 1;
    if ($last) {
        $numPart = (int) substr($last, strlen($prefix));
        $nextNum = $numPart + 1;
    }
    return $prefix . str_pad((string) $nextNum, 3, '0', STR_PAD_LEFT);
}

function fetch_wo_budget_items(PDO $pdo, int $woId): array
{
    $stmt = $pdo->prepare('SELECT * FROM work_order_budget_items WHERE wo_id = :wo ORDER BY id ASC');
    $stmt->execute([':wo' => $woId]);
    return $stmt->fetchAll();
}

/**
 * Simpan ulang seluruh baris "Item Pekerjaan" (hapus lalu insert baru - sama
 * seperti pola BOM Produksi) dan kembalikan total budget & actual-nya, yang
 * dipakai menimpa budget_prod/aktual_prod kalau baris item dikirim.
 * Return null kalau tidak ada array budget_items yang dikirim sama sekali
 * (artinya WO ini masih pakai input manual budget_prod/aktual_prod lama).
 */
function save_wo_budget_items(PDO $pdo, int $woId, $budgetItems): ?array
{
    if (!is_array($budgetItems)) return null;

    $pdo->prepare('DELETE FROM work_order_budget_items WHERE wo_id = :wo')->execute([':wo' => $woId]);
    $totalBudget = 0.0;
    $totalActual = 0.0;
    $stmt = $pdo->prepare(
        'INSERT INTO work_order_budget_items (wo_id, nama_item, qty, budget, actual, status) VALUES (:wo, :nama, :qty, :budget, :actual, :status)'
    );
    foreach ($budgetItems as $item) {
        $nama = clean_str($item['nama_item'] ?? '');
        if ($nama === '') continue;
        $budget = to_float($item['budget'] ?? 0);
        $actual = to_float($item['actual'] ?? 0);
        $stmt->execute([
            ':wo' => $woId, ':nama' => $nama, ':qty' => to_float($item['qty'] ?? 1),
            ':budget' => $budget, ':actual' => $actual,
            ':status' => in_array($item['status'] ?? '', ['ON PROCESS', 'FINISH'], true) ? $item['status'] : 'ON PROCESS',
        ]);
        $totalBudget += $budget;
        $totalActual += $actual;
    }
    return [$totalBudget, $totalActual];
}

// ---------------------------------------------------------
// action=generate_wo_number : sarankan No. WO otomatis sesuai kategori
// ---------------------------------------------------------
if ($method === 'GET' && $action === 'generate_wo_number') {
    $category = in_array($_GET['category'] ?? '', ['PROJECT', 'MAINTENANCE', 'INVENTARIS'], true) ? $_GET['category'] : 'PROJECT';
    json_success(['wo_number' => generate_wo_number($pdo, $category)]);
    exit;
}

switch ($method) {

    case 'GET':
        // Semua kalkulasi (DPP aktual, total seal, total transport, total produksi,
        // P/L, status auto) dilakukan di SERVER supaya konsisten & tidak bisa
        // dimanipulasi dari browser - menggantikan logika yang dulu ada di client JS.
        $sql = "
            SELECT wo.*, c.nama AS customer_nama,
                   kr.nama AS requester_nama, ka.nama AS atasan_nama, km.nama AS manager_nama,
                   COALESCE((SELECT SUM(pr.dpp) FROM pr_items pr WHERE pr.wo_id = wo.id AND pr.status != 'CANCEL'), 0) AS aktual_pem,
                   COALESCE((SELECT SUM(si.total) FROM seal_items si WHERE si.wo_id = wo.id), 0) AS total_seal,
                   COALESCE((SELECT SUM(ti.total) FROM transport_items ti WHERE ti.wo_id = wo.id), 0) AS total_transport,
                   (SELECT COUNT(*) FROM pr_items pr WHERE pr.wo_id = wo.id) AS pr_count,
                   (SELECT COUNT(*) FROM pr_items pr WHERE pr.wo_id = wo.id AND pr.status IN ('ON PROSES','PO ISSUED')) AS pr_on_proses_count,
                   (SELECT COALESCE(SUM(ar.terbayar),0) FROM account_receivable ar WHERE ar.wo_id = wo.id) AS ar_terbayar,
                   (SELECT COUNT(*) FROM account_receivable ar WHERE ar.wo_id = wo.id) AS ar_count
            FROM work_orders wo
            LEFT JOIN customers c ON c.id = wo.customer_id
            LEFT JOIN master_karyawan kr ON kr.id = wo.requester_karyawan_id
            LEFT JOIN master_karyawan ka ON ka.id = wo.atasan_karyawan_id
            LEFT JOIN master_karyawan km ON km.id = wo.manager_karyawan_id
            ORDER BY wo.created_at DESC
        ";
        $rows = $pdo->query($sql)->fetchAll();

        foreach ($rows as &$w) {
            $w['budget_items'] = fetch_wo_budget_items($pdo, (int) $w['id']);

            $totalProduksi = (float) $w['aktual_prod'] + (float) $w['aktual_pem'] + (float) $w['total_seal'] + (float) $w['total_transport'] + (float) $w['total_lain'];
            $w['total_produksi'] = $totalProduksi;

            // Profit/Loss RIIL: pakai wo_total (nilai jual setelah pajak) kalau sudah diisi
            // lewat sisi Finance; kalau belum, fallback ke nilai_po (DPP) lalu budget lama.
            if ((float) $w['wo_total'] > 0) {
                $w['profit_loss'] = (float) $w['wo_total'] - $totalProduksi;
            } elseif ((float) $w['nilai_po'] > 0) {
                $w['profit_loss'] = (float) $w['nilai_po'] - $totalProduksi;
            } else {
                $w['profit_loss'] = ((float) $w['budget_prod'] + (float) $w['budget_pem']) - $totalProduksi;
            }

            $hasOnProses = (int) $w['pr_on_proses_count'] > 0;
            $w['computed_status'] = ((int) $w['pr_count'] > 0 && !$hasOnProses) ? 'RECEIVED' : 'ON PROSES';

            // Status Budget: AMAN kalau total budget (produksi+pembelian+lain-lain) masih
            // cukup menutupi total aktual/realisasinya.
            $totalBudgetKeseluruhan = (float) $w['budget_prod'] + (float) $w['budget_pem'] + (float) $w['budget_lain'];
            $w['status_budget'] = ($totalBudgetKeseluruhan >= $totalProduksi) ? 'AMAN' : 'OVER BUDGET';

            // Status invoice (sisi Finance): dipakai badge "WO Pipeline" di dashboard.
            if ((int) $w['ar_count'] === 0) {
                $w['invoice_status'] = 'BELUM INVOICE';
            } elseif ((float) $w['ar_terbayar'] > 0 && (float) $w['ar_terbayar'] >= (float) $w['wo_total']) {
                $w['invoice_status'] = 'LUNAS';
            } else {
                $w['invoice_status'] = 'PENDING';
            }
        }
        unset($w);

        json_success($rows);
        break;

    case 'POST':
        $b = get_json_input();
        $category = in_array(arr_val($b, 'wo_category', 'PROJECT'), ['PROJECT', 'MAINTENANCE', 'INVENTARIS'], true) ? arr_val($b, 'wo_category', 'PROJECT') : 'PROJECT';
        $woNumber = clean_str(arr_val($b, 'wo_number', '')) ?: generate_wo_number($pdo, $category);
        $project  = clean_str(arr_val($b, 'project', ''));
        if ($project === '') {
            json_error('Nama Project wajib diisi.', 422);
        }

        $qty = to_float(arr_val($b, 'qty', 1));
        $harga = to_float(arr_val($b, 'harga_satuan', 0));
        $diskon = to_float(arr_val($b, 'diskon', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', true);
        $isPph23 = (bool) arr_val($b, 'is_pph23', true);
        $pphLainPct = to_float(arr_val($b, 'pph_lain_pct', 0));
        [$dpp, $ppn, $pph23, $pphLain, $woTotal] = calc_wo_finance($qty, $harga, $diskon, $isPpn, $isPph23, $pphLainPct);

        // Kalau daftar Item Pekerjaan (budget_items) dikirim, budget_prod/aktual_prod
        // dihitung sebagai SUM baris-baris itu, bukan dari input manual.
        $budgetItemsInput = $b['budget_items'] ?? null;
        $budgetProd = to_float(arr_val($b, 'budget_prod'));
        $aktualProd = to_float(arr_val($b, 'aktual_prod'));

        $stmt = $pdo->prepare(
            'INSERT INTO work_orders
             (wo_number, wo_category, project, customer_id, requester_karyawan_id, atasan_karyawan_id, manager_karyawan_id,
              est_kirim, nilai_po, budget_prod, aktual_prod, budget_pem, budget_lain, total_lain, status,
              po_no, qty, satuan, harga_satuan, diskon, is_ppn, ppn, is_pph23, pph23, pph_lain_pct, pph_lain, wo_total)
             VALUES (:wo, :cat, :proj, :cust, :req, :atasan, :manager,
              :est, :nilai, :bprod, :aprod, :bpem, :blain, :lain, :status,
              :pono, :qty, :satuan, :harga, :diskon, :isppn, :ppn, :ispph23, :pph23, :pphlainpct, :pphlain, :wototal)'
        );
        try {
            $stmt->execute([
                ':wo'    => $woNumber,
                ':cat'   => $category,
                ':proj'  => $project,
                ':cust'  => to_int_or_null(arr_val($b, 'customer_id')),
                ':req'   => to_int_or_null(arr_val($b, 'requester_karyawan_id')),
                ':atasan'=> to_int_or_null(arr_val($b, 'atasan_karyawan_id')),
                ':manager' => to_int_or_null(arr_val($b, 'manager_karyawan_id')),
                ':est'   => arr_val($b, 'est_kirim') ?: null,
                ':nilai' => $dpp,
                ':bprod' => $budgetProd,
                ':aprod' => $aktualProd,
                ':bpem'  => to_float(arr_val($b, 'budget_pem')),
                ':blain' => to_float(arr_val($b, 'budget_lain')),
                ':lain'  => to_float(arr_val($b, 'total_lain')),
                ':status'=> in_array(arr_val($b, 'status', 'ON PROGRESS'), ['ON PROGRESS','HOLD','CANCEL','DELIVERY','FINISHED'], true) ? arr_val($b, 'status', 'ON PROGRESS') : 'ON PROGRESS',
                ':pono'      => arr_val($b, 'po_no', ''),
                ':qty'       => $qty,
                ':satuan'    => arr_val($b, 'satuan', 'Unit'),
                ':harga'     => $harga,
                ':diskon'    => $diskon,
                ':isppn'     => $isPpn ? 1 : 0,
                ':ppn'       => $ppn,
                ':ispph23'   => $isPph23 ? 1 : 0,
                ':pph23'     => $pph23,
                ':pphlainpct'=> $pphLainPct,
                ':pphlain'   => $pphLain,
                ':wototal'   => $woTotal,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. WO sudah pernah dipakai.', 409);
            throw $e;
        }

        $newId = (int) $pdo->lastInsertId();

        $sums = save_wo_budget_items($pdo, $newId, $budgetItemsInput);
        if ($sums !== null) {
            $pdo->prepare('UPDATE work_orders SET budget_prod = :b, aktual_prod = :a WHERE id = :id')
                ->execute([':b' => $sums[0], ':a' => $sums[1], ':id' => $newId]);
        }

        log_activity('create', 'work_orders', $newId, $woNumber);
        json_success(['id' => $newId, 'wo_number' => $woNumber, 'dpp' => $dpp, 'wo_total' => $woTotal], 'Work Order berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $category = in_array(arr_val($b, 'wo_category', 'PROJECT'), ['PROJECT', 'MAINTENANCE', 'INVENTARIS'], true) ? arr_val($b, 'wo_category', 'PROJECT') : 'PROJECT';
        $woNumber = clean_str(arr_val($b, 'wo_number', ''));
        $project  = clean_str(arr_val($b, 'project', ''));
        if (!$id || $woNumber === '' || $project === '') {
            json_error('ID, No. WO, dan Nama Project wajib diisi.', 422);
        }

        $qty = to_float(arr_val($b, 'qty', 1));
        $harga = to_float(arr_val($b, 'harga_satuan', 0));
        $diskon = to_float(arr_val($b, 'diskon', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', true);
        $isPph23 = (bool) arr_val($b, 'is_pph23', true);
        $pphLainPct = to_float(arr_val($b, 'pph_lain_pct', 0));
        [$dpp, $ppn, $pph23, $pphLain, $woTotal] = calc_wo_finance($qty, $harga, $diskon, $isPpn, $isPph23, $pphLainPct);

        $budgetItemsInput = $b['budget_items'] ?? null;
        $sums = save_wo_budget_items($pdo, $id, $budgetItemsInput);
        $budgetProd = $sums !== null ? $sums[0] : to_float(arr_val($b, 'budget_prod'));
        $aktualProd = $sums !== null ? $sums[1] : to_float(arr_val($b, 'aktual_prod'));

        $stmt = $pdo->prepare(
            'UPDATE work_orders SET
                wo_number = :wo, wo_category = :cat, project = :proj, customer_id = :cust,
                requester_karyawan_id = :req, atasan_karyawan_id = :atasan, manager_karyawan_id = :manager,
                est_kirim = :est,
                nilai_po = :nilai, budget_prod = :bprod, aktual_prod = :aprod,
                budget_pem = :bpem, budget_lain = :blain, total_lain = :lain, status = :status,
                po_no = :pono, qty = :qty, satuan = :satuan, harga_satuan = :harga, diskon = :diskon,
                is_ppn = :isppn, ppn = :ppn, is_pph23 = :ispph23, pph23 = :pph23,
                pph_lain_pct = :pphlainpct, pph_lain = :pphlain, wo_total = :wototal
             WHERE id = :id'
        );
        try {
            $stmt->execute([
                ':wo'    => $woNumber,
                ':cat'   => $category,
                ':proj'  => $project,
                ':cust'  => to_int_or_null(arr_val($b, 'customer_id')),
                ':req'   => to_int_or_null(arr_val($b, 'requester_karyawan_id')),
                ':atasan'=> to_int_or_null(arr_val($b, 'atasan_karyawan_id')),
                ':manager' => to_int_or_null(arr_val($b, 'manager_karyawan_id')),
                ':est'   => arr_val($b, 'est_kirim') ?: null,
                ':nilai' => $dpp,
                ':bprod' => $budgetProd,
                ':aprod' => $aktualProd,
                ':bpem'  => to_float(arr_val($b, 'budget_pem')),
                ':blain' => to_float(arr_val($b, 'budget_lain')),
                ':lain'  => to_float(arr_val($b, 'total_lain')),
                ':status'=> in_array(arr_val($b, 'status', 'ON PROGRESS'), ['ON PROGRESS','HOLD','CANCEL','DELIVERY','FINISHED'], true) ? arr_val($b, 'status', 'ON PROGRESS') : 'ON PROGRESS',
                ':pono'      => arr_val($b, 'po_no', ''),
                ':qty'       => $qty,
                ':satuan'    => arr_val($b, 'satuan', 'Unit'),
                ':harga'     => $harga,
                ':diskon'    => $diskon,
                ':isppn'     => $isPpn ? 1 : 0,
                ':ppn'       => $ppn,
                ':ispph23'   => $isPph23 ? 1 : 0,
                ':pph23'     => $pph23,
                ':pphlainpct'=> $pphLainPct,
                ':pphlain'   => $pphLain,
                ':wototal'   => $woTotal,
                ':id'    => $id,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. WO sudah dipakai WO lain.', 409);
            throw $e;
        }

        log_activity('update', 'work_orders', $id, $woNumber);
        json_success(['id' => $id, 'dpp' => $dpp, 'wo_total' => $woTotal], 'Work Order berhasil diperbarui.');
        break;

    case 'DELETE':
        // Hapus massal: ?ids=1,2,3. WO yang masih punya PR / AR terkait DILEWATI
        // (aturan sama dengan hapus satuan), lalu dilaporkan balik ke user.
        if (!isset($_GET['id'])) {
            $ids = parse_id_list();
            if (!$ids) json_error('Tidak ada data yang dipilih.', 422);
            $ph = implode(',', array_fill(0, count($ids), '?'));

            $blocked = [];
            $q = $pdo->prepare("
                SELECT wo.id, wo.wo_number,
                       (SELECT COUNT(*) FROM pr_items p WHERE p.wo_id = wo.id) AS pr_count,
                       (SELECT COUNT(*) FROM account_receivable a WHERE a.wo_id = wo.id) AS ar_count
                FROM work_orders wo WHERE wo.id IN ($ph)
            ");
            $q->execute($ids);
            $toDelete = [];
            foreach ($q->fetchAll() as $r) {
                if ((int) $r['pr_count'] > 0 || (int) $r['ar_count'] > 0) {
                    $blocked[] = $r['wo_number'] . ((int) $r['pr_count'] > 0 ? ' (ada PR)' : ' (ada AR)');
                } else {
                    $toDelete[] = (int) $r['id'];
                }
            }

            $deleted = 0;
            if ($toDelete) {
                $ph2 = implode(',', array_fill(0, count($toDelete), '?'));
                $pdo->beginTransaction();
                $stmt = $pdo->prepare("DELETE FROM work_orders WHERE id IN ($ph2)");
                $stmt->execute($toDelete);
                $deleted = $stmt->rowCount();
                $pdo->commit();
                log_activity('bulk_delete', 'work_orders', null, 'IDs: ' . implode(',', $toDelete));
            }

            $msg = "$deleted Work Order berhasil dihapus.";
            if ($blocked) $msg .= ' ' . count($blocked) . ' WO dilewati karena masih punya data PR/AR terkait: ' . implode(', ', array_slice($blocked, 0, 10)) . (count($blocked) > 10 ? ', ...' : '') . '.';
            json_success(['deleted' => $deleted, 'skipped' => $blocked], $msg);
        }

        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $check = $pdo->prepare('SELECT COUNT(*) c FROM pr_items WHERE wo_id = :id');
        $check->execute([':id' => $id]);
        if ((int) $check->fetch()['c'] > 0) {
            json_error('WO ini masih punya data PR terkait, tidak bisa dihapus.', 409);
        }

        $checkAr = $pdo->prepare('SELECT COUNT(*) c FROM account_receivable WHERE wo_id = :id');
        $checkAr->execute([':id' => $id]);
        if ((int) $checkAr->fetch()['c'] > 0) {
            json_error('WO ini masih punya data AR (invoice) terkait, tidak bisa dihapus.', 409);
        }

        $stmt = $pdo->prepare('DELETE FROM work_orders WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'work_orders', $id, '');
        json_success([], 'Work Order berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
