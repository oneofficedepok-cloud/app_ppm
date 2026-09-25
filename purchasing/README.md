# Purchasing Cloud (PHP + MariaDB)

Replika Dashboard Purchasing Request, WO Tracking & Perpajakan PPN.
Dibangun dengan **PHP native (PDO) + MariaDB** — tanpa Composer, tanpa
build step — supaya bisa langsung di-upload ke hosting cPanel biasa
manapun.

---

## 1. Yang berubah dari versi sebelumnya (HTML/localStorage)

| | Versi lama | Versi ini |
|---|---|---|
| Penyimpanan data | `localStorage` browser (tidak sinkron antar user/device) | MariaDB (server, sinkron real-time untuk semua user) |
| Login | Form login tapi password tidak divalidasi | Autentikasi sungguhan (`password_hash`/`password_verify`), session PHP |
| Kalkulasi PPN/Total/P&L | Dihitung di browser (bisa dimanipulasi user) | Dihitung ulang di server, tidak bisa dimanipulasi dari console browser |
| Akses data | Semua orang otomatis "admin" | Role `admin` / `user`, aksi sensitif (hapus master, hapus user) dibatasi admin |
| Keamanan | Rawan XSS (`innerHTML` tanpa escape) | Semua output di-escape, semua query pakai prepared statement |

---

## 2. Kebutuhan Hosting

- PHP **7.4 atau lebih baru** (idealnya PHP 8.1+) dengan ekstensi `pdo_mysql` (hampir selalu aktif secara default)
- MariaDB atau MySQL 5.7+
- Web server Apache (disarankan, karena `.htaccess` disertakan) — Nginx juga bisa tapi perlu konfigurasi manual setara
- **Tidak butuh** Composer, SSH, atau akses terminal. Cukup File Manager / FTP + phpMyAdmin, seperti hosting cPanel pada umumnya.

---

## 3. Langkah Instalasi

### A. Buat Database
1. Di cPanel, buka **MySQL Databases**, buat database baru (mis. `purchasing_cloud`) dan user baru dengan password kuat, lalu berikan **All Privileges** pada database tersebut ke user itu.
2. Buka **phpMyAdmin**, pilih database yang baru dibuat, buka tab **Import**, lalu import file berikut **berurutan** (klik **Go** tiap file):
   1. `database/schema.sql`
   2. `database/migration_gudang_produksi.sql`
   3. `database/migration_sync_live.sql`
3. File `migration_roles_and_approval.sql` dan `migration_finance_module.sql` hanya untuk upgrade database versi lama, tidak perlu untuk instalasi baru.

> **Database yang sudah live:** cukup jalankan `database/migration_sync_live.sql` sekali. File ini aman: hanya membuat tabel/kolom yang belum ada (`IF NOT EXISTS`), tidak mengubah atau menghapus data. Butuh MariaDB (XAMPP & hosting cPanel umumnya sudah MariaDB).

### B. Upload File
1. Upload **seluruh isi folder ini** (bukan foldernya sendiri, tapi isinya) ke `public_html` (atau subfolder/subdomain pilihan Anda) via File Manager cPanel atau FTP.
2. Pastikan struktur di hosting persis seperti ini:
   ```
   public_html/
     api/
     assets/
     config/
     database/
     includes/
     index.php
     login.php
     logout.php
     .htaccess
   ```

