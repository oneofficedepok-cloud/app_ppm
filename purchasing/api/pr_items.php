<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/pr_functions.php';

$method = http_method();
$pdo = db();

$action = $_GET['action'] ?? '';

if ($method === 'POST' && $action === 'receive') {
    // Penerimaan barang dilakukan tim Gudang (atau Purchasing).
    require_module(['gudang', 'purchasing']);
} else {
    // Baca: Purchasing + modul yang memakai data PR (Incoming/Receiving Gudang,
    // biaya aktual WO di Produksi, Finance). Ubah/approval: modul Purchasing.
    require_module_access(['purchasing', 'gudang', 'produksi', 'finance'], ['purchasing']);
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
                   c.nama  AS customer_nama,
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

        // ============= ALUR APPROVAL: Leader cek =============
        if ($prAction === 'leader_check') {
            $user = require_role(['leader']);
            $b = get_json_input();
            $id = to_int_or_null(arr_val($b, 'id'));
            $decision = arr_val($b, 'decision'); // 'approve' | 'reject'
            $note = clean_str(arr_val($b, 'note', ''));
            if (!$id || !in_array($decision, ['approve', 'reject'], true)) {
                json_error('Data tidak lengkap.', 422);
            }

            $cur = $pdo->prepare('SELECT approval_status FROM pr_items WHERE id = :id');
            $cur->execute([':id' => $id]);
            $row = $cur->fetch();
            if (!$row) json_error('Data PR tidak ditemukan.', 404);
            if ($row['approval_status'] !== 'PENDING_LEADER') {
                json_error('PR ini sudah tidak dalam status menunggu cek Leader (mungkin sudah diproses orang lain).', 409);
            }

            $newStatus = $decision === 'approve' ? 'PENDING_MANAGER' : 'REJECTED';
            $stmt = $pdo->prepare(
                'UPDATE pr_items SET approval_status = :s, leader_id = :uid, leader_checked_at = NOW(), leader_note = :note WHERE id = :id'
            );
            $stmt->execute([':s' => $newStatus, ':uid' => $user['id'], ':note' => $note, ':id' => $id]);

            log_activity($decision === 'approve' ? 'leader_approve' : 'leader_reject', 'pr_items', $id, $note);
            json_success(
                ['id' => $id, 'approval_status' => $newStatus],
                $decision === 'approve' ? 'PR diteruskan ke Manager Purchasing untuk approval final.' : 'PR ditolak di tahap pengecekan Leader.'
            );
        }

        // ============= ALUR APPROVAL: Manager Purchasing approve =============
        if ($prAction === 'manager_approve') {
            $user = require_role(['manager_purchasing']);
            $b = get_json_input();
            $id = to_int_or_null(arr_val($b, 'id'));
            $decision = arr_val($b, 'decision');
            $note = clean_str(arr_val($b, 'note', ''));
            if (!$id || !in_array($decision, ['approve', 'reject'], true)) {
                json_error('Data tidak lengkap.', 422);
            }

            $cur = $pdo->prepare('SELECT approval_status FROM pr_items WHERE id = :id');
            $cur->execute([':id' => $id]);
            $row = $cur->fetch();
            if (!$row) json_error('Data PR tidak ditemukan.', 404);
            if ($row['approval_status'] !== 'PENDING_MANAGER') {
                json_error('PR ini sudah tidak dalam status menunggu approve Manager (mungkin sudah diproses orang lain).', 409);
            }

            $newStatus = $decision === 'approve' ? 'APPROVED' : 'REJECTED';
            $stmt = $pdo->prepare(
                'UPDATE pr_items SET approval_status = :s, manager_id = :uid, manager_approved_at = NOW(), manager_note = :note WHERE id = :id'
            );
            $stmt->execute([':s' => $newStatus, ':uid' => $user['id'], ':note' => $note, ':id' => $id]);

            log_activity($decision === 'approve' ? 'manager_approve' : 'manager_reject', 'pr_items', $id, $note);
            json_success(
                ['id' => $id, 'approval_status' => $newStatus],
                $decision === 'approve' ? 'PR disetujui (APPROVED).' : 'PR ditolak di tahap approval Manager Purchasing.'
            );
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
            json_success(['id' => $id], 'PR dikirim ulang untuk approval dari awal (menunggu cek Leader).');
        }

        // ============= TAMBAH PR BARU (alur normal) =============
        $b = get_json_input();

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
                ':customer_id'    => to_int_or_null(arr_val($b, 'customer_id')),
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

        $qty   = to_float(arr_val($b, 'qty', 0));
        $harga = to_float(arr_val($b, 'harga', 0));
        $isPpn = (bool) arr_val($b, 'is_ppn', false);
        $ppnRate = to_float(arr_val($b, 'ppn_rate', 11));
        [$dpp, $ppnAmount, $total] = calc_ppn($qty, $harga, $isPpn, $ppnRate);

        // Kalau data PR yang SUDAH LEWAT tahap cek Leader diubah oleh bukan-admin,
        // kirim ulang ke antrian review dari awal — supaya tidak ada celah
        // mengubah harga/qty diam-diam setelah disetujui.
        $currentUser = current_user();
        $curStmt = $pdo->prepare('SELECT approval_status FROM pr_items WHERE id = :id');
        $curStmt->execute([':id' => $id]);
        $curRow = $curStmt->fetch();
        if (!$curRow) json_error('Data PR tidak ditemukan.', 404);

        $resetApproval = empty($currentUser['is_admin'])
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
            ':customer_id'    => to_int_or_null(arr_val($b, 'customer_id')),
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
