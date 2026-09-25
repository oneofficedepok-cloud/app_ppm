<?php
require_once __DIR__ . '/../includes/auth.php';

$type = $_GET['type'] ?? '';
if ($type === 'users') {
    // Daftar akun login + role hanya untuk admin. Pengecualian: user boleh
    // mengubah data akunnya sendiri (nama/password) lewat PUT - dicek di bawah.
    http_method() === 'PUT' ? require_login() : require_admin();
} else {
    // Product/Buyer/Karyawan: baca = semua user login (dropdown), ubah = modul Master Data.
    require_module_access(null, ['masterdata']);
}

/** Cek apakah role_key benar-benar ada di tabel roles (validasi dinamis, bukan hardcode). */
function role_key_exists(PDO $pdo, ?string $key): bool
{
    if (!$key) return false;
    $stmt = $pdo->prepare('SELECT COUNT(*) c FROM roles WHERE role_key = :k');
    $stmt->execute([':k' => $key]);
    return (int) $stmt->fetch()['c'] > 0;
}

/**
 * Hitung berapa user AKTIF yang punya role dengan akses admin penuh,
 * opsional kecualikan satu user id (dipakai untuk cek "seandainya user
 * ini diubah/dihapus, apa masih ada admin aktif lain yang tersisa?").
 * Ini mencegah admin tidak sengaja mengunci semua orang dari sistem.
 */
function count_active_admins(PDO $pdo, ?int $excludeUserId = null): int
{
    $sql = "SELECT COUNT(*) c FROM users u JOIN roles r ON r.role_key = u.role WHERE u.status = 'AKTIF' AND r.is_admin = 1";
    $params = [];
    if ($excludeUserId) {
        $sql .= ' AND u.id != :id';
        $params[':id'] = $excludeUserId;
    }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return (int) $stmt->fetch()['c'];
}

$method = http_method();
$pdo = db();

if (!in_array($type, ['products', 'buyers', 'users', 'karyawan'], true)) {
    json_error('Parameter type tidak valid (products|buyers|users|karyawan).', 422);
}

