<?php
/**
 * Daftar MENU aplikasi yang bisa diberikan ke sebuah role, dikelompokkan
 * per modul (mirip policy editor AWS IAM). Admin mencentang per menu:
 *   - Lihat : menu tampil & datanya bisa dibaca
 *   - Ubah  : boleh tambah / edit / hapus / proses (otomatis termasuk Lihat)
 *
 * Key menu = key tab di assets/js/app.js (TAB_LOADERS), supaya server & UI
 * memakai nama yang sama. Disimpan di kolom roles.modules sebagai teks,
 * contoh: "dashboard:edit,transport:view,stok:edit".
 *
 * Menambah menu baru: tambah 1 baris di sini + pakai require_perm() di
 * endpoint API-nya + daftarkan tab-nya di app.js.
 *
 * Role dengan "Akses Admin Penuh" (roles.is_admin = 1) otomatis boleh
 * SEMUA menu dengan level Ubah.
 */
const APP_MODULES = [
    'purchasing' => ['label' => 'Purchasing', 'menus' => [
        'dashboard' => 'Purchase Request (PR)',
        'transport' => 'Transportasi',
    ]],
    'produksi' => ['label' => 'Produksi', 'menus' => [
        'tracking' => 'WO & Budget',
        'seal'     => 'Seal CNC',
    ]],
    'masterdata' => ['label' => 'Master Data', 'menus' => [
        'customers' => 'Customer',
        'suppliers' => 'Supplier',
        'master'    => 'Master Directory (Product, Buyer, Karyawan)',
    ]],
    'gudang' => ['label' => 'Gudang & Produksi', 'menus' => [
        'stok'      => 'Stok Material',
        'incoming'  => 'Incoming Goods',
        'receiving' => 'Receiving Goods',
        'produksi'  => 'Produksi & BOM',
        'riwayat'   => 'Riwayat Pergerakan',
    ]],
    'finance' => ['label' => 'Finance', 'menus' => [
        'findash'  => 'Finance Dashboard',
        'cashflow' => 'Cash Flow',
        'ar'       => 'AR (Piutang)',
        'ap'       => 'AP (Hutang)',
        'talangan' => 'Dana Talangan',
    ]],
    'mtc' => ['label' => 'MTC Produksi', 'menus' => [
        'mtcdash'   => 'Dashboard MTC',
        'mtcdivisi' => 'Modul Divisi Produksi',
        'mtcmaster' => 'Master Data MTC (Mesin & Tarif)',
    ]],
];

const PERM_NONE = 0;
const PERM_VIEW = 1;
const PERM_EDIT = 2;

/** Semua key menu: ['dashboard' => 'purchasing', 'transport' => 'purchasing', ...] */
function all_menus(): array
{
    static $menus = null;
    if ($menus === null) {
        $menus = [];
        foreach (APP_MODULES as $moduleKey => $module) {
            foreach ($module['menus'] as $menuKey => $label) {
                $menus[$menuKey] = $moduleKey;
            }
        }
    }
    return $menus;
}

/** Izin penuh (semua menu level Ubah) - untuk role Admin. */
function full_permissions(): array
{
    return array_fill_keys(array_keys(all_menus()), PERM_EDIT);
}

/**
 * Baca isi kolom roles.modules jadi ['menu' => PERM_VIEW|PERM_EDIT].
 * Kompatibel dengan format lama (hanya nama modul, mis. "purchasing,gudang"):
 * modul lama dianggap semua menu di dalamnya level Ubah.
 * Key asing / typo dibuang supaya tidak bisa disisipkan nilai aneh.
 */
function parse_permissions($raw): array
{
    if (is_string($raw)) {
        $raw = $raw === '' ? [] : explode(',', $raw);
    }
    if (!is_array($raw)) {
        return [];
    }
    $menus = all_menus();
    $perms = [];
    foreach ($raw as $token) {
        $token = trim((string) $token);
        if (strpos($token, ':') === false) {
            // Format lama: nama modul -> semua menunya boleh diubah.
            if (isset(APP_MODULES[$token])) {
                foreach (APP_MODULES[$token]['menus'] as $menuKey => $_) {
                    $perms[$menuKey] = PERM_EDIT;
                }
            }
            continue;
        }
        [$menu, $level] = explode(':', $token, 2);
        if (!isset($menus[$menu])) continue;
        $lvl = $level === 'edit' ? PERM_EDIT : ($level === 'view' ? PERM_VIEW : PERM_NONE);
        if ($lvl > ($perms[$menu] ?? PERM_NONE)) {
            $perms[$menu] = $lvl;
        }
    }
    return $perms;
}

/**
 * Ubah input dari form Role Management ({"dashboard":"edit","stok":"view"})
 * jadi teks untuk disimpan di kolom roles.modules.
 */
function permissions_to_string($input): string
{
    if (!is_array($input)) return '';
    $menus = all_menus();
    $tokens = [];
    foreach ($input as $menu => $level) {
        if (!isset($menus[$menu])) continue;
        if ($level === 'edit' || $level === 'view') {
            $tokens[] = "{$menu}:{$level}";
        }
    }
    return implode(',', $tokens);
}

/** Izin dalam format untuk dikirim ke browser: {"dashboard":"edit","stok":"view"} */
function permissions_for_client(array $perms): array
{
    $out = [];
    foreach ($perms as $menu => $lvl) {
        if ($lvl >= PERM_VIEW) {
            $out[$menu] = $lvl >= PERM_EDIT ? 'edit' : 'view';
        }
    }
    return $out;
}

/** Modul (grup menu level-1) yang punya minimal 1 menu boleh dilihat. */
function visible_modules(array $perms): array
{
    $menus = all_menus();
    $mods = [];
    foreach ($perms as $menu => $lvl) {
        if ($lvl >= PERM_VIEW && isset($menus[$menu]) && !in_array($menus[$menu], $mods, true)) {
            $mods[] = $menus[$menu];
        }
    }
    return $mods;
}
