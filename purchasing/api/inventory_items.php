<?php
require_once __DIR__ . '/../includes/auth.php';

// Baca: menu-menu Gudang + WO. Ubah: menu Stok Material.
require_perm(['stok', 'receiving', 'produksi', 'riwayat', 'tracking'], ['stok']);

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        // low_stock=1 -> hanya item yang stok_qty <= stok_min (dipakai untuk alert/badge)
        $sql = "SELECT * FROM inventory_items";
        if (!empty($_GET['low_stock'])) {
            $sql .= " WHERE stok_qty <= stok_min";
        }
        $sql .= " ORDER BY nama ASC";
        json_success($pdo->query($sql)->fetchAll());
        break;

    case 'POST':
        $b = get_json_input();
        $nama = arr_val($b, 'nama', '');
        if ($nama === '') json_error('Nama material wajib diisi.', 422);

        $sku = arr_val($b, 'sku', '');
        if ($sku === '') json_error('SKU wajib diisi.', 422);

        $stmt = $pdo->prepare(
            'INSERT INTO inventory_items (sku, nama, kategori, satuan, harga_satuan, stok_qty, stok_min, lokasi_rak, barcode, status)
             VALUES (:sku, :nama, :kat, :satuan, :harga, :stok, :min, :rak, :barcode, :status)'
        );
        try {
            $stmt->execute([
                ':sku'     => $sku,
                ':nama'    => $nama,
                ':kat'     => arr_val($b, 'kategori', ''),
                ':satuan'  => arr_val($b, 'satuan', 'Pcs'),
                ':harga'   => to_float(arr_val($b, 'harga_satuan', 0)),
                // stok_qty awal boleh diisi (mis. saldo opening balance saat setup pertama kali)
                ':stok'    => to_float(arr_val($b, 'stok_qty', 0)),
                ':min'     => to_float(arr_val($b, 'stok_min', 0)),
                ':rak'     => arr_val($b, 'lokasi_rak', ''),
                ':barcode' => arr_val($b, 'barcode') ?: null,
                ':status'  => arr_val($b, 'status', 'AKTIF'),
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('SKU atau Barcode sudah dipakai material lain.', 409);
            throw $e;
        }

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'inventory_items', $newId, $nama);
        json_success(['id' => $newId], 'Material baru berhasil ditambahkan ke Gudang.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        if (!$id) json_error('ID wajib diisi.', 422);

        // Koreksi stok lewat form Edit: KHUSUS ADMIN. Stok tidak ditimpa diam-diam -
        // selisihnya dicatat sebagai pergerakan ADJUSTMENT (sumber OPNAME) di Riwayat
        // Pergerakan, supaya saldo tetap bisa ditelusuri asalnya.
        $user = current_user();
        $wantStok = array_key_exists('stok_qty', $b) && $b['stok_qty'] !== '' && $b['stok_qty'] !== null;
        $newStok = $wantStok ? to_float($b['stok_qty']) : null;
        if ($wantStok && $newStok < 0) json_error('Stok tidak boleh negatif.', 422);

        $pdo->beginTransaction();
        try {
            $cur = $pdo->prepare('SELECT stok_qty, harga_satuan, satuan FROM inventory_items WHERE id = :id FOR UPDATE');
            $cur->execute([':id' => $id]);
            $row = $cur->fetch();
            if (!$row) {
                $pdo->rollBack();
                json_error('Material tidak ditemukan.', 404);
            }

            $stmt = $pdo->prepare(
                'UPDATE inventory_items SET sku=:sku, nama=:nama, kategori=:kat, satuan=:satuan,
                    harga_satuan=:harga, stok_min=:min, lokasi_rak=:rak, barcode=:barcode, status=:status
                 WHERE id = :id'
            );
            $harga = to_float(arr_val($b, 'harga_satuan', 0));
            $stmt->execute([
                ':sku'    => arr_val($b, 'sku', ''),
                ':nama'   => arr_val($b, 'nama', ''),
                ':kat'    => arr_val($b, 'kategori', ''),
                ':satuan' => arr_val($b, 'satuan', 'Pcs'),
                ':harga'  => $harga,
                ':min'    => to_float(arr_val($b, 'stok_min', 0)),
                ':rak'    => arr_val($b, 'lokasi_rak', ''),
                ':barcode'=> arr_val($b, 'barcode') ?: null,
                ':status' => arr_val($b, 'status', 'AKTIF'),
                ':id'     => $id,
            ]);

            $oldStok = (float) $row['stok_qty'];
            $delta = $wantStok ? round($newStok - $oldStok, 3) : 0.0;
            if ($delta != 0.0) {
                if (empty($user['is_admin'])) {
                    $pdo->rollBack();
                    json_error('Hanya admin yang boleh mengoreksi stok lewat form Edit Material. Gunakan Riwayat Pergerakan untuk mencatat barang masuk/keluar.', 403);
                }
                $fmt = fn($n) => rtrim(rtrim(number_format($n, 3, ',', '.'), '0'), ',');
                $pdo->prepare(
                    "INSERT INTO inventory_movements (item_id, tanggal, tipe, qty, harga_satuan, sumber, keterangan, user_id)
                     VALUES (:item, CURDATE(), 'ADJUSTMENT', :qty, :harga, 'OPNAME', :ket, :uid)"
                )->execute([
                    ':item' => $id, ':qty' => $delta, ':harga' => $harga ?: $row['harga_satuan'],
                    ':ket' => 'Koreksi stok oleh admin lewat Edit Material: ' . $fmt($oldStok) . ' -> ' . $fmt($newStok) . ' ' . $row['satuan'],
                    ':uid' => $user['id'] ?? null,
                ]);
                $pdo->prepare('UPDATE inventory_items SET stok_qty = :s WHERE id = :id')->execute([':s' => $newStok, ':id' => $id]);
            }
            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($e->getCode() === '23000') json_error('SKU atau Barcode sudah dipakai material lain.', 409);
            throw $e;
        }

        if ($delta != 0.0) {
            log_activity('stock_adjust', 'inventory_items', $id, "stok {$oldStok} -> {$newStok}");
        }
        log_activity('update', 'inventory_items', $id, '');
        json_success(['id' => $id], $delta != 0.0
            ? 'Data material diperbarui. Koreksi stok dicatat di Riwayat Pergerakan.'
            : 'Data material berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        // Cegah hapus material yang masih punya saldo stok, supaya nilai
        // inventaris tidak hilang diam-diam - harus di-nolkan dulu lewat
        // Riwayat Pergerakan (movement ADJUSTMENT) baru boleh dihapus.
        $chk = $pdo->prepare('SELECT stok_qty FROM inventory_items WHERE id = :id');
        $chk->execute([':id' => $id]);
        $row = $chk->fetch();
        if ($row && abs((float) $row['stok_qty']) > 0.0001) {
            json_error('Material masih punya saldo stok (' . $row['stok_qty'] . '). Nolkan dulu lewat Riwayat Pergerakan sebelum menghapus.', 409);
        }

        $stmt = $pdo->prepare('DELETE FROM inventory_items WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'inventory_items', $id, '');
        json_success([], 'Material berhasil dihapus dari Gudang.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