switch ($method) {

    case 'GET':
        if ($type === 'products') {
            $rows = $pdo->query('SELECT * FROM master_products ORDER BY nama ASC')->fetchAll();
        } elseif ($type === 'buyers') {
            $rows = $pdo->query('SELECT * FROM master_buyers ORDER BY nama ASC')->fetchAll();
        } elseif ($type === 'karyawan') {
            $rows = $pdo->query('SELECT * FROM master_karyawan ORDER BY nama ASC')->fetchAll();
        } else {
            $rows = $pdo->query('SELECT id, username, full_name, divisi, role, status FROM users ORDER BY full_name ASC')->fetchAll();
        }
        json_success($rows);
        break;

    case 'POST':
        $b = get_json_input();

        if ($type === 'products') {
            $nama = strtoupper(clean_str(arr_val($b, 'nama', '')));
            if ($nama === '') json_error('Nama product wajib diisi.', 422);
            $stmt = $pdo->prepare('INSERT INTO master_products (nama) VALUES (:n)');
            $stmt->execute([':n' => $nama]);
            $id = (int) $pdo->lastInsertId();

        } elseif ($type === 'buyers') {
            $nama = strtoupper(clean_str(arr_val($b, 'nama', '')));
            if ($nama === '') json_error('Nama buyer wajib diisi.', 422);
            $stmt = $pdo->prepare('INSERT INTO master_buyers (nama) VALUES (:n)');
            $stmt->execute([':n' => $nama]);
            $id = (int) $pdo->lastInsertId();

        } elseif ($type === 'karyawan') {
            $nama = strtoupper(clean_str(arr_val($b, 'nama', '')));
            if ($nama === '') json_error('Nama karyawan wajib diisi.', 422);
            $stmt = $pdo->prepare(
                'INSERT INTO master_karyawan (nama, divisi, jabatan, status) VALUES (:n, :d, :j, :s)'
            );
            $stmt->execute([
                ':n' => $nama,
                ':d' => strtoupper(clean_str(arr_val($b, 'divisi', 'GENERAL'))),
                ':j' => clean_str(arr_val($b, 'jabatan', '')),
                ':s' => in_array(arr_val($b, 'status', 'AKTIF'), ['AKTIF', 'NON AKTIF'], true) ? arr_val($b, 'status', 'AKTIF') : 'AKTIF',
            ]);
            $id = (int) $pdo->lastInsertId();

        } else { // users
            require_admin(); // hanya admin boleh tambah user/login account baru
            $username = strtolower(clean_str(arr_val($b, 'username', '')));
            $fullName = strtoupper(clean_str(arr_val($b, 'full_name', '')));
            $password = (string) arr_val($b, 'password', '');
            $divisi   = strtoupper(clean_str(arr_val($b, 'divisi', 'GENERAL')));
            $role     = role_key_exists($pdo, arr_val($b, 'role', 'user')) ? arr_val($b, 'role', 'user') : 'user';

            if ($username === '' || $fullName === '') {
                json_error('Username dan nama lengkap wajib diisi.', 422);
            }
            if (!preg_match('/^[a-z0-9._-]{3,50}$/', $username)) {
                json_error('Username 3-50 karakter, hanya huruf kecil, angka, titik, strip, atau underscore.', 422);
            }
            if ($err = password_policy_error($password, $username)) {
                json_error($err, 422);
            }
            $dup = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = :u');
            $dup->execute([':u' => $username]);
            if ((int) $dup->fetchColumn() > 0) {
                json_error('Username sudah dipakai.', 409);
            }

            $stmt = $pdo->prepare(
                'INSERT INTO users (username, password, full_name, divisi, role, status)
                 VALUES (:u, :p, :f, :d, :r, "AKTIF")'
            );
            $stmt->execute([
                ':u' => $username,
                ':p' => password_hash($password, PASSWORD_DEFAULT),
                ':f' => $fullName,
                ':d' => $divisi,
                ':r' => $role,
            ]);
            $id = (int) $pdo->lastInsertId();
        }

        log_activity('create', 'master_' . $type, $id, '');
        json_success(['id' => $id], ucfirst($type) . ' berhasil ditambahkan.');
        break;

    case 'PUT':
        $b = get_json_input();
        $id = to_int_or_null(arr_val($b, 'id'));
        if (!$id) json_error('ID wajib diisi.', 422);

        if ($type === 'products') {
            $nama = strtoupper(clean_str(arr_val($b, 'nama', '')));
            if ($nama === '') json_error('Nama product wajib diisi.', 422);
            $stmt = $pdo->prepare('UPDATE master_products SET nama = :n WHERE id = :id');
            $stmt->execute([':n' => $nama, ':id' => $id]);

        } elseif ($type === 'buyers') {
            $nama = strtoupper(clean_str(arr_val($b, 'nama', '')));
            if ($nama === '') json_error('Nama buyer wajib diisi.', 422);
            $stmt = $pdo->prepare('UPDATE master_buyers SET nama = :n WHERE id = :id');
            $stmt->execute([':n' => $nama, ':id' => $id]);

        } elseif ($type === 'karyawan') {
            $nama = strtoupper(clean_str(arr_val($b, 'nama', '')));
            if ($nama === '') json_error('Nama karyawan wajib diisi.', 422);
            $stmt = $pdo->prepare(
                'UPDATE master_karyawan SET nama = :n, divisi = :d, jabatan = :j, status = :s WHERE id = :id'
            );
            $stmt->execute([
                ':n'  => $nama,
                ':d'  => strtoupper(clean_str(arr_val($b, 'divisi', 'GENERAL'))),
                ':j'  => clean_str(arr_val($b, 'jabatan', '')),
                ':s'  => in_array(arr_val($b, 'status', 'AKTIF'), ['AKTIF', 'NON AKTIF'], true) ? arr_val($b, 'status', 'AKTIF') : 'AKTIF',
                ':id' => $id,
            ]);

        } else { // users
            $currentUser = current_user();
            // User biasa hanya boleh edit dirinya sendiri; role dengan akses admin boleh edit siapa saja.
            if (empty($currentUser['is_admin']) && (int) $currentUser['id'] !== $id) {
                json_error('Anda hanya bisa mengubah data akun Anda sendiri.', 403);
            }

            $fullName = strtoupper(clean_str(arr_val($b, 'full_name', '')));
            $divisi   = strtoupper(clean_str(arr_val($b, 'divisi', 'GENERAL')));
            if ($fullName === '') json_error('Nama lengkap wajib diisi.', 422);

            $sql = 'UPDATE users SET full_name = :f, divisi = :d';
            $params = [':f' => $fullName, ':d' => $divisi, ':id' => $id];

            // Hanya role dengan akses admin yang boleh ganti role/status user lain.
            if (!empty($currentUser['is_admin'])) {
                $role = role_key_exists($pdo, arr_val($b, 'role', 'user')) ? arr_val($b, 'role', 'user') : 'user';
                $status = in_array(arr_val($b, 'status', 'AKTIF'), ['AKTIF', 'NON AKTIF'], true) ? arr_val($b, 'status', 'AKTIF') : 'AKTIF';

                // Cegah perubahan yang membuat sistem kehilangan admin aktif terakhir.
                $roleCheck = $pdo->prepare('SELECT is_admin FROM roles WHERE role_key = :r');
                $roleCheck->execute([':r' => $role]);
                $willStayAdmin = ((int) ($roleCheck->fetch()['is_admin'] ?? 0) === 1) && $status === 'AKTIF';
                if (!$willStayAdmin && count_active_admins($pdo, $id) === 0) {
                    json_error('Tidak bisa menyimpan perubahan ini — akan membuat sistem kehilangan akun admin aktif terakhir. Jadikan user lain admin dulu sebelum ini.', 409);
                }

                $sql .= ', role = :r, status = :s';
                $params[':r'] = $role;
                $params[':s'] = $status;
            }

            // Password hanya diubah jika field diisi.
            $newPassword = (string) arr_val($b, 'password', '');
            if ($newPassword !== '') {
                $uStmt = $pdo->prepare('SELECT username FROM users WHERE id = :id');
                $uStmt->execute([':id' => $id]);
                if ($err = password_policy_error($newPassword, (string) $uStmt->fetchColumn())) {
                    json_error($err, 422);
                }
                $sql .= ', password = :p';
                $params[':p'] = password_hash($newPassword, PASSWORD_DEFAULT);
            }

            $sql .= ' WHERE id = :id';
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
        }

        log_activity('update', 'master_' . $type, $id, '');
        json_success(['id' => $id], ucfirst($type) . ' berhasil diperbarui.');
        break;

    case 'DELETE':
        $id = to_int_or_null($_GET['id'] ?? null);
        if (!$id) json_error('ID wajib diisi.', 422);

        if ($type === 'users') {
            require_admin();
            $currentUser = current_user();
            if ((int) $currentUser['id'] === $id) {
                json_error('Tidak bisa menghapus akun Anda sendiri yang sedang login.', 409);
            }

            // Cegah menghapus akun admin aktif terakhir yang tersisa di sistem.
            $target = $pdo->prepare("SELECT u.status, COALESCE(r.is_admin,0) AS is_admin FROM users u LEFT JOIN roles r ON r.role_key = u.role WHERE u.id = :id");
            $target->execute([':id' => $id]);
            $t = $target->fetch();
            if ($t && $t['status'] === 'AKTIF' && (int) $t['is_admin'] === 1 && count_active_admins($pdo, $id) === 0) {
                json_error('Tidak bisa menghapus akun ini — ini satu-satunya akun dengan akses admin penuh yang aktif.', 409);
            }
        } else {
            require_admin();
        }

        $table = $type === 'products' ? 'master_products' : ($type === 'buyers' ? 'master_buyers' : ($type === 'karyawan' ? 'master_karyawan' : 'users'));
        $stmt = $pdo->prepare("DELETE FROM {$table} WHERE id = :id");
        $stmt->execute([':id' => $id]);

        log_activity('delete', 'master_' . $type, $id, '');
        json_success([], ucfirst($type) . ' berhasil dihapus.');
        break;

    default:
        json_error('Method tidak didukung.', 405);
}
