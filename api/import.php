<?php
require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/xlsx_reader.php';

require_login();
require_admin(); // import data massal - khusus admin, supaya tidak sembarang orang timpa data

$pdo = db();

if (http_method() !== 'POST') {
    json_error('Method tidak didukung.', 405);
}

$type = $_POST['type'] ?? '';
$validTypes = ['customers', 'suppliers', 'karyawan', 'buyers', 'products', 'work_orders', 'pr_items'];
if (!in_array($type, $validTypes, true)) {
    json_error('Tipe import tidak valid.', 422);
}

if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
    json_error('File tidak ditemukan atau gagal diupload.', 422);
}

$ext = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
if ($ext !== 'xlsx') {
    json_error('File harus format .xlsx (Excel 2007+). Simpan file Anda sebagai .xlsx lalu upload lagi.', 422);
}

try {
    $rows = read_xlsx_first_sheet($_FILES['file']['tmp_name']);
} catch (Throwable $e) {
    json_error('Gagal membaca file: ' . $e->getMessage(), 422);
}

// Buang baris kosong di awal/akhir, cari baris header (baris pertama yang tidak kosong)
$rows = array_values(array_filter($rows, fn($r) => count(array_filter($r, fn($v) => $v !== '')) > 0));
if (count($rows) < 2) {
    json_error('File tidak berisi data (cuma ada header atau kosong). Isi minimal 1 baris data di bawah header.', 422);
}

$header = array_map('strtolower', array_map('trim', $rows[0]));
$dataRows = array_slice($rows, 1);

$ok = 0;
$skipped = 0;
$errors = []; // ['baris' => n, 'pesan' => '...']

function c(array $header, array $row, string $name): string
{
    return xlsx_col($header, $row, $name);
}

function findIdByName(PDO $pdo, string $table, string $nama): ?int
{
    if ($nama === '') return null;
    $stmt = $pdo->prepare("SELECT id FROM {$table} WHERE nama = :n LIMIT 1");
    $stmt->execute([':n' => $nama]);
    $id = $stmt->fetchColumn();
    return $id !== false ? (int) $id : null;
}

function yesNo(string $v): bool
{
    $v = strtoupper(trim($v));
    return in_array($v, ['YA', 'Y', 'YES', '1', 'TRUE'], true);
}