### C. Konfigurasi Database
Buka `config/database.php`, edit 4 baris berikut sesuai data dari langkah A:
```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'namadb_purchasing_cloud');   // nama database Anda (biasanya diawali nama akun cPanel)
define('DB_USER', 'namadb_useranda');           // username database Anda
define('DB_PASS', 'password_database_anda');
```
Juga ganti `APP_SECRET_KEY` dengan string acak (boleh generate di https://randomkeygen.com/, ambil salah satu "CodeIgniter Encryption Keys").

### D. Selesai — Login
Buka `https://domainanda.com/login.php`.

**Akun default:**
- Username: `admin`
- Password: `admin123`

**⚠️ WAJIB langsung ganti password ini** setelah login pertama (menu Master Directory → Master User & Divisi → Edit akun `admin` → isi password baru). Juga bisa hapus 2 akun contoh lain (`abdus.somad`, `budi`) atau edit sesuai nama tim Anda.

---

## 4. Menambahkan User Tim

Setiap orang yang perlu login sebaiknya punya akunnya sendiri (bukan share 1 akun admin), supaya:
- Riwayat siapa mengisi/mengubah apa tercatat di `activity_log`
- Bisa dinonaktifkan individual kalau ada yang resign, tanpa mengganggu yang lain

Cara tambah: Menu **Master Directory** → **Master User & Divisi** → **+ Tambah**. Isi username (untuk login), nama lengkap, divisi, role, dan password awal.

**Role bawaan (bisa ditambah/diubah sendiri lewat menu Master Directory → Role Management, tanpa perlu edit kode):**
| Role | Keterangan |
|---|---|
| `admin` | Akses penuh (role sistem, tidak bisa dihapus) — boleh hapus data master, kelola user, kelola role |
| `manager_purchasing` | Approval final PR (tahap ke-3 alur approval) |
| `leader` | Pengecekan PR (tahap ke-2 alur approval) |
| `buyer` | Membuat PR (tahap ke-1 alur approval) |
| `user` | Staff biasa / pemohon PR (role sistem, default untuk akun baru) |

Detail hak akses tiap role di alur approval PR ada di bagian **8b** di bawah. Untuk menambah role baru di luar daftar ini (misal "Supervisor Gudang"), buka menu Role Management — tidak perlu bantuan saya lagi untuk itu.

Perlu diingat: role `buyer` di sini (akun login) **berbeda** dari **Master Buyer** (daftar nama di tab Master Directory yang dipakai untuk dropdown "Buyer" di form PR). Keduanya belum saling terhubung otomatis.

---

## 5. Struktur Kode (untuk referensi / pengembangan lanjutan)

```
config/database.php     - Satu-satunya file yang perlu diedit saat instalasi
database/schema.sql     - Skema tabel + data contoh
includes/db.php         - Koneksi PDO (singleton, prepared statements)
includes/auth.php       - Login/logout/session, role-based access
includes/helpers.php    - Fungsi bantu (response JSON, sanitasi, log aktivitas)
api/auth.php            - Endpoint login/logout/cek sesi
api/customers.php       - CRUD Customer
api/suppliers.php       - CRUD Supplier
api/master.php          - CRUD Master Product/Buyer/User (?type=products|buyers|users)
api/roles.php           - CRUD Role Management (dinamis, dikelola admin lewat UI)
api/work_orders.php     - CRUD Work Order (biaya + nilai jual) + kalkulasi otomatis (aktual pembelian, P&L, status)
api/pr_items.php        - CRUD Purchasing Request + kalkulasi PPN/DPP/Total di server + alur approval (?action=leader_check|manager_approve|resubmit)
api/account_receivable.php - CRUD AR (Piutang) + auto-fill dari WO + kalkulasi sisa piutang
api/account_payable.php    - CRUD AP (Hutang) + kalkulasi sisa hutang
api/cashflow.php           - GET gabungan AR+AP+manual (Cash Flow) + CRUD transaksi manual
api/dana_talangan.php      - CRUD Dana Talangan + rekonsiliasi pelunasan otomatis
includes/cashflow.php      - Helper get_combined_cashflow() dipakai bersama api/cashflow.php & api/dana_talangan.php
api/seal_items.php      - CRUD data Seal CNC
api/transport_items.php - CRUD data Transportasi
login.php / logout.php  - Halaman & proses autentikasi
index.php               - Shell UI utama (7 tab/menu)
assets/js/app.js        - Seluruh logic frontend (fetch ke api/*.php)
```

Semua endpoint di `api/` mengembalikan format JSON konsisten:
```json
{ "success": true, "message": "...", "data": { ... } }
{ "success": false, "message": "..." }
```

---

## 6. Yang Disederhanakan dari Versi Asli (perlu Anda tahu)

- **Export/Template Excel**: tetap jalan di sisi browser (SheetJS), sama seperti sebelumnya.
- **Bulk delete / checkbox pilih banyak baris**: belum diimplementasikan di versi ini (versi asli punya tombol ini tapi belum berfungsi penuh). Bisa ditambahkan kalau dibutuhkan.

> **Update:** fitur "Tambah Item Barang" (multi-item dalam satu form PR) sudah dikembalikan — lihat bagian **8c** di bawah.

---

## 7. Keamanan yang Sudah Diterapkan

- Semua query database pakai **prepared statement** (PDO) — aman dari SQL Injection
- Semua output ke HTML di-**escape** (`htmlspecialchars`) — aman dari XSS
- Password disimpan dengan **`password_hash()`** (bcrypt), tidak pernah plain text
- Session cookie: `HttpOnly`, `SameSite=Lax`, otomatis `Secure` kalau diakses via HTTPS
- Kalkulasi uang (PPN, DPP, Total, Profit/Loss) dihitung **di server**, bukan percaya angka dari browser
- Role-based access: hapus data master & user hanya bisa oleh role `admin`
- File konfigurasi (`config/`), skema SQL (`database/`), dan source internal (`includes/`) diblokir akses langsung lewat `.htaccess`

## 8b. Update Log — Role Management (UI) + Alur Approval PR

Dua fitur besar ditambahkan setelah rilis awal:

**1. Role Management lewat UI** — admin sekarang bisa buat/edit/hapus role sendiri di menu **Master Directory → Role Management**, tanpa perlu edit kode. Tinggal ketik "Nama Role", kode teknisnya dibuat otomatis. Ada centang "Akses Admin Penuh" kalau role itu perlu setara admin (boleh hapus data master/user/role lain).

**2. Alur Approval PR** — setiap PR baru sekarang melalui 3 tahap:

| Tahap | Siapa | Aksi |
|---|---|---|
| 1. Dibuat | Siapapun yang login (biasanya role **Buyer**) | Isi form PR seperti biasa → otomatis berstatus **"Menunggu Leader"** |
| 2. Dicek | Role **Leader** (atau Admin) | Klik tombol **Cek** di baris PR pada tabel Dashboard → pilih **Setujui** (lanjut ke Manager) atau **Tolak** (isi catatan alasan) |
| 3. Approve Final | Role **Manager Purchasing** (atau Admin) | Klik tombol **Approve** → pilih **Setujui (Final)** atau **Tolak** |

Status approval ditampilkan sebagai badge di kolom **Approval** pada tabel PR, dan bisa difilter lewat dropdown **Status Approval** di bagian filter dashboard.

**Aturan tambahan yang otomatis berlaku:**
- PR yang **ditolak** bisa dikirim ulang (tombol **Kirim Ulang**) oleh siapapun — akan kembali ke antrian "Menunggu Leader".
- Kalau PR yang **sudah lewat tahap Leader** (sedang di tahap Manager, sudah Disetujui, atau sudah Ditolak) diedit ulang oleh user biasa, sistem **otomatis mengirim ulang PR itu ke antrian approval dari awal** — supaya tidak ada celah mengubah harga/qty diam-diam setelah disetujui. Admin dikecualikan dari aturan ini (edit oleh admin tidak memicu reset).
- Role apapun boleh **membuat** PR (tidak dibatasi khusus Buyer) — kalau Anda mau pembuatan PR dibatasi khusus akun ber-role Buyer saja, beri tahu saya, ini bisa ditambahkan.
- Siapapun dengan **Akses Admin Penuh** bisa melakukan aksi Cek maupun Approve di tahap manapun (admin punya wewenang override).

### Cara migrasi (database yang sudah online & sudah ada datanya)

**JANGAN import ulang `database/schema.sql`** — itu akan menghapus data yang sudah ada. Lakukan ini saja:

**A. Jalankan 1 file migrasi** — buka phpMyAdmin → pilih database Anda → tab **SQL** → buka file `database/migration_roles_and_approval.sql` dari paket ini, copy seluruh isinya, paste, lalu **Go**. File ini aman dijalankan di database yang sudah berisi data (tidak menghapus apapun), dan sudah mencakup migrasi role dari update sebelumnya sekaligus kolom approval yang baru.

> Kalau Anda sudah pernah menjalankan migrasi role di update sebelumnya, bagian `ALTER TABLE ... ADD CONSTRAINT fk_users_role` di file ini akan menampilkan error "duplicate key name" saat dijalankan ulang — itu **normal**, artinya bagian itu memang sudah terpasang. Lanjutkan saja menjalankan sisa query di bawahnya (jalankan per-blok kalau phpMyAdmin berhenti di error itu).

**B. Upload ulang file-file berikut** (timpa yang lama), lewat File Manager/FTP:
- `api/master.php`
- `api/pr_items.php`
- `api/roles.php` ← **file baru**, belum ada di instalasi lama Anda
- `includes/auth.php`
- `index.php`
- `assets/js/app.js`

**JANGAN upload ulang `config/database.php`** (akan menghapus kredensial database Anda yang sudah diisi).

**C. Wajib: minta semua orang logout lalu login lagi** — terutama akun admin. Ini penting karena sistem permission sekarang membaca status "akses admin" langsung dari sesi login; sesi yang sudah aktif dari sebelum update ini tidak akan otomatis ter-update sampai login ulang.

**D. Assign role Leader / Manager Purchasing / Buyer ke orang yang tepat** — lewat menu Master Directory → Master User & Divisi → Edit user → pilih Role yang sesuai. Kalau rolenya belum ada di daftar, buat dulu lewat Role Management (lihat poin 1 di atas) — tapi role `leader`, `manager_purchasing`, dan `buyer` seharusnya sudah otomatis tersedia dari migrasi di atas.

Setelah semua langkah selesai, hard refresh browser (Ctrl+F5).

## 8c. Update Log — Form PR Multi-Item Dikembalikan

Form "+ PR Baru" sekarang punya tombol **"+ Tambah Item Barang"** lagi (seperti versi HTML asli) — bisa input banyak barang sekaligus dalam satu No. PR, masing-masing dengan Product/Qty/Harga/PPN/Supplier/Status sendiri-sendiri. Klik **Hapus Item** untuk membuang salah satu baris item (minimal harus tersisa 1). Mode **Edit** tetap seperti biasa (1 item per edit).

Saat disimpan, tiap item dikirim sebagai record terpisah ke server satu per satu. Kalau salah satu item gagal tersimpan (misalnya No. Item bentrok), item lain yang valid tetap tersimpan dan aplikasi memberi tahu item mana yang gagal beserta alasannya, supaya Anda tinggal perbaiki item itu saja.

**Ini murni perubahan tampilan/JavaScript** — tidak ada perubahan skema database maupun API baru, jadi **tidak perlu migrasi SQL apapun** untuk update ini.

**File yang perlu diupload ulang (timpa):**
- `index.php`
- `assets/js/app.js`

Setelah upload, hard refresh browser (Ctrl+F5).

## 8d. Update Log — Modul Finance Terintegrasi (Cash Flow, AR, AP, Dana Talangan)

Aplikasi sekarang bernama **PANCA PUTRA MADANI** dan menggabungkan Purchasing + Finance jadi satu sistem. WO (Work Order) sekarang punya **dua sisi dalam satu data**: sisi biaya (dari Purchasing, sudah ada sebelumnya) dan sisi nilai jual/tagihan ke customer (baru, dari Finance) — supaya Profit/Loss per WO dihitung dari angka riil, bukan estimasi manual.

**5 menu baru** (di ujung kanan nav bar, dipisah garis vertikal):
| Menu | Fungsi |
|---|---|
| Finance Dashboard | KPI saldo kas, sisa piutang/hutang, chart tren cashflow, aging piutang, WO pipeline |
| Cash Flow | Mutasi kas — gabungan otomatis dari AR/AP yang sudah dibayar + transaksi manual (beban, pendapatan, dst) |
| AR (Piutang) | Invoice ke customer, bisa auto-isi dari WO, hitung Due Date otomatis dari TOP |
| AP (Hutang) | Invoice dari supplier, sama seperti AR tapi sisi hutang |
| Dana Talangan | Pinjaman operasional, pelunasan dicocokkan otomatis dari Cash Flow |

Form **Tambah/Edit WO** sekarang juga punya bagian "Nilai Jual ke Customer" (Qty, Harga, Diskon, PPN, PPh23, PPh Lain) di atas bagian Budget & Biaya Produksi yang sudah ada.

### Cara migrasi (database yang sudah online & sudah ada datanya)

**JANGAN import ulang `database/schema.sql`.** Cukup:

**A. Jalankan file migrasi** `database/migration_finance_module.sql` di phpMyAdmin (tab SQL, paste seluruh isi, Go). File ini:
- Menambah kolom nilai jual ke tabel `work_orders` yang sudah ada (data WO lama Anda **tidak hilang** — sudah diuji langsung, data lama 100% tetap utuh setelah migrasi)
- Membuat 4 tabel baru: `account_receivable`, `account_payable`, `dana_talangan`, `manual_cashflow`
- **Tidak** menyertakan data contoh apapun — supaya tidak tercampur dengan data Anda yang sungguhan

**B. Upload ulang seluruh isi folder** dari paket ini ke hosting (banyak file berubah/baru untuk fitur ini) — **KECUALI** `config/database.php` (jangan ditimpa, itu sudah berisi kredensial database Anda).

**C. Hard refresh browser** (Ctrl+F5) setelah upload.

Tidak perlu logout/login ulang untuk update ini (berbeda dari update Role Management sebelumnya) — tidak ada perubahan pada sistem sesi/permission.

## 8e. Update Log — Modul Gudang & Produksi (Stok Material, Produksi & BOM, Riwayat Pergerakan)

**3 menu baru** di section level-1 **GUDANG & PRODUKSI** (nav gelap, di antara PURCHASING dan FINANCE):

| Menu | Fungsi |
|---|---|
| Stok Material | Master material gudang: SKU, kategori, satuan, harga, stok minimum (alert), lokasi rak, barcode. Saldo stok (`stok_qty`) **hanya berubah lewat Riwayat Pergerakan**, tidak bisa diedit manual dari form ini — supaya semua perubahan saldo selalu bisa ditelusuri asalnya. |
| Produksi & BOM | Progress panel produksi per WO, dengan Bill of Materials (BOM) — daftar material & kebutuhan qty per unit produk. Tombol **konsumsi** (ikon panah) mencatat sisa kebutuhan BOM sebagai pengurangan stok Gudang sekaligus. |
| Riwayat Pergerakan | Log semua mutasi stok (IN/OUT/ADJUSTMENT), dari sumber PEMBELIAN/PRODUKSI/MANUAL/RETUR/OPNAME. Bisa dibatalkan (saldo stok otomatis dikembalikan). |

**Tabel baru**: `inventory_items`, `inventory_movements`, `production_orders`, `production_bom_items`.
**Endpoint baru**: `api/inventory_items.php`, `api/inventory_movements.php`, `api/production_orders.php` (punya `?action=consume` untuk konsumsi BOM).

### Cara migrasi (database yang sudah online & sudah ada datanya)

**JANGAN import ulang `database/schema.sql`.** Cukup:

**A. Jalankan file migrasi** `database/migration_gudang_produksi.sql` di phpMyAdmin (tab SQL, paste seluruh isi, Go). File ini:
- Hanya membuat 4 tabel baru — **tidak** mengubah/menghapus tabel yang sudah ada, data lama Anda 100% aman
- Tidak menyertakan data contoh apapun

**B. Upload file-file berikut** (baru semua, tidak ada yang ditimpa kecuali 2 file di bawah):
- `api/inventory_items.php`, `api/inventory_movements.php`, `api/production_orders.php` ← **file baru**
- `index.php` ← **ditimpa** (nav & tab baru ditambahkan)
- `assets/js/app.js` ← **ditimpa** (logic frontend baru ditambahkan)

**JANGAN upload ulang `config/database.php`** (kredensial database Anda).

**C. Hard refresh browser** (Ctrl+F5) setelah upload. Tidak perlu logout/login ulang (tidak ada perubahan sesi/permission untuk update ini).

### Catatan pemakaian
- **Stok awal (opening balance)**: saat pertama kali menambah material baru, ada field "Stok Awal" untuk mengisi saldo pembuka. Setelahnya, semua perubahan wajib lewat Riwayat Pergerakan.
- **Hapus material**: dibatasi — material dengan saldo stok ≠ 0 tidak bisa dihapus (harus dinolkan dulu lewat pergerakan `ADJUSTMENT`), supaya nilai inventaris tidak hilang diam-diam.
- **Auto SKU**: form Tambah Material otomatis menyarankan SKU `MAT-000X`, boleh diedit manual.
- **Auto No. Produksi**: kalau field "No. Produksi" dikosongkan saat submit, server otomatis generate `PROD-000X`.
- **Link ke PR (pembelian masuk gudang)**: saat ini pencatatan stok masuk dari PR yang diterima **belum otomatis** — kolom `ref_pr_id` di `inventory_movements` sudah disiapkan untuk itu, tapi pemicunya (link tombol "Terima Barang" di PR ke pencatatan movement IN) belum dibuat. Beri tahu saya kalau Anda mau ini diotomatiskan di update berikutnya.

---

## 8. Yang Masih Perlu Anda Lakukan Sendiri

- **Aktifkan HTTPS** (SSL) di hosting Anda — biasanya gratis (Let's Encrypt) lewat menu cPanel "SSL/TLS Status". Tanpa HTTPS, password & data bisa disadap di jaringan publik.
- **Backup rutin** database (cPanel biasanya punya fitur backup otomatis, atau export manual via phpMyAdmin secara berkala).
- Ganti password akun `admin` default dan `APP_SECRET_KEY` (lihat langkah D di atas) — **jangan dilewati**.


---

## Import Data Excel

Menu **Administrator → Import Data Excel** (khusus admin). Urutan import yang disarankan, karena data transaksi merujuk ke master:

1. Karyawan, Customer, Supplier, Buyer, Product
2. Work Order (butuh Customer)
3. Purchase Request (butuh WO / Customer / Supplier / Buyer / Karyawan)

Aturan:
- Selalu pakai template dari tombol **Download Template Excel**. Kolom dicocokkan berdasarkan nama header, jadi urutan kolom boleh berubah.
- Data yang sudah ada (nama master sama, No WO sama, atau No PR + No Item sama) **dilewati**, tidak ditimpa.
- No WO / No PR boleh dikosongkan untuk nomor otomatis. Item PR dengan No PR kosong dan No Item 2, 3, dst. otomatis digabung ke PR baris sebelumnya.
- Angka boleh format Indonesia (`8.500.000`) atau internasional (`8,500,000`). Tanggal boleh `YYYY-MM-DD`, `DD/MM/YYYY`, atau sel tanggal Excel.
- Baris yang error dilaporkan per nomor baris; baris lain tetap masuk.
- Tidak butuh Composer. Ekstensi PHP `zip` tidak wajib (ada pembaca cadangan), tapi `SimpleXML` harus aktif (default di XAMPP/cPanel).
