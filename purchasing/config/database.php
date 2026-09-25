<?php
/**
 * =========================================================
 *  KONFIGURASI DATABASE
 * =========================================================
 *  EDIT 4 baris di bawah ini sesuai data database MariaDB/MySQL
 *  dari hosting Anda (cPanel > MySQL Databases).
 * =========================================================
 */

define('DB_HOST', 'localhost');          // biasanya 'localhost' di hosting
define('DB_NAME', 'purchasing_cloud');   // nama database yang sudah Anda buat
define('DB_USER', 'root');               // username database dari hosting
define('DB_PASS', '');                   // password database dari hosting
define('DB_CHARSET', 'utf8mb4');

/**
 * =========================================================
 *  KONFIGURASI APLIKASI
 * =========================================================
 */

// Ganti dengan string acak yang unik & rahasia (untuk keamanan session).
// Contoh generate: bin2hex(random_bytes(32))
define('APP_SECRET_KEY', 'GANTI_DENGAN_STRING_ACAK_RAHASIA_ANDA_DISINI');

// Set true HANYA saat development lokal. WAJIB false saat sudah online (production).
define('APP_DEBUG', false);

// Nama aplikasi (ditampilkan di title/header)
define('APP_NAME', 'Purchasing Cloud');
