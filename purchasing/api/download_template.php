<?php
/**
 * Serve template Excel import - filenya di-embed langsung sebagai base64 di
 * file PHP ini (bukan file .xlsx terpisah di folder templates/), supaya tidak
 * pernah 'hilang' gara-gara lupa ikut ter-upload waktu deploy ke hosting.
 */

require_once __DIR__ . '/../includes/auth.php';
require_login();

$type = $_GET['type'] ?? '';

$templates = require __DIR__ . '/../includes/import_templates.php';

if (!isset($templates[$type])) {
    http_response_code(404);
    echo 'Template tidak ditemukan.';
    exit;
}

$tpl = $templates[$type];
$binary = base64_decode($tpl['data']);

header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
header('Content-Disposition: attachment; filename="' . $tpl['filename'] . '"');
header('Content-Length: ' . strlen($binary));
header('Cache-Control: no-cache, must-revalidate');
echo $binary;
