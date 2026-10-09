<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/pr_functions.php';

$method = http_method();
$pdo = db();

/** Kolom PR yang diisi PEMBUAT PR (user peminta). Hanya pembuat PR (atau Admin) yang boleh mengubah. */
const PR_REQUESTER_FIELDS = ['sheet', 'tanggal', 'pr_number', 'item_no', 'wo_id', 'project', 'product', 'type', 'dimensi',
    'brand', 'qty', 'uom', 'karyawan_id', 'atasan_karyawan_id', 'manager_karyawan_id', 'divisi'];
/** Kolom PR yang diisi STAFF PURCHASING (izin "Proses PR"). Pembuat PR tidak bisa mengisi bagian ini. */
const PR_PURCHASING_FIELDS = ['harga', 'is_ppn', 'ppn_rate', 'po_number', 'invoice_number', 'supplier_id', 'tgl_beli',
    'tgl_datang', 'penerima_barang', 'status', 'buyer_id', 'lampiran', 'keterangan'];

function can_proses_pr(array $user): bool
{
    return !empty($user['is_admin']) || user_level($user, 'cap_pr_proses') >= PERM_VIEW;
}

/**
 * Terapkan aturan siapa-mengisi-apa ke input PR (seperti ERP):
 * - PR baru: pembuat = user login; bagian Purchasing hanya terisi kalau user punya izin Proses PR.
 * - Edit: bagian pembuat hanya oleh pembuat PR / Admin, bagian Purchasing hanya oleh Staff Purchasing / Admin.
 *   Bagian yang tidak boleh diubah diambil dari data lama (input dari browser diabaikan).
 * Return [$b, $requesterChanged].
 */
function pr_apply_field_rules(array $b, array $user, ?array $row): array
{
    $isAdmin = !empty($user['is_admin']);
    $canPur = can_proses_pr($user);
    if ($row === null) {
        $b['user_id'] = (int) $user['id'];
        if (trim((string) ($b['divisi'] ?? '')) === '') $b['divisi'] = $user['divisi'] ?? ''; // divisi pembuat PR
        if (!$canPur) {
            foreach (PR_PURCHASING_FIELDS as $f) $b[$f] = null;
            $b['status'] = 'ON PROSES';
            $b['ppn_rate'] = 11;
        }
        return [$b, true];
    }
    $isCreator = $row['user_id'] !== null && (int) $row['user_id'] === (int) $user['id'];
    $canReq = $isAdmin || $isCreator;
    if (!$canReq && !$canPur) {
        json_error('PR ini hanya bisa diubah oleh pembuatnya atau Staff Purchasing. Hubungi Admin bila perlu.', 403);
    }
    $changed = false;
    foreach (PR_REQUESTER_FIELDS as $f) {
        if (!$canReq) { $b[$f] = $row[$f]; continue; }
        if ((string) ($b[$f] ?? '') !== (string) ($row[$f] ?? '') && !in_array($f, ['qty'], true)) $changed = true;
        if ($f === 'qty' && abs((float) ($b[$f] ?? 0) - (float) $row[$f]) > 0.0005) $changed = true;
    }
    if (!$canPur) foreach (PR_PURCHASING_FIELDS as $f) $b[$f] = $row[$f];
    $b['user_id'] = $row['user_id'] ?? ($isCreator ? (int) $user['id'] : null); // pembuat PR tidak pernah berubah
    return [$b, $changed];
}

/**
 * Customer PR selalu mengikuti WO yang dipilih (kolom "Nama Customer (Auto)" di form).
 * Tanpa WO: pakai customer_id yang dikirim, atau (saat edit) pertahankan yang lama.
 */
function pr_customer_id(PDO $pdo, array $b, ?int $existingId = null): ?int
{
    $woId = to_int_or_null(arr_val($b, 'wo_id'));
    if ($woId) {
        $stmt = $pdo->prepare('SELECT customer_id FROM work_orders WHERE id = :id');
        $stmt->execute([':id' => $woId]);
        $cust = $stmt->fetchColumn();
        if ($cust !== false) return $cust !== null ? (int) $cust : null;
    }
    $sent = to_int_or_null(arr_val($b, 'customer_id'));
    if ($sent) return $sent;
    if ($existingId === null) return null;
    $stmt = $pdo->prepare('SELECT customer_id FROM pr_items WHERE id = :id');
    $stmt->execute([':id' => $existingId]);
    $cur = $stmt->fetchColumn();
    return $cur ? (int) $cur : null;
}

