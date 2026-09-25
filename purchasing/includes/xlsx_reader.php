<?php
/**
 * Pembaca file .xlsx minimalis - TANPA Composer / PhpSpreadsheet.
 *
 * Membaca sheet PERTAMA dan mengembalikan array baris:
 *   [ nomorBarisExcel => [ indexKolom(0-based) => nilai ], ... ]
 * Nilai angka dikembalikan sebagai float, teks sebagai string.
 *
 * Pakai ekstensi ZipArchive kalau aktif. Kalau tidak (sering terjadi di
 * XAMPP karena extension=zip dikomentari di php.ini), otomatis pakai
 * pembaca ZIP bawaan di bawah yang hanya butuh zlib (selalu aktif).
 */

const XLSX_NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XLSX_NS_REL  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

class XlsxReadException extends RuntimeException {}

/** Ambil isi beberapa file dari dalam arsip ZIP. Return [nama => isi|null]. */
function xlsx_zip_extract(string $path, array $wanted): array
{
    $out = array_fill_keys($wanted, null);

    if (class_exists('ZipArchive') && !defined('XLSX_FORCE_PURE_ZIP')) {
        $zip = new ZipArchive();
        if ($zip->open($path) === true) {
            foreach ($wanted as $name) {
                $data = $zip->getFromName($name);
                $out[$name] = $data === false ? null : $data;
            }
            $zip->close();
            return $out;
        }
    }

    // ---- Fallback: baca Central Directory ZIP secara manual ----
    $bin = file_get_contents($path);
    if ($bin === false || strlen($bin) < 22) throw new XlsxReadException('File bukan .xlsx yang valid atau rusak. Buka di Excel lalu Save As "Excel Workbook (*.xlsx)".');

    $eocd = strrpos($bin, "PK\x05\x06");
    if ($eocd === false) throw new XlsxReadException('File bukan .xlsx yang valid (struktur ZIP tidak ditemukan).');
    $e = unpack('vdisk/vcdDisk/vcountDisk/vcount/Vsize/Voffset', substr($bin, $eocd + 4, 16));

    $pos = $e['offset'];
    for ($i = 0; $i < $e['count']; $i++) {
        if (substr($bin, $pos, 4) !== "PK\x01\x02") break;
        $h = unpack('vmade/vneed/vflag/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/vxlen/vclen/vdisk/viattr/Veattr/Vlocal', substr($bin, $pos + 4, 42));
        $name = substr($bin, $pos + 46, $h['nlen']);
        $pos += 46 + $h['nlen'] + $h['xlen'] + $h['clen'];

        if (!array_key_exists($name, $out)) continue;

        $lh = unpack('vnlen/vxlen', substr($bin, $h['local'] + 26, 4));
        $raw = substr($bin, $h['local'] + 30 + $lh['nlen'] + $lh['xlen'], $h['csize']);
        if ($h['method'] === 0) {
            $out[$name] = $raw;
        } elseif ($h['method'] === 8) {
            $data = @gzinflate($raw);
            if ($data === false) throw new XlsxReadException('Gagal mengekstrak isi file .xlsx.');
            $out[$name] = $data;
        } else {
            throw new XlsxReadException('Metode kompresi file .xlsx tidak didukung.');
        }
    }
    return $out;
}

/** "AB12" -> 27 (index kolom 0-based). */
function xlsx_col_index(string $ref): int
{
    $letters = preg_replace('/[^A-Z]/', '', strtoupper($ref));
    $n = 0;
    for ($i = 0, $len = strlen($letters); $i < $len; $i++) {
        $n = $n * 26 + (ord($letters[$i]) - 64);
    }
    return $n - 1;
}

function xlsx_load_xml(?string $xml): ?SimpleXMLElement
{
    if ($xml === null || $xml === '') return null;
    $prev = libxml_use_internal_errors(true);
    $el = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NONET | LIBXML_COMPACT);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    return $el === false ? null : $el;
}

/** Gabungkan semua <t> di dalam elemen string (termasuk rich text <r><t>). */
function xlsx_text(SimpleXMLElement $el): string
{
    $m = $el->children(XLSX_NS_MAIN);
    if (isset($m->t)) return (string) $m->t;
    $s = '';
    foreach ($m->r as $r) {
        $s .= (string) $r->children(XLSX_NS_MAIN)->t;
    }
    return $s;
}

