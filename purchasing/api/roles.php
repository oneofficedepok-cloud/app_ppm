<?php
require_once __DIR__ . '/../includes/auth.php';

require_login(); // GET boleh semua user login (untuk isi dropdown); POST/PUT/DELETE khusus admin di bawah

$method = http_method();
$pdo = db();

switch ($method) {

    case 'GET':
        $stmt = $pdo->query('SELECT * FROM roles ORDER BY is_system DESC, id ASC');
        json_success($stmt->fetchAll());
        break;

    case 'POST':
        require_admin();
        $b = get_json_input();
        $label = clean_str(arr_val($b, 'label', ''));
        if ($label === '') {
            json_error('Nama role wajib diisi.', 422);
        }
        $isAdmin = (bool) arr_val($b, 'is_admin', false);

        // Generate role_key unik dari label, tambahkan angka kalau bentrok.
        $baseKey = slugify($label);
        $key = $baseKey;
        $i = 2;
        $check = $pdo->prepare('SELECT COUNT(*) c FROM roles WHERE role_key = :k');
        while (true) {
            $check->execute([':k' => $key]);
            if ((int) $check->fetch()['c'] === 0) break;
            $key = $baseKey . '_' . $i;
            $i++;
        }

        $stmt = $pdo->prepare(
            'INSERT INTO roles (role_key, label, is_admin, is_system) VALUES (:key, :label, :admin, 0)'
        );
        $stmt->execute([':key' => $key, ':label' => $label, ':admin' => $isAdmin ? 1 : 0]);

        $newId = (int) $pdo->lastInsertId();
        log_activity('create', 'roles', $newId, $label);
        json_success(['id' => $newId, 'role_key' => $key], 'Role berhasil ditambahkan.');
        break;

    case 'PUT':
        require_admin();
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        $label = clean_str(arr_val($b, 'label', ''));
        if (!$id || $label === '') {
            json_error('ID dan nama role wajib diisi.', 422);
        }
        $isAdmin = (bool) arr_val($b, 'is_admin', false);

        // Cari role_key dulu untuk cek proteksi khusus role 'admin'.
        $find = $pdo->prepare('SELECT role_key FROM roles WHERE id = :id');
        $find->execute([':id' => $id]);
        $existing = $find->fetch();
        if (!$existing) {
            json_error('Role tidak ditemukan.', 404);
        }

        // Role sistem 'admin' TIDAK BOLEH kehilangan status akses penuhnya,
        // supaya tidak ada kemungkinan aplikasi kehilangan akses admin sama sekali.
        if ($existing['role_key'] === 'admin') {
            $isAdmin = true;
        }

        $stmt = $pdo->prepare('UPDATE roles SET label = :label, is_admin = :admin WHERE id = :id');
        $stmt->execute([':label' => $label, ':admin' => $isAdmin ? 1 : 0, ':id' => $id]);

        log_activity('update', 'roles', $id, $label);
        json_success(['id' => $id], 'Role berhasil diperbarui.');
        break;

    case 'DELETE':
        require_admin();
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        $find = $pdo->prepare('SELECT role_key, is_system FROM roles WHERE id = :id');
        $find->execute([':id' => $id]);
        $role = $find->fetch();
        if (!$role) {
            json_error('Role tidak ditemukan.', 404);
        }
        if ((int) $role['is_system'] === 1) {
            json_error('Role bawaan sistem ini tidak bisa dihapus.', 409);
        }

        $check = $pdo->prepare('SELECT COUNT(*) c FROM users WHERE role = :key');
        $check->execute([':key' => $role['role_key']]);
        if ((int) $check->fetch()['c'] > 0) {
            json_error('Role ini masih dipakai oleh salah satu user. Pindahkan usernya ke role lain dulu sebelum menghapus.', 409);
        }

        $stmt = $pdo->prepare('DELETE FROM roles WHERE id = :id');
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'roles', $id, $role['role_key']);
        json_success([], 'Role berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