$action = $_GET['action'] ?? '';

if ($method === 'POST' && $action === 'receive') {
    // Penerimaan barang dilakukan tim Gudang dari menu Incoming / Receiving Goods.
    require_edit(['incoming', 'receiving']);
} elseif ($method === 'POST' && in_array($action, ['leader_check', 'manager_approve', 'bulk_approve'], true)) {
    // Approval PR: cukup boleh MELIHAT menu PR + punya izin approval (dicek di handler-nya),
    // jadi Supervisor / Manager Produksi tidak perlu hak ubah data PR.
    require_view(['dashboard']);
} elseif ($method === 'PUT' && can_view(current_user(), ['dashboard']) && can_proses_pr(current_user())) {
    // Staff / Manager Purchasing cukup boleh MELIHAT menu PR untuk memproses PR;
    // kolom yang boleh diubah dibatasi pr_apply_field_rules() (hanya bagian Purchasing).
} else {
    // Baca: menu PR + menu yang memakai data PR (Incoming/Receiving Gudang,
    // biaya aktual WO, Finance Dashboard). Ubah & approval: menu PR.
    require_perm(['dashboard', 'incoming', 'receiving', 'tracking', 'findash'], ['dashboard']);
}

// ---------------------------------------------------------
// action=receive : PR berstatus STORE ROOM diterima tim Gudang -
// otomatis menambah/membuat Master Stok Gudang & catat movement IN,
// lalu status PR berubah jadi RECEIVED (masuk daftar Receiving Goods).
// ---------------------------------------------------------
if ($method === 'POST' && $action === 'receive') {
    $b = get_json_input();
    $id = to_int_or_null(arr_val($b, 'id'));
    if (!$id) json_error('ID wajib diisi.', 422);

    $stmt = $pdo->prepare('SELECT * FROM pr_items WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $pr = $stmt->fetch();
    if (!$pr) json_error('Data PR tidak ditemukan.', 404);
    if ($pr['status'] !== 'STORE ROOM') json_error('PR ini belum berstatus STORE ROOM - tidak bisa diterima.', 422);

    $penerima = clean_str(arr_val($b, 'penerima_barang', '')) ?: $pr['penerima_barang'];
    $user = current_user();

    $pdo->beginTransaction();
    try {
        // Cari Master Stok Gudang dengan nama sama persis; kalau belum ada, buat baru otomatis.
        $itemStmt = $pdo->prepare('SELECT id, stok_qty FROM inventory_items WHERE nama = :n LIMIT 1');
        $itemStmt->execute([':n' => $pr['product']]);
        $item = $itemStmt->fetch();

        if ($item) {
            $itemId = (int) $item['id'];
            $currentStok = (float) $item['stok_qty'];
        } else {
            $cnt = (int) $pdo->query('SELECT COUNT(*) FROM inventory_items')->fetchColumn();
            $sku = 'MAT-' . str_pad((string) ($cnt + 1), 4, '0', STR_PAD_LEFT);
            $ins = $pdo->prepare(
                "INSERT INTO inventory_items (sku, nama, satuan, harga_satuan, stok_qty, stok_min, status)
                 VALUES (:sku, :nama, :satuan, :harga, 0, 0, 'AKTIF')"
            );
            $ins->execute([':sku' => $sku, ':nama' => $pr['product'], ':satuan' => $pr['uom'] ?: 'Pcs', ':harga' => $pr['harga']]);
            $itemId = (int) $pdo->lastInsertId();
            $currentStok = 0.0;
        }

        $newStok = $currentStok + (float) $pr['qty'];
        $pdo->prepare('UPDATE inventory_items SET stok_qty = :s, harga_satuan = :h WHERE id = :id')
            ->execute([':s' => $newStok, ':h' => $pr['harga'], ':id' => $itemId]);

        $mv = $pdo->prepare(
            "INSERT INTO inventory_movements (item_id, tanggal, tipe, qty, harga_satuan, sumber, ref_pr_id, wo_id, keterangan, user_id)
             VALUES (:item, CURDATE(), 'IN', :qty, :harga, 'PEMBELIAN', :prid, :wo, :ket, :uid)"
        );
        $mv->execute([
            ':item' => $itemId, ':qty' => $pr['qty'], ':harga' => $pr['harga'], ':prid' => $id,
            ':wo' => $pr['wo_id'], ':ket' => "Diterima dari PR {$pr['pr_number']} item #{$pr['item_no']}", ':uid' => $user['id'] ?? null,
        ]);

        $upd = $pdo->prepare(
            "UPDATE pr_items SET status = 'RECEIVED', tgl_datang = COALESCE(tgl_datang, CURDATE()), penerima_barang = :pen WHERE id = :id"
        );
        $upd->execute([':pen' => $penerima, ':id' => $id]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    log_activity('receive', 'pr_items', $id, "Diterima -> stok Gudang item#{$itemId}");
    json_success(['inventory_item_id' => $itemId], 'Barang berhasil diterima & Stok Gudang otomatis diperbarui.');
    exit;
}

switch ($method) {

    case 'GET':
        if (isset($_GET['action']) && $_GET['action'] === 'generate_pr_number') {
            $sheet = in_array($_GET['sheet'] ?? '', PR_SHEET_VALUES, true) ? $_GET['sheet'] : 'PROJECT';
            json_success(['pr_number' => generate_pr_number($pdo, $sheet)]);
        }

        $sql = "
            SELECT pr.*,
                   COALESCE(cw.nama, c.nama) AS customer_nama,
                   s.nama  AS supplier_nama,
                   wo.wo_number AS wo_number,
                   b.nama  AS buyer_nama,
                   u.full_name AS user_nama,
                   ul.full_name AS leader_nama,
                   um.full_name AS manager_nama,
                   k.nama  AS karyawan_nama, k.divisi AS karyawan_divisi,
                   ka.nama AS atasan_karyawan_nama,
                   km.nama AS manager_karyawan_nama
            FROM pr_items pr
            LEFT JOIN customers c ON c.id = pr.customer_id
            LEFT JOIN suppliers s ON s.id = pr.supplier_id
            LEFT JOIN work_orders wo ON wo.id = pr.wo_id
            LEFT JOIN customers cw ON cw.id = wo.customer_id
            LEFT JOIN master_buyers b ON b.id = pr.buyer_id
            LEFT JOIN users u ON u.id = pr.user_id
            LEFT JOIN users ul ON ul.id = pr.leader_id
            LEFT JOIN users um ON um.id = pr.manager_id
            LEFT JOIN master_karyawan k  ON k.id = pr.karyawan_id
            LEFT JOIN master_karyawan ka ON ka.id = pr.atasan_karyawan_id
            LEFT JOIN master_karyawan km ON km.id = pr.manager_karyawan_id
            ORDER BY pr.tanggal DESC, pr.id DESC
        ";
        json_success($pdo->query($sql)->fetchAll());
        break;

    case 'POST':
        $prAction = $_GET['action'] ?? '';

        // ============= ALUR APPROVAL: Supervisor (tahap 1) -> Manager Produksi (tahap 2/final) =============
        // Siapa yang boleh approve diatur Admin lewat Role Management (izin khusus
        // cap_pr_approve_spv / cap_pr_approve_mgr), bukan nama role yang ditanam di kode.
        // Kolom DB tetap leader_* / manager_* dan status PENDING_LEADER / PENDING_MANAGER.
        if (in_array($prAction, ['leader_check', 'manager_approve', 'bulk_approve'], true)) {
            $user = require_login();
            $canSpv = user_level($user, 'cap_pr_approve_spv') >= PERM_VIEW;
            $canMgr = user_level($user, 'cap_pr_approve_mgr') >= PERM_VIEW;
            $b = get_json_input();
            $decision = arr_val($b, 'decision'); // 'approve' | 'reject'
            $note = clean_str(arr_val($b, 'note', ''));
            if (!in_array($decision, ['approve', 'reject'], true)) json_error('Data tidak lengkap.', 422);

            /** Proses 1 PR sesuai tahapnya. Return status baru, atau null kalau user tidak berhak / status sudah berubah. */
            $decide = function (int $id, ?string $onlyStage) use ($pdo, $user, $canSpv, $canMgr, $decision, $note): ?string {
                $cur = $pdo->prepare('SELECT approval_status FROM pr_items WHERE id = :id FOR UPDATE');
                $cur->execute([':id' => $id]);
                $status = $cur->fetchColumn();
                if ($status === 'PENDING_LEADER' && $canSpv && $onlyStage !== 'manager_approve') {
                    $new = $decision === 'approve' ? 'PENDING_MANAGER' : 'REJECTED';
                    $pdo->prepare('UPDATE pr_items SET approval_status = :s, leader_id = :uid, leader_checked_at = NOW(), leader_note = :note WHERE id = :id')
                        ->execute([':s' => $new, ':uid' => $user['id'], ':note' => $note, ':id' => $id]);
                    log_activity($decision === 'approve' ? 'spv_approve' : 'spv_reject', 'pr_items', $id, $note);
                    return $new;
                }
                if ($status === 'PENDING_MANAGER' && $canMgr && $onlyStage !== 'leader_check') {
                    $new = $decision === 'approve' ? 'APPROVED' : 'REJECTED';
                    $pdo->prepare('UPDATE pr_items SET approval_status = :s, manager_id = :uid, manager_approved_at = NOW(), manager_note = :note WHERE id = :id')
                        ->execute([':s' => $new, ':uid' => $user['id'], ':note' => $note, ':id' => $id]);
                    log_activity($decision === 'approve' ? 'mgr_approve' : 'mgr_reject', 'pr_items', $id, $note);
                    return $new;
                }
                return null;
            };

            if ($prAction === 'bulk_approve') {
                // Approval massal: hanya PR yang memang menunggu tahap milik user ini yang diproses
                // (1 tahap per klik - PR dari Supervisor tetap harus dicek Manager Produksi).
                if (!$canSpv && !$canMgr) json_error('Role Anda tidak punya izin approval PR. Hubungi admin.', 403);
                $ids = array_values(array_unique(array_filter(array_map('intval', (array) arr_val($b, 'ids', [])), fn($v) => $v > 0)));
                if (!$ids) json_error('Tidak ada PR yang dipilih.', 422);
                if (count($ids) > 500) json_error('Maksimal 500 PR sekali proses.', 422);
                $done = 0; $skipped = 0;
                $pdo->beginTransaction();
                try {
                    foreach ($ids as $id) { if ($decide($id, null) !== null) $done++; else $skipped++; }
                    $pdo->commit();
                } catch (Throwable $e) {
                    $pdo->rollBack();
                    throw $e;
                }
                $verb = $decision === 'approve' ? 'disetujui' : 'ditolak';
                json_success(['processed' => $done, 'skipped' => $skipped],
                    "$done PR $verb." . ($skipped ? " $skipped PR dilewati (bukan tahap approval Anda / sudah diproses)." : ''));
            }

            $id = to_int_or_null(arr_val($b, 'id'));
            if (!$id) json_error('Data tidak lengkap.', 422);
            $exists = $pdo->prepare('SELECT approval_status FROM pr_items WHERE id = :id');
            $exists->execute([':id' => $id]);
            $status = $exists->fetchColumn();
            if ($status === false) json_error('Data PR tidak ditemukan.', 404);
            $needed = $prAction === 'leader_check' ? ['PENDING_LEADER', $canSpv, 'Supervisor'] : ['PENDING_MANAGER', $canMgr, 'Manager Produksi'];
            if (!$needed[1]) json_error("Role Anda tidak punya izin approval tahap {$needed[2]}. Hubungi admin.", 403);
            if ($status !== $needed[0]) json_error("PR ini sudah tidak menunggu approval {$needed[2]} (mungkin sudah diproses orang lain).", 409);

            $pdo->beginTransaction();
            $new = $decide($id, $prAction);
            $pdo->commit();
            $msg = [
                'PENDING_MANAGER' => 'PR diteruskan ke Manager Produksi untuk approval final.',
                'APPROVED' => 'PR disetujui (APPROVED).',
                'REJECTED' => "PR ditolak di tahap {$needed[2]}.",
            ][$new] ?? 'Tersimpan.';
            json_success(['id' => $id, 'approval_status' => $new], $msg);
        }

        // ============= ALUR APPROVAL: Kirim ulang PR yang ditolak =============
        if ($prAction === 'resubmit') {
            require_login();
            $b = get_json_input();
            $id = to_int_or_null(arr_val($b, 'id'));
            if (!$id) json_error('ID wajib diisi.', 422);

            $cur = $pdo->prepare('SELECT approval_status FROM pr_items WHERE id = :id');
            $cur->execute([':id' => $id]);
            $row = $cur->fetch();
            if (!$row) json_error('Data PR tidak ditemukan.', 404);
            if ($row['approval_status'] !== 'REJECTED') {
                json_error('Hanya PR berstatus Ditolak yang bisa dikirim ulang.', 409);
            }

            $stmt = $pdo->prepare(
                "UPDATE pr_items SET approval_status = 'PENDING_LEADER',
                    leader_id = NULL, leader_checked_at = NULL, leader_note = NULL,
                    manager_id = NULL, manager_approved_at = NULL, manager_note = NULL
                 WHERE id = :id"
            );
            $stmt->execute([':id' => $id]);

            log_activity('resubmit', 'pr_items', $id, '');
            json_success(['id' => $id], 'PR dikirim ulang untuk approval dari awal (menunggu Supervisor).');
        }

        // ============= TAMBAH PR BARU (alur normal) =============
        $b = get_json_input();
        [$b] = pr_apply_field_rules($b, current_user(), null);

        $prNumber = clean_str(arr_val($b, 'pr_number', ''));
        $tanggal  = arr_val($b, 'tanggal');
        if ($prNumber === '' || !$tanggal) {
            json_error('No. PR dan Tanggal PR wajib diisi.', 422);
        }

        $qty   = to_float(arr_val($b, 'qty', 0));
        $harga = to_float(arr_val($b, 'harga', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', false);
        $ppnRate = to_float(arr_val($b, 'ppn_rate', 11));
        [$dpp, $ppnAmount, $total] = calc_ppn($qty, $harga, $isPpn, $ppnRate);

        $stmt = $pdo->prepare(
            'INSERT INTO pr_items
             (sheet, tanggal, pr_number, item_no, customer_id, project, wo_id, product, type, dimensi, brand,
              qty, uom, harga, is_ppn, ppn_rate, ppn_amount, dpp, total, supplier_id, tgl_beli, tgl_datang, penerima_barang,
              po_number, invoice_number, buyer_id, user_id, karyawan_id, atasan_karyawan_id, manager_karyawan_id,
              divisi, status, lampiran, keterangan, approval_status)
             VALUES
             (:sheet, :tanggal, :pr_number, :item_no, :customer_id, :project, :wo_id, :product, :type, :dimensi, :brand,
              :qty, :uom, :harga, :is_ppn, :ppn_rate, :ppn_amount, :dpp, :total, :supplier_id, :tgl_beli, :tgl_datang, :penerima,
              :po_number, :invoice_number, :buyer_id, :user_id, :karyawan_id, :atasan_karyawan_id, :manager_karyawan_id,
              :divisi, :status, :lampiran, :keterangan, :approval_status)'
        );

        try {
            $stmt->execute([
                ':sheet'          => in_array(arr_val($b, 'sheet'), PR_SHEET_VALUES, true) ? arr_val($b, 'sheet') : 'PROJECT',
                ':tanggal'        => $tanggal,
                ':pr_number'      => $prNumber,
                ':item_no'        => (int) to_float(arr_val($b, 'item_no', 1)),
                ':customer_id'    => pr_customer_id($pdo, $b),
                ':project'        => arr_val($b, 'project', ''),
                ':wo_id'          => to_int_or_null(arr_val($b, 'wo_id')),
                ':product'        => arr_val($b, 'product', ''),
                ':type'           => arr_val($b, 'type', ''),
                ':dimensi'        => arr_val($b, 'dimensi', ''),
                ':brand'          => arr_val($b, 'brand', ''),
                ':qty'            => $qty,
                ':uom'            => arr_val($b, 'uom', ''),
                ':harga'          => $harga,
                ':is_ppn'         => $isPpn ? 1 : 0,
                ':ppn_rate'       => $ppnRate,
                ':ppn_amount'     => $ppnAmount,
                ':dpp'            => $dpp,
                ':total'          => $total,
                ':supplier_id'    => to_int_or_null(arr_val($b, 'supplier_id')),
                ':tgl_beli'       => arr_val($b, 'tgl_beli') ?: null,
                ':tgl_datang'     => arr_val($b, 'tgl_datang') ?: null,
                ':penerima'       => arr_val($b, 'penerima_barang', ''),
                ':po_number'      => arr_val($b, 'po_number', ''),
                ':invoice_number' => arr_val($b, 'invoice_number', ''),
                ':buyer_id'       => to_int_or_null(arr_val($b, 'buyer_id')),
                ':user_id'        => to_int_or_null(arr_val($b, 'user_id')),
                ':karyawan_id'    => to_int_or_null(arr_val($b, 'karyawan_id')),
                ':atasan_karyawan_id'  => to_int_or_null(arr_val($b, 'atasan_karyawan_id')),
                ':manager_karyawan_id' => to_int_or_null(arr_val($b, 'manager_karyawan_id')),
                ':divisi'         => arr_val($b, 'divisi', ''),
                ':status'         => in_array(arr_val($b, 'status'), ['RECEIVED','PO ISSUED','ON PROSES','STORE ROOM','CANCEL'], true) ? arr_val($b, 'status') : 'ON PROSES',
                ':lampiran'       => arr_val($b, 'lampiran', ''),
                ':keterangan'     => arr_val($b, 'keterangan', ''),
                ':approval_status' => 'PENDING_LEADER', // setiap PR baru otomatis masuk antrian cek Leader
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('No. PR ini sudah pernah dipakai untuk item lain dengan No. Item yang sama.', 409);
            throw $e;
        }

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'pr_items', $newId, $prNumber);
        json_success(['id' => $newId, 'dpp' => $dpp, 'ppn_amount' => $ppnAmount, 'total' => $total], 'PR berhasil ditambahkan, menunggu cek Leader.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $prNumber = clean_str(arr_val($b, 'pr_number', ''));
        if (!$id || $prNumber === '') {
            json_error('ID dan No. PR wajib diisi.', 422);
        }

        $currentUser = current_user();
        $curStmt = $pdo->prepare('SELECT * FROM pr_items WHERE id = :id');
        $curStmt->execute([':id' => $id]);
        $curRow = $curStmt->fetch();
        if (!$curRow) json_error('Data PR tidak ditemukan.', 404);

        // Bagian pembuat vs bagian Purchasing (yang tidak boleh diubah user ini diambil dari data lama).
        [$b, $requesterChanged] = pr_apply_field_rules($b, $currentUser, $curRow);
        $prNumber = clean_str(arr_val($b, 'pr_number', ''));

        $qty   = to_float(arr_val($b, 'qty', 0));
        $harga = to_float(arr_val($b, 'harga', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', false);
        $ppnRate = to_float(arr_val($b, 'ppn_rate', 11));
        [$dpp, $ppnAmount, $total] = calc_ppn($qty, $harga, $isPpn, $ppnRate);

        // Kalau isi permintaan barang (produk/qty/dll.) diubah setelah PR lewat tahap Supervisor
        // oleh bukan-admin, PR dikirim ulang untuk approval dari awal. Staff Purchasing yang
        // mengisi harga / PO / status TIDAK mereset approval.
        $resetApproval = empty($currentUser['is_admin']) && $requesterChanged
            && in_array($curRow['approval_status'], ['PENDING_MANAGER', 'APPROVED', 'REJECTED'], true);

        $sql = 'UPDATE pr_items SET
                sheet = :sheet, tanggal = :tanggal, pr_number = :pr_number, item_no = :item_no,
                customer_id = :customer_id, project = :project, wo_id = :wo_id, product = :product,
                type = :type, dimensi = :dimensi, brand = :brand, qty = :qty, uom = :uom, harga = :harga,
                is_ppn = :is_ppn, ppn_rate = :ppn_rate, ppn_amount = :ppn_amount, dpp = :dpp, total = :total,
                supplier_id = :supplier_id, tgl_beli = :tgl_beli, tgl_datang = :tgl_datang, penerima_barang = :penerima,
                po_number = :po_number, invoice_number = :invoice_number, buyer_id = :buyer_id,
                user_id = :user_id, karyawan_id = :karyawan_id, atasan_karyawan_id = :atasan_karyawan_id,
                manager_karyawan_id = :manager_karyawan_id,
                divisi = :divisi, status = :status, lampiran = :lampiran, keterangan = :keterangan';
        if ($resetApproval) {
            $sql .= ", approval_status = 'PENDING_LEADER',
                leader_id = NULL, leader_checked_at = NULL, leader_note = NULL,
                manager_id = NULL, manager_approved_at = NULL, manager_note = NULL";
        }
        $sql .= ' WHERE id = :id';
        $stmt = $pdo->prepare($sql);

        $stmt->execute([
            ':sheet'          => in_array(arr_val($b, 'sheet'), PR_SHEET_VALUES, true) ? arr_val($b, 'sheet') : 'PROJECT',
            ':tanggal'        => arr_val($b, 'tanggal'),
            ':pr_number'      => $prNumber,
            ':item_no'        => (int) to_float(arr_val($b, 'item_no', 1)),
            ':customer_id'    => pr_customer_id($pdo, $b, $id),
            ':project'        => arr_val($b, 'project', ''),
            ':wo_id'          => to_int_or_null(arr_val($b, 'wo_id')),
            ':product'        => arr_val($b, 'product', ''),
            ':type'           => arr_val($b, 'type', ''),
            ':dimensi'        => arr_val($b, 'dimensi', ''),
            ':brand'          => arr_val($b, 'brand', ''),
            ':qty'            => $qty,
            ':uom'            => arr_val($b, 'uom', ''),
            ':harga'          => $harga,
            ':is_ppn'         => $isPpn ? 1 : 0,
            ':ppn_rate'       => $ppnRate,
            ':ppn_amount'     => $ppnAmount,
            ':dpp'            => $dpp,
            ':total'          => $total,
            ':supplier_id'    => to_int_or_null(arr_val($b, 'supplier_id')),
            ':tgl_beli'       => arr_val($b, 'tgl_beli') ?: null,
            ':tgl_datang'     => arr_val($b, 'tgl_datang') ?: null,
            ':penerima'       => arr_val($b, 'penerima_barang', ''),
            ':po_number'      => arr_val($b, 'po_number', ''),
            ':invoice_number' => arr_val($b, 'invoice_number', ''),
            ':buyer_id'       => to_int_or_null(arr_val($b, 'buyer_id')),
            ':user_id'        => to_int_or_null(arr_val($b, 'user_id')),
            ':karyawan_id'    => to_int_or_null(arr_val($b, 'karyawan_id')),
            ':atasan_karyawan_id'  => to_int_or_null(arr_val($b, 'atasan_karyawan_id')),
            ':manager_karyawan_id' => to_int_or_null(arr_val($b, 'manager_karyawan_id')),
            ':divisi'         => arr_val($b, 'divisi', ''),
            ':status'         => in_array(arr_val($b, 'status'), ['RECEIVED','PO ISSUED','ON PROSES','STORE ROOM','CANCEL'], true) ? arr_val($b, 'status') : 'ON PROSES',
            ':lampiran'       => arr_val($b, 'lampiran', ''),
            ':keterangan'     => arr_val($b, 'keterangan', ''),
            ':id'             => $id,
        ]);

        log_activity('update', 'pr_items', $id, $prNumber);
        $msg = 'PR berhasil diperbarui.';
        if ($resetApproval) $msg .= ' Karena datanya sudah pernah diproses, PR ini otomatis dikirim ulang untuk approval dari awal.';
        json_success(['id' => $id, 'dpp' => $dpp, 'ppn_amount' => $ppnAmount, 'total' => $total], $msg);
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $stmt = $pdo->prepare('DELETE FROM pr_items WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'pr_items', $id, '');
        json_success([], 'PR berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
