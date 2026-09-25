<?php
/**
 * Pembaca file .xlsx MINIMAL, tanpa Composer/library eksternal.
 * File .xlsx sebenarnya adalah ZIP berisi file-file XML - PHP sudah
 * punya ZipArchive + SimpleXML bawaan, jadi cukup dipakai langsung.
 *
 * Keterbatasan (cukup untuk template import sederhana, satu sheet,
 * tanpa formula/merge cell):
 * - Hanya membaca SHEET PERTAMA di file.
 * - Tidak mendukung formula (hanya nilai yang sudah dihitung Excel).
 * - Style/warna/format diabaikan (tidak relevan untuk import data).
 */

/** Ubah referensi kolom huruf (A, B, ..., Z, AA, ...) jadi index angka (0-based). */
function xlsx_col_to_index(string $letters): int
{
    $letters = strtoupper($letters);
    $index = 0;
    for ($i = 0; $i < strlen($letters); $i++) {
        $index = $index * 26 + (ord($letters[$i]) - ord('A') + 1);
    }
    return $index - 1;
}

/**
 * Baca sheet pertama dari file .xlsx, kembalikan sebagai array baris,
 * tiap baris adalah array nilai kolom (string, sudah di-trim), 0-indexed,
 * kolom kosong di tengah tetap diisi '' supaya index-nya tidak geser.
 */
function read_xlsx_first_sheet(string $filePath): array
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('Ekstensi PHP "zip" tidak aktif di server ini - hubungi hosting/admin server untuk mengaktifkan php_zip.');
    }
    if (!function_exists('simplexml_load_string')) {
        throw new RuntimeException('Ekstensi PHP "simplexml" (bagian dari ekstensi xml) tidak aktif di server ini - hubungi hosting/admin server untuk mengaktifkan php_xml / php_simplexml.');
    }

    $zip = new ZipArchive();
    if ($zip->open($filePath) !== true) {
        throw new RuntimeException('File bukan format .xlsx yang valid (gagal dibuka sebagai ZIP).');
    }

    // 1) Shared strings (Excel menyimpan teks berulang di tabel terpisah demi efisiensi)
    $sharedStrings = [];
    $ssXml = $zip->getFromName('xl/sharedStrings.xml');
    if ($ssXml !== false) {
        $ss = @simplexml_load_string($ssXml);
        if ($ss !== false) {
            foreach ($ss->si as $si) {
                if (isset($si->t)) {
                    $sharedStrings[] = (string) $si->t;
                } else {
                    $text = '';
                    foreach ($si->r as $r) {
                        $text .= (string) $r->t;
                    }
                    $sharedStrings[] = $text;
                }
            }
        }
    }

    // 2) Cari sheet pertama - biasanya xl/worksheets/sheet1.xml, tapi urutan bisa beda
    //    kalau sheet sempat dihapus/diurutkan ulang di Excel, jadi cek workbook.xml.rels dulu.
    $sheetPath = 'xl/worksheets/sheet1.xml';
    $wbXml = $zip->getFromName('xl/workbook.xml');
    $relsXml = $zip->getFromName('xl/_rels/workbook.xml.rels');
    if ($wbXml !== false && $relsXml !== false) {
        $wb = @simplexml_load_string($wbXml);
        $rels = @simplexml_load_string($relsXml);
        if ($wb !== false && $rels !== false && isset($wb->sheets->sheet[0])) {
            $firstSheet = $wb->sheets->sheet[0];
            $rId = (string) $firstSheet->attributes('r', true)->id;
            foreach ($rels->Relationship as $rel) {
                if ((string) $rel['Id'] === $rId) {
                    $target = (string) $rel['Target'];
                    // Target bisa relatif ("worksheets/sheet1.xml") atau absolut ("/xl/worksheets/sheet1.xml")
                    // tergantung aplikasi yang menulis file-nya (Excel vs openpyxl vs lainnya).
                    if (str_starts_with($target, '/')) {
                        $sheetPath = ltrim($target, '/');
                    } else {
                        $sheetPath = 'xl/' . $target;
                    }
                    break;
                }
            }
        }
    }

    $sheetXml = $zip->getFromName($sheetPath);
    if ($sheetXml === false) {
        $zip->close();
        throw new RuntimeException('Sheet pertama tidak ditemukan di dalam file .xlsx.');
    }
    $sheet = @simplexml_load_string($sheetXml);
    $zip->close();
    if ($sheet === false || !isset($sheet->sheetData->row)) {
        throw new RuntimeException('Format sheet tidak dikenali / file rusak.');
    }

    $rows = [];
    foreach ($sheet->sheetData->row as $row) {
        $rowData = [];
        $maxCol = -1;
        foreach ($row->c as $c) {
            $ref = (string) $c['r'];
            if (!preg_match('/^([A-Z]+)\d+$/', $ref, $m)) continue;
            $colIndex = xlsx_col_to_index($m[1]);

            $type = (string) $c['t'];
            $value = '';
            if ($type === 's') {
                $raw = isset($c->v) ? (int) $c->v : -1;
                $value = $sharedStrings[$raw] ?? '';
            } elseif ($type === 'inlineStr') {
                $value = isset($c->is->t) ? (string) $c->is->t : '';
            } else {
                $value = isset($c->v) ? (string) $c->v : '';
            }
            $rowData[$colIndex] = trim($value);
            $maxCol = max($maxCol, $colIndex);
        }
        if ($maxCol < 0) {
            $rows[] = []; // baris kosong tetap dicatat supaya nomor baris tidak geser
            continue;
        }
        $normalized = [];
        for ($i = 0; $i <= $maxCol; $i++) {
            $normalized[] = $rowData[$i] ?? '';
        }
        $rows[] = $normalized;
    }

    return $rows;
}

/** Cari nilai kolom dari satu baris berdasarkan nama header (case-insensitive, trim). */
function xlsx_col(array $header, array $row, string $name): string
{
    $idx = array_search(strtolower(trim($name)), $header, true);
    if ($idx === false || !isset($row[$idx])) return '';
    return trim((string) $row[$idx]);
}