$rowNum = 1; // baris 1 = header, data mulai baris 2
foreach ($dataRows as $row) {
    $rowNum++;
    if (count(array_filter($row, fn($v) => $v !== '')) === 0) continue; // lewati baris kosong di tengah

    try {
        switch ($type) {

            case 'customers': {
                $nama = c($header, $row, 'nama');
                if ($nama === '') { $errors[] = ['baris' => $rowNum, 'pesan' => 'Nama wajib diisi.']; continue 2; }
                if (findIdByName($pdo, 'customers', $nama)) { $skipped++; continue 2; }
                $stmt = $pdo->prepare(
                    'INSERT INTO customers (nama, alamat, kelurahan, kecamatan, kota, provinsi, kodepos, negara, pic, cp, telepon, npwp, status)
                     VALUES (:nama,:alamat,:kelurahan,:kecamatan,:kota,:provinsi,:kodepos,:negara,:pic,:cp,:telepon,:npwp,:status)'
                );
                $stmt->execute([
                    ':nama' => $nama, ':alamat' => c($header, $row, 'alamat'),
                    ':kelurahan' => c($header, $row, 'kelurahan'), ':kecamatan' => c($header, $row, 'kecamatan'),
                    ':kota' => c($header, $row, 'kota'), ':provinsi' => c($header, $row, 'provinsi'),
                    ':kodepos' => c($header, $row, 'kode pos'), ':negara' => c($header, $row, 'negara') ?: 'Indonesia',
                    ':pic' => c($header, $row, 'pic'), ':cp' => c($header, $row, 'contact person'),
                    ':telepon' => c($header, $row, 'telepon'), ':npwp' => c($header, $row, 'npwp'),
                    ':status' => strtoupper(c($header, $row, 'status')) === 'NON AKTIF' ? 'NON AKTIF' : 'AKTIF',
                ]);
                $ok++;
                break;
            }

            case 'suppliers': {
                $nama = c($header, $row, 'nama');
                if ($nama === '') { $errors[] = ['baris' => $rowNum, 'pesan' => 'Nama wajib diisi.']; continue 2; }
                if (findIdByName($pdo, 'suppliers', $nama)) { $skipped++; continue 2; }
                $stmt = $pdo->prepare(
                    'INSERT INTO suppliers (nama, alamat, kelurahan, kecamatan, kota, provinsi, kodepos, negara, pic, cp, telepon, npwp, status)
                     VALUES (:nama,:alamat,:kelurahan,:kecamatan,:kota,:provinsi,:kodepos,:negara,:pic,:cp,:telepon,:npwp,:status)'
                );
                $stmt->execute([
                    ':nama' => $nama, ':alamat' => c($header, $row, 'alamat'),
                    ':kelurahan' => c($header, $row, 'kelurahan'), ':kecamatan' => c($header, $row, 'kecamatan'),
                    ':kota' => c($header, $row, 'kota'), ':provinsi' => c($header, $row, 'provinsi'),
                    ':kodepos' => c($header, $row, 'kode pos'), ':negara' => c($header, $row, 'negara') ?: 'Indonesia',
                    ':pic' => c($header, $row, 'pic'), ':cp' => c($header, $row, 'contact person'),
                    ':telepon' => c($header, $row, 'telepon'), ':npwp' => c($header, $row, 'npwp'),
                    ':status' => strtoupper(c($header, $row, 'status')) === 'NON AKTIF' ? 'NON AKTIF' : 'AKTIF',
                ]);
                $ok++;
                break;
            }

            case 'karyawan': {
                $nama = strtoupper(c($header, $row, 'nama'));
                if ($nama === '') { $errors[] = ['baris' => $rowNum, 'pesan' => 'Nama wajib diisi.']; continue 2; }
                if (findIdByName($pdo, 'master_karyawan', $nama)) { $skipped++; continue 2; }
                $stmt = $pdo->prepare('INSERT INTO master_karyawan (nama, divisi, jabatan, status) VALUES (:n,:d,:j,:s)');
                $stmt->execute([
                    ':n' => $nama, ':d' => strtoupper(c($header, $row, 'divisi')) ?: 'GENERAL',
                    ':j' => c($header, $row, 'jabatan'),
                    ':s' => strtoupper(c($header, $row, 'status')) === 'NON AKTIF' ? 'NON AKTIF' : 'AKTIF',
                ]);
                $ok++;
                break;
            }

            case 'buyers': {
                $nama = strtoupper(c($header, $row, 'nama'));
                if ($nama === '') { $errors[] = ['baris' => $rowNum, 'pesan' => 'Nama wajib diisi.']; continue 2; }
                try {
                    $pdo->prepare('INSERT INTO master_buyers (nama) VALUES (:n)')->execute([':n' => $nama]);
                    $ok++;
                } catch (PDOException $e) {
                    if ($e->getCode() === '23000') { $skipped++; } else { throw $e; }
                }
                break;
            }

            case 'products': {
                $nama = strtoupper(c($header, $row, 'nama'));
                if ($nama === '') { $errors[] = ['baris' => $rowNum, 'pesan' => 'Nama wajib diisi.']; continue 2; }
                try {
                    $pdo->prepare('INSERT INTO master_products (nama) VALUES (:n)')->execute([':n' => $nama]);
                    $ok++;
                } catch (PDOException $e) {
                    if ($e->getCode() === '23000') { $skipped++; } else { throw $e; }
                }
                break;
            }

            case 'work_orders': {
                $project = c($header, $row, 'nama project');
                if ($project === '') { $errors[] = ['baris' => $rowNum, 'pesan' => 'Nama Project wajib diisi.']; continue 2; }

                $customerNama = c($header, $row, 'nama customer');
                $customerId = $customerNama !== '' ? findIdByName($pdo, 'customers', $customerNama) : null;
                if ($customerNama !== '' && !$customerId) {
                    $errors[] = ['baris' => $rowNum, 'pesan' => "Customer \"{$customerNama}\" tidak ditemukan di Master Customer - import customer-nya dulu."];
                    continue 2;
                }

                $category = strtoupper(c($header, $row, 'kategori wo'));
                if (!in_array($category, ['PROJECT', 'MAINTENANCE', 'INVENTARIS'], true)) $category = 'PROJECT';

                $woNumber = c($header, $row, 'no wo');
                if ($woNumber === '') {
                    $prefix = $category === 'MAINTENANCE' ? 'WO-M-' : ($category === 'INVENTARIS' ? 'WO-A-' : 'WO-' . date('Y') . '-');
                    $cnt = (int) $pdo->query("SELECT COUNT(*) FROM work_orders WHERE wo_number LIKE " . $pdo->quote($prefix . '%'))->fetchColumn();
                    $woNumber = $prefix . str_pad((string) ($cnt + 1), 3, '0', STR_PAD_LEFT);
                }

                $qty = (float) (c($header, $row, 'qty') ?: 1);
                $harga = (float) c($header, $row, 'harga satuan');
                $diskon = (float) c($header, $row, 'diskon');
                $isPpn = yesNo(c($header, $row, 'ppn'));
                $isPph23 = yesNo(c($header, $row, 'pph23'));
                $pphLainPct = (float) c($header, $row, 'pph lain %');
                $dpp = ($qty * $harga) - $diskon;
                $ppn = $isPpn ? round($dpp * 0.11, 2) : 0.0;
                $pph23 = $isPph23 ? round($dpp * 0.02, 2) : 0.0;
                $pphLain = round($dpp * ($pphLainPct / 100), 2);
                $woTotal = $dpp + $ppn - $pph23 - $pphLain;

                $stmt = $pdo->prepare(
                    'INSERT INTO work_orders (wo_number, wo_category, project, customer_id, est_kirim, po_no,
                        qty, satuan, harga_satuan, diskon, is_ppn, ppn, is_pph23, pph23, pph_lain_pct, pph_lain, wo_total,
                        nilai_po, budget_prod, aktual_prod, budget_pem, budget_lain, total_lain, status)
                     VALUES (:wo,:cat,:proj,:cust,:est,:pono,:qty,:satuan,:harga,:diskon,:isppn,:ppn,:ispph23,:pph23,:pphlainpct,:pphlain,:total,
                        :dpp,:bprod,:aprod,:bpem,:blain,:lain,:status)'
                );
                try {
                    $stmt->execute([
                        ':wo' => $woNumber, ':cat' => $category, ':proj' => $project, ':cust' => $customerId,
                        ':est' => c($header, $row, 'estimasi kirim') ?: null, ':pono' => c($header, $row, 'no po'),
                        ':qty' => $qty, ':satuan' => c($header, $row, 'satuan') ?: 'Unit', ':harga' => $harga, ':diskon' => $diskon,
                        ':isppn' => $isPpn ? 1 : 0, ':ppn' => $ppn, ':ispph23' => $isPph23 ? 1 : 0, ':pph23' => $pph23,
                        ':pphlainpct' => $pphLainPct, ':pphlain' => $pphLain, ':total' => $woTotal, ':dpp' => $dpp,
                        ':bprod' => (float) c($header, $row, 'budget produksi'), ':aprod' => (float) c($header, $row, 'aktual produksi'),
                        ':bpem' => (float) c($header, $row, 'budget pembelian'), ':blain' => (float) c($header, $row, 'budget lain-lain'),
                        ':lain' => (float) c($header, $row, 'aktual lain-lain'),
                        ':status' => in_array(strtoupper(c($header, $row, 'status')), ['ON PROGRESS','HOLD','CANCEL','DELIVERY','FINISHED'], true) ? strtoupper(c($header, $row, 'status')) : 'ON PROGRESS',
                    ]);
                    $ok++;
                } catch (PDOException $e) {
                    if ($e->getCode() === '23000') {
                        $errors[] = ['baris' => $rowNum, 'pesan' => "No. WO \"{$woNumber}\" sudah dipakai WO lain."];
                    } else { throw $e; }
                }
                break;
            }

            case 'pr_items': {
                $product = c($header, $row, 'nama barang');
                if ($product === '') { $errors[] = ['baris' => $rowNum, 'pesan' => 'Nama Barang wajib diisi.']; continue 2; }

                $sheet = strtoupper(c($header, $row, 'kategori'));
                if (!in_array($sheet, ['PROJECT', 'GENERAL', 'CONSUMABLE', 'MAINTENANCE', 'INVENTARIS'], true)) $sheet = 'PROJECT';

                $woNumber = c($header, $row, 'no wo');
                $woId = null;
                $customerId = null;
                if ($woNumber !== '') {
                    $stmt = $pdo->prepare('SELECT id, customer_id FROM work_orders WHERE wo_number = :w LIMIT 1');
                    $stmt->execute([':w' => $woNumber]);
                    $wo = $stmt->fetch();
                    if (!$wo) { $errors[] = ['baris' => $rowNum, 'pesan' => "No. WO \"{$woNumber}\" tidak ditemukan - import WO-nya dulu."]; continue 2; }
                    $woId = (int) $wo['id'];
                    $customerId = $wo['customer_id'] ? (int) $wo['customer_id'] : null;
                }
                $customerNamaCol = c($header, $row, 'nama customer');
                if ($customerNamaCol !== '') {
                    $customerId = findIdByName($pdo, 'customers', $customerNamaCol);
                    if (!$customerId) { $errors[] = ['baris' => $rowNum, 'pesan' => "Customer \"{$customerNamaCol}\" tidak ditemukan."]; continue 2; }
                }

                $supplierNama = c($header, $row, 'supplier');
                $supplierId = $supplierNama !== '' ? findIdByName($pdo, 'suppliers', $supplierNama) : null;
                if ($supplierNama !== '' && !$supplierId) { $errors[] = ['baris' => $rowNum, 'pesan' => "Supplier \"{$supplierNama}\" tidak ditemukan."]; continue 2; }

                $buyerNama = strtoupper(c($header, $row, 'buyer'));
                $buyerId = $buyerNama !== '' ? findIdByName($pdo, 'master_buyers', $buyerNama) : null;

                $karyawanNama = strtoupper(c($header, $row, 'user peminta'));
                $karyawanId = $karyawanNama !== '' ? findIdByName($pdo, 'master_karyawan', $karyawanNama) : null;

                $prNumber = c($header, $row, 'no pr');
                if ($prNumber === '') {
                    $prefixMap = ['PROJECT' => 'P-', 'GENERAL' => 'G-', 'CONSUMABLE' => 'STR-', 'MAINTENANCE' => 'M-', 'INVENTARIS' => 'A-'];
                    $prefix = $prefixMap[$sheet] . date('y');
                    $cnt = (int) $pdo->query("SELECT COUNT(*) FROM pr_items WHERE pr_number LIKE " . $pdo->quote($prefix . '%'))->fetchColumn();
                    $prNumber = $prefix . str_pad((string) ($cnt + 1), 4, '0', STR_PAD_LEFT);
                }
                $itemNo = (int) (c($header, $row, 'no item') ?: 1);

                $qty = (float) (c($header, $row, 'qty') ?: 1);
                $harga = (float) c($header, $row, 'harga satuan');
                $isPpn = yesNo(c($header, $row, 'kena ppn'));
                $ppnRate = (float) (c($header, $row, 'tarif ppn %') ?: 11);
                $dpp = $qty * $harga;
                $ppnAmount = $isPpn ? round($dpp * ($ppnRate / 100), 2) : 0.0;
                $total = $dpp + $ppnAmount;

                $stmt = $pdo->prepare(
                    'INSERT INTO pr_items
                     (sheet, tanggal, pr_number, item_no, customer_id, project, wo_id, product, type, dimensi, brand,
                      qty, uom, harga, is_ppn, ppn_rate, ppn_amount, dpp, total, supplier_id, tgl_beli, tgl_datang, penerima_barang,
                      po_number, buyer_id, karyawan_id, divisi, status, keterangan, approval_status)
                     VALUES (:sheet,:tgl,:pr,:itemno,:cust,:proj,:wo,:prod,:type,:dim,:brand,
                      :qty,:uom,:harga,:isppn,:ppnrate,:ppnamt,:dpp,:total,:supp,:tglbeli,:tgldatang,:penerima,
                      :po,:buyer,:karyawan,:divisi,:status,:ket,:appr)'
                );
                try {
                    $stmt->execute([
                        ':sheet' => $sheet, ':tgl' => c($header, $row, 'tanggal') ?: date('Y-m-d'), ':pr' => $prNumber, ':itemno' => $itemNo,
                        ':cust' => $customerId, ':proj' => c($header, $row, 'nama project'), ':wo' => $woId,
                        ':prod' => $product, ':type' => c($header, $row, 'type'), ':dim' => c($header, $row, 'dimensi'), ':brand' => c($header, $row, 'brand'),
                        ':qty' => $qty, ':uom' => c($header, $row, 'satuan') ?: 'Pcs', ':harga' => $harga,
                        ':isppn' => $isPpn ? 1 : 0, ':ppnrate' => $ppnRate, ':ppnamt' => $ppnAmount, ':dpp' => $dpp, ':total' => $total,
                        ':supp' => $supplierId, ':tglbeli' => c($header, $row, 'tanggal beli') ?: null, ':tgldatang' => c($header, $row, 'tanggal datang') ?: null,
                        ':penerima' => c($header, $row, 'penerima barang'),
                        ':po' => c($header, $row, 'no po'), ':buyer' => $buyerId, ':karyawan' => $karyawanId,
                        ':divisi' => c($header, $row, 'divisi'),
                        ':status' => in_array(strtoupper(c($header, $row, 'status')), ['RECEIVED','PO ISSUED','ON PROSES','STORE ROOM','CANCEL'], true) ? strtoupper(c($header, $row, 'status')) : 'ON PROSES',
                        ':ket' => c($header, $row, 'deskripsi'), ':appr' => 'PENDING_LEADER',
                    ]);
                    $ok++;
                } catch (PDOException $e) {
                    if ($e->getCode() === '23000') {
                        $errors[] = ['baris' => $rowNum, 'pesan' => "No. PR \"{$prNumber}\" item {$itemNo} sudah ada."];
                    } else { throw $e; }
                }
                break;
            }
        }
    } catch (Throwable $e) {
        $errors[] = ['baris' => $rowNum, 'pesan' => 'Error server: ' . $e->getMessage()];
    }
}

log_activity('import', $type, 0, "{$ok} baris berhasil, " . count($errors) . " gagal, {$skipped} dilewati (sudah ada)");

json_success([
    'berhasil' => $ok,
    'dilewati' => $skipped,
    'gagal' => count($errors),
    'errors' => array_slice($errors, 0, 50), // batasi tampilan biar tidak kebanjiran
], "Import selesai: {$ok} baris berhasil, {$skipped} dilewati (sudah ada), " . count($errors) . ' gagal.');
