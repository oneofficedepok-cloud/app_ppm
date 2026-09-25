<?php
require_once __DIR__ . '/../includes/auth.php';

require_login();

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

        // stok_qty SENGAJA tidak diedit lewat form ini - hanya lewat Riwayat
        // Pergerakan (inventory_movements), supaya saldo selalu bisa ditelusuri asalnya.
        $stmt = $pdo->prepare(
            'UPDATE inventory_items SET sku=:sku, nama=:nama, kategori=:kat, satuan=:satuan,
                harga_satuan=:harga, stok_min=:min, lokasi_rak=:rak, barcode=:barcode, status=:status
             WHERE id = :id'
        );
        try {
            $stmt->execute([
                ':sku'    => arr_val($b, 'sku', ''),
                ':nama'   => arr_val($b, 'nama', ''),
                ':kat'    => arr_val($b, 'kategori', ''),
                ':satuan' => arr_val($b, 'satuan', 'Pcs'),
                ':harga'  => to_float(arr_val($b, 'harga_satuan', 0)),
                ':min'    => to_float(arr_val($b, 'stok_min', 0)),
                ':rak'    => arr_val($b, 'lokasi_rak', ''),
                ':barcode'=> arr_val($b, 'barcode') ?: null,
                ':status' => arr_val($b, 'status', 'AKTIF'),
                ':id'     => $id,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') json_error('SKU atau Barcode sudah dipakai material lain.', 409);
            throw $e;
        }

        log_activity('update', 'inventory_items', $id, '');
        json_success(['id' => $id], 'Data material berhasil diperbarui.');
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
