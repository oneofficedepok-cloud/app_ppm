<?php
/**
 * Daftar MODUL aplikasi yang bisa diberikan ke sebuah role
 * (dicentang admin lewat menu Administrator -> Role Management).
 *
 * Key di sini = nilai yang disimpan di kolom roles.modules
 * (dipisah koma, mis. "purchasing,gudang"). Menambah modul baru cukup
 * tambah 1 baris di sini + pakai require_module() di endpoint API-nya.
 *
 * Role dengan "Akses Admin Penuh" (roles.is_admin = 1) otomatis boleh
 * mengakses SEMUA modul tanpa perlu dicentang satu per satu.
 */
const APP_MODULES = [
    'purchasing' => 'Purchasing (PR & Transportasi)',
    'produksi'   => 'Produksi (WO & Budget, Seal CNC)',
    'masterdata' => 'Master Data (Customer, Supplier, Master Directory)',
    'gudang'     => 'Gudang (Stok, Incoming, Receiving, Produksi & BOM)',
    'finance'    => 'Finance (Cash Flow, AR, AP, Dana Talangan)',
    'mtc'        => 'MTC Produksi',
];

/** Modul yang boleh MEMBACA data referensi lintas modul (dropdown, laporan). */
const MODULES_ANY = ['purchasing', 'produksi', 'masterdata', 'gudang', 'finance', 'mtc'];

/**
 * Ubah isi kolom roles.modules ("purchasing,gudang") jadi array key modul
 * yang valid saja — key asing/typo dibuang supaya tidak bisa disisipkan
 * nilai aneh lewat request.
 */
function parse_modules($raw): array
{
    if (is_string($raw)) {
        $raw = explode(',', $raw);
    }
    if (!is_array($raw)) {
        return [];
    }
    $valid = [];
    foreach ($raw as $m) {
        $m = trim((string) $m);
        if (isset(APP_MODULES[$m]) && !in_array($m, $valid, true)) {
            $valid[] = $m;
        }
    }
    return $valid;
}

/** Simpan array modul ke format kolom roles.modules. */
function modules_to_string(array $modules): string
{
    return implode(',', parse_modules($modules));
}
