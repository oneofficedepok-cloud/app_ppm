<?php
/**
 * Koneksi Database (PDO) - Singleton
 * Menggunakan prepared statements di seluruh aplikasi untuk mencegah SQL Injection.
 */

require_once __DIR__ . '/../config/database.php';

function db(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            http_response_code(500);
            if (defined('APP_DEBUG') && APP_DEBUG) {
                die(json_encode(['success' => false, 'message' => 'DB Connection failed: ' . $e->getMessage()]));
            }
            die(json_encode(['success' => false, 'message' => 'Koneksi database gagal. Hubungi administrator.']));
        }
    }

    return $pdo;
}