function xlsx_read_rows(string $path, int $maxRows = 10000): array
{
    if (!function_exists('simplexml_load_string')) {
        throw new XlsxReadException('Ekstensi PHP "SimpleXML" tidak aktif di server - aktifkan dulu (biasanya sudah aktif default di XAMPP/cPanel).');
    }

    // 1. Cari lokasi sheet pertama lewat workbook.xml + rels.
    $meta = xlsx_zip_extract($path, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']);
    if ($meta['xl/workbook.xml'] === null) {
        throw new XlsxReadException('File bukan .xlsx yang valid. Pastikan disimpan sebagai "Excel Workbook (*.xlsx)", bukan .xls / .csv.');
    }

    $sheetPath = 'xl/worksheets/sheet1.xml';
    $wb = xlsx_load_xml($meta['xl/workbook.xml']);
    $rels = xlsx_load_xml($meta['xl/_rels/workbook.xml.rels']);
    if ($wb && $rels) {
        $sheets = $wb->children(XLSX_NS_MAIN)->sheets;
        if ($sheets && isset($sheets->children(XLSX_NS_MAIN)->sheet[0])) {
            $rid = (string) $sheets->children(XLSX_NS_MAIN)->sheet[0]->attributes(XLSX_NS_REL)['id'];
            foreach ($rels->children() as $rel) {
                if ((string) $rel['Id'] === $rid) {
                    $target = ltrim((string) $rel['Target'], '/');
                    $sheetPath = strpos($target, 'xl/') === 0 ? $target : 'xl/' . $target;
                    break;
                }
            }
        }
    }

    // 2. Shared strings.
    $shared = [];
    $ss = xlsx_load_xml($meta['xl/sharedStrings.xml']);
    if ($ss) {
        foreach ($ss->children(XLSX_NS_MAIN)->si as $si) {
            $shared[] = xlsx_text($si);
        }
    }

    // 3. Baca sel.
    $sheetXml = xlsx_zip_extract($path, [$sheetPath])[$sheetPath];
    $sheet = xlsx_load_xml($sheetXml);
    if (!$sheet) throw new XlsxReadException('Sheet pertama di file .xlsx tidak bisa dibaca.');

    $rows = [];
    $data = $sheet->children(XLSX_NS_MAIN)->sheetData;
    if (!$data) return $rows;

    $autoRow = 0;
    foreach ($data->children(XLSX_NS_MAIN)->row as $row) {
        $ra = $row->attributes();
        $rowNum = (int) ($ra['r'] ?? 0) ?: ($autoRow + 1);
        $autoRow = $rowNum;
        if (count($rows) >= $maxRows) {
            throw new XlsxReadException("File terlalu besar - maksimal $maxRows baris per import. Pecah jadi beberapa file.");
        }

        $cells = [];
        $autoCol = -1;
        foreach ($row->children(XLSX_NS_MAIN)->c as $c) {
            $ca = $c->attributes();
            $col = isset($ca['r']) ? xlsx_col_index((string) $ca['r']) : $autoCol + 1;
            $autoCol = $col;
            $type = isset($ca['t']) ? (string) $ca['t'] : 'n';
            $m = $c->children(XLSX_NS_MAIN);
            $v = isset($m->v) ? (string) $m->v : null;

            switch ($type) {
                case 's':         $val = $v !== null ? ($shared[(int) $v] ?? '') : ''; break;
                case 'inlineStr': $val = isset($m->is) ? xlsx_text($m->is) : ''; break;
                case 'str':       $val = (string) $v; break;
                case 'b':         $val = $v === '1' ? 'TRUE' : 'FALSE'; break;
                case 'e':         $val = ''; break; // #N/A, #REF! dsb dianggap kosong
                default:          $val = ($v === null || $v === '') ? '' : (is_numeric($v) ? (float) $v : $v);
            }
            if (is_string($val)) $val = trim($val);
            $cells[$col] = $val;
        }

        // Lewati baris yang benar-benar kosong.
        $hasValue = false;
        foreach ($cells as $x) { if ($x !== '' && $x !== null) { $hasValue = true; break; } }
        if ($hasValue) $rows[$rowNum] = $cells;
    }
    return $rows;
}
