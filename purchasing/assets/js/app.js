/* =========================================================
   PANCA PUTRA MADANI - FRONTEND LOGIC (Purchasing + Finance)
   Semua data sekarang diambil/disimpan lewat REST API PHP
   (api/*.php) yang terhubung ke MariaDB, BUKAN localStorage lagi.
   ========================================================= */

// ===================== GLOBAL STATE =====================
let customers = [];
let suppliers = [];
let workOrders = [];
let prItems = [];
let sealItems = [];
let transportItems = [];
let masterProducts = [];
let masterBuyers = [];
let roles = []; // dikelola lewat menu Role Management, dipakai untuk dropdown role user

// --- State modul Gudang & Produksi ---
let inventoryItems = [];
let productionOrders = [];
let inventoryMovements = [];
let karyawanList = [];
let headerDefaultBuyerId = ''; // default Buyer dari field header PR, dipakai saat menambah item baru

// --- State modul MTC Produksi ---
let mtcMesinList = [];
let mtcMpList = [];
let mtcDivisiList = []; // 16 divisi baku dari server
let mtcDashboardData = [];
let mtcCurrentWOId = ''; // WO yang sedang dipilih di Modul Divisi Produksi
let mtcCurrentWOBudgetItems = []; // Item Pekerjaan milik WO yang sedang dipilih
let mtcCurrentRecords = []; // Record divisi milik WO yang sedang dipilih

// --- State modul Finance ---
let arData = [];
let apData = [];
let danaTalangan = [];
let sjData = []; // Surat Jalan (dimuat saat tab Surat Jalan dibuka)
let cashflowCombined = []; // hasil GET api/cashflow.php (gabungan AR+AP+manual, sudah ada saldo berjalan)
let chartCashflowTrendInstance = null;
let chartArAgingInstance = null;
let chartWOPipelineInstance = null;
let masterUsers = []; // akun login sekaligus master "User/Peminta"

let supplierChartObj = null;
let statusChartObj = null;

const currentUser = window.CURRENT_USER || null;
const CSRF_TOKEN = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
let appModules = {}; // katalog modul -> menu (dari api/roles.php), dipakai form Role Management

// ===================== HAK AKSES MENU =====================
// Hanya untuk menyembunyikan menu/tombol & tidak memuat data yang tidak perlu.
// Pengaman SEBENARNYA ada di server (require_perm di tiap api/*.php).
// currentUser.access = {"dashboard":"edit","stok":"view", ...}
const USER_ACCESS = (currentUser && currentUser.access) || {};
const IS_ADMIN = !!(currentUser && currentUser.is_admin);
/** Boleh melihat minimal salah satu menu. */
function canView(...menus) {
  return IS_ADMIN || menus.some(m => !!USER_ACCESS[m]);
}
/**
 * Izin khusus data sensitif: Nilai PO / harga jual WO, Profit & Loss, Margin.
 * Tanpa izin ini server sudah TIDAK mengirim nilainya (null) - di UI kolom/kartunya
 * disembunyikan supaya tidak tampil "Rp 0" yang menyesatkan.
 */
const CAN_NILAI = IS_ADMIN || !!USER_ACCESS.cap_nilai_po;
let appCapabilities = {}; // katalog izin khusus (dari api/roles.php), untuk form Role Management
// Status Surat Jalan (modul Finance) - dipakai tabel SJ, tabel WO & Dashboard MTC.
const SJ_STATUS_CFG = {
  DELIVERY: { l: 'Delivery', c: 'bg-amber-100 text-amber-800 border-amber-200' },
  DONE: { l: 'Done', c: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  HOLD: { l: 'Hold', c: 'bg-slate-200 text-slate-700 border-slate-300' },
  WARRANTY: { l: 'Warranty', c: 'bg-purple-100 text-purple-800 border-purple-200' },
  CANCEL: { l: 'Cancel', c: 'bg-rose-100 text-rose-800 border-rose-200' },
};
function sjStatusBadge(status, extra = '') {
  const cfg = SJ_STATUS_CFG[status] || { l: status || '-', c: 'bg-slate-100 text-slate-600 border-slate-200' };
  return `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.c}">${esc(cfg.l)}${extra}</span>`;
}
/** Boleh tambah/ubah/hapus di minimal salah satu menu. */
function canEdit(...menus) {
  return IS_ADMIN || menus.some(m => USER_ACCESS[m] === 'edit');
}
/** Modul level-1 (Purchasing/Gudang/...) tampil kalau minimal 1 menunya boleh dilihat. */
function can(section) {
  return (SECTION_TABS[section] || []).some(t => canView(t));
}
const ALL_MODULE_KEYS = ['purchasing', 'produksi', 'masterdata', 'gudang', 'finance', 'mtc'];
// Aturan baca data per endpoint - harus sama dengan aturan require_perm() di server.
const READ_RULES = {
  workOrders: () => IS_ADMIN || Object.keys(USER_ACCESS).length > 0,
  prItems: () => canView('dashboard', 'incoming', 'receiving', 'tracking', 'findash'),
  sealItems: () => canView('seal', 'tracking', 'findash'),
  transportItems: () => canView('transport', 'tracking', 'findash'),
  masterUsers: () => IS_ADMIN,
  ar: () => canView('ar', 'findash', 'cashflow'),
  ap: () => canView('ap', 'findash', 'cashflow'),
  cashflow: () => canView('cashflow', 'findash', 'talangan'),
  talangan: () => canView('talangan', 'findash', 'cashflow'),
  sj: () => canView('sj'),
  inventoryItems: () => canView('stok', 'receiving', 'produksi', 'riwayat', 'tracking'),
  inventoryMovements: () => canView('riwayat', 'stok', 'receiving', 'produksi'),
  productionOrders: () => canView('produksi', 'riwayat', 'stok', 'tracking'),
  mtcMaster: () => canView('mtcmaster', 'mtcdivisi', 'mtcdash'),
};
/** Panggil api() hanya kalau boleh, selain itu kembalikan array kosong. */
function apiIf(allowed, url) {
  return allowed ? api(url) : Promise.resolve([]);
}

// ===================== API HELPER =====================
/**
 * Wrapper fetch() terpusat. Otomatis kirim/terima JSON,
 * dan redirect ke login.php kalau session habis (401).
 */
async function api(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
    credentials: 'same-origin',
  };
  if (body !== null) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    throw new Error('Tidak bisa terhubung ke server. Cek koneksi internet Anda.');
  }

  if (res.status === 401) {
    window.location.href = 'login.php';
    throw new Error('Sesi berakhir, mengalihkan ke halaman login...');
  }

  let json;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch (err) {
    // Biasanya karena PHP mengeluarkan pesan error/warning (bukan JSON).
    // Tampilkan file API-nya + cuplikan pesan supaya mudah dilacak.
    const endpoint = url.split('?')[0].replace(/^.*\//, '');
    const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    console.error(`[API] Respons tidak valid dari ${url} (HTTP ${res.status}):\n`, text);
    throw new Error(`Respons server tidak valid dari ${endpoint} (HTTP ${res.status})${snippet ? ': ' + snippet : ''}. Buka cek_instalasi.php untuk diagnosa.`);
  }

  if (!json.success) {
    throw new Error(json.message || 'Terjadi kesalahan.');
  }
  return json.data;
}

// ===================== TOAST NOTIFICATION =====================
let toastTimer = null;
// ===================== MODAL KONFIRMASI YA / TIDAK =====================
/**
 * Pengganti confirm() bawaan browser. Mengembalikan Promise<boolean>.
 * Pemakaian: if (!(await showConfirm('Detail...'))) return;
 */
function showConfirm(message = '', opts = {}) {
  const isDelete = opts.danger !== undefined ? opts.danger : /^hapus/i.test(message);
  const title = opts.title || (isDelete ? 'Apakah anda yakin ingin menghapus item ini?' : 'Konfirmasi');
  const modal = document.getElementById('confirm-modal');
  if (!modal) return Promise.resolve(window.confirm(title + '\n' + message));

  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;
  const yesBtn = document.getElementById('confirm-modal-yes');
  const noBtn = document.getElementById('confirm-modal-no');
  yesBtn.textContent = opts.yesText || 'YA';
  noBtn.textContent = opts.noText || 'TIDAK';
  yesBtn.className = 'flex-1 text-white text-sm font-bold py-2.5 rounded-xl transition ' +
    (isDelete ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700');
  const icon = document.getElementById('confirm-modal-icon');
  icon.className = 'mx-auto w-14 h-14 rounded-full flex items-center justify-center text-2xl mb-4 ' +
    (isDelete ? 'bg-rose-100 text-rose-500' : 'bg-amber-100 text-amber-500');

  modal.classList.remove('hidden');
  return new Promise(resolve => {
    const close = (val) => {
      modal.classList.add('hidden');
      yesBtn.onclick = noBtn.onclick = modal.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    yesBtn.onclick = () => close(true);
    noBtn.onclick = () => close(false);
    modal.onclick = (e) => { if (e.target === modal) close(false); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => noBtn.focus(), 0);
  });
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'fixed bottom-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-lg text-xs font-bold text-white ' +
    (type === 'success' ? 'bg-emerald-600' : type === 'error' ? 'bg-rose-600' : 'bg-slate-800');
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

function showApiError(err) {
  console.error(err);
  showToast(err.message || 'Terjadi kesalahan.', 'error');
}

// ===================== FORMAT HELPERS =====================
// Angka di semua grafik (sumbu & tooltip) memakai format Indonesia: 60.000.000 (bukan 60,000,000).
if (typeof Chart !== 'undefined') Chart.defaults.locale = 'id-ID';

function formatRupiah(num) {
  // Tampilan Rupiah dibulatkan ke rupiah penuh (Rp 2.676.475), nilai asli di database tetap utuh.
  return 'Rp ' + Math.round(Number(num) || 0).toLocaleString('id-ID');
}

// ===================== INPUT UANG FORMAT RUPIAH (12.500.000) =====================
// Kolom isian uang tampil dengan pemisah ribuan saat diketik / dibuka. Supaya SEMUA kode lama
// (parseFloat(el.value), el.value = 5000000, form.reset) tetap jalan tanpa diubah, properti
// .value elemen tsb di-override: yang TAMPIL "12.500.000", yang DIBACA kode "12500000".
// Desimal pakai koma (12.500,5). Elemen baru (baris item PR/MTC/WO dll.) ikut otomatis.
const MONEY_INPUT_SELECTOR = [
  '#wo-form-harga-satuan', '#wo-form-diskon', '#wo-form-budget-prod', '#wo-form-aktual-prod', '#wo-form-budget-pem',
  '#wo-form-budget-lain', '#wo-form-total-lain', '#transport-harga', '#inv-harga', '#mtcm-harga', '#mtcmp-harga',
  '#cf-nominal', '#cf-pph23', '#ar-penjualan', '#ar-pph23', '#ar-biaya-lain', '#ar-terbayar', '#ap-pembelian',
  '#ap-biaya-lain', '#ap-terbayar', '#talangan-pinjaman',
  '.pri-harga', '.mtci-harga', '.seali-harga', '.wobi-budget', '.wobi-actual',
].join(', ');
const NATIVE_INPUT_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/** Teks tampilan Indonesia ("12.500.000,5") -> string angka JS ("12500000.5"). Kosong -> ''. */
function moneyRawFromDisplay(txt) {
  let t = String(txt ?? '').replace(/[^\d,\-]/g, '');
  if (!/\d/.test(t)) return '';
  const neg = t.startsWith('-');
  t = t.replace(/-/g, '');
  const [i, d = ''] = t.split(',');
  const num = (i.replace(/^0+(?=\d)/, '') || '0') + (d ? '.' + d.slice(0, 2) : '');
  return (neg ? '-' : '') + num;
}
/** Nilai dari kode (5000000 / "5000000.00") -> tampilan "5.000.000". */
function moneyDisplayFromValue(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  const n = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number(moneyRawFromDisplay(s));
  if (!isFinite(n)) return '';
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
/** Format ulang saat mengetik, posisi kursor dijaga. */
function moneyReformatTyping(el) {
  const old = NATIVE_INPUT_VALUE.get.call(el);
  const caret = el.selectionStart ?? old.length;
  const sigBefore = old.slice(0, caret).replace(/[^\d,\-]/g, '').length; // digit/koma sebelum kursor
  let t = old.replace(/[^\d,\-]/g, '');
  const neg = t.startsWith('-');
  t = t.replace(/-/g, '');
  const firstComma = t.indexOf(',');
  let intPart = firstComma >= 0 ? t.slice(0, firstComma) : t;
  const decPart = firstComma >= 0 ? t.slice(firstComma + 1).replace(/,/g, '').slice(0, 2) : null;
  intPart = intPart.replace(/^0+(?=\d)/, '');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const out = (neg ? '-' : '') + grouped + (decPart !== null ? ',' + decPart : '');
  NATIVE_INPUT_VALUE.set.call(el, out);
  let pos = 0, seen = 0;
  while (pos < out.length && seen < sigBefore) { if (/[\d,\-]/.test(out[pos])) seen++; pos++; }
  try { el.setSelectionRange(pos, pos); } catch (e) { /* abaikan */ }
}
function enhanceMoneyInput(el) {
  if (!(el instanceof HTMLInputElement) || el.dataset.money === '1') return;
  const raw = NATIVE_INPUT_VALUE.get.call(el);
  el.dataset.money = '1';
  el.type = 'text';
  el.inputMode = 'decimal';
  el.autocomplete = 'off';
  if (el.defaultValue && /^-?\d+(\.\d+)?$/.test(el.defaultValue)) el.defaultValue = moneyDisplayFromValue(el.defaultValue); // untuk form.reset()
  Object.defineProperty(el, 'value', {
    configurable: true,
    get() { return moneyRawFromDisplay(NATIVE_INPUT_VALUE.get.call(this)); },
    set(v) { NATIVE_INPUT_VALUE.set.call(this, moneyDisplayFromValue(v)); },
  });
  el.value = raw;
  el.addEventListener('input', () => moneyReformatTyping(el));
}
function enhanceMoneyInputsIn(root) {
  if (root.matches && root.matches(MONEY_INPUT_SELECTOR)) enhanceMoneyInput(root);
  if (root.querySelectorAll) root.querySelectorAll(MONEY_INPUT_SELECTOR).forEach(enhanceMoneyInput);
}
document.addEventListener('DOMContentLoaded', () => {
  enhanceMoneyInputsIn(document.body);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) enhanceMoneyInputsIn(n); })))
    .observe(document.body, { childList: true, subtree: true });
});

// Terima format Y-m-d (dari <input type=date> / MySQL DATE) -> tampilkan DD/MM/YYYY
function formatDateID(dateStr) {
  if (!dateStr) return '-';
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ===================== PRINT / CETAK DOKUMEN =====================
// Semua "Print" di aplikasi ini pakai dialog print bawaan browser (window.print()),
// bukan generate PDF di server - jadi tinggal "Save as PDF" dari dialog print kalau
// butuh file PDF-nya.

function openPrintWindow(title, bodyHtml) {
  const win = window.open('', '_blank', 'width=900,height=1100');
  if (!win) {
    showToast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.');
    return;
  }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>
      /* Kertas A4 portrait. Konten dibatasi selebar area cetak A4 (210mm - 2x12mm),
         supaya hasil print/PDF tidak "diperkecil paksa" mengikuti lebar monitor. */
      @page { size: A4 portrait; margin: 12mm; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; line-height: 1.35; color: #1e293b; background: #e2e8f0; }
      .sheet { width: 186mm; min-height: 273mm; margin: 12px auto; padding: 0; background: #fff; }
      @media screen { .sheet { padding: 12mm; width: 210mm; box-shadow: 0 2px 12px rgba(0,0,0,.15); } }
      @media print { body { background: #fff; } .sheet { margin: 0; min-height: 0; box-shadow: none; } }

      h1 { font-size: 14pt; margin: 0 0 2px; }
      h2 { font-size: 10.5pt; margin: 0 0 10px; color: #475569; font-weight: 600; }
      .print-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2.5px solid #1e293b; padding-bottom: 8px; margin-bottom: 12px; }
      .print-header .company { font-size: 13pt; font-weight: 800; letter-spacing: .3px; }
      .print-header .doc-no { text-align: right; font-size: 10pt; font-weight: 700; white-space: nowrap; }

      /* Info dokumen: label kolom tetap, isi membungkus rapi di sebelahnya (tidak turun ke bawah label). */
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 18px; margin-bottom: 12px; }
      .meta-grid > div { display: grid; grid-template-columns: 30mm 1fr; column-gap: 6px; align-items: start; }
      .meta-grid > div.full { grid-column: 1 / -1; }
      .meta-grid span.lbl { color: #64748b; }
      .meta-grid .val { overflow-wrap: anywhere; font-weight: 600; }

      table { width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
      th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; font-size: 8.5pt; overflow-wrap: anywhere; word-break: normal; }
      th { background: #f1f5f9; font-weight: 700; text-transform: uppercase; font-size: 7.5pt; vertical-align: middle; }
      td.num, th.num { text-align: right; white-space: nowrap; overflow-wrap: normal; }
      td.center, th.center { text-align: center; }
      thead { display: table-header-group; }   /* header tabel diulang di tiap halaman */
      tr { page-break-inside: avoid; break-inside: avoid; }
      .item-name { font-weight: 700; }
      .item-spec { color: #475569; font-size: 8pt; margin-top: 1px; }
      .item-desc { color: #334155; font-size: 8pt; margin-top: 3px; padding-top: 3px; border-top: 1px dashed #e2e8f0; white-space: pre-line; }

      .totals { margin-top: 8px; width: 75mm; margin-left: auto; break-inside: avoid; }
      .totals div { display: flex; justify-content: space-between; padding: 2px 0; }
      .totals .grand { border-top: 2px solid #1e293b; font-weight: 800; font-size: 10.5pt; padding-top: 5px; }
      .notes { margin-top: 10px; font-size: 8.5pt; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; break-inside: avoid; }
      .notes .lbl { color: #64748b; font-weight: 700; font-size: 7.5pt; text-transform: uppercase; }
      /* Total + tanda tangan selalu satu blok: tidak boleh terpisah halaman. */
      .closing { break-inside: avoid; page-break-inside: avoid; }
      .sign-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 6mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
      .sign-grid .box { border-top: 1px solid #1e293b; padding-top: 5px; margin-top: 16mm; font-weight: 600; font-size: 8.5pt; }
      .sign-grid .box .nm { font-weight: 400; color: #475569; margin-top: 1px; min-height: 1.2em; }
      .print-footer { margin-top: 4mm; font-size: 7pt; color: #94a3b8; text-align: right; }
    </style>
  </head><body><div class="sheet">${bodyHtml}</div></body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

function printPR(prNumber) {
  const items = prItems.filter(p => p.pr_number === prNumber).sort((a, b) => a.item_no - b.item_no);
  if (items.length === 0) { showToast('Data PR tidak ditemukan.'); return; }
  const head = items[0];
  const grandTotal = items.reduce((s, p) => s + Number(p.total), 0);
  const dppTotal = items.reduce((s, p) => s + Number(p.dpp || 0), 0);
  const ppnTotal = items.reduce((s, p) => s + Number(p.ppn_amount || 0), 0);

  // Customer / project: pakai data PR, kalau kosong ambil dari WO terkait.
  const wo = head.wo_id ? workOrders.find(w => Number(w.id) === Number(head.wo_id)) : null;
  const customer = head.customer_nama || (wo && wo.customer_nama) || '-';
  const project = head.project || (wo && wo.project) || '';
  // Info yang sama di semua item ditampilkan di atas; yang beda per item ditampilkan di baris item.
  const uniq = (fn) => [...new Set(items.map(fn).filter(Boolean))];
  const suppliers = uniq(p => p.supplier_nama);
  const poList = uniq(p => p.po_number);
  const invList = uniq(p => p.invoice_number);
  const val = (v) => `<span class="val">${esc(v || '-')}</span>`;
  const spec = (p) => [p.type, p.dimensi, p.brand].filter(x => x && x !== '-').map(esc).join(' / ');

  const rows = items.map(p => `
    <tr>
      <td class="center">${esc(p.item_no)}</td>
      <td>
        <div class="item-name">${esc(p.product || '-')}</div>
        ${spec(p) ? `<div class="item-spec">${spec(p)}</div>` : ''}
        ${suppliers.length > 1 && p.supplier_nama ? `<div class="item-spec">Supplier: ${esc(p.supplier_nama)}</div>` : ''}
        ${p.keterangan ? `<div class="item-desc">${esc(p.keterangan)}</div>` : ''}
      </td>
      <td class="center">${formatQty(p.qty)} ${esc(p.uom || '')}</td>
      <td class="num">${formatRupiah(p.harga)}</td>
      <td class="num">${Number(p.is_ppn) ? formatRupiah(p.ppn_amount) : '-'}</td>
      <td class="num">${formatRupiah(p.total)}</td>
    </tr>`).join('');

  const body = `
    <div class="print-header">
      <div><div class="company">PANCA PUTRA MADANI</div><div style="color:#64748b;">Sistem Purchasing, Work Order &amp; Keuangan</div></div>
      <div class="doc-no">PURCHASING REQUEST<br><span style="font-size:13pt;">${esc(head.pr_number)}</span></div>
    </div>
    <div class="meta-grid">
      <div><span class="lbl">Kategori</span>${val(head.sheet)}</div>
      <div><span class="lbl">Tanggal PR</span>${val(formatDateID(head.tanggal))}</div>
      <div><span class="lbl">User Peminta</span>${val(head.karyawan_nama || head.user_nama)}</div>
      <div><span class="lbl">Divisi</span>${val(head.divisi)}</div>
      <div><span class="lbl">No. WO</span>${val(head.wo_number)}</div>
      <div><span class="lbl">Buyer</span>${val(head.buyer_nama)}</div>
      <div class="full"><span class="lbl">Customer</span>${val(customer)}</div>
      ${project ? `<div class="full"><span class="lbl">Project</span>${val(project)}</div>` : ''}
      <div><span class="lbl">Supplier</span>${val(suppliers.length > 1 ? 'Lihat per item' : suppliers[0])}</div>
      <div><span class="lbl">Status</span>${val(head.status)}</div>
      <div><span class="lbl">No. PO</span>${val(poList.join(', '))}</div>
      <div><span class="lbl">No. Invoice</span>${val(invList.join(', '))}</div>
    </div>
    <table>
      <colgroup>
        <col style="width:8mm"><col><col style="width:22mm"><col style="width:27mm"><col style="width:24mm"><col style="width:28mm">
      </colgroup>
      <thead><tr><th class="center">No</th><th>Nama Barang / Spesifikasi</th><th class="center">Qty</th><th class="num">Harga Satuan</th><th class="num">PPN</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="closing">
    <div class="totals">
      <div><span>Subtotal (DPP)</span><span>${formatRupiah(dppTotal)}</span></div>
      <div><span>PPN</span><span>${formatRupiah(ppnTotal)}</span></div>
      <div class="grand"><span>GRAND TOTAL</span><span>${formatRupiah(grandTotal)}</span></div>
    </div>
    <div class="sign-grid">
      <div class="box">User Peminta<div class="nm">${esc(head.karyawan_nama || head.user_nama || '')}</div></div>
      <div class="box">Supervisor<div class="nm">${esc(head.atasan_karyawan_nama || head.leader_nama || '')}</div></div>
      <div class="box">Manager Produksi<div class="nm">${esc(head.manager_karyawan_nama || head.manager_nama || '')}</div></div>
    </div>
    <div class="print-footer">Dicetak ${new Date().toLocaleString('id-ID')}</div>
    </div>`;
  openPrintWindow(`PR ${head.pr_number}`, body);
}

function printWO(id) {
  const w = workOrders.find(x => x.id === id);
  if (!w) { showToast('Data WO tidak ditemukan.'); return; }
  const budgetRows = (w.budget_items || []).map(bi => `
    <tr><td>${esc(bi.nama_item)}</td><td class="num">${formatRupiah(bi.budget)}</td><td class="num">${formatRupiah(bi.actual)}</td></tr>
  `).join('') || `<tr><td colspan="3" class="center" style="color:#94a3b8;">Tidak ada rincian Item Pekerjaan</td></tr>`;

  const body = `
    <div class="print-header">
      <div><div class="company">PANCA PUTRA MADANI</div><div style="color:#64748b;">Sistem Purchasing, Work Order &amp; Keuangan</div></div>
      <div class="doc-no">WORK ORDER<br><span style="font-size:16px;">${esc(w.wo_number)}</span></div>
    </div>
    <div class="meta-grid">
      <div><span class="lbl">Kategori WO</span> ${esc(w.wo_category || '-')}</div>
      <div><span class="lbl">Estimasi Kirim</span> ${formatDateID(w.est_kirim)}</div>
      <div><span class="lbl">Nama Project</span> ${esc(w.project)}</div>
      <div><span class="lbl">Customer</span> ${esc(w.customer_nama || '-')}</div>
      <div><span class="lbl">No. PO Customer</span> ${esc(w.po_no || '-')}</div>
      <div><span class="lbl">Status</span> ${esc(w.status || '-')}</div>
      <div><span class="lbl">User Peminta</span> ${esc(w.requester_nama || '-')}</div>
      <div><span class="lbl">Atasan Direct</span> ${esc(w.atasan_nama || '-')}</div>
      <div><span class="lbl">Manager Head</span> ${esc(w.manager_nama || '-')}</div>
    </div>
    ${CAN_NILAI ? `<h2>Perhitungan Nilai Jual</h2>
    <table>
      <thead><tr><th>Qty</th><th>Satuan</th><th class="num">Harga Satuan</th><th class="num">Diskon</th><th class="num">DPP</th><th class="num">PPN</th><th class="num">PPh23</th><th class="num">Total</th></tr></thead>
      <tbody><tr>
        <td class="center">${formatQty(w.qty)}</td><td class="center">${esc(w.satuan)}</td>
        <td class="num">${formatRupiah(w.harga_satuan)}</td><td class="num">${formatRupiah(w.diskon)}</td>
        <td class="num">${formatRupiah(w.nilai_po)}</td><td class="num">${formatRupiah(w.ppn)}</td>
        <td class="num">${formatRupiah(w.pph23)}</td><td class="num" style="font-weight:800;">${formatRupiah(w.wo_total)}</td>
      </tr></tbody>
    </table>` : ''}
    <h2 style="margin-top:16px;">Budgeting Produksi Perusahaan</h2>
    <table>
      <thead><tr><th>Item Pekerjaan</th><th class="num">Budget</th><th class="num">Actual</th></tr></thead>
      <tbody>${budgetRows}</tbody>
    </table>
    <div class="totals">
      <div><span>Budget Produksi</span><span>${formatRupiah(w.budget_prod)}</span></div>
      <div><span>Aktual Produksi</span><span>${formatRupiah(w.aktual_prod)}</span></div>
      <div><span>Budget Pembelian</span><span>${formatRupiah(w.budget_pem)}</span></div>
      <div><span>Aktual Pembelian (DPP PR)</span><span>${formatRupiah(w.aktual_pem)}</span></div>
      ${CAN_NILAI ? `<div class="grand"><span>PROFIT / LOSS <small style="font-weight:400;">(DPP - Diskon - Total Produksi)</small></span><span>${formatRupiah(w.profit_loss)}</span></div>` : ''}
    </div>
    <div class="sign-grid">
      <div class="box">User Peminta</div>
      <div class="box">Atasan Direct</div>
      <div class="box">Manager Head</div>
    </div>`;
  openPrintWindow(`WO ${w.wo_number}`, body);
}

function printAR(id) {
  const a = arData.find(x => x.id === id);
  if (!a) { showToast('Data invoice tidak ditemukan.'); return; }
  const body = `
    <div class="print-header">
      <div><div class="company">PANCA PUTRA MADANI</div><div style="color:#64748b;">Sistem Purchasing, Work Order &amp; Keuangan</div></div>
      <div class="doc-no">INVOICE (AR)<br><span style="font-size:16px;">${esc(a.invoice_no)}</span></div>
    </div>
    <div class="meta-grid">
      <div><span class="lbl">Tanggal Invoice</span> ${formatDateID(a.tgl_invoice)}</div>
      <div><span class="lbl">Jatuh Tempo</span> ${formatDateID(a.due_date)}</div>
      <div><span class="lbl">Customer</span> ${esc(a.customer_nama || '-')}</div>
      <div><span class="lbl">No. WO</span> ${esc(a.wo_numbers || a.wo_number || '-')}</div>
      <div><span class="lbl">No. PO</span> ${esc(a.po_no || '-')}</div>
      <div><span class="lbl">Faktur Pajak</span> ${esc(a.faktur_pajak || '-')}</div>
    </div>
    <table>
      <thead><tr><th>Deskripsi</th><th class="num">Penjualan</th><th class="num">PPN</th><th class="num">PPh23</th><th class="num">Biaya Lain</th></tr></thead>
      <tbody><tr>
        <td>${esc(a.deskripsi || '-')}</td>
        <td class="num">${formatRupiah(a.penjualan)}</td>
        <td class="num">${Number(a.is_ppn) ? formatRupiah(a.ppn) : '-'}</td>
        <td class="num">${formatRupiah(a.pph23)}</td>
        <td class="num">${formatRupiah(a.biaya_lain)}</td>
      </tr></tbody>
    </table>
    <div class="totals">
      <div><span>Terbayar</span><span>${formatRupiah(a.terbayar)}</span></div>
      <div class="grand"><span>SISA TAGIHAN</span><span>${formatRupiah((Number(a.penjualan)+Number(a.ppn)-Number(a.pph23)+Number(a.biaya_lain)) - Number(a.terbayar))}</span></div>
    </div>
    <div class="sign-grid"><div class="box">Finance</div><div class="box">Customer</div></div>`;
  openPrintWindow(`Invoice ${a.invoice_no}`, body);
}

function printAP(id) {
  const a = apData.find(x => x.id === id);
  if (!a) { showToast('Data invoice tidak ditemukan.'); return; }
  const body = `
    <div class="print-header">
      <div><div class="company">PANCA PUTRA MADANI</div><div style="color:#64748b;">Sistem Purchasing, Work Order &amp; Keuangan</div></div>
      <div class="doc-no">INVOICE SUPPLIER (AP)<br><span style="font-size:16px;">${esc(a.invoice_no)}</span></div>
    </div>
    <div class="meta-grid">
      <div><span class="lbl">Tanggal Invoice</span> ${formatDateID(a.tgl_invoice)}</div>
      <div><span class="lbl">Jatuh Tempo</span> ${formatDateID(a.due_date)}</div>
      <div><span class="lbl">Supplier</span> ${esc(a.supplier_nama || '-')}</div>
      <div><span class="lbl">No. PO</span> ${esc(a.po_no || '-')}</div>
      <div><span class="lbl">Faktur Pajak</span> ${esc(a.faktur_pajak || '-')}</div>
    </div>
    <table>
      <thead><tr><th>Deskripsi</th><th class="num">Pembelian</th><th class="num">PPN</th><th class="num">PPh23</th><th class="num">Biaya Lain</th></tr></thead>
      <tbody><tr>
        <td>${esc(a.deskripsi || '-')}</td>
        <td class="num">${formatRupiah(a.pembelian)}</td>
        <td class="num">${Number(a.is_ppn) ? formatRupiah(a.ppn) : '-'}</td>
        <td class="num">${Number(a.is_pph23) ? formatRupiah(a.pph23) : '-'}</td>
        <td class="num">${formatRupiah(a.biaya_lain)}</td>
      </tr></tbody>
    </table>
    <div class="totals">
      <div><span>Terbayar</span><span>${formatRupiah(a.terbayar)}</span></div>
      <div class="grand"><span>SISA HUTANG</span><span>${formatRupiah((Number(a.pembelian)+Number(a.ppn)-Number(a.pph23)+Number(a.biaya_lain)) - Number(a.terbayar))}</span></div>
    </div>
    <div class="sign-grid"><div class="box">Finance</div><div class="box">Supplier</div></div>`;
  openPrintWindow(`Invoice ${a.invoice_no}`, body);
}

// Label tampilan role diambil dari data roles yang dimuat dari server
// (dikelola admin lewat menu Role Management) — bukan mapping statis lagi.
function roleLabel(roleKey) {
  const r = roles.find(x => x.role_key === roleKey);
  return r ? r.label : roleKey;
}
function isAdminRole(roleKey) {
  const r = roles.find(x => x.role_key === roleKey);
  return !!(r && Number(r.is_admin));
}

// ===================== TAB NAVIGATION =====================
const TAB_LOADERS = {
  overview: () => renderOverviewDashboard(),
  dashboard: () => renderDashboard(),
  tracking: () => renderWOTracking(),
  seal: () => renderSealTable(),
  transport: () => renderTransportTable(),
  customers: () => renderCustomerDirectory(),
  suppliers: () => renderSupplierDirectory(),
  master: () => renderMasterLists(),
  stok: () => renderStokTable(),
  incoming: () => renderIncomingTable(),
  receiving: () => renderReceivingTable(),
  produksi: () => renderProduksiTable(),
  riwayat: () => renderRiwayatTable(),
  findash: () => renderFinanceDashboard(),
  cashflow: () => renderCashflowTable(),
  ar: () => renderARTable(),
  ap: () => renderAPTable(),
  talangan: () => renderTalanganTable(),
  sj: () => loadSJTab(),
  mtcdash: () => renderMTCDashboard(),
  mtcdivisi: () => renderMTCDivisiTab(),
  mtcmaster: () => renderMTCMasterLists(),
  admin: () => renderAdminSection(),
};

// Modul level-1: tab mana termasuk section apa, dan urutan tab per-section.
const TAB_SECTION = {
  overview: 'overview',
  dashboard: 'purchasing', transport: 'purchasing',
  tracking: 'produksi', seal: 'produksi',
  customers: 'masterdata', suppliers: 'masterdata', master: 'masterdata',
  stok: 'gudang', produksi: 'gudang', riwayat: 'gudang', incoming: 'gudang', receiving: 'gudang',
  findash: 'finance', cashflow: 'finance', ar: 'finance', sj: 'finance', ap: 'finance', talangan: 'finance',
  mtcdash: 'mtc', mtcdivisi: 'mtc', mtcmaster: 'mtc',
  admin: 'admin',
};
const SECTION_TABS = {
  purchasing: ['dashboard', 'transport'],
  produksi: ['tracking', 'seal'],
  masterdata: ['customers', 'suppliers', 'master'],
  gudang: ['stok', 'incoming', 'receiving', 'produksi', 'riwayat'],
  finance: ['findash', 'cashflow', 'ar', 'sj', 'ap', 'talangan'],
  mtc: ['mtcdash', 'mtcdivisi', 'mtcmaster'],
};
// Ingat tab terakhir yang dibuka per-section, supaya balik ke section yang sama tidak selalu reset ke tab pertama.
const lastTabForSection = { purchasing: 'dashboard', produksi: 'tracking', masterdata: 'customers', gudang: 'stok', finance: 'findash', mtc: 'mtcdash' };

function switchTab(tab) {
  // Pengaman sisi client: non-admin tidak boleh masuk tab admin (biar tidak bisa
  // dipaksa lewat console browser). Aksi tulis di baliknya sudah diblokir di server juga.
  if (tab === 'admin' && !(currentUser && currentUser.is_admin)) {
    tab = 'overview';
  }
  // Menu yang tidak boleh dilihat role ini -> kembali ke Dashboard.
  const isMenuTab = ALL_MODULE_KEYS.includes(TAB_SECTION[tab]);
  if (isMenuTab && !canView(tab)) {
    tab = 'overview';
  }

  // Tampilkan/sembunyikan konten tab. Menu yang hanya boleh DILIHAT diberi class
  // perm-readonly -> tombol tambah/edit/hapus di dalamnya disembunyikan (lihat CSS di index.php).
  Object.keys(TAB_LOADERS).forEach(t => {
    const content = document.getElementById(`tab-content-${t}`);
    if (!content) return;
    content.classList.toggle('hidden', t !== tab);
    if (ALL_MODULE_KEYS.includes(TAB_SECTION[t])) content.classList.toggle('perm-readonly', !canEdit(t));
  });

  const section = TAB_SECTION[tab] || 'overview';

  // Update tombol level-1 (Dashboard / Purchasing / Gudang / Finance) di nav gelap.
  ['overview', 'purchasing', 'produksi', 'masterdata', 'gudang', 'finance', 'mtc'].forEach(s => {
    const btn = document.getElementById(`section-btn-${s}`);
    if (!btn) return;
    btn.className = 'px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap ' +
      (s === section ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white');
  });

  // Tombol Administrator ada di header (bukan nav gelap), style dasarnya beda —
  // cukup toggle ring highlight-nya saja, jangan timpa seluruh className.
  const adminBtn = document.getElementById('section-btn-admin');
  if (adminBtn) {
    adminBtn.classList.toggle('ring-2', section === 'admin');
    adminBtn.classList.toggle('ring-rose-300', section === 'admin');
  }

  // Tampilkan/sembunyikan sub-nav level-2 sesuai section aktif.
  ['purchasing', 'produksi', 'masterdata', 'gudang', 'finance', 'mtc'].forEach(s => {
    const sub = document.getElementById(`subnav-${s}`);
    if (sub) sub.classList.toggle('hidden', section !== s);
  });

  // Update tombol level-2 (tab di dalam section aktif) + ingat tab terakhir.
  if (SECTION_TABS[section]) {
    SECTION_TABS[section].forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      if (!btn) return;
      btn.className = 'px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap ' +
        (t === tab ? 'text-indigo-600 bg-indigo-50 border border-indigo-100' : 'text-slate-600 hover:bg-slate-100');
    });
    lastTabForSection[section] = tab;
  }

  if (TAB_LOADERS[tab]) TAB_LOADERS[tab]();
}

/** Dipanggil oleh tombol level-1 (Dashboard/Purchasing/Finance). */
function switchSection(section) {
  if (ALL_MODULE_KEYS.includes(section) && !can(section)) {
    showToast('Anda tidak memiliki akses ke modul ini.');
    return;
  }
  if (section === 'overview' || section === 'admin') {
    switchTab(section);
    return;
  }
  const last = lastTabForSection[section];
  const tab = (last && canView(last)) ? last : SECTION_TABS[section].find(t => canView(t));
  switchTab(tab || 'overview');
}

// ===================== INIT & LOAD DATA =====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  updateIncomingBadge();
  switchTab('overview');
});

async function loadAllData() {
  try {
    const [cust, supp, wo, pr, seal, trans, prod, buyers, users, rolesData, ar, ap, talangan, cashflow, invItems, prodOrders, invMoves, karyawanData, mesinData, mpData, divisiListData] = await Promise.all([
      api('api/customers.php'),
      api('api/suppliers.php'),
      apiIf(READ_RULES.workOrders(), 'api/work_orders.php'),
      apiIf(READ_RULES.prItems(), 'api/pr_items.php'),
      apiIf(READ_RULES.sealItems(), 'api/seal_items.php'),
      apiIf(READ_RULES.transportItems(), 'api/transport_items.php'),
      api('api/master.php?type=products'),
      api('api/master.php?type=buyers'),
      apiIf(READ_RULES.masterUsers(), 'api/master.php?type=users'),
      api('api/roles.php'),
      apiIf(READ_RULES.ar(), 'api/account_receivable.php'),
      apiIf(READ_RULES.ap(), 'api/account_payable.php'),
      apiIf(READ_RULES.talangan(), 'api/dana_talangan.php'),
      apiIf(READ_RULES.cashflow(), 'api/cashflow.php'),
      apiIf(READ_RULES.inventoryItems(), 'api/inventory_items.php'),
      apiIf(READ_RULES.productionOrders(), 'api/production_orders.php'),
      apiIf(READ_RULES.inventoryMovements(), 'api/inventory_movements.php'),
      api('api/master.php?type=karyawan'),
      apiIf(READ_RULES.mtcMaster(), 'api/mtc.php?resource=mesin'),
      apiIf(READ_RULES.mtcMaster(), 'api/mtc.php?resource=mp'),
      api('api/mtc.php?resource=divisi_list'),
    ]);
    customers = cust; suppliers = supp; workOrders = wo; prItems = pr;
    sealItems = seal; transportItems = trans;
    masterProducts = prod; masterBuyers = buyers; masterUsers = users;
    roles = rolesData.roles; appModules = rolesData.modules; appCapabilities = rolesData.capabilities || {};
    arData = ar; apData = ap; danaTalangan = talangan; cashflowCombined = cashflow;
    inventoryItems = invItems; productionOrders = prodOrders; inventoryMovements = invMoves;
    karyawanList = karyawanData;
    mtcMesinList = mesinData; mtcMpList = mpData; mtcDivisiList = divisiListData;

    updateDropdownOptions();
  } catch (err) {
    showApiError(err);
  }
}

/** Refresh subset data setelah operasi CRUD tertentu, tanpa reload semuanya. */
async function refresh(...keys) {
  const map = {
    customers: async () => (customers = await api('api/customers.php')),
    suppliers: async () => (suppliers = await api('api/suppliers.php')),
    workOrders: async () => (workOrders = await apiIf(READ_RULES.workOrders(), 'api/work_orders.php')),
    prItems: async () => (prItems = await apiIf(READ_RULES.prItems(), 'api/pr_items.php')),
    sealItems: async () => (sealItems = await apiIf(READ_RULES.sealItems(), 'api/seal_items.php')),
    transportItems: async () => (transportItems = await apiIf(READ_RULES.transportItems(), 'api/transport_items.php')),
    masterProducts: async () => (masterProducts = await api('api/master.php?type=products')),
    masterBuyers: async () => (masterBuyers = await api('api/master.php?type=buyers')),
    masterUsers: async () => (masterUsers = await apiIf(READ_RULES.masterUsers(), 'api/master.php?type=users')),
    roles: async () => { const d = await api('api/roles.php'); roles = d.roles; appModules = d.modules; appCapabilities = d.capabilities || {}; },
    arData: async () => (arData = await apiIf(READ_RULES.ar(), 'api/account_receivable.php')),
    apData: async () => (apData = await apiIf(READ_RULES.ap(), 'api/account_payable.php')),
    danaTalangan: async () => (danaTalangan = await apiIf(READ_RULES.talangan(), 'api/dana_talangan.php')),
    sjData: async () => (sjData = await apiIf(READ_RULES.sj(), 'api/surat_jalan.php')),
    cashflowCombined: async () => (cashflowCombined = await apiIf(READ_RULES.cashflow(), 'api/cashflow.php')),
    inventoryItems: async () => (inventoryItems = await apiIf(READ_RULES.inventoryItems(), 'api/inventory_items.php')),
    productionOrders: async () => (productionOrders = await apiIf(READ_RULES.productionOrders(), 'api/production_orders.php')),
    inventoryMovements: async () => (inventoryMovements = await apiIf(READ_RULES.inventoryMovements(), 'api/inventory_movements.php')),
    karyawanList: async () => (karyawanList = await api('api/master.php?type=karyawan')),
    mtcMesinList: async () => (mtcMesinList = await apiIf(READ_RULES.mtcMaster(), 'api/mtc.php?resource=mesin')),
    mtcMpList: async () => (mtcMpList = await apiIf(READ_RULES.mtcMaster(), 'api/mtc.php?resource=mp')),
  };
  await Promise.all(keys.map(k => map[k] ? map[k]() : Promise.resolve()));
  updateDropdownOptions();
}

// ===================== DROPDOWN POPULATOR =====================
function opt(value, label) {
  return `<option value="${esc(value)}">${esc(label)}</option>`;
}

function updateDropdownOptions() {
  // --- PR Form dropdowns ---
  const karyawanOptions = () => karyawanList.filter(k => k.status !== 'NON AKTIF')
    .map(k => opt(k.id, `${k.nama} (${k.divisi})`)).join('');

  const karSel = document.getElementById('form-karyawan-select');
  if (karSel) {
    const cur = karSel.value;
    karSel.innerHTML = '<option value="">-- Pilih Karyawan --</option>' + karyawanOptions();
    if (cur) karSel.value = cur;
  }
  const atasanSel = document.getElementById('form-atasan-select');
  if (atasanSel) {
    const cur = atasanSel.value;
    atasanSel.innerHTML = '<option value="">-- Pilih --</option>' + karyawanOptions();
    if (cur) atasanSel.value = cur;
  }
  const managerSel = document.getElementById('form-manager-select');
  if (managerSel) {
    const cur = managerSel.value;
    managerSel.innerHTML = '<option value="">-- Pilih --</option>' + karyawanOptions();
    if (cur) managerSel.value = cur;
  }
  const buyerHeaderSel = document.getElementById('form-buyer-header-select');
  if (buyerHeaderSel) {
    const cur = buyerHeaderSel.value;
    buyerHeaderSel.innerHTML = '<option value="">-- Pilih Buyer --</option>' + masterBuyers.map(b => opt(b.id, b.nama)).join('');
    if (cur) buyerHeaderSel.value = cur;
  }

  // --- WO Form dropdowns: karyawan (User Peminta / Atasan Direct / Manager Head) ---
  const woReqSel = document.getElementById('wo-form-requester-select');
  const woAtasanSel = document.getElementById('wo-form-atasan-select');
  const woManagerSel = document.getElementById('wo-form-manager-select');
  [woReqSel, woAtasanSel, woManagerSel].forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Pilih --</option>' + karyawanOptions();
    if (cur) sel.value = cur;
  });

  const woSelForm = document.getElementById('form-wo-select');
  if (woSelForm) {
    woSelForm.innerHTML = '<option value="">-- Tanpa WO --</option>' +
      workOrders.map(w => opt(w.id, `${w.wo_number} - ${w.project}`)).join('');
  }

  // --- Dropdown product/supplier/buyer di SETIAP blok item PR yang sedang terbuka ---
  document.querySelectorAll('#pr-items-container .pri-block').forEach(populateItemBlockDropdowns);

  // --- Karyawan: list Master Directory ---
  renderKaryawanList();

  // --- Role dropdown di form Add/Edit User (isinya dari Role Management) ---
  const muRoleSel = document.getElementById('mu-role');
  if (muRoleSel) {
    const cur = muRoleSel.value;
    muRoleSel.innerHTML = roles.map(r => opt(r.role_key, r.label + (Number(r.is_admin) ? ' (Admin Penuh)' : ''))).join('');
    if (cur) muRoleSel.value = cur;
  }

  // --- Filter dashboard: supplier ---
  const filterSupp = document.getElementById('filter-supplier');
  if (filterSupp) {
    const cur = filterSupp.value;
    filterSupp.innerHTML = '<option value="ALL">Semua Supplier</option>' +
      suppliers.map(s => opt(s.nama, s.nama)).join('');
    filterSupp.value = cur || 'ALL';
  }

  // --- WO Form: customer select ---
  const woCustSel = document.getElementById('wo-form-customer-select');
  if (woCustSel) {
    woCustSel.innerHTML = customers.map(c => opt(c.id, c.nama)).join('');
  }

  // --- WO Tracking filter: customer ---
  const woFilterCust = document.getElementById('filter-wo-customer');
  if (woFilterCust) {
    const cur = woFilterCust.value;
    woFilterCust.innerHTML = '<option value="ALL">Semua Customer</option>' +
      customers.map(c => opt(c.nama, c.nama)).join('');
    woFilterCust.value = cur || 'ALL';
  }

  // --- Seal & Transport: WO select ---
  const sealWo = document.getElementById('seal-wo-select');
  const transWo = document.getElementById('transport-wo-select');
  const woOptions = '<option value="">-- Pilih Work Order --</option>' +
    workOrders.map(w => opt(w.id, `${w.wo_number} - ${w.project}`)).join('');
  if (sealWo) sealWo.innerHTML = woOptions;
  if (transWo) transWo.innerHTML = woOptions;

  // --- Gudang & Produksi: WO select (opsional, boleh tanpa WO) ---
  const mvWo = document.getElementById('mv-wo-select');
  const prodWo = document.getElementById('prod-wo-select');
  const woOptionsOpsional = '<option value="">-- Tanpa WO --</option>' +
    workOrders.map(w => opt(w.id, `${w.wo_number} - ${w.project}`)).join('');
  if (mvWo) mvWo.innerHTML = woOptionsOpsional;
  if (prodWo) prodWo.innerHTML = woOptionsOpsional;

  // --- Gudang: dropdown Material (Riwayat Pergerakan) ---
  const mvItemSel = document.getElementById('mv-item-select');
  if (mvItemSel) {
    const cur = mvItemSel.value;
    mvItemSel.innerHTML = '<option value="">-- Pilih Material --</option>' +
      inventoryItems.map(i => opt(i.id, `${i.sku} - ${i.nama} (Stok: ${formatQty(i.stok_qty)} ${i.satuan})`)).join('');
    if (cur) mvItemSel.value = cur;
  }

  // --- Dropdown Material di SETIAP blok BOM Produksi yang sedang terbuka ---
  document.querySelectorAll('#bom-items-container .bomi-block').forEach(populateBomItemBlockDropdown);

  // --- Dropdown product di SETIAP blok item Seal CNC yang sedang terbuka ---
  document.querySelectorAll('#seal-items-container .seali-block').forEach(populateSealItemBlockDropdown);

  // --- Finance: AR form customer select ---
  ['ar-customer-select', 'sj-customer-select'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Pilih Customer --</option>' + customers.map(c => opt(c.id, c.nama)).join('');
    if (cur) sel.value = cur;
  });
  // --- Finance: AP form supplier select ---
  const apSuppSel = document.getElementById('ap-supplier-select');
  if (apSuppSel) {
    const cur = apSuppSel.value;
    apSuppSel.innerHTML = '<option value="">-- Pilih Supplier --</option>' + suppliers.map(s => opt(s.id, s.nama)).join('');
    if (cur) apSuppSel.value = cur;
  }
  // --- Finance: filter AR customer / AP supplier ---
  const filterArCust = document.getElementById('filter-ar-customer');
  if (filterArCust) {
    const cur = filterArCust.value;
    filterArCust.innerHTML = '<option value="ALL">Semua Customer</option>' + customers.map(c => opt(c.nama, c.nama)).join('');
    filterArCust.value = cur || 'ALL';
  }
  const filterApSupp = document.getElementById('filter-ap-supplier');
  if (filterApSupp) {
    const cur = filterApSupp.value;
    filterApSupp.innerHTML = '<option value="ALL">Semua Supplier</option>' + suppliers.map(s => opt(s.nama, s.nama)).join('');
    filterApSupp.value = cur || 'ALL';
  }
}

// ===================== DASHBOARD & PR MODULE =====================

function getFilteredPRData() {
  const search = (document.getElementById('filter-search')?.value || '').toLowerCase().trim();
  const sheet = document.getElementById('filter-sheet')?.value || 'ALL';
  const status = document.getElementById('filter-status')?.value || 'ALL';
  const ppn = document.getElementById('filter-ppn')?.value || 'ALL';
  const supplier = document.getElementById('filter-supplier')?.value || 'ALL';
  const approval = document.getElementById('filter-approval')?.value || 'ALL';

  return prItems.filter(p => {
    if (sheet !== 'ALL' && p.sheet !== sheet) return false;
    if (status !== 'ALL' && p.status !== status) return false;
    if (ppn === 'PPN' && !Number(p.is_ppn)) return false;
    if (ppn === 'NON_PPN' && Number(p.is_ppn)) return false;
    if (supplier !== 'ALL' && p.supplier_nama !== supplier) return false;
    if (approval === 'MINE') { if (!isMyApproval(p)) return false; }
    else if (approval !== 'ALL' && p.approval_status !== approval) return false;
    if (search) {
      const haystack = `${p.pr_number} ${p.keterangan || ''} ${p.wo_number || ''} ${p.po_number || ''} ${p.invoice_number || ''} ${p.customer_nama || ''} ${p.project || ''} ${p.product || ''} ${p.type || ''} ${p.dimensi || ''} ${p.brand || ''} ${p.supplier_nama || ''} ${p.user_nama || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function renderDashboard() {
  renderKPI();
  renderPRTable();
  renderCharts();
}

function renderKPI() {
  const filtered = getFilteredPRData();
  let totalSpend = 0, totalDPP = 0, totalPPN = 0, receivedCount = 0, cancelCount = 0;

  filtered.forEach(p => {
    totalSpend += Number(p.total) || 0;
    totalDPP += Number(p.dpp) || 0;
    totalPPN += Number(p.ppn_amount) || 0;
    if (p.status === 'RECEIVED') receivedCount++;
    if (p.status === 'CANCEL') cancelCount++;
  });

  const totalItems = filtered.length;
  document.getElementById('kpi-total-spend').textContent = formatRupiah(totalSpend);
  document.getElementById('kpi-total-dpp').textContent = formatRupiah(totalDPP);
  document.getElementById('kpi-total-ppn').textContent = formatRupiah(totalPPN);
  document.getElementById('kpi-received-count').textContent = receivedCount.toLocaleString('id-ID');
  document.getElementById('kpi-received-percent').textContent = (totalItems ? Math.round(receivedCount / totalItems * 100) : 0) + '% item';
  document.getElementById('kpi-cancel-count').textContent = cancelCount.toLocaleString('id-ID');
  document.getElementById('kpi-cancel-percent').textContent = (totalItems ? Math.round(cancelCount / totalItems * 100) : 0) + '% item';
}

function statusBadgeClass(status) {
  switch (status) {
    case 'RECEIVED': return 'bg-emerald-100 text-emerald-800';
    case 'PO ISSUED': return 'bg-blue-100 text-blue-800';
    case 'ON PROSES': return 'bg-amber-100 text-amber-800 animate-pulse';
    case 'STORE ROOM': return 'bg-purple-100 text-purple-800';
    case 'CANCEL': return 'bg-rose-100 text-rose-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}

// ===================== ALUR APPROVAL: Buyer buat -> Supervisor cek -> Manager Produksi approve =====================
// Status di database tetap PENDING_LEADER (= tahap Supervisor) & PENDING_MANAGER (= tahap Manager Produksi).
// Yang boleh approve diatur Admin lewat izin khusus di Role Management.
const CAN_APPROVE_SPV = IS_ADMIN || !!USER_ACCESS.cap_pr_approve_spv;
const CAN_APPROVE_MGR = IS_ADMIN || !!USER_ACCESS.cap_pr_approve_mgr;
const APPROVAL_LABELS = {
  PENDING_LEADER: 'Menunggu Supervisor',
  PENDING_MANAGER: 'Menunggu Manager Produksi',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};
function approvalLabel(status) {
  return APPROVAL_LABELS[status] || status || '-';
}
function approvalBadgeClass(status) {
  switch (status) {
    case 'PENDING_LEADER': return 'bg-amber-100 text-amber-800 animate-pulse';
    case 'PENDING_MANAGER': return 'bg-blue-100 text-blue-800 animate-pulse';
    case 'APPROVED': return 'bg-emerald-100 text-emerald-800';
    case 'REJECTED': return 'bg-rose-100 text-rose-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}

/** Tombol aksi approval yang relevan untuk PR baris ini, sesuai role user yang sedang login. */
function approvalActionButton(p) {
  if (!currentUser) return '';
  if (p.approval_status === 'PENDING_LEADER' && CAN_APPROVE_SPV) {
    return `<button onclick="openApprovalModal(${p.id})" class="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold" title="Cek sebagai Supervisor"><i class="fa-solid fa-magnifying-glass"></i> Cek</button>`;
  }
  if (p.approval_status === 'PENDING_MANAGER' && CAN_APPROVE_MGR) {
    return `<button onclick="openApprovalModal(${p.id})" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold" title="Approve sebagai Manager Produksi"><i class="fa-solid fa-stamp"></i> Approve</button>`;
  }
  if (p.approval_status === 'REJECTED') {
    return `<button onclick="resubmitPR(${p.id})" class="px-2 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-[10px] font-bold" title="Kirim ulang untuk direview dari awal"><i class="fa-solid fa-rotate-right"></i> Kirim Ulang</button>`;
  }
  return '';
}

/**
 * Tampilkan qty apa adanya (angka real, format Indonesia, tanpa nol berlebih):
 * 50 -> "50", 2.5 -> "2,5", 1500 -> "1.500". Database menyimpan 3 desimal
 * ("50.000") yang kalau ditampilkan mentah terbaca lima puluh ribu.
 */
function formatQty(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !isFinite(n)) return '-';
  return n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/** Nilai qty untuk diisi ke <input type="number"> saat Edit: "50.000" -> 50. */
function qtyInputValue(v, fallback = '') {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !isFinite(n) ? fallback : n;
}

/** "2026-10-07 14:05:33" -> "07/10/2026 14:05" */
function formatDateTimeID(dt) {
  if (!dt) return '';
  const [d, t = ''] = String(dt).split(' ');
  return `${formatDateID(d)}${t ? ' ' + t.slice(0, 5) : ''}`;
}

/**
 * Info approval terakhir di bawah badge Approval (otomatis dari aksi): mis. "Approve by Manager" + tanggal.
 * Riwayat lengkap (siapa & kapan untuk semua aksi) ada di Administrator -> Riwayat / Log Aplikasi.
 */
function prTimelineHtml(p) {
  let label = '', when = '', cls = 'text-emerald-700';
  const rejected = p.approval_status === 'REJECTED';
  if (p.manager_approved_at) { label = rejected ? 'Ditolak by Manager' : 'Approve by Manager'; when = p.manager_approved_at; }
  else if (p.leader_checked_at) { label = rejected ? 'Ditolak by Supervisor' : 'Approve by Supervisor'; when = p.leader_checked_at; cls = rejected ? '' : 'text-amber-700'; }
  if (!label) return '';
  if (rejected) cls = 'text-rose-600';
  return `<div class="mt-1 text-[10px] leading-tight ${cls}"><div class="font-semibold">${label}</div><div class="text-slate-500">${esc(formatDateTimeID(when))}</div></div>`;
}

/** PR ini sedang menunggu approval di tahap milik user yang login? */
function isMyApproval(p) {
  return (p.approval_status === 'PENDING_LEADER' && CAN_APPROVE_SPV) || (p.approval_status === 'PENDING_MANAGER' && CAN_APPROVE_MGR);
}
const prApproveSel = new Set(); // PR yang dicentang untuk approval massal

function toggleApprovePick(id, checked) {
  if (checked) prApproveSel.add(id); else prApproveSel.delete(id);
  renderPRApprovalBar();
}

/** Bar "Approval Massal" di atas tabel PR (hanya untuk role yang punya izin approval). */
function renderPRApprovalBar() {
  const bar = document.getElementById('pr-approval-bar');
  if (!bar) return;
  if (!CAN_APPROVE_SPV && !CAN_APPROVE_MGR) { bar.classList.add('hidden'); return; }
  const mine = getFilteredPRData().filter(isMyApproval);
  // Buang pilihan yang sudah tidak menunggu approval user ini (mis. sudah diproses).
  [...prApproveSel].forEach(id => { const p = prItems.find(x => x.id === id); if (!p || !isMyApproval(p)) prApproveSel.delete(id); });
  const stage = [CAN_APPROVE_SPV ? 'Supervisor' : '', CAN_APPROVE_MGR ? 'Manager Produksi' : ''].filter(Boolean).join(' & ');
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
      <div class="text-amber-900"><i class="fa-solid fa-stamp mr-1"></i><b>Approval Massal</b> (${esc(stage)}) &middot;
        <b>${mine.length}</b> PR menunggu approval Anda${mine.length ? ' di tampilan ini' : ''} &middot; <b>${prApproveSel.size}</b> dipilih</div>
      <div class="flex flex-wrap items-center gap-1.5">
        <button type="button" onclick="pickAllMyApprovals()" ${mine.length ? '' : 'disabled'} class="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 font-bold hover:bg-amber-100 disabled:opacity-40"><i class="fa-solid fa-check-double mr-1"></i>Pilih Semua (${mine.length})</button>
        <button type="button" onclick="prApproveSel.clear(); renderPRTable();" ${prApproveSel.size ? '' : 'disabled'} class="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-600 font-bold hover:bg-slate-50 disabled:opacity-40">Kosongkan</button>
        <button type="button" onclick="bulkApprovePR('reject')" ${prApproveSel.size ? '' : 'disabled'} class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold disabled:opacity-40"><i class="fa-solid fa-xmark mr-1"></i>Tolak Terpilih</button>
        <button type="button" onclick="bulkApprovePR('approve')" ${prApproveSel.size ? '' : 'disabled'} class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40"><i class="fa-solid fa-stamp mr-1"></i>Setujui Terpilih (${prApproveSel.size})</button>
      </div>
    </div>`;
}

function pickAllMyApprovals() {
  getFilteredPRData().filter(isMyApproval).forEach(p => prApproveSel.add(p.id));
  renderPRTable();
}

async function bulkApprovePR(decision) {
  const ids = [...prApproveSel];
  if (!ids.length) return;
  const verb = decision === 'approve' ? 'SETUJUI' : 'TOLAK';
  if (!(await showConfirm(`${verb} ${ids.length} PR yang dipilih? PR dari tahap Supervisor akan diteruskan ke Manager Produksi; PR di tahap Manager Produksi menjadi final.`))) return;
  try {
    // Dikirim per 500 PR (batas server) supaya "Pilih Semua" ribuan PR tetap jalan.
    let processed = 0, skipped = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const res = await api('api/pr_items.php?action=bulk_approve', 'POST',
        { ids: ids.slice(i, i + 500), decision, note: decision === 'approve' ? 'Approval massal' : 'Ditolak (massal)' });
      processed += res.processed; skipped += res.skipped;
    }
    showToast(`${processed} PR ${decision === 'approve' ? 'disetujui' : 'ditolak'}${skipped ? `, ${skipped} dilewati` : ''}.`);
    prApproveSel.clear();
    await refresh('prItems');
    renderDashboard();
  } catch (err) {
    showApiError(err);
  }
}

function renderPRTable() {
  renderPRApprovalBar();
  const SHEET_BADGE = {
    PROJECT: 'bg-indigo-100 text-indigo-800', GENERAL: 'bg-slate-200 text-slate-700',
    CONSUMABLE: 'bg-emerald-100 text-emerald-800', MAINTENANCE: 'bg-amber-100 text-amber-800', INVENTARIS: 'bg-purple-100 text-purple-800',
  };
  const tbody = document.getElementById('pr-table-body');
  const filtered = getFilteredPRData();
  document.getElementById('table-count').textContent = `${filtered.length} Items`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="18" class="text-center py-8 text-slate-400 font-semibold">Tidak ada data Purchasing Request yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows('pr', sortRows('pr', filtered)).map(p => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-3 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="printPR('${esc(p.pr_number)}')" class="p-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition" title="Print PR"><i class="fa-solid fa-print"></i></button>
          <button onclick="openModal('edit', ${p.id})" class="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deletePRItem(${p.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${SHEET_BADGE[p.sheet] || 'bg-slate-200 text-slate-700'}">${esc(p.sheet)}</span></td>
      <td class="py-2.5 px-3 font-mono">${formatDateID(p.tanggal)}</td>
      <td class="py-2.5 px-3 font-extrabold text-indigo-900">${esc(p.pr_number)}</td>
      <td class="py-2.5 px-3 text-center bg-indigo-50/40 font-bold">${esc(p.item_no)}</td>
      <td class="py-2.5 px-3 min-w-[220px]">
        <div class="font-bold text-slate-800">${esc(p.wo_number || '-')}</div>
        <div class="text-[11px] text-slate-600">${esc(p.project || '-')}</div>
        <div class="text-[10px] text-slate-400 font-semibold">${esc(p.customer_nama || '-')}</div>
      </td>
      <td class="py-2.5 px-3 min-w-[200px]">
        <div class="font-semibold text-slate-800">${esc(p.product || '-')}</div>
        <div class="text-[11px] text-slate-500">${esc(p.type || '-')} / ${esc(p.dimensi || '-')} / ${esc(p.brand || '-')}</div>
      </td>
      <td class="py-2.5 px-3 min-w-[180px] max-w-[260px] whitespace-normal text-[11px] text-slate-600" title="${esc(p.keterangan || '')}">${p.keterangan ? esc(p.keterangan) : '<span class="text-slate-300">-</span>'}</td>
      <td class="py-2.5 px-3 text-center font-mono whitespace-nowrap">${formatQty(p.qty)} ${esc(p.uom || '')}</td>
      <td class="py-2.5 px-3 text-right font-mono">${formatRupiah(p.harga)}</td>
      <td class="py-2.5 px-3 text-right font-mono text-[11px]">
        <div>DPP: ${formatRupiah(p.dpp)}</div>
        <div class="text-purple-600">PPN: ${Number(p.is_ppn) ? formatRupiah(p.ppn_amount) + ' (' + p.ppn_rate + '%)' : '-'}</div>
      </td>
      <td class="py-2.5 px-3 text-right font-extrabold text-slate-900">${formatRupiah(p.total)}</td>
      <td class="py-2.5 px-3">
        <div class="font-semibold">${esc(p.supplier_nama || '-')}</div>
        <div class="text-[10px] text-slate-400">Beli: ${formatDateID(p.tgl_beli)} &rarr; Datang: ${formatDateID(p.tgl_datang)}</div>
      </td>
      <td class="py-2.5 px-3 text-[11px] whitespace-nowrap">
        <div><span class="text-slate-400">INV:</span> <span class="font-semibold">${esc(p.invoice_number || '-')}</span></div>
        <div><span class="text-slate-400">PO:</span> <span class="font-semibold">${esc(p.po_number || '-')}</span></div>
      </td>
      <td class="py-2.5 px-3">
        <div class="font-semibold">${esc(p.buyer_nama || '-')} / ${esc(p.karyawan_nama || p.user_nama || '-')}</div>
        <div class="text-[10px] text-slate-400">${esc(p.divisi || '-')}</div>
      </td>
      <td class="py-2.5 px-3 text-center align-top">
        <span class="px-2 py-1 rounded-full text-[10px] uppercase font-bold ${statusBadgeClass(p.status)}">${esc(p.status)}</span>
        <div class="mt-1 text-[10px] text-slate-500 leading-tight whitespace-nowrap">Tgl PR: ${formatDateID(p.tanggal)}</div>
      </td>
      <td class="py-2.5 px-3 text-center align-top bg-rose-50/30">
        <span class="px-2 py-1 rounded-full text-[10px] uppercase font-bold ${approvalBadgeClass(p.approval_status)}" title="${p.approval_status === 'REJECTED' ? esc((p.leader_note || p.manager_note) ? 'Catatan: ' + (p.manager_note || p.leader_note) : '') : ''}">${approvalLabel(p.approval_status)}</span>
        <div class="mt-1 flex items-center justify-center gap-1">${isMyApproval(p) ? `<input type="checkbox" ${prApproveSel.has(p.id) ? 'checked' : ''} onchange="toggleApprovePick(${p.id}, this.checked)" class="w-4 h-4 accent-emerald-600 cursor-pointer" title="Pilih untuk approval massal">` : ''}${approvalActionButton(p)}</div>
        ${prTimelineHtml(p)}
      </td>
      <td class="py-2.5 px-3 text-center">
        ${p.lampiran ? `<a href="${esc(p.lampiran)}" target="_blank" class="text-emerald-600 hover:text-emerald-800"><i class="fa-brands fa-google-drive text-lg"></i></a>` : '<span class="text-slate-300">-</span>'}
      </td>
    </tr>
  `).join('');
}

function renderCharts() {
  const filtered = getFilteredPRData();

  // Chart 1: Pengeluaran per Supplier
  const supplierSpend = {};
  filtered.forEach(p => {
    const supp = p.supplier_nama || 'Unassigned';
    supplierSpend[supp] = (supplierSpend[supp] || 0) + (Number(p.total) || 0);
  });
  const ctxSupp = document.getElementById('supplierChart').getContext('2d');
  if (supplierChartObj) supplierChartObj.destroy();
  supplierChartObj = new Chart(ctxSupp, {
    type: 'bar',
    data: {
      labels: Object.keys(supplierSpend),
      datasets: [{ label: 'Total (Rp)', data: Object.values(supplierSpend), backgroundColor: '#4f46e5', borderRadius: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => formatRupiah(v) } } },
    },
  });

  // Chart 2: Distribusi Status
  const statusCounts = {};
  filtered.forEach(p => {
    const st = p.status || 'ON PROSES';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });
  const ctxSt = document.getElementById('statusChart').getContext('2d');
  if (statusChartObj) statusChartObj.destroy();
  statusChartObj = new Chart(ctxSt, {
    type: 'doughnut',
    data: {
      labels: Object.keys(statusCounts),
      datasets: [{
        data: Object.values(statusCounts),
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#a855f7', '#f43f5e', '#94a3b8'],
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } } },
  });
}

function applyFilters() { renderDashboard(); }

function resetFilters() {
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-sheet').value = 'ALL';
  document.getElementById('filter-status').value = 'ALL';
  document.getElementById('filter-ppn').value = 'ALL';
  document.getElementById('filter-supplier').value = 'ALL';
  document.getElementById('filter-approval').value = 'ALL';
  renderDashboard();
}

// ===================== PR MODAL (ADD/EDIT) =====================

async function autoGeneratePRNumber() {
  const sheet = document.getElementById('form-sheet').value;
  try {
    const data = await api(`api/pr_items.php?action=generate_pr_number&sheet=${sheet}`);
    document.getElementById('form-pr').value = data.pr_number;
  } catch (err) {
    showApiError(err);
  }
}

function handleFormKaryawanChange() {
  const karyawanId = document.getElementById('form-karyawan-select').value;
  const k = karyawanList.find(x => String(x.id) === String(karyawanId));
  document.getElementById('form-divisi').value = k ? k.divisi : '';
}

function handleWOSelect() {
  const woId = document.getElementById('form-wo-select').value;
  const w = workOrders.find(x => String(x.id) === String(woId));
  document.getElementById('form-customer').value = w ? (w.customer_nama || '') : '';
  document.getElementById('form-project').value = w ? w.project : '';
}

function handleHeaderBuyerChange() {
  headerDefaultBuyerId = document.getElementById('form-buyer-header-select').value;
  // Sinkronkan ke semua blok item yang belum diisi buyer-nya sendiri.
  document.querySelectorAll('#pr-items-container .pri-block .pri-buyer').forEach(sel => {
    if (!sel.value) sel.value = headerDefaultBuyerId;
  });
}

// ===================== PR ITEM BLOCK (mode multi-item saat Tambah PR baru) =====================

let prItemBlockCounter = 0;

function buildPRItemBlockHTML() {
  return `
  <div class="pri-block relative bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
    <div class="flex items-center justify-between">
      <span class="pri-item-label text-xs font-extrabold text-indigo-700">Item #1</span>
      <button type="button" onclick="removePRItemBlock(this)" class="pri-remove-btn text-rose-500 hover:text-rose-700 text-[11px] font-bold flex items-center gap-1"><i class="fa-solid fa-trash-can"></i> Hapus Item</button>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
      <div>
        <label class="block font-semibold text-slate-600 mb-1 text-[11px]">No. Item *</label>
        <input type="number" class="pri-item-no w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs" min="1" value="1" required>
      </div>
      <div class="sm:col-span-3">
        <label class="block font-semibold text-slate-600 mb-1 text-[11px]">Nama Product / Part *</label>
        <select class="pri-product w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs text-slate-900" required></select>
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Type / Tipe</label><input type="text" class="pri-type w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="Hydraulic Seal"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Dimensi / Ukuran</label><input type="text" class="pri-dimensi w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="NBR 70 / 50x60mm"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Brand / Merk</label><input type="text" class="pri-brand w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="NOK / Komatsu"></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Qty (Kuantitas) *</label><input type="number" class="pri-qty w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs" min="0.01" step="any" value="1" oninput="calcPRItemBlockTotal(this)" required></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Satuan (UOM) *</label><input type="text" class="pri-uom w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="Pc / LITER / Kaleng" required></div>
    </div>

    <div class="bg-purple-50/60 p-3 rounded-lg border border-purple-100 space-y-2">
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Harga Satuan (Rp)</label><input type="number" class="pri-harga w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs" min="0" step="any" value="0" oninput="calcPRItemBlockTotal(this)"></div>
        <div class="flex items-center space-x-2 pt-4">
          <input type="checkbox" class="pri-is-ppn w-4 h-4 text-purple-600 rounded border-slate-300" onchange="calcPRItemBlockTotal(this)">
          <label class="text-[11px] font-bold text-purple-900">Kenakan PPN</label>
        </div>
        <div>
          <label class="block font-semibold text-slate-600 mb-1 text-[11px]">Tarif PPN</label>
          <select class="pri-ppn-rate w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" onchange="calcPRItemBlockTotal(this)"><option value="11">PPN 11%</option><option value="12">PPN 12%</option></select>
        </div>
        <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Nominal PPN (Rp)</label><input type="text" class="pri-ppn-amount w-full p-2 bg-purple-100 border border-purple-200 rounded-lg font-bold text-purple-900 text-xs" readonly></div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">DPP</label><input type="text" class="pri-dpp w-full p-2 bg-slate-100 border border-slate-300 rounded-lg font-bold text-slate-700 text-xs" readonly></div>
        <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Total Tagihan Item</label><input type="text" class="pri-total w-full p-2 bg-slate-900 text-emerald-400 border border-slate-800 rounded-lg font-extrabold text-xs" readonly></div>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">No. PO</label><input type="text" class="pri-po w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="PO-88712"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">No. Invoice</label><input type="text" class="pri-invoice w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="INV-9902"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Supplier / Vendor</label><select class="pri-supplier w-full p-2 bg-white border border-slate-300 rounded-lg font-medium text-xs"></select></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Tanggal Beli</label><input type="date" class="pri-tgl-beli w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Tanggal Datang / Received</label><input type="date" class="pri-tgl-datang w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Penerima Barang</label><input type="text" class="pri-penerima w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="Nama penerima"></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label class="block font-semibold text-slate-600 mb-1 text-[11px]">Status PR</label>
        <select class="pri-status w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs">
          <option value="ON PROSES">ON PROSES</option><option value="PO ISSUED">PO ISSUED</option><option value="RECEIVED">RECEIVED</option><option value="STORE ROOM">STORE ROOM</option><option value="CANCEL">CANCEL</option>
        </select>
      </div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Buyer / Purchasing</label><select class="pri-buyer w-full p-2 bg-white border border-slate-300 rounded-lg font-medium text-xs"></select></div>
    </div>
    <div>
      <label class="block font-semibold text-slate-600 mb-1 text-[11px]">Lampiran Google Drive (URL)</label>
      <input type="url" class="pri-lampiran w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="https://drive.google.com/file/d/...">
    </div>
    <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Deskripsi</label><input type="text" class="pri-keterangan w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="Catatan logistik / spesifikasi tambahan..."></div>
  </div>`;
}

function populateItemBlockDropdowns(block) {
  const prodSel = block.querySelector('.pri-product');
  if (prodSel) {
    const cur = prodSel.value;
    prodSel.innerHTML = masterProducts.map(p => opt(p.nama, p.nama)).join('');
    if (cur) prodSel.value = cur;
  }
  const suppSel = block.querySelector('.pri-supplier');
  if (suppSel) {
    const cur = suppSel.value;
    suppSel.innerHTML = '<option value="">-- Pilih Supplier --</option>' + suppliers.map(s => opt(s.id, s.nama)).join('');
    if (cur) suppSel.value = cur;
  }
  const buyerSel = block.querySelector('.pri-buyer');
  if (buyerSel) {
    const cur = buyerSel.value;
    buyerSel.innerHTML = '<option value="">-- Pilih Buyer --</option>' + masterBuyers.map(b => opt(b.id, b.nama)).join('');
    if (cur) buyerSel.value = cur;
    else if (headerDefaultBuyerId) buyerSel.value = headerDefaultBuyerId;
  }
}

function addPRItemBlock(data = null) {
  const container = document.getElementById('pr-items-container');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildPRItemBlockHTML();
  const block = wrapper.firstElementChild;
  container.appendChild(block);

  populateItemBlockDropdowns(block);

  // Saran No. Item = posisi urutan blok saat ini (tetap bisa diedit manual).
  block.querySelector('.pri-item-no').value = container.querySelectorAll('.pri-block').length;

  if (data) {
    block.querySelector('.pri-item-no').value = data.item_no;
    block.querySelector('.pri-product').value = data.product || '';
    block.querySelector('.pri-type').value = data.type || '';
    block.querySelector('.pri-dimensi').value = data.dimensi || '';
    block.querySelector('.pri-brand').value = data.brand || '';
    block.querySelector('.pri-qty').value = qtyInputValue(data.qty);
    block.querySelector('.pri-uom').value = data.uom || '';
    block.querySelector('.pri-harga').value = data.harga;
    block.querySelector('.pri-is-ppn').checked = !!Number(data.is_ppn);
    block.querySelector('.pri-ppn-rate').value = data.ppn_rate;
    block.querySelector('.pri-po').value = data.po_number || '';
    block.querySelector('.pri-invoice').value = data.invoice_number || '';
    block.querySelector('.pri-supplier').value = data.supplier_id || '';
    block.querySelector('.pri-tgl-beli').value = data.tgl_beli || '';
    block.querySelector('.pri-tgl-datang').value = data.tgl_datang || '';
    block.querySelector('.pri-penerima').value = data.penerima_barang || '';
    block.querySelector('.pri-status').value = data.status;
    block.querySelector('.pri-buyer').value = data.buyer_id || '';
    block.querySelector('.pri-lampiran').value = data.lampiran || '';
    block.querySelector('.pri-keterangan').value = data.keterangan || '';
  } else {
    block.querySelector('.pri-status').value = 'ON PROSES';
  }

  calcPRItemBlockTotal(block.querySelector('.pri-qty'));
  updatePRItemLabelsAndButtons();
  return block;
}

function removePRItemBlock(btn) {
  const container = document.getElementById('pr-items-container');
  const blocks = container.querySelectorAll('.pri-block');
  if (blocks.length <= 1) {
    showToast('Minimal harus ada 1 item dalam satu PR.', 'error');
    return;
  }
  btn.closest('.pri-block').remove();
  updatePRItemLabelsAndButtons();
}

/** Update label "Item #N" tiap blok, dan sembunyikan tombol tambah/hapus saat mode Edit (selalu 1 item). */
function updatePRItemLabelsAndButtons() {
  const blocks = document.querySelectorAll('#pr-items-container .pri-block');
  blocks.forEach((block, idx) => {
    block.querySelector('.pri-item-label').textContent = `Item #${idx + 1}`;
  });
  const isEditMode = !!document.getElementById('form-id').value;
  document.getElementById('pr-add-item-btn').classList.toggle('hidden', isEditMode);
  blocks.forEach(block => {
    block.querySelector('.pri-remove-btn').classList.toggle('hidden', isEditMode || blocks.length <= 1);
  });
}

function calcPRItemBlockTotal(el) {
  const block = el.closest('.pri-block');
  const qty = parseFloat(block.querySelector('.pri-qty').value) || 0;
  const harga = parseFloat(block.querySelector('.pri-harga').value) || 0;
  const isPpn = block.querySelector('.pri-is-ppn').checked;
  const ppnRate = parseFloat(block.querySelector('.pri-ppn-rate').value) || 11;

  const dpp = qty * harga;
  const ppnAmount = isPpn ? Math.round(dpp * (ppnRate / 100)) : 0;
  const total = dpp + ppnAmount;

  block.querySelector('.pri-dpp').value = formatRupiah(dpp);
  block.querySelector('.pri-ppn-amount').value = formatRupiah(ppnAmount);
  block.querySelector('.pri-total').value = formatRupiah(total);
}

async function openModal(mode, id = null) {
  document.getElementById('pr-form').reset();
  document.getElementById('form-id').value = '';
  document.getElementById('pr-items-container').innerHTML = '';
  headerDefaultBuyerId = '';
  updateDropdownOptions();

  const title = document.getElementById('modal-title');

  if (mode === 'add') {
    title.textContent = 'Form Purchasing Request (PR) - Tambah Baru';
    document.getElementById('form-tanggal').value = new Date().toISOString().slice(0, 10);
    await autoGeneratePRNumber();
    addPRItemBlock();
  } else {
    const p = prItems.find(x => x.id === id);
    if (!p) return;
    title.textContent = `Edit Purchasing Request - ${p.pr_number}`;

    document.getElementById('form-id').value = p.id;
    document.getElementById('form-sheet').value = p.sheet;
    document.getElementById('form-pr').value = p.pr_number;
    document.getElementById('form-tanggal').value = p.tanggal;
    document.getElementById('form-karyawan-select').value = p.karyawan_id || '';
    document.getElementById('form-atasan-select').value = p.atasan_karyawan_id || '';
    document.getElementById('form-manager-select').value = p.manager_karyawan_id || '';
    document.getElementById('form-divisi').value = p.divisi || '';
    document.getElementById('form-wo-select').value = p.wo_id || '';
    // Customer mengikuti WO terpilih (data terbaru), bukan salinan lama di PR.
    const prWo = workOrders.find(x => String(x.id) === String(p.wo_id));
    document.getElementById('form-customer').value = (prWo && prWo.customer_nama) || p.customer_nama || '';
    document.getElementById('form-project').value = p.project || '';
    headerDefaultBuyerId = p.buyer_id || '';
    document.getElementById('form-buyer-header-select').value = headerDefaultBuyerId;

    addPRItemBlock(p);
  }

  document.getElementById('pr-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('pr-modal').classList.add('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('form-id').value;
  const sharedFields = {
    sheet: document.getElementById('form-sheet').value,
    pr_number: document.getElementById('form-pr').value.trim().toUpperCase(),
    tanggal: document.getElementById('form-tanggal').value,
    user_id: currentUser ? currentUser.id : null, // jejak akun login yang menginput (bukan "User Peminta" lagi)
    karyawan_id: document.getElementById('form-karyawan-select').value || null,
    atasan_karyawan_id: document.getElementById('form-atasan-select').value || null,
    manager_karyawan_id: document.getElementById('form-manager-select').value || null,
    divisi: document.getElementById('form-divisi').value,
    wo_id: document.getElementById('form-wo-select').value || null,
    project: document.getElementById('form-project').value,
  };

  function readBlockPayload(block) {
    const qty = parseFloat(block.querySelector('.pri-qty').value) || 0;
    const harga = parseFloat(block.querySelector('.pri-harga').value) || 0;
    const isPpn = block.querySelector('.pri-is-ppn').checked;
    const ppnRate = parseFloat(block.querySelector('.pri-ppn-rate').value) || 11;
    return {
      ...sharedFields,
      item_no: block.querySelector('.pri-item-no').value,
      product: block.querySelector('.pri-product').value,
      type: block.querySelector('.pri-type').value,
      dimensi: block.querySelector('.pri-dimensi').value,
      brand: block.querySelector('.pri-brand').value,
      qty,
      uom: block.querySelector('.pri-uom').value,
      harga,
      is_ppn: isPpn,
      ppn_rate: ppnRate,
      po_number: block.querySelector('.pri-po').value,
      invoice_number: block.querySelector('.pri-invoice').value,
      supplier_id: block.querySelector('.pri-supplier').value || null,
      tgl_beli: block.querySelector('.pri-tgl-beli').value || null,
      tgl_datang: block.querySelector('.pri-tgl-datang').value || null,
      penerima_barang: block.querySelector('.pri-penerima').value,
      status: block.querySelector('.pri-status').value,
      buyer_id: block.querySelector('.pri-buyer').value || document.getElementById('form-buyer-header-select').value || null,
      lampiran: block.querySelector('.pri-lampiran').value,
      keterangan: block.querySelector('.pri-keterangan').value,
    };
  }

  const blocks = Array.from(document.querySelectorAll('#pr-items-container .pri-block'));

  try {
    if (id) {
      // Mode edit: selalu 1 blok, PUT ke item yang sama.
      const payload = { id, ...readBlockPayload(blocks[0]) };
      await api('api/pr_items.php', 'PUT', payload);
      showToast('PR berhasil diperbarui.');
    } else {
      // Mode tambah: bisa banyak item sekaligus, dikirim satu per satu berurutan.
      let successCount = 0;
      const errors = [];
      for (let i = 0; i < blocks.length; i++) {
        try {
          await api('api/pr_items.php', 'POST', readBlockPayload(blocks[i]));
          successCount++;
        } catch (err) {
          errors.push(`Item #${i + 1}: ${err.message}`);
        }
      }
      if (errors.length === 0) {
        showToast(`${successCount} item PR berhasil ditambahkan.`);
      } else if (successCount > 0) {
        showToast(`${successCount} item tersimpan, ${errors.length} gagal — ${errors.join(' | ')}`, 'error');
      } else {
        showToast(`Gagal menyimpan: ${errors.join(' | ')}`, 'error');
        return; // jangan tutup modal, biar user bisa perbaiki lalu submit ulang
      }
    }
    closeModal();
    await refresh('prItems', 'workOrders'); // WO agregat ikut berubah (aktual pembelian)
    updateIncomingBadge();
    renderDashboard();
  } catch (err) {
    showApiError(err);
  }
}

async function deletePRItem(id) {
  if (!(await showConfirm('Hapus item PR ini? Tindakan tidak bisa dibatalkan.'))) return;
  try {
    await api(`api/pr_items.php?id=${id}`, 'DELETE');
    showToast('PR berhasil dihapus.');
    await refresh('prItems', 'workOrders');
    renderDashboard();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== ALUR APPROVAL PR (Cek Supervisor / Approve Manager Produksi) =====================

function openApprovalModal(prId) {
  const p = prItems.find(x => x.id === prId);
  if (!p) return;

  document.getElementById('approval-pr-id').value = prId;
  document.getElementById('approval-note').value = '';

  const header = document.getElementById('approval-modal-header');
  const title = document.getElementById('approval-modal-title');
  const approveBtn = document.getElementById('approval-approve-btn');
  const summary = document.getElementById('approval-pr-summary');

  summary.innerHTML = `
    <div class="flex justify-between"><span class="text-slate-500">No. PR</span><span class="font-bold text-slate-800">${esc(p.pr_number)}</span></div>
    <div class="flex justify-between"><span class="text-slate-500">Product</span><span class="font-semibold text-slate-800">${esc(p.product || '-')}</span></div>
    <div class="flex justify-between"><span class="text-slate-500">Qty x Harga</span><span class="font-mono">${formatQty(p.qty)} x ${formatRupiah(p.harga)}</span></div>
    <div class="flex justify-between"><span class="text-slate-500">Total Tagihan</span><span class="font-extrabold text-slate-900">${formatRupiah(p.total)}</span></div>
    <div class="flex justify-between"><span class="text-slate-500">Diajukan oleh</span><span class="font-semibold">${esc(p.user_nama || '-')}</span></div>
  `;

  if (p.approval_status === 'PENDING_LEADER') {
    document.getElementById('approval-stage').value = 'leader_check';
    header.className = 'px-6 py-4 bg-amber-600 text-white flex items-center justify-between';
    title.textContent = 'Cek PR (sebagai Supervisor)';
    approveBtn.textContent = 'Setujui & Teruskan ke Manager Produksi';
    approveBtn.className = 'px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-md';
  } else if (p.approval_status === 'PENDING_MANAGER') {
    document.getElementById('approval-stage').value = 'manager_approve';
    header.className = 'px-6 py-4 bg-blue-600 text-white flex items-center justify-between';
    title.textContent = 'Approve PR (sebagai Manager Produksi)';
    approveBtn.textContent = 'Setujui (Final)';
    approveBtn.className = 'px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md';
  } else {
    return; // tidak ada aksi yang relevan untuk status ini
  }

  document.getElementById('approval-modal').classList.remove('hidden');
}

function closeApprovalModal() {
  document.getElementById('approval-modal').classList.add('hidden');
}

async function submitApprovalDecision(decision) {
  const id = document.getElementById('approval-pr-id').value;
  const stage = document.getElementById('approval-stage').value; // 'leader_check' | 'manager_approve'
  const note = document.getElementById('approval-note').value.trim();

  if (decision === 'reject' && !(await showConfirm('Yakin tolak PR ini?'))) return;

  try {
    await api(`api/pr_items.php?action=${stage}`, 'POST', { id, decision, note });
    showToast(decision === 'approve' ? 'Keputusan approval tersimpan.' : 'PR ditolak.');
    closeApprovalModal();
    await refresh('prItems');
    renderDashboard();
  } catch (err) {
    showApiError(err);
  }
}

async function resubmitPR(id) {
  if (!(await showConfirm('Kirim ulang PR ini untuk direview dari awal (menunggu Supervisor lagi)?'))) return;
  try {
    await api('api/pr_items.php?action=resubmit', 'POST', { id });
    showToast('PR dikirim ulang untuk approval.');
    await refresh('prItems');
    renderDashboard();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== WO TRACKING MODULE =====================

// ===================== HAPUS MASSAL (CHECKBOX) — WO, SEAL CNC, TRANSPORTASI =====================
const BULK_CFG = {
  wo: {
    api: 'api/work_orders.php', tbody: 'wo-tracking-tbody', label: 'Work Order',
    note: 'Seal CNC & Transportasi milik WO tersebut ikut terhapus. WO yang masih punya data PR / AR akan dilewati.',
    reload: async () => { await refresh('workOrders', 'sealItems', 'transportItems'); renderWOTracking(); },
  },
  seal: {
    api: 'api/seal_items.php', tbody: 'seal-table-tbody', label: 'Seal CNC', note: '',
    reload: async () => { await refresh('sealItems', 'workOrders'); renderSealTable(); },
  },
  transport: {
    api: 'api/transport_items.php', tbody: 'transport-table-tbody', label: 'Transportasi', note: '',
    reload: async () => { await refresh('transportItems', 'workOrders'); renderTransportTable(); },
  },
};
const bulkSelected = { wo: new Set(), seal: new Set(), transport: new Set() };

function bulkCheckbox(key, id) {
  const checked = bulkSelected[key].has(Number(id)) ? 'checked' : '';
  return `<input type="checkbox" data-bulk="${key}" value="${Number(id)}" ${checked} onchange="toggleBulkRow('${key}', ${Number(id)}, this.checked)" class="w-4 h-4 mr-1 accent-rose-600 cursor-pointer" title="Pilih untuk dihapus">`;
}

/** ID baris yang sedang tampil di tabel (setelah filter). */
function bulkVisibleIds(key) {
  const tbody = document.getElementById(BULK_CFG[key].tbody);
  if (!tbody) return [];
  // Baris yang disembunyikan oleh "Cari cepat" (atribut hidden, lihat table-tools.js)
  // TIDAK dihitung - supaya "Hapus Semua" hanya menghapus baris yang terlihat.
  return [...tbody.querySelectorAll(`input[data-bulk="${key}"]`)]
    .filter(cb => !cb.closest('tr')?.hidden)
    .map(cb => Number(cb.value));
}

function toggleBulkRow(key, id, checked) {
  if (checked) bulkSelected[key].add(Number(id)); else bulkSelected[key].delete(Number(id));
  syncBulkBar(key);
}

function toggleBulkAll(key, checked) {
  const tbody = document.getElementById(BULK_CFG[key].tbody);
  tbody.querySelectorAll(`input[data-bulk="${key}"]`).forEach(cb => {
    if (cb.closest('tr')?.hidden) return; // abaikan baris yang tersembunyi oleh pencarian
    cb.checked = checked;
    if (checked) bulkSelected[key].add(Number(cb.value)); else bulkSelected[key].delete(Number(cb.value));
  });
  syncBulkBar(key);
}

/** Buang pilihan yang barisnya sudah tidak tampil, lalu update header checkbox & tombol. */
function syncBulkBar(key) {
  const visible = bulkVisibleIds(key);
  const visibleSet = new Set(visible);
  [...bulkSelected[key]].forEach(id => { if (!visibleSet.has(id)) bulkSelected[key].delete(id); });
  // Centang di baris yang tersembunyi ikut dilepas supaya tampilan sama dengan pilihan.
  document.querySelectorAll(`input[data-bulk="${key}"]`).forEach(cb => {
    if (cb.checked && !bulkSelected[key].has(Number(cb.value))) cb.checked = false;
  });
  const n = bulkSelected[key].size;

  const all = document.getElementById(`bulk-all-${key}`);
  if (all) {
    all.checked = visible.length > 0 && n === visible.length;
    all.indeterminate = n > 0 && n < visible.length;
    all.disabled = visible.length === 0;
  }
  const count = document.getElementById(`bulk-count-${key}`);
  if (count) count.textContent = n > 0 ? `${n} dipilih` : 'Belum ada yang dipilih';
  const btnSel = document.getElementById(`bulk-del-selected-${key}`);
  if (btnSel) btnSel.disabled = n === 0;
  const btnAll = document.getElementById(`bulk-del-all-${key}`);
  if (btnAll) btnAll.disabled = visible.length === 0;
}

/** mode: 'selected' = hanya yang diceklis, 'all' = semua baris yang sedang tampil. */
async function bulkDelete(key, mode) {
  const cfg = BULK_CFG[key];
  const ids = mode === 'all' ? bulkVisibleIds(key) : [...bulkSelected[key]];
  if (ids.length === 0) { showToast('Belum ada data yang dipilih.', 'error'); return; }

  const detail = (mode === 'all'
    ? `SEMUA ${ids.length} data ${cfg.label} yang tampil di tabel akan dihapus.`
    : `${ids.length} data ${cfg.label} yang diceklis akan dihapus.`) +
    ' Tindakan ini tidak bisa dibatalkan.' + (cfg.note ? ' ' + cfg.note : '');
  const ok = await showConfirm(detail, {
    title: ids.length === 1 ? 'Apakah anda yakin ingin menghapus item ini?' : `Apakah anda yakin ingin menghapus ${ids.length} item ini?`,
    danger: true,
  });
  if (!ok) return;

  try {
    const res = await api(`${cfg.api}?ids=${ids.join(',')}`, 'DELETE');
    const deleted = res && res.deleted !== undefined ? res.deleted : ids.length;
    const skipped = (res && res.skipped) || [];
    bulkSelected[key].clear();
    await cfg.reload();
    if (skipped.length) {
      showToast(`${deleted} ${cfg.label} dihapus, ${skipped.length} dilewati: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', ...' : ''}`, 'error');
    } else {
      showToast(`${deleted} data ${cfg.label} berhasil dihapus.`);
    }
  } catch (err) {
    showApiError(err);
  }
}

function renderWOTracking() {
  const tbody = document.getElementById('wo-tracking-tbody');
  const search = (document.getElementById('filter-wo-search')?.value || '').toLowerCase().trim();
  const filterCust = document.getElementById('filter-wo-customer')?.value || 'ALL';
  const filterStatus = document.getElementById('filter-wo-status')?.value || 'ALL';

  const filtered = workOrders.filter(w => {
    if (filterCust !== 'ALL' && w.customer_nama !== filterCust) return false;
    if (filterStatus !== 'ALL' && w.computed_status !== filterStatus) return false;
    if (search) {
      const haystack = `${w.wo_number} ${w.project} ${w.customer_nama || ''} ${w.po_no || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="20" class="text-center py-6 text-slate-400 font-semibold">Tidak ada data Work Order (WO) yang cocok.</td></tr>`;
    syncBulkBar('wo');
    return;
  }

  const invBadge = {
    'LUNAS': 'bg-emerald-100 text-emerald-800',
    'PENDING': 'bg-amber-100 text-amber-800',
    'BELUM INVOICE': 'bg-slate-100 text-slate-600',
  };

  const budgetBadge = { 'AMAN': 'bg-emerald-100 text-emerald-800', 'OVER BUDGET': 'bg-rose-100 text-rose-800 font-bold' };
  const statusBadge = {
    'ON PROGRESS': 'bg-blue-100 text-blue-800', 'HOLD': 'bg-amber-100 text-amber-800',
    'CANCEL': 'bg-rose-100 text-rose-800', 'DELIVERY': 'bg-purple-100 text-purple-800', 'FINISHED': 'bg-emerald-100 text-emerald-800',
  };
  const categoryBadge = { 'PROJECT': 'bg-indigo-100 text-indigo-800', 'MAINTENANCE': 'bg-amber-100 text-amber-800', 'INVENTARIS': 'bg-slate-200 text-slate-700' };

  tbody.innerHTML = pageRows('wo', sortRows('wo', filtered)).map(w => {
    const isProfit = Number(w.profit_loss) >= 0;
    const plBadgeClass = isProfit ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800 font-bold';
    return `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-3 px-3 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          ${bulkCheckbox('wo', w.id)}
          <button onclick="printWO(${w.id})" class="p-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition" title="Print WO"><i class="fa-solid fa-print"></i></button>
          <button onclick="openWOModal('edit', ${w.id})" class="p-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition" title="Edit WO"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteWO(${w.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition" title="Hapus WO"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-3 px-3 font-extrabold text-indigo-900">${esc(w.wo_number)}</td>
      <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${categoryBadge[w.wo_category] || 'bg-slate-100 text-slate-600'}">${esc(w.wo_category || 'PROJECT')}</span></td>
      <td class="py-3 px-3 font-bold text-slate-800">${esc(w.project)}</td>
      <td class="py-3 px-3 font-semibold text-slate-700">${esc(w.customer_nama || '-')}</td>
      <td class="py-3 px-3 font-semibold text-slate-700 whitespace-nowrap">${w.po_no && w.po_no.trim() && w.po_no !== '-' ? esc(w.po_no) : '<span class="text-slate-300">-</span>'}</td>
      <td class="py-3 px-3 text-center font-mono">${formatDateID(w.est_kirim)}</td>
      ${CAN_NILAI ? `<td class="py-3 px-3 text-right font-mono">${formatRupiah(w.dpp_gross)}</td>
      <td class="py-3 px-3 text-right font-mono ${Number(w.diskon) > 0 ? 'text-rose-600' : 'text-slate-400'}">${Number(w.diskon) > 0 ? '- ' : ''}${formatRupiah(w.diskon)}</td>
      <td class="py-3 px-3 text-right font-mono text-blue-700">${formatRupiah(w.ppn)}</td>
      <td class="py-3 px-3 text-right font-mono font-bold text-emerald-700">${formatRupiah(w.wo_total)}</td>` : ''}
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.budget_prod)}</td>
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.aktual_prod)}</td>
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.budget_pem)}</td>
      <td class="py-3 px-3 text-right font-mono bg-indigo-50/70 font-bold text-indigo-900">${formatRupiah(w.aktual_pem)}</td>
      <td class="py-3 px-3 text-right font-mono bg-amber-50/70 font-bold text-amber-900">${formatRupiah(w.total_seal)}</td>
      <td class="py-3 px-3 text-right font-mono bg-blue-50/70 font-bold text-blue-900">${formatRupiah(w.total_transport)}</td>
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.total_lain)}</td>
      <td class="py-3 px-3 text-right font-mono font-extrabold text-slate-900 bg-slate-100">${formatRupiah(w.total_produksi)}</td>
      ${CAN_NILAI ? `<td class="py-3 px-3 text-right font-mono font-extrabold ${isProfit ? 'text-emerald-600' : 'text-rose-600'}">
        <span class="px-2 py-0.5 rounded ${plBadgeClass}">${formatRupiah(w.profit_loss)}</span>
      </td>` : ''}
      <td class="py-3 px-3 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] uppercase font-bold ${budgetBadge[w.status_budget] || 'bg-slate-100 text-slate-600'}">${esc(w.status_budget || '-')}</span>
      </td>
      <td class="py-3 px-3 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] uppercase font-bold ${statusBadge[w.status] || 'bg-slate-100 text-slate-600'}">${esc(w.status || '-')}</span>
      </td>
      <td class="py-3 px-3 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] uppercase font-bold ${w.computed_status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800 animate-pulse'}">${esc(w.computed_status)}</span>
      </td>
      <td class="py-3 px-3 text-center">
        ${(w.surat_jalan || []).length
          ? `${sjStatusBadge(w.surat_jalan[0].status)}<div class="text-[10px] text-slate-500 mt-0.5" title="${esc(w.surat_jalan.map(x => x.no_sj).join(', '))}">${esc(w.surat_jalan[0].no_sj)}${w.surat_jalan.length > 1 ? ` (+${w.surat_jalan.length - 1})` : ''}</div>`
          : '<span class="px-2.5 py-1 rounded-full text-[10px] uppercase font-bold bg-slate-100 text-slate-500">BELUM SJ</span>'}
      </td>
      <td class="py-3 px-3 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] uppercase font-bold ${invBadge[w.invoice_status] || 'bg-slate-100 text-slate-600'}">${esc(w.invoice_status)}</span>
        ${(w.ar_invoices || []).length ? `<div class="text-[10px] text-slate-500 mt-0.5">${esc(w.ar_invoices.join(', '))}</div>` : ''}
      </td>
    </tr>`;
  }).join('');
  syncBulkBar('wo');
}

function resetWOFilters() {
  document.getElementById('filter-wo-search').value = '';
  document.getElementById('filter-wo-customer').value = 'ALL';
  document.getElementById('filter-wo-status').value = 'ALL';
  renderWOTracking();
}

function calcWOFinance() {
  const qty = parseFloat(document.getElementById('wo-form-qty').value) || 0;
  const harga = parseFloat(document.getElementById('wo-form-harga-satuan').value) || 0;
  const diskon = parseFloat(document.getElementById('wo-form-diskon').value) || 0;
  const isPpn = document.getElementById('wo-form-is-ppn').value === '1';
  const isPph23 = document.getElementById('wo-form-is-pph23').value === '1';
  const pphLainPct = parseFloat(document.getElementById('wo-form-pph-lain-pct').value) || 0;

  const dpp = (qty * harga) - diskon;
  const ppn = isPpn ? dpp * 0.11 : 0;
  const pph23 = isPph23 ? dpp * 0.02 : 0;
  const pphLain = dpp * (pphLainPct / 100);
  const total = dpp + ppn - pph23 - pphLain;

  document.getElementById('wo-calc-dpp').textContent = formatRupiah(dpp);
  document.getElementById('wo-calc-ppn').textContent = formatRupiah(ppn);
  document.getElementById('wo-calc-pph23').textContent = formatRupiah(pph23);
  document.getElementById('wo-calc-pphlain').textContent = formatRupiah(pphLain);
  document.getElementById('wo-calc-total').textContent = formatRupiah(total);
}

async function autoGenerateWONumber() {
  const category = document.getElementById('wo-form-category').value;
  try {
    const data = await api(`api/work_orders.php?action=generate_wo_number&category=${category}`);
    document.getElementById('wo-form-no').value = data.wo_number;
  } catch (err) {
    showApiError(err);
  }
}

// --- Item Pekerjaan (Budgeting Produksi Perusahaan) - blok dinamis mirip pola BOM Produksi ---

function buildWOBudgetItemBlockHTML() {
  return `
  <div class="wobi-block flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200">
    <input type="text" class="wobi-nama flex-1 p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="Pekerjaan Wiring / Busbar">
    <input type="number" class="wobi-qty w-20 p-2 bg-white border border-slate-300 rounded-lg text-xs" min="0" step="any" value="1" placeholder="Qty" title="Qty">
    <input type="number" class="wobi-budget w-28 p-2 bg-white border border-slate-300 rounded-lg text-xs" min="0" value="0" placeholder="Budget" oninput="recalcWOBudgetTotals()">
    <input type="number" class="wobi-actual w-28 p-2 bg-white border border-slate-300 rounded-lg text-xs" min="0" value="0" placeholder="Actual" oninput="recalcWOBudgetTotals()">
    <select class="wobi-status w-32 p-2 bg-white border border-slate-300 rounded-lg text-xs"><option value="ON PROCESS">ON PROCESS</option><option value="FINISH">FINISH</option></select>
    <button type="button" onclick="removeWOBudgetItemBlock(this)" class="text-rose-500 hover:text-rose-700 font-bold px-1">X</button>
  </div>`;
}

function addWOBudgetItemBlock(data = null) {
  const container = document.getElementById('wo-budget-items-container');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildWOBudgetItemBlockHTML();
  const block = wrapper.firstElementChild;
  container.appendChild(block);
  if (data) {
    block.querySelector('.wobi-nama').value = data.nama_item || '';
    block.querySelector('.wobi-qty').value = qtyInputValue(data.qty, 1);
    block.querySelector('.wobi-budget').value = data.budget || 0;
    block.querySelector('.wobi-actual').value = data.actual || 0;
    block.querySelector('.wobi-status').value = data.status || 'ON PROCESS';
    if (data.actual_from_mtc) {
      // Aktual item ini dihitung otomatis dari rincian MTC (Modul Divisi Produksi) -> kunci input.
      const act = block.querySelector('.wobi-actual');
      act.readOnly = true;
      act.classList.remove('bg-white');
      act.classList.add('bg-emerald-50', 'border-emerald-300', 'text-emerald-800', 'font-bold');
      act.title = 'Otomatis dari total rincian MTC (Modul Divisi Produksi) untuk item ini. Ubah lewat menu MTC Produksi.';
      // Item dari MTC: nama dikunci (kunci penghubung ke rinciannya) & tidak bisa dihapus dari sini.
      const nama = block.querySelector('.wobi-nama');
      nama.readOnly = true;
      nama.classList.add('bg-slate-100', 'cursor-not-allowed');
      nama.title = 'Item ini berasal dari MTC Produksi. Ubah/hapus lewat MTC Produksi → Modul Divisi Produksi.';
      const del = block.querySelector('[onclick^="removeWOBudgetItemBlock"]');
      if (del) del.classList.add('invisible');
      const badge = document.createElement('span');
      badge.className = 'text-[9px] font-bold text-emerald-700 whitespace-nowrap';
      badge.innerHTML = '<i class="fa-solid fa-link"></i> MTC';
      badge.title = act.title;
      act.after(badge);
    }
  }
  recalcWOBudgetTotals();
  return block;
}

function removeWOBudgetItemBlock(btn) {
  btn.closest('.wobi-block').remove();
  recalcWOBudgetTotals();
}

/** Item Pekerjaan yang terisi otomatis menimpa field Budget/Aktual Produksi (read-only kalau ada isinya). */
function recalcWOBudgetTotals() {
  const blocks = Array.from(document.querySelectorAll('#wo-budget-items-container .wobi-block'));
  const hasItems = blocks.some(b => b.querySelector('.wobi-nama').value.trim() !== '');
  const bprodInput = document.getElementById('wo-form-budget-prod');
  const aprodInput = document.getElementById('wo-form-aktual-prod');
  const bprodHint = document.getElementById('wo-bprod-auto-hint');
  const aprodHint = document.getElementById('wo-aprod-auto-hint');

  if (hasItems) {
    const totalBudget = blocks.reduce((s, b) => s + (parseFloat(b.querySelector('.wobi-budget').value) || 0), 0);
    const totalActual = blocks.reduce((s, b) => s + (parseFloat(b.querySelector('.wobi-actual').value) || 0), 0);
    bprodInput.value = totalBudget;
    aprodInput.value = totalActual;
    bprodInput.readOnly = true; aprodInput.readOnly = true;
    bprodInput.classList.add('bg-slate-100'); aprodInput.classList.add('bg-slate-100');
    bprodHint.classList.remove('hidden'); aprodHint.classList.remove('hidden');
  } else {
    bprodInput.readOnly = false; aprodInput.readOnly = false;
    bprodInput.classList.remove('bg-slate-100'); aprodInput.classList.remove('bg-slate-100');
    bprodHint.classList.add('hidden'); aprodHint.classList.add('hidden');
  }
}

function updateWOStatusBudgetPreview() {
  const bprod = parseFloat(document.getElementById('wo-form-budget-prod').value) || 0;
  const bpem = parseFloat(document.getElementById('wo-form-budget-pem').value) || 0;
  const blain = parseFloat(document.getElementById('wo-form-budget-lain').value) || 0;
  const el = document.getElementById('wo-form-status-budget');
  // Preview sederhana di form (perbandingan lengkap dgn realisasi PR/Seal/Transport dihitung server & tampil di tabel).
  const totalBudget = bprod + bpem + blain;
  el.textContent = totalBudget > 0 ? 'AMAN (estimasi)' : '-';
  el.className = 'w-full p-2.5 rounded-lg font-bold text-center ' + (totalBudget > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500');
}

function openWOModal(mode, id = null) {
  document.getElementById('wo-form').reset();
  document.getElementById('wo-form-id').value = '';
  document.getElementById('wo-budget-items-container').innerHTML = '';
  updateDropdownOptions();

  const title = document.getElementById('wo-modal-title');
  if (mode === 'add') {
    title.textContent = 'Form Work Order (WO) - Tambah Baru';
    document.getElementById('wo-form-category').value = 'PROJECT';
    document.getElementById('wo-form-status').value = 'ON PROGRESS';
    document.getElementById('wo-form-aktual-pem').value = formatRupiah(0);
    autoGenerateWONumber();
    calcWOFinance();
    recalcWOBudgetTotals();
    document.getElementById('wo-form-status-budget').textContent = '-';
  } else {
    const w = workOrders.find(x => x.id === id);
    if (!w) return;
    title.textContent = `Edit Work Order - ${w.wo_number}`;
    document.getElementById('wo-form-id').value = w.id;
    document.getElementById('wo-form-category').value = w.wo_category || 'PROJECT';
    document.getElementById('wo-form-no').value = w.wo_number;
    document.getElementById('wo-form-est-kirim').value = w.est_kirim || '';
    document.getElementById('wo-form-project').value = w.project;
    document.getElementById('wo-form-customer-select').value = w.customer_id || '';
    document.getElementById('wo-form-po-no').value = w.po_no || '';
    document.getElementById('wo-form-requester-select').value = w.requester_karyawan_id || '';
    document.getElementById('wo-form-atasan-select').value = w.atasan_karyawan_id || '';
    document.getElementById('wo-form-manager-select').value = w.manager_karyawan_id || '';
    document.getElementById('wo-form-qty').value = qtyInputValue(w.qty);
    document.getElementById('wo-form-satuan').value = w.satuan;
    document.getElementById('wo-form-harga-satuan').value = w.harga_satuan;
    document.getElementById('wo-form-diskon').value = w.diskon;
    document.getElementById('wo-form-is-ppn').value = Number(w.is_ppn) ? '1' : '0';
    document.getElementById('wo-form-is-pph23').value = Number(w.is_pph23) ? '1' : '0';
    document.getElementById('wo-form-pph-lain-pct').value = w.pph_lain_pct;
    document.getElementById('wo-form-total-lain').value = w.total_lain;
    document.getElementById('wo-form-budget-lain').value = w.budget_lain || 0;
    document.getElementById('wo-form-budget-prod').value = w.budget_prod;
    document.getElementById('wo-form-aktual-prod').value = w.aktual_prod;
    document.getElementById('wo-form-budget-pem').value = w.budget_pem;
    document.getElementById('wo-form-aktual-pem').value = formatRupiah(w.aktual_pem);
    document.getElementById('wo-form-status').value = w.status || 'ON PROGRESS';
    (w.budget_items || []).forEach(bi => addWOBudgetItemBlock(bi));
    calcWOFinance();
    recalcWOBudgetTotals();
    const budgetEl = document.getElementById('wo-form-status-budget');
    budgetEl.textContent = w.status_budget || '-';
    budgetEl.className = 'w-full p-2.5 rounded-lg font-bold text-center ' + (w.status_budget === 'AMAN' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700');
  }

  document.getElementById('wo-modal').classList.remove('hidden');
}

function closeWOModal() {
  document.getElementById('wo-modal').classList.add('hidden');
}

async function handleWOSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('wo-form-id').value;
  const budgetBlocks = Array.from(document.querySelectorAll('#wo-budget-items-container .wobi-block'))
    .map(b => ({
      nama_item: b.querySelector('.wobi-nama').value,
      qty: b.querySelector('.wobi-qty').value,
      budget: b.querySelector('.wobi-budget').value,
      actual: b.querySelector('.wobi-actual').value,
      status: b.querySelector('.wobi-status').value,
    }))
    .filter(b => b.nama_item.trim() !== '');

  const payload = {
    id: id || undefined,
    wo_category: document.getElementById('wo-form-category').value,
    wo_number: document.getElementById('wo-form-no').value.trim().toUpperCase(),
    project: document.getElementById('wo-form-project').value,
    customer_id: document.getElementById('wo-form-customer-select').value || null,
    requester_karyawan_id: document.getElementById('wo-form-requester-select').value || null,
    atasan_karyawan_id: document.getElementById('wo-form-atasan-select').value || null,
    manager_karyawan_id: document.getElementById('wo-form-manager-select').value || null,
    est_kirim: document.getElementById('wo-form-est-kirim').value || null,
    po_no: document.getElementById('wo-form-po-no').value,
    qty: document.getElementById('wo-form-qty').value,
    satuan: document.getElementById('wo-form-satuan').value,
    harga_satuan: document.getElementById('wo-form-harga-satuan').value,
    diskon: document.getElementById('wo-form-diskon').value,
    is_ppn: document.getElementById('wo-form-is-ppn').value === '1',
    is_pph23: document.getElementById('wo-form-is-pph23').value === '1',
    pph_lain_pct: document.getElementById('wo-form-pph-lain-pct').value,
    total_lain: document.getElementById('wo-form-total-lain').value,
    budget_lain: document.getElementById('wo-form-budget-lain').value,
    budget_prod: document.getElementById('wo-form-budget-prod').value,
    aktual_prod: document.getElementById('wo-form-aktual-prod').value,
    budget_pem: document.getElementById('wo-form-budget-pem').value,
    status: document.getElementById('wo-form-status').value,
    budget_items: budgetBlocks, // array kosong = tetap pakai budget_prod/aktual_prod manual di atas
  };

  try {
    if (id) {
      await api('api/work_orders.php', 'PUT', payload);
      showToast('Work Order berhasil diperbarui.');
    } else {
      await api('api/work_orders.php', 'POST', payload);
      showToast('Work Order berhasil ditambahkan.');
    }
    closeWOModal();
    await refresh('workOrders');
    renderWOTracking();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteWO(id) {
  if (!(await showConfirm('Hapus Work Order ini? Data PR/Seal/Transport/AR terkait tidak boleh ada agar bisa dihapus.'))) return;
  try {
    await api(`api/work_orders.php?id=${id}`, 'DELETE');
    showToast('Work Order berhasil dihapus.');
    await refresh('workOrders');
    renderWOTracking();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== SEAL CNC MODULE =====================

// ===================== URUTKAN (SORTIR) TABEL =====================
// Dropdown "Urutkan" di panel filter setiap tabel. Pilihan per tabel ada di TABLE_SORTS.
// Opsi pertama ('' = Default) mengikuti urutan bawaan dari server.
const SORT_BY = {
  dateDesc: (f, l = 'Tanggal Terbaru') => ({ v: `${f}:desc`, l, cmp: (a, b) => String(b[f] || '').localeCompare(String(a[f] || '')) }),
  dateAsc: (f, l = 'Tanggal Terlama') => ({ v: `${f}:asc`, l, cmp: (a, b) => (a[f] ? 0 : 1) - (b[f] ? 0 : 1) || String(a[f] || '').localeCompare(String(b[f] || '')) }),
  numDesc: (f, l) => ({ v: `${typeof f === 'string' ? f : l}:ndesc`, l, cmp: (a, b) => sortNum(b, f) - sortNum(a, f) }),
  numAsc: (f, l) => ({ v: `${typeof f === 'string' ? f : l}:nasc`, l, cmp: (a, b) => sortNum(a, f) - sortNum(b, f) }),
  text: (f, l) => ({ v: `${typeof f === 'string' ? f : l}:text`, l, cmp: (a, b) => sortText(a, f).localeCompare(sortText(b, f), 'id', { numeric: true, sensitivity: 'base' }) }),
};
function sortNum(r, f) { return Number(typeof f === 'function' ? f(r) : r[f]) || 0; }
function sortText(r, f) {
  const v = typeof f === 'function' ? f(r) : r[f];
  return v === null || v === undefined || v === '' ? '￿' : String(v); // kosong selalu di bawah
}

// Catatan: Cash Flow dihitung kronologis (saldo berjalan) tapi ditampilkan terbaru di atas.
const TABLE_SORTS = {
  pr: [SORT_BY.dateDesc('tanggal'), SORT_BY.dateAsc('tanggal'), SORT_BY.numDesc('total', 'Total Terbesar'), SORT_BY.numAsc('total', 'Total Terkecil'),
    SORT_BY.text('status', 'Status (dikelompokkan)'), SORT_BY.text('approval_status', 'Status Approval (dikelompokkan)'),
    SORT_BY.text('supplier_nama', 'Supplier A-Z'), SORT_BY.text('pr_number', 'No. PR')],
  wo: [SORT_BY.text('wo_number', 'No. WO'), SORT_BY.dateDesc('est_kirim', 'Est. Kirim Terbaru'), SORT_BY.dateAsc('est_kirim', 'Est. Kirim Terdekat'),
    SORT_BY.text(r => r.computed_status || r.status, 'Status (dikelompokkan)'), SORT_BY.text('customer_nama', 'Customer A-Z'), SORT_BY.text('po_no', 'No. PO'),
    SORT_BY.text(r => r.sj_status || 'BELUM SJ', 'Status Surat Jalan (dikelompokkan)'), SORT_BY.text('invoice_status', 'Status Invoice (dikelompokkan)'),
    ...(CAN_NILAI ? [SORT_BY.numDesc('wo_total', 'Nilai WO Terbesar'), SORT_BY.numDesc('profit_loss', 'Profit Terbesar'), SORT_BY.numAsc('profit_loss', 'Profit Terkecil / Rugi')] : [])],
  seal: [SORT_BY.text('wo_number', 'No. WO'), SORT_BY.text('customer_nama', 'Customer A-Z'), SORT_BY.text('product', 'Product A-Z'),
    SORT_BY.numDesc('total', 'Total Terbesar'), SORT_BY.numAsc('total', 'Total Terkecil')],
  transport: [SORT_BY.text('wo_number', 'No. WO'), SORT_BY.text('customer_nama', 'Customer A-Z'), SORT_BY.text('tujuan', 'Tujuan A-Z'),
    SORT_BY.numDesc('total', 'Total Terbesar'), SORT_BY.numAsc('total', 'Total Terkecil')],
  customers: [SORT_BY.text('nama', 'Nama A-Z'), SORT_BY.text('kota', 'Kota A-Z'), SORT_BY.text('status', 'Status (dikelompokkan)')],
  suppliers: [SORT_BY.text('nama', 'Nama A-Z'), SORT_BY.text('kota', 'Kota A-Z'), SORT_BY.text('status', 'Status (dikelompokkan)')],
  stok: [SORT_BY.text('nama', 'Nama Material A-Z'), SORT_BY.text('sku', 'SKU'), SORT_BY.text('kategori', 'Kategori (dikelompokkan)'),
    SORT_BY.numAsc('stok_qty', 'Stok Paling Sedikit'), SORT_BY.numDesc('stok_qty', 'Stok Paling Banyak'),
    SORT_BY.numDesc(r => (Number(r.stok_qty) || 0) * (Number(r.harga_satuan) || 0), 'Nilai Stok Terbesar')],
  incoming: [SORT_BY.dateDesc('tgl_datang', 'Tgl Datang Terbaru'), SORT_BY.dateAsc('tgl_datang', 'Tgl Datang Terlama'),
    SORT_BY.text('pr_number', 'No. PR'), SORT_BY.text('supplier_nama', 'Supplier A-Z'), SORT_BY.text('product', 'Nama Barang A-Z')],
  receiving: [SORT_BY.dateDesc('tgl_datang', 'Tgl Datang Terbaru'), SORT_BY.dateAsc('tgl_datang', 'Tgl Datang Terlama'),
    SORT_BY.text('pr_number', 'No. PR'), SORT_BY.text('supplier_nama', 'Supplier A-Z'), SORT_BY.text('product', 'Nama Barang A-Z')],
  produksi: [SORT_BY.text('po_number', 'No. Produksi'), SORT_BY.text('status', 'Status (dikelompokkan)'),
    SORT_BY.numDesc(r => produksiProgressPct(r), 'Progress Material Tertinggi'), SORT_BY.numAsc(r => produksiProgressPct(r), 'Progress Material Terendah'),
    SORT_BY.text('customer_nama', 'Customer A-Z'), SORT_BY.text('wo_number', 'No. WO')],
  riwayat: [SORT_BY.dateDesc('tanggal'), SORT_BY.dateAsc('tanggal'), SORT_BY.text('tipe', 'Tipe (dikelompokkan)'),
    SORT_BY.text('item_nama', 'Material A-Z'), SORT_BY.numDesc('qty', 'Qty Terbesar')],
  cashflow: [SORT_BY.dateDesc('tanggal'), SORT_BY.dateAsc('tanggal'), SORT_BY.numDesc('debit', 'Debit (Masuk) Terbesar'),
    SORT_BY.numDesc('kredit', 'Kredit (Keluar) Terbesar'), SORT_BY.text('kode', 'Kode (dikelompokkan)'), SORT_BY.text('status', 'Status (dikelompokkan)')],
  ar: [SORT_BY.dateDesc('tgl_invoice', 'Tgl Invoice Terbaru'), SORT_BY.dateAsc('tgl_invoice', 'Tgl Invoice Terlama'),
    SORT_BY.dateAsc('due_date', 'Jatuh Tempo Terdekat'), SORT_BY.numDesc('sisa_piutang', 'Sisa Piutang Terbesar'),
    SORT_BY.text('status', 'Status (dikelompokkan)'), SORT_BY.text('customer_nama', 'Customer A-Z')],
  ap: [SORT_BY.dateDesc('tgl_invoice', 'Tgl Invoice Terbaru'), SORT_BY.dateAsc('tgl_invoice', 'Tgl Invoice Terlama'),
    SORT_BY.dateAsc('due_date', 'Jatuh Tempo Terdekat'), SORT_BY.numDesc('sisa_hutang', 'Sisa Hutang Terbesar'),
    SORT_BY.text('status', 'Status (dikelompokkan)'), SORT_BY.text('supplier_nama', 'Supplier A-Z')],
  sj: [SORT_BY.dateDesc('tgl_kirim', 'Tgl Kirim Terbaru'), SORT_BY.dateAsc('tgl_kirim', 'Tgl Kirim Terlama'), SORT_BY.text('no_sj', 'No. SJ'),
    SORT_BY.text('status', 'Status (dikelompokkan)'), SORT_BY.text('customer_nama', 'Customer A-Z'),
    ...(CAN_NILAI ? [SORT_BY.numDesc('nilai_total', 'Nilai WO Terbesar')] : [])],
  talangan: [SORT_BY.dateDesc('tanggal'), SORT_BY.dateAsc('tanggal'), SORT_BY.numDesc('sisa', 'Sisa Terbesar'),
    SORT_BY.text('status', 'Status (dikelompokkan)'), SORT_BY.text('pic', 'PIC A-Z')],
  mtcdash: [SORT_BY.text('wo_number', 'No. WO'), SORT_BY.text('customer_nama', 'Customer A-Z'), SORT_BY.text('status', 'Status (dikelompokkan)'),
    ...(CAN_NILAI ? [SORT_BY.numDesc('nilai_po', 'Nilai PO Terbesar')] : []), SORT_BY.numDesc('total_biaya', 'Total Biaya Terbesar')],
};
// tbody tiap tabel (untuk mereset sortir klik-judul-kolom saat dropdown dipakai) & fungsi render ulangnya.
const SORT_TARGETS = {
  pr: ['pr-table-body', () => renderPRTable()], wo: ['wo-tracking-tbody', () => renderWOTracking()],
  seal: ['seal-table-tbody', () => renderSealTable()], transport: ['transport-table-tbody', () => renderTransportTable()],
  customers: ['customer-cards-container', () => renderCustomerDirectory()], suppliers: ['supplier-detail-tbody', () => renderSupplierDirectory()],
  stok: ['stok-table-tbody', () => renderStokTable()], incoming: ['incoming-table-tbody', () => renderIncomingTable()],
  receiving: ['receiving-table-tbody', () => renderReceivingTable()], produksi: ['produksi-table-tbody', () => renderProduksiTable()],
  riwayat: ['riwayat-table-tbody', () => renderRiwayatTable()], cashflow: ['cashflow-tbody', () => renderCashflowTable()],
  ar: ['ar-tbody', () => renderARTable()], ap: ['ap-tbody', () => renderAPTable()],
  talangan: ['talangan-tbody', () => renderTalanganTable()], sj: ['sj-tbody', () => renderSJTable()], mtcdash: ['mtc-dash-matrix-tbody', () => renderMTCDashboard()],
};

/** Urutkan baris sesuai pilihan dropdown "Urutkan" tabel tsb (tidak mengubah array asli). */
function sortRows(name, rows) {
  const v = document.getElementById(`sort-${name}`)?.value || '';
  const opt = v && (TABLE_SORTS[name] || []).find(o => o.v === v);
  if (!opt) return rows;
  return rows.map((r, i) => [r, i]).sort((a, b) => opt.cmp(a[0], b[0]) || a[1] - b[1]).map(x => x[0]);
}

// ===================== PAGINATION TABEL =====================
// Hanya baris di halaman aktif yang digambar ke layar, supaya tabel dengan ribuan
// data tetap cepat dibuka. Filter, pencarian, total, grafik & export Excel tetap
// memakai SEMUA data (yang dipotong hanya tampilannya).
const PAGE_SIZES = [10, 25, 50, 100, 0]; // 0 = Semua
const DEFAULT_PAGE_SIZE = 10;
const pageState = {}; // name -> { page, size }

function getPageState(name) {
  if (!pageState[name]) {
    let size = DEFAULT_PAGE_SIZE;
    try {
      const saved = localStorage.getItem(`pageSize:${name}`);
      if (saved !== null && PAGE_SIZES.includes(Number(saved))) size = Number(saved);
    } catch (e) { /* localStorage tidak tersedia */ }
    pageState[name] = { page: 1, size };
  }
  return pageState[name];
}

/** Potong baris sesuai halaman aktif + gambar kontrol halaman di bawah tabel. */
function pageRows(name, rows) {
  const st = getPageState(name);
  const total = rows.length;
  const pages = st.size ? Math.max(1, Math.ceil(total / st.size)) : 1;
  if (st.page > pages) st.page = pages;
  if (st.page < 1) st.page = 1;
  const start = st.size ? (st.page - 1) * st.size : 0;
  const slice = st.size ? rows.slice(start, start + st.size) : rows;
  renderPager(name, total, start, slice.length, pages);
  ensureColumnTool(name);
  return slice;
}

// ===================== ATUR KOLOM TABEL (pilih kolom yang tampil) =====================
// Tombol "Atur Kolom" di atas setiap tabel: user mencentang kolom yang mau ditampilkan.
// Default SEMUA kolom tampil. Pilihan disimpan per user & per tabel di browser (localStorage),
// berdasarkan JUDUL kolom (bukan posisi) supaya tetap benar walau ada kolom baru.
// Kolom disembunyikan lewat CSS nth-child, jadi tetap berlaku setiap tabel di-render ulang.
const colToolReady = {};
function colPrefKey(name) { return `hiddenCols:${(currentUser && currentUser.id) || 0}:${name}`; }
function colLoadHidden(name) {
  try { return JSON.parse(localStorage.getItem(colPrefKey(name)) || '[]'); } catch (e) { return []; }
}
function colSaveHidden(name, labels) {
  try { localStorage.setItem(colPrefKey(name), JSON.stringify(labels)); } catch (e) { /* abaikan */ }
}
function colTable(name) {
  const [tbodyId] = SORT_TARGETS[name] || [];
  const tbody = tbodyId && document.getElementById(tbodyId);
  return tbody && tbody.tagName === 'TBODY' ? tbody.closest('table') : null;
}
/** Judul kolom (baris header terakhir). Kolom pertama (Aksi) selalu tampil. */
function colHeaders(name) {
  const table = colTable(name);
  const row = table && table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
  if (!row) return [];
  return [...row.cells].map((th, i) => ({ i: i + 1, label: th.textContent.replace(/\s+/g, ' ').trim() || `Kolom ${i + 1}` }));
}
function colApply(name) {
  const table = colTable(name);
  if (!table) return;
  if (!table.id) table.id = `tbl-${name}`;
  const hidden = colLoadHidden(name);
  const idx = colHeaders(name).filter(h => h.i > 1 && hidden.includes(h.label)).map(h => h.i);
  let style = document.getElementById(`colstyle-${name}`);
  if (!style) { style = document.createElement('style'); style.id = `colstyle-${name}`; document.head.appendChild(style); }
  style.textContent = idx.map(i => `#${table.id} > thead > tr > :nth-child(${i}), #${table.id} > tbody > tr > :nth-child(${i}) { display: none; }`).join('\n');
  requestAnimationFrame(() => applyFreeze(name));
  const btn = document.getElementById(`coltool-btn-${name}`);
  if (btn) {
    const total = colHeaders(name).length - 1;
    btn.innerHTML = `<i class="fa-solid fa-table-columns"></i> Atur Kolom${idx.length ? ` <span class="px-1.5 rounded bg-indigo-600 text-white">${total - idx.length}/${total}</span>` : ''}`;
  }
}
// ===================== FREEZE KOLOM (kolom kiri tidak ikut tergeser) =====================
// Kolom dari paling kiri SAMPAI kolom berjudul ini tetap diam saat tabel digeser ke kanan.
const FREEZE_UNTIL = {
  pr: 'No PR', transport: 'No. WO', wo: 'No. WO', seal: 'No. WO',
  cashflow: 'Kode', ar: 'Customer', mtcdash: 'Customer & No PO',
};
const normHead = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * Warna latar SOLID untuk sel beku. Warna dibaca lewat canvas (mendukung semua format CSS,
 * termasuk oklch dari Tailwind), yang semi-transparan dicampur putih supaya isi di belakangnya tidak tembus.
 */
const _bgCanvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function opaqueBg(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const css = getComputedStyle(e).backgroundColor;
    if (!css || css === 'transparent') continue;
    _bgCanvas.clearRect(0, 0, 1, 1);
    _bgCanvas.fillStyle = '#000'; _bgCanvas.fillStyle = css;
    _bgCanvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a255] = _bgCanvas.getImageData(0, 0, 1, 1).data;
    const a = a255 / 255;
    if (!a) continue;
    const mix = c => Math.round(c * a + 255 * (1 - a));
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }
  return '#ffffff';
}
/** Hitung posisi kiri tiap kolom beku dari lebar kolom yang tampil, lalu pasang CSS sticky. */
function applyFreeze(name) {
  const until = FREEZE_UNTIL[name];
  const table = colTable(name);
  if (!until || !table || !table.tHead) return;
  if (!table.id) table.id = `tbl-${name}`;
  const row = table.tHead.rows[table.tHead.rows.length - 1];
  const cells = [...row.cells];
  const last = cells.findIndex(th => normHead(th.textContent) === normHead(until));
  let style = document.getElementById(`freeze-${name}`);
  if (!style) { style = document.createElement('style'); style.id = `freeze-${name}`; document.head.appendChild(style); }
  if (last < 0) { style.textContent = ''; return; }
  const id = `#${table.id}`;
  const body = `${id} > tbody > tr:not(:has(> td[colspan]))`;
  let left = 0, css = '', lastVisible = -1;
  for (let i = 0; i <= last; i++) if (cells[i].offsetWidth > 0) lastVisible = i;
  for (let i = 0; i <= last; i++) {
    const w = cells[i].offsetWidth;
    if (!w) continue; // kolom disembunyikan lewat "Atur Kolom"
    const n = i + 1;
    const shadow = i === lastVisible ? 'box-shadow: 3px 0 6px -2px rgba(15,23,42,.18);' : '';
    css += `${id} > thead > tr > :nth-child(${n}) { position: sticky; left: ${left}px; z-index: 21; background-color: ${opaqueBg(cells[i])}; ${shadow} }\n`;
    css += `${body} > :nth-child(${n}) { position: sticky; left: ${left}px; z-index: 11; background-color: #ffffff; ${shadow} }\n`;
    css += `${body}:hover > :nth-child(${n}) { background-color: #f8fafc; }\n`;
    left += w;
  }
  style.textContent = css;
}
window.addEventListener('resize', () => Object.keys(FREEZE_UNTIL).forEach(n => applyFreeze(n)));

function ensureColumnTool(name) {
  const table = colTable(name);
  if (!table) return;
  colApply(name); // header bisa dibangun ulang (mis. Dashboard MTC) - hitung ulang posisinya
  requestAnimationFrame(() => applyFreeze(name)); // setelah baris baru selesai digambar
  if (colToolReady[name]) return;
  colToolReady[name] = true;
  const scroller = table.parentElement && /overflow/.test(table.parentElement.className) ? table.parentElement : table;
  const bar = document.createElement('div');
  bar.className = 'relative flex justify-end px-3 py-1.5';
  bar.innerHTML = `
    <button type="button" id="coltool-btn-${name}" onclick="toggleColumnPanel('${name}', event)" class="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-600 text-[11px] font-bold hover:bg-slate-50 flex items-center gap-1.5"></button>
    <div id="coltool-panel-${name}" class="hidden absolute right-3 top-full mt-1 z-40 w-64 bg-white border border-slate-200 rounded-xl shadow-xl text-xs" onclick="event.stopPropagation()"></div>`;
  scroller.before(bar);
  colApply(name);
}
function toggleColumnPanel(name, ev) {
  if (ev) ev.stopPropagation();
  const panel = document.getElementById(`coltool-panel-${name}`);
  const open = panel.classList.contains('hidden');
  document.querySelectorAll('[id^="coltool-panel-"]').forEach(p => p.classList.add('hidden'));
  if (!open) return;
  const hidden = colLoadHidden(name);
  const heads = colHeaders(name).filter(h => h.i > 1);
  panel.innerHTML = `
    <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
      <b class="text-slate-700">Kolom yang ditampilkan</b>
      <button type="button" onclick="setAllColumns('${name}', true)" class="text-indigo-600 font-bold hover:underline">Tampilkan Semua</button>
    </div>
    <div class="max-h-72 overflow-y-auto custom-scrollbar py-1">
      ${heads.map(h => `<label class="flex items-center gap-2 px-3 py-1 hover:bg-slate-50 cursor-pointer">
        <input type="checkbox" class="w-4 h-4 accent-indigo-600" ${hidden.includes(h.label) ? '' : 'checked'} data-label="${esc(h.label)}" onchange="toggleColumn('${name}', this)">
        <span class="text-slate-700">${esc(h.label)}</span></label>`).join('')}
    </div>
    <div class="px-3 py-1.5 border-t border-slate-100 text-[10px] text-slate-400">Kolom Aksi selalu tampil. Pilihan tersimpan di browser ini.</div>`;
  panel.classList.remove('hidden');
}
function toggleColumn(name, cb) {
  const label = cb.dataset.label;
  let hidden = colLoadHidden(name).filter(l => l !== label);
  if (!cb.checked) hidden.push(label);
  colSaveHidden(name, hidden);
  colApply(name);
}
function setAllColumns(name, show) {
  colSaveHidden(name, show ? [] : colHeaders(name).filter(h => h.i > 1).map(h => h.label));
  colApply(name);
  document.querySelectorAll(`#coltool-panel-${name} input[type=checkbox]`).forEach(cb => { cb.checked = show; });
}
document.addEventListener('click', () => document.querySelectorAll('[id^="coltool-panel-"]').forEach(p => p.classList.add('hidden')));

function renderPager(name, total, start, shown, pages) {
  const [targetId] = SORT_TARGETS[name] || [];
  const target = targetId && document.getElementById(targetId);
  if (!target) return;
  let pager = document.getElementById(`pager-${name}`);
  if (!pager) {
    pager = document.createElement('div');
    pager.id = `pager-${name}`;
    pager.className = 'flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-slate-600';
    // Letakkan di bawah area scroll tabel (atau di bawah kontainer kartu).
    const table = target.closest('table');
    const anchor = table ? (table.parentElement && /overflow/.test(table.parentElement.className) ? table.parentElement : table) : target;
    anchor.after(pager);
    // Kartu tabel tanpa padding (mis. tabel PR): beri jarak sendiri supaya tidak menempel ke tepi.
    if (parseFloat(getComputedStyle(pager.parentElement).paddingLeft) < 8) pager.classList.add('px-4', 'pb-4');
    // Render yang berhenti lebih awal (data kosong / tidak cocok filter) tidak memanggil
    // pageRows -> sembunyikan pager kalau isi tabel tinggal baris pesan saja.
    new MutationObserver(() => {
      const hasData = [...target.children].some(el => !(el.tagName === 'TR' && el.cells.length === 1) && !/col-span-full/.test(el.className));
      pager.classList.toggle('hidden', !hasData);
    }).observe(target, { childList: true });
  }
  pager.classList.remove('hidden');
  const st = getPageState(name);
  if (total === 0) { pager.innerHTML = ''; return; }

  const btn = (p, label, disabled, active = false) =>
    `<button type="button" ${disabled ? 'disabled' : `onclick="goToPage('${name}', ${p})"`}
      class="min-w-[32px] h-8 px-2 rounded-lg border text-xs font-bold transition ${active ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}">${label}</button>`;
  // Nomor halaman ringkas: 1 … 4 5 [6] 7 8 … 20
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - st.page) <= 2) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const numBtns = nums.map(p => p === '…' ? '<span class="px-1 text-slate-400">…</span>' : btn(p, p, false, p === st.page)).join('');

  pager.innerHTML = `
    <div class="flex items-center gap-2">
      <span>Tampilkan</span>
      <select onchange="setPageSize('${name}', this.value)" class="h-8 px-2 bg-white border border-slate-300 rounded-lg text-xs font-bold">
        ${PAGE_SIZES.map(s => `<option value="${s}" ${s === st.size ? 'selected' : ''}>${s || 'Semua'}</option>`).join('')}
      </select>
      <span class="text-slate-500">Baris <b>${(start + 1).toLocaleString('id-ID')}–${(start + shown).toLocaleString('id-ID')}</b> dari <b>${total.toLocaleString('id-ID')}</b></span>
    </div>
    ${pages > 1 ? `<div class="flex items-center gap-1 flex-wrap">
      ${btn(st.page - 1, '<i class="fa-solid fa-chevron-left"></i>', st.page <= 1)}
      ${numBtns}
      ${btn(st.page + 1, '<i class="fa-solid fa-chevron-right"></i>', st.page >= pages)}
    </div>` : ''}`;
}

function rerenderTable(name) {
  const [, render] = SORT_TARGETS[name] || [];
  if (render) render();
}

function goToPage(name, page) {
  getPageState(name).page = page;
  rerenderTable(name);
  // Gulir ke awal tabel supaya halaman baru langsung terlihat.
  const [targetId] = SORT_TARGETS[name] || [];
  const el = targetId && document.getElementById(targetId);
  const top = el && (el.closest('table') || el);
  if (top) top.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setPageSize(name, size) {
  const st = getPageState(name);
  st.size = Number(size);
  st.page = 1;
  try { localStorage.setItem(`pageSize:${name}`, String(st.size)); } catch (e) { /* abaikan */ }
  rerenderTable(name);
}

// Saat filter / pencarian / urutan di sebuah tab diubah, kembali ke halaman 1.
// Pakai fase "capture" supaya halaman sudah di-reset SEBELUM handler oninput/onchange
// milik filter itu sendiri merender ulang tabel.
['input', 'change'].forEach(evt => document.addEventListener(evt, e => {
  const el = e.target;
  if (!(el instanceof HTMLElement) || el.closest('[id^=pager-]') || el.closest('table')) return;
  const tab = el.closest('[id^=tab-content-]');
  if (!tab) return;
  Object.entries(SORT_TARGETS).forEach(([name, [targetId]]) => {
    if (tab.querySelector(`#${targetId}`)) getPageState(name).page = 1;
  });
}, true));

function sortSelectHtml(name, selectClass) {
  return `<select id="sort-${name}" data-sort-tbody="${(SORT_TARGETS[name] || [])[0] || ''}" onchange="onSortChange('${name}')" class="${selectClass}">
      <option value="">Default</option>
      ${(TABLE_SORTS[name] || []).map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}
    </select>`;
}

function onSortChange(name) {
  const [tbodyId, render] = SORT_TARGETS[name] || [];
  if (window.TableTools && tbodyId) window.TableTools.clearSort(tbodyId);
  if (render) render();
}

/**
 * Tempel dropdown "Urutkan" ke panel filter yang sudah ada, tepat setelah
 * kontrol filter `afterId` - memakai class yang sama dengan sel filter di sebelahnya
 * supaya tampilannya seragam.
 */
function mountSortSelect(name, afterId) {
  if (document.getElementById(`sort-${name}`)) return;
  const ref = document.getElementById(afterId);
  if (!ref) return;
  // Naik maksimal 3 level mencari "sel" filter (div yang berisi <label> + kontrol).
  let cell = ref;
  for (let i = 0; i < 3 && cell.parentElement && !cell.querySelector('label'); i++) cell = cell.parentElement;
  if (!cell.querySelector('label')) {
    // Panel tanpa label (mis. kotak cari di header Dashboard MTC): taruh dropdown ringkas di sebelahnya.
    const wrap = ref.parentElement;
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `<i class="fa-solid fa-arrow-down-wide-short text-slate-400 text-sm" title="Urutkan"></i>` +
      sortSelectHtml(name, 'py-2 px-3 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500');
    // Kelompokkan kotak cari + dropdown supaya tetap berdampingan di layout header.
    const group = document.createElement('div');
    group.className = 'flex items-center gap-2 flex-wrap';
    wrap.before(group);
    group.append(wrap, div);
    return;
  }
  const label = cell.querySelector('label');
  const panel = cell.parentElement;
  const refSelect = panel.querySelector('select') || ref;
  const div = document.createElement('div');
  div.className = cell.className;
  div.innerHTML = `<label class="${label ? label.className : ''}"><i class="fa-solid fa-arrow-down-wide-short mr-1"></i>Urutkan</label>` +
    sortSelectHtml(name, refSelect.className.replace(/\bpl-\d+\b/, ''));
  cell.after(div);
}

function mountAllSortSelects() {
  [['pr', 'filter-approval'], ['wo', 'filter-wo-status'], ['customers', 'filter-customer-directory-status'],
   ['suppliers', 'filter-supplier-directory-status'], ['stok', 'filter-stok-kondisi'], ['cashflow', 'filter-cf-search'],
   ['ar', 'filter-ar-status'], ['ap', 'filter-ap-status'], ['mtcdash', 'mtc-dash-search']]
    .forEach(([name, afterId]) => mountSortSelect(name, afterId));
}
document.addEventListener('DOMContentLoaded', mountAllSortSelects);

// ===================== FILTER & PENCARIAN TABEL (GENERIK) =====================
// Satu mesin filter untuk tabel: Transportasi, Seal CNC, Progress Produksi,
// Riwayat Pergerakan Stok, Dana Talangan. Tiap tabel cukup didefinisikan di TABLE_FILTERS.
//   search : field yang dicari (boleh beberapa kata, semua kata harus cocok)
//   selects: dropdown. `get` = ambil nilai dari baris (pilihan dibuat otomatis dari data),
//            atau `options` = pilihan tetap [{v, l, test?}]
//   date   : field tanggal untuk filter rentang Dari - Sampai
function produksiProgressPct(p) {
  const butuh = (p.bom_items || []).reduce((s, b) => s + Number(b.qty_dibutuhkan), 0);
  const pakai = (p.bom_items || []).reduce((s, b) => s + Number(b.qty_terpakai), 0);
  return butuh > 0 ? Math.min(100, Math.round((pakai / butuh) * 100)) : 0;
}

const TABLE_FILTERS = {
  incoming: {
    color: 'orange', data: () => prItems.filter(p => p.status === 'STORE ROOM'), render: () => renderIncomingTable(),
    placeholder: 'Cari No. PR, barang, supplier, WO, project...',
    search: ['pr_number', 'product', 'supplier_nama', 'wo_number', 'project', 'penerima_barang'],
    selects: [
      { key: 'supplier', label: 'Supplier', all: 'Semua Supplier', get: r => r.supplier_nama },
      { key: 'wo', label: 'No WO', all: 'Semua WO', get: r => r.wo_number },
    ],
    date: 'tgl_datang',
  },
  receiving: {
    color: 'lime', data: () => prItems.filter(p => p.status === 'RECEIVED').sort((a, b) => (b.tgl_datang || '').localeCompare(a.tgl_datang || '')), render: () => renderReceivingTable(),
    placeholder: 'Cari No. PR, barang, supplier, WO, penerima...',
    search: ['pr_number', 'product', 'supplier_nama', 'wo_number', 'project', 'penerima_barang'],
    selects: [
      { key: 'supplier', label: 'Supplier', all: 'Semua Supplier', get: r => r.supplier_nama },
      { key: 'wo', label: 'No WO', all: 'Semua WO', get: r => r.wo_number },
    ],
    date: 'tgl_datang',
  },
  transport: {
    color: 'blue', data: () => transportItems, render: () => renderTransportTable(),
    placeholder: 'Cari WO, project, customer, deskripsi, asal, tujuan...',
    search: ['wo_number', 'project', 'customer_nama', 'deskripsi', 'asal', 'tujuan'],
    selects: [
      { key: 'customer', label: 'Customer', all: 'Semua Customer', get: r => r.customer_nama },
      { key: 'wo', label: 'No WO', all: 'Semua WO', get: r => r.wo_number },
    ],
    total: r => Number(r.total) || 0,
  },
  seal: {
    color: 'amber', data: () => sealItems, render: () => renderSealTable(),
    placeholder: 'Cari WO, project, customer, product, type, dimensi, brand...',
    search: ['wo_number', 'project', 'customer_nama', 'product', 'type', 'dimensi', 'brand'],
    selects: [
      { key: 'customer', label: 'Customer', all: 'Semua Customer', get: r => r.customer_nama },
      { key: 'wo', label: 'No WO', all: 'Semua WO', get: r => r.wo_number },
      { key: 'brand', label: 'Brand', all: 'Semua Brand', get: r => r.brand },
    ],
    total: r => Number(r.total) || 0,
  },
  produksi: {
    color: 'teal', data: () => productionOrders, render: () => renderProduksiTable(),
    placeholder: 'Cari No produksi, WO, customer, product...',
    search: ['po_number', 'wo_number', 'customer_nama', 'product'],
    selects: [
      { key: 'status', label: 'Status', all: 'Semua Status', get: r => r.status,
        options: ['DRAFT', 'ON PROGRESS', 'HOLD', 'SELESAI', 'CANCEL'].map(v => ({ v, l: v })) },
      { key: 'progress', label: 'Progress Material', all: 'Semua Progress', options: [
        { v: 'NOL', l: 'Belum mulai (0%)', test: r => produksiProgressPct(r) === 0 },
        { v: 'JALAN', l: 'Berjalan (1-99%)', test: r => { const x = produksiProgressPct(r); return x > 0 && x < 100; } },
        { v: 'PENUH', l: 'Material lengkap (100%)', test: r => produksiProgressPct(r) === 100 },
      ] },
      { key: 'customer', label: 'Customer', all: 'Semua Customer', get: r => r.customer_nama },
    ],
  },
  riwayat: {
    color: 'cyan', data: () => inventoryMovements, render: () => renderRiwayatTable(),
    placeholder: 'Cari SKU, material, WO, keterangan, user...',
    search: ['sku', 'item_nama', 'wo_number', 'keterangan', 'user_nama', 'sumber'],
    selects: [
      { key: 'tipe', label: 'Tipe', all: 'Semua Tipe', get: r => r.tipe,
        options: [{ v: 'IN', l: 'IN (Masuk)' }, { v: 'OUT', l: 'OUT (Keluar)' }, { v: 'ADJUSTMENT', l: 'ADJUSTMENT' }] },
      { key: 'sumber', label: 'Sumber', all: 'Semua Sumber', get: r => r.sumber,
        options: ['PEMBELIAN', 'PRODUKSI', 'MANUAL', 'RETUR', 'OPNAME'].map(v => ({ v, l: v })) },
      { key: 'material', label: 'Material', all: 'Semua Material', get: r => r.sku ? `${r.sku} - ${r.item_nama}` : '' },
    ],
    date: 'tanggal',
  },
  sj: {
    color: 'sky', data: () => sjData, render: () => renderSJTable(),
    placeholder: 'Cari No SJ, No WO, customer, project, PO, invoice...',
    search: ['no_sj', 'wo_numbers', 'customer_nama', 'projects', 'po_numbers', 'nomor_invoice', 'auto_invoices', 'keterangan'],
    selects: [
      { key: 'status', label: 'Status SJ', all: 'Semua Status', get: r => r.status,
        options: Object.entries(SJ_STATUS_CFG).map(([v, c]) => ({ v, l: c.l })) },
      { key: 'customer', label: 'Customer', all: 'Semua Customer', get: r => r.customer_nama },
    ],
    date: 'tgl_kirim',
  },
  talangan: {
    color: 'purple', data: () => danaTalangan, render: () => renderTalanganTable(),
    placeholder: 'Cari No DT, PIC, deskripsi...',
    search: ['no_dt', 'pic', 'deskripsi'],
    selects: [
      { key: 'status', label: 'Status', all: 'Semua Status', get: r => r.status,
        options: [{ v: 'PENDING', l: 'PENDING' }, { v: 'PARTIAL', l: 'PARTIAL' }, { v: 'LUNAS', l: 'LUNAS' }] },
      { key: 'pic', label: 'PIC', all: 'Semua PIC', get: r => r.pic },
    ],
    date: 'tanggal',
  },
};

function tfId(name, key) { return `tf-${name}-${key}`; }

/** Bangun filter bar sekali saja ke dalam <div id="tf-bar-NAME">. */
function tfEnsureBar(name) {
  const host = document.getElementById(`tf-bar-${name}`);
  const cfg = TABLE_FILTERS[name];
  if (!host || host.dataset.ready) return;
  const c = cfg.color;
  const lbl = 'block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1';
  const inp = `w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-${c}-500`;
  const on = `TABLE_FILTERS['${name}'].render()`;
  let html = `
    <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 flex flex-wrap gap-3 items-end">
      <div class="flex-1 min-w-[220px]">
        <label class="${lbl}">Pencarian</label>
        <div class="relative">
          <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-2.5 text-slate-400 text-xs"></i>
          <input type="text" id="${tfId(name, 'q')}" oninput="${on}" placeholder="${esc(cfg.placeholder)}" class="${inp} pl-9">
        </div>
      </div>`;
  (cfg.selects || []).forEach(sel => {
    html += `
      <div class="w-full sm:w-auto sm:min-w-[160px]">
        <label class="${lbl}">${esc(sel.label)}</label>
        <select id="${tfId(name, sel.key)}" onchange="${on}" class="${inp}"><option value="ALL">${esc(sel.all)}</option></select>
      </div>`;
  });
  if (TABLE_SORTS[name]) {
    html += `
      <div class="w-full sm:w-auto sm:min-w-[170px]">
        <label class="${lbl}"><i class="fa-solid fa-arrow-down-wide-short mr-1"></i>Urutkan</label>
        ${sortSelectHtml(name, inp)}
      </div>`;
  }
  if (cfg.date) {
    html += `
      <div class="w-full sm:w-auto">
        <label class="${lbl}">Tanggal Dari</label>
        <input type="date" id="${tfId(name, 'from')}" onchange="${on}" class="${inp}">
      </div>
      <div class="w-full sm:w-auto">
        <label class="${lbl}">Sampai</label>
        <input type="date" id="${tfId(name, 'to')}" onchange="${on}" class="${inp}">
      </div>`;
  }
  html += `
      <button type="button" onclick="tfReset('${name}')" title="Reset filter" class="h-[30px] px-3 text-xs text-${c}-700 hover:text-${c}-900 bg-white border border-slate-300 rounded-lg font-semibold whitespace-nowrap"><i class="fa-solid fa-rotate-left mr-1"></i>Reset</button>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 mt-2">
      <span id="${tfId(name, 'count')}" class="text-[11px] font-bold text-slate-500"></span>
      <span id="${tfId(name, 'sum')}" class="text-[11px] font-bold text-slate-600"></span>
    </div>`;
  host.innerHTML = html;
  host.dataset.ready = '1';
}

/** Isi ulang pilihan dropdown dinamis dari data (pilihan yang sedang aktif dipertahankan). */
function tfRefreshOptions(name) {
  const cfg = TABLE_FILTERS[name];
  const rows = cfg.data() || [];
  (cfg.selects || []).forEach(sel => {
    const el = document.getElementById(tfId(name, sel.key));
    if (!el) return;
    const cur = el.value || 'ALL';
    let opts;
    if (sel.options) {
      opts = sel.options;
    } else {
      const vals = [...new Set(rows.map(sel.get).filter(v => v !== null && v !== undefined && String(v).trim() !== ''))]
        .map(String).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
      opts = vals.map(v => ({ v, l: v }));
    }
    el.innerHTML = `<option value="ALL">${esc(sel.all)}</option>` + opts.map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
    el.value = opts.some(o => String(o.v) === cur) ? cur : 'ALL';
  });
}

/** Kembalikan baris yang lolos filter + perbarui teks jumlah/total. */
function tfApply(name) {
  const cfg = TABLE_FILTERS[name];
  tfEnsureBar(name);
  tfRefreshOptions(name);
  const rows = cfg.data() || [];
  const val = (k) => (document.getElementById(tfId(name, k))?.value ?? '');
  const words = val('q').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const from = cfg.date ? val('from') : '';
  const to = cfg.date ? val('to') : '';

  const out = rows.filter(r => {
    if (words.length) {
      const hay = cfg.search.map(f => r[f] ?? '').join(' ').toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    for (const sel of (cfg.selects || [])) {
      const v = val(sel.key);
      if (!v || v === 'ALL') continue;
      const opt = sel.options && sel.options.find(o => String(o.v) === v);
      if (opt && opt.test) { if (!opt.test(r)) return false; }
      else if (String(sel.get(r) ?? '') !== v) return false;
    }
    if (from || to) {
      const d = String(r[cfg.date] || '').slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
    }
    return true;
  });

  const countEl = document.getElementById(tfId(name, 'count'));
  if (countEl) countEl.textContent = `Menampilkan ${out.length.toLocaleString('id-ID')} dari ${rows.length.toLocaleString('id-ID')} data`;
  const sumEl = document.getElementById(tfId(name, 'sum'));
  if (sumEl) sumEl.textContent = cfg.total ? `Total (hasil filter): ${formatRupiah(out.reduce((s, r) => s + cfg.total(r), 0))}` : '';
  return sortRows(name, out);
}

function tfReset(name) {
  const cfg = TABLE_FILTERS[name];
  const q = document.getElementById(tfId(name, 'q')); if (q) q.value = '';
  (cfg.selects || []).forEach(sel => { const el = document.getElementById(tfId(name, sel.key)); if (el) el.value = 'ALL'; });
  ['from', 'to'].forEach(k => { const el = document.getElementById(tfId(name, k)); if (el) el.value = ''; });
  const sortEl = document.getElementById(`sort-${name}`); if (sortEl) sortEl.value = '';
  const [tbodyId] = SORT_TARGETS[name] || [];
  if (window.TableTools && tbodyId) window.TableTools.clearSort(tbodyId);
  cfg.render();
}

function tfNoMatchRow(colspan) {
  return `<tr><td colspan="${colspan}" class="text-center py-8 text-slate-400 font-semibold">Tidak ada data yang cocok dengan pencarian / filter. <button onclick="this.closest('[id^=tab-content-]').querySelector('button[onclick^=tfReset]')?.click()" class="ml-1 text-indigo-600 hover:underline font-bold">Reset filter</button></td></tr>`;
}

/** Cetak semua item Seal CNC milik 1 WO (dokumen A4). */
function printSealWO(woId) {
  if (!woId) { showToast('Item ini belum terhubung ke WO.', 'error'); return; }
  const items = sealItems.filter(x => Number(x.wo_id) === Number(woId));
  if (!items.length) { showToast('Tidak ada data Seal CNC untuk WO ini.', 'error'); return; }
  const w = workOrders.find(x => Number(x.id) === Number(woId)) || {};
  const first = items[0];
  const totalQty = items.reduce((t, x) => t + (Number(x.qty) || 0), 0);
  const grand = items.reduce((t, x) => t + (Number(x.total) || 0), 0);
  const rows = items.map((x, i) => `
    <tr><td class="center">${i + 1}</td><td><b>${esc(x.product || '-')}</b></td><td>${esc(x.type || '-')}</td>
    <td>${esc(x.dimensi || '-')}</td><td>${esc(x.brand || '-')}</td><td class="center">${formatQty(x.qty)}</td>
    <td class="num">${formatRupiah(x.harga)}</td><td class="num" style="font-weight:700;">${formatRupiah(x.total)}</td></tr>`).join('');
  const body = `
    <div class="print-header">
      <div><div class="company">PANCA PUTRA MADANI</div><div style="color:#64748b;">Daftar Pesanan / Produksi Seal CNC</div></div>
      <div class="doc-no">SEAL CNC<br><span style="font-size:16px;">${esc(w.wo_number || first.wo_number || '-')}</span></div>
    </div>
    <div class="meta-grid">
      <div><span class="lbl">No. WO</span> ${esc(w.wo_number || first.wo_number || '-')}</div>
      <div><span class="lbl">Customer</span> ${esc(w.customer_nama || first.customer_nama || '-')}</div>
      <div><span class="lbl">Nama Project</span> ${esc(w.project || first.project || '-')}</div>
      <div><span class="lbl">No. PO Customer</span> ${esc(w.po_no || '-')}</div>
      <div><span class="lbl">Estimasi Kirim</span> ${formatDateID(w.est_kirim)}</div>
      <div><span class="lbl">Jumlah Item</span> ${items.length} item &middot; Qty ${formatQty(totalQty)}</div>
    </div>
    <h2>Rincian Item Seal CNC</h2>
    <table>
      <thead><tr><th style="width:28px;">No</th><th>Product Part</th><th>Type</th><th>Dimensi</th><th>Brand</th><th class="center">Qty</th><th class="num">Harga</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5" class="num"><b>TOTAL</b></td><td class="center"><b>${formatQty(totalQty)}</b></td><td></td><td class="num"><b>${formatRupiah(grand)}</b></td></tr></tfoot>
    </table>
    <div class="sign-grid">
      <div class="box">Dibuat Oleh</div><div class="box">Diperiksa (Produksi)</div><div class="box">Disetujui</div>
    </div>`;
  openPrintWindow(`Seal CNC ${w.wo_number || first.wo_number || ''}`, body);
}

/** Tombol "Print per WO" di atas tabel: pakai No WO yang dipilih di filter. */
function printSealByFilter() {
  const woNo = document.getElementById(tfId('seal', 'wo'))?.value || '';
  if (!woNo || woNo === 'ALL') {
    showToast('Pilih No WO di filter dulu, atau klik ikon print di baris item Seal-nya.', 'error');
    return;
  }
  const item = sealItems.find(x => x.wo_number === woNo);
  printSealWO(item ? item.wo_id : null);
}

function renderSealTable() {
  const tbody = document.getElementById('seal-table-tbody');
  const rows = tfApply('seal');
  if (sealItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Seal CNC.</td></tr>`;
    syncBulkBar('seal');
    return;
  }
  if (rows.length === 0) {
    tbody.innerHTML = tfNoMatchRow(11);
    syncBulkBar('seal');
    return;
  }
  tbody.innerHTML = pageRows('seal', rows).map(s => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-4 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          ${bulkCheckbox('seal', s.id)}
          <button onclick="printSealWO(${s.wo_id ? Number(s.wo_id) : 'null'})" class="p-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition" title="Print semua Seal CNC WO ini"><i class="fa-solid fa-print"></i></button>
          <button onclick="openSealModal('edit', ${s.id})" class="p-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteSealItem(${s.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-4 font-bold text-amber-900">${esc(s.wo_number || '-')}</td>
      <td class="py-2.5 px-4">${esc(s.project || '-')}</td>
      <td class="py-2.5 px-4">${esc(s.customer_nama || '-')}</td>
      <td class="py-2.5 px-4 font-semibold">${esc(s.product || '-')}</td>
      <td class="py-2.5 px-4">${esc(s.type || '-')}</td>
      <td class="py-2.5 px-4">${esc(s.dimensi || '-')}</td>
      <td class="py-2.5 px-4">${esc(s.brand || '-')}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatQty(s.qty)}</td>
      <td class="py-2.5 px-4 text-right font-mono">${formatRupiah(s.harga)}</td>
      <td class="py-2.5 px-4 text-right font-extrabold">${formatRupiah(s.total)}</td>
    </tr>
  `).join('');
  syncBulkBar('seal');
}

function handleSealWOChange() {
  const woId = document.getElementById('seal-wo-select').value;
  const w = workOrders.find(x => String(x.id) === String(woId));
  document.getElementById('seal-project-input').value = w ? w.project : '';
  document.getElementById('seal-customer-input').value = w ? (w.customer_nama || '') : '';
}

// --- Seal item block (mode multi-item saat Tambah Data Seal CNC baru) ---

function buildSealItemBlockHTML() {
  return `
  <div class="seali-block bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
    <div class="flex items-center justify-between">
      <span class="seali-item-label text-xs font-extrabold text-amber-700">Item #1</span>
      <button type="button" onclick="removeSealItemBlock(this)" class="seali-remove-btn text-rose-500 hover:text-rose-700 text-[11px] font-bold flex items-center gap-1"><i class="fa-solid fa-trash-can"></i> Hapus Item</button>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
      <div class="sm:col-span-2"><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Product Part</label><select class="seali-product w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs"></select></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Type</label><input type="text" class="seali-type w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="Rod Seal"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Brand</label><input type="text" class="seali-brand w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="NOK"></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Dimensi</label><input type="text" class="seali-dimensi w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="50x65x10 mm"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Qty *</label><input type="number" class="seali-qty w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs" min="0.01" step="any" value="1" required oninput="calcSealItemBlockTotal(this)"></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Harga Satuan (Rp)</label><input type="number" class="seali-harga w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs" min="0" value="0" oninput="calcSealItemBlockTotal(this)"></div>
    </div>
    <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Total (Rp)</label><input type="text" class="seali-total w-full p-2 bg-slate-900 text-emerald-400 border border-slate-800 rounded-lg font-extrabold text-xs" readonly></div>
  </div>`;
}

function populateSealItemBlockDropdown(block) {
  const sel = block.querySelector('.seali-product');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- Pilih / ketik manual --</option>' + masterProducts.map(p => opt(p.nama, p.nama)).join('');
  if (cur) sel.value = cur;
}

function addSealItemBlock(data = null) {
  const container = document.getElementById('seal-items-container');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildSealItemBlockHTML();
  const block = wrapper.firstElementChild;
  container.appendChild(block);

  populateSealItemBlockDropdown(block);

  if (data) {
    block.querySelector('.seali-product').value = data.product || '';
    block.querySelector('.seali-type').value = data.type || '';
    block.querySelector('.seali-brand').value = data.brand || '';
    block.querySelector('.seali-dimensi').value = data.dimensi || '';
    block.querySelector('.seali-qty').value = qtyInputValue(data.qty);
    block.querySelector('.seali-harga').value = data.harga;
  }

  calcSealItemBlockTotal(block.querySelector('.seali-qty'));
  updateSealItemLabelsAndButtons();
  return block;
}

function removeSealItemBlock(btn) {
  const container = document.getElementById('seal-items-container');
  const blocks = container.querySelectorAll('.seali-block');
  if (blocks.length <= 1) {
    showToast('Minimal harus ada 1 item Seal.', 'error');
    return;
  }
  btn.closest('.seali-block').remove();
  updateSealItemLabelsAndButtons();
}

function updateSealItemLabelsAndButtons() {
  const blocks = document.querySelectorAll('#seal-items-container .seali-block');
  blocks.forEach((block, idx) => {
    block.querySelector('.seali-item-label').textContent = `Item #${idx + 1}`;
  });
  const isEditMode = !!document.getElementById('seal-form-id').value;
  document.getElementById('seal-add-item-btn').classList.toggle('hidden', isEditMode);
  blocks.forEach(block => {
    block.querySelector('.seali-remove-btn').classList.toggle('hidden', isEditMode || blocks.length <= 1);
  });
}

function calcSealItemBlockTotal(el) {
  const block = el.closest('.seali-block');
  const qty = parseFloat(block.querySelector('.seali-qty').value) || 0;
  const harga = parseFloat(block.querySelector('.seali-harga').value) || 0;
  block.querySelector('.seali-total').value = formatRupiah(qty * harga);
}

function openSealModal(mode, id = null) {
  document.getElementById('seal-form').reset();
  document.getElementById('seal-form-id').value = '';
  document.getElementById('seal-items-container').innerHTML = '';
  updateDropdownOptions();

  const title = document.getElementById('seal-modal-title');
  if (mode === 'add') {
    title.textContent = 'Form Produksi & Pesanan SEAL CNC - Tambah Baru';
    addSealItemBlock();
  } else {
    const s = sealItems.find(x => x.id === id);
    if (!s) return;
    title.textContent = 'Edit Data Seal CNC';
    document.getElementById('seal-form-id').value = s.id;
    document.getElementById('seal-wo-select').value = s.wo_id || '';
    document.getElementById('seal-project-input').value = s.project || '';
    document.getElementById('seal-customer-input').value = s.customer_nama || '';
    addSealItemBlock(s);
  }
  document.getElementById('seal-modal').classList.remove('hidden');
}

function closeSealModal() {
  document.getElementById('seal-modal').classList.add('hidden');
}

async function handleSealSubmit(e) {
  e.preventDefault();
  const woId = document.getElementById('seal-wo-select').value;
  const w = workOrders.find(x => String(x.id) === String(woId));
  const id = document.getElementById('seal-form-id').value;

  const sharedFields = {
    wo_id: woId,
    project: w ? w.project : document.getElementById('seal-project-input').value,
    customer_id: w ? w.customer_id : null,
  };

  const blocks = Array.from(document.querySelectorAll('#seal-items-container .seali-block'));

  try {
    if (id) {
      // Mode edit: selalu 1 blok, PUT ke item yang sama.
      const block = blocks[0];
      const payload = {
        id,
        ...sharedFields,
        product: block.querySelector('.seali-product').value,
        type: block.querySelector('.seali-type').value,
        dimensi: block.querySelector('.seali-dimensi').value,
        brand: block.querySelector('.seali-brand').value,
        qty: block.querySelector('.seali-qty').value,
        harga: block.querySelector('.seali-harga').value,
      };
      await api('api/seal_items.php', 'PUT', payload);
      showToast('Data Seal CNC berhasil diperbarui.');
    } else {
      // Mode tambah: bisa banyak item sekaligus, dikirim satu per satu berurutan.
      let successCount = 0;
      const errors = [];
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const payload = {
          ...sharedFields,
          product: block.querySelector('.seali-product').value,
          type: block.querySelector('.seali-type').value,
          dimensi: block.querySelector('.seali-dimensi').value,
          brand: block.querySelector('.seali-brand').value,
          qty: block.querySelector('.seali-qty').value,
          harga: block.querySelector('.seali-harga').value,
        };
        try {
          await api('api/seal_items.php', 'POST', payload);
          successCount++;
        } catch (err) {
          errors.push(`Item #${i + 1}: ${err.message}`);
        }
      }
      if (errors.length === 0) {
        showToast(`${successCount} item Seal CNC berhasil ditambahkan.`);
      } else if (successCount > 0) {
        showToast(`${successCount} item tersimpan, ${errors.length} gagal — ${errors.join(' | ')}`, 'error');
      } else {
        showToast(`Gagal menyimpan: ${errors.join(' | ')}`, 'error');
        return;
      }
    }
    closeSealModal();
    await refresh('sealItems', 'workOrders');
    renderSealTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteSealItem(id) {
  if (!(await showConfirm('Hapus item Seal CNC ini?'))) return;
  try {
    await api(`api/seal_items.php?id=${id}`, 'DELETE');
    showToast('Data Seal CNC berhasil dihapus.');
    await refresh('sealItems', 'workOrders');
    renderSealTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== GUDANG: STOK MATERIAL MODULE =====================

/** Kondisi stok: HABIS (<= 0), MENIPIS (ada tapi <= minimum), AMAN (di atas minimum). */
function stokKondisi(i) {
  const q = Number(i.stok_qty) || 0;
  const min = Number(i.stok_min) || 0;
  if (q <= 0) return 'HABIS';
  if (q <= min) return 'MENIPIS';
  return 'AMAN';
}

function setStokFilterKondisi(val) {
  const sel = document.getElementById('filter-stok-kondisi');
  if (sel) sel.value = val;
  renderStokTable();
}

function resetStokFilters() {
  ['filter-stok-kategori', 'filter-stok-kondisi', 'filter-stok-status'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = 'ALL';
  });
  const s = document.getElementById('filter-stok-search'); if (s) s.value = '';
  renderStokTable();
}

function getFilteredStokItems() {
  const q = (document.getElementById('filter-stok-search')?.value || '').trim().toLowerCase();
  const kat = document.getElementById('filter-stok-kategori')?.value || 'ALL';
  const kondisi = document.getElementById('filter-stok-kondisi')?.value || 'ALL';
  const status = document.getElementById('filter-stok-status')?.value || 'ALL';
  const words = q.split(/\s+/).filter(Boolean);
  return inventoryItems.filter(i => {
    if (words.length) {
      const hay = `${i.sku || ''} ${i.nama || ''} ${i.kategori || ''}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    if (kat !== 'ALL' && (i.kategori || '-') !== kat) return false;
    if (status !== 'ALL' && i.status !== status) return false;
    if (kondisi !== 'ALL') {
      const k = stokKondisi(i);
      if (kondisi === 'ADA' ? k === 'HABIS' : k !== kondisi) return false;
    }
    return true;
  });
}

/** Isi dropdown Kategori dari data material yang ada (pilihan yang sedang dipilih dipertahankan). */
function refreshStokKategoriOptions() {
  const sel = document.getElementById('filter-stok-kategori');
  if (!sel) return;
  const cur = sel.value || 'ALL';
  const cats = [...new Set(inventoryItems.map(i => i.kategori || '-'))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="ALL">Semua Kategori</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = cats.includes(cur) ? cur : 'ALL';
}

function renderStokTable() {
  const tbody = document.getElementById('stok-table-tbody');
  refreshStokKategoriOptions();

  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('stok-sum-total', inventoryItems.length.toLocaleString('id-ID'));
  setText('stok-sum-habis', inventoryItems.filter(i => stokKondisi(i) === 'HABIS').length.toLocaleString('id-ID'));
  setText('stok-sum-menipis', inventoryItems.filter(i => stokKondisi(i) === 'MENIPIS').length.toLocaleString('id-ID'));

  const items = getFilteredStokItems();
  setText('stok-sum-nilai', formatRupiah(items.reduce((s, i) => s + (Number(i.stok_qty) || 0) * (Number(i.harga_satuan) || 0), 0)));
  setText('stok-table-count', `${items.length.toLocaleString('id-ID')} dari ${inventoryItems.length.toLocaleString('id-ID')} material`);

  if (inventoryItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Material.</td></tr>`;
    return;
  }
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">Tidak ada material yang cocok dengan filter.</td></tr>`;
    return;
  }
  tbody.innerHTML = pageRows('stok', sortRows('stok', items)).map(i => {
    const low = Number(i.stok_qty) <= Number(i.stok_min);
    return `
    <tr class="hover:bg-slate-50 transition group ${low ? 'bg-rose-50/60' : ''}">
      <td class="py-2.5 px-4 text-center sticky left-0 z-10 ${low ? 'bg-rose-50' : 'bg-white'} group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="openInventoryItemModal('edit', ${i.id})" class="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteInventoryItem(${i.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-4 font-mono font-bold text-emerald-900">${esc(i.sku)}</td>
      <td class="py-2.5 px-4 font-semibold">${esc(i.nama)}</td>
      <td class="py-2.5 px-4">${esc(i.kategori || '-')}</td>
      <td class="py-2.5 px-4 text-center font-mono font-bold ${low ? 'text-rose-600' : ''}">
        ${formatQty(i.stok_qty)} ${esc(i.satuan)}
        ${low ? '<span title="Stok di bawah/sama dengan minimum" class="ml-1 text-rose-500"><i class="fa-solid fa-triangle-exclamation"></i></span>' : ''}
      </td>
      <td class="py-2.5 px-4 text-right font-mono">${formatRupiah(i.harga_satuan)}</td>
      <td class="py-2.5 px-4 text-right font-extrabold">${formatRupiah(i.stok_qty * i.harga_satuan)}</td>
      <td class="py-2.5 px-4 text-center">
        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${i.status === 'AKTIF' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}">${esc(i.status)}</span>
      </td>
    </tr>`;
  }).join('');
}

function nextSkuSuggestion() {
  return 'MAT-' + String(inventoryItems.length + 1).padStart(4, '0');
}

/**
 * Kolom stok di form Material:
 *  - Tambah : "Stok Awal" (opening balance), bisa diisi semua yang boleh menambah material.
 *  - Edit   : "Stok Saat Ini" - admin boleh mengoreksi (dicatat otomatis di Riwayat Pergerakan
 *             sebagai ADJUSTMENT / OPNAME), user lain hanya melihat.
 */
function setInventoryStockField(mode, item = null) {
  const input = document.getElementById('inv-stok-awal');
  const label = document.getElementById('inv-stok-label');
  const lock = document.getElementById('inv-stok-lock');
  const hint = document.getElementById('inv-stok-hint');
  document.getElementById('inv-stok-awal-wrapper').classList.remove('hidden');
  input.classList.remove('bg-slate-100', 'text-slate-500', 'cursor-not-allowed', 'bg-amber-50', 'border-amber-300');
  input.dataset.original = '';

  if (mode === 'add') {
    label.textContent = 'Stok Awal (opening balance, hanya saat tambah baru)';
    input.readOnly = false;
    input.value = 0;
    lock.classList.add('hidden');
    hint.classList.add('hidden');
    return;
  }

  const satuan = item.satuan || '';
  label.textContent = `Stok Saat Ini (${satuan})`;
  input.value = Number(item.stok_qty) || 0;
  input.dataset.original = String(Number(item.stok_qty) || 0);
  if (IS_ADMIN) {
    input.readOnly = false;
    input.classList.add('bg-amber-50', 'border-amber-300');
    lock.classList.add('hidden');
    hint.className = 'text-[10px] mt-1 text-amber-700';
    hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> Mengubah angka ini = koreksi stok (stock opname). Selisihnya dicatat otomatis di <b>Riwayat Pergerakan</b> sebagai ADJUSTMENT.';
  } else {
    input.readOnly = true;
    input.classList.add('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');
    lock.classList.remove('hidden');
    hint.className = 'text-[10px] mt-1 text-slate-400';
    hint.textContent = 'Untuk barang masuk/keluar gunakan menu Riwayat Pergerakan. Koreksi stok langsung hanya bisa dilakukan admin.';
  }
  hint.classList.remove('hidden');
}

function openInventoryItemModal(mode, id = null) {
  document.getElementById('inventory-form').reset();
  document.getElementById('inv-form-id').value = '';
  const title = document.getElementById('inventory-modal-title');
  const stokAwalWrapper = document.getElementById('inv-stok-awal-wrapper');

  if (mode === 'add') {
    title.textContent = 'Tambah Material Baru';
    document.getElementById('inv-sku').value = nextSkuSuggestion();
    document.getElementById('inv-satuan').value = 'Pcs';
    setInventoryStockField('add');
  } else {
    const i = inventoryItems.find(x => x.id === id);
    if (!i) return;
    title.textContent = 'Edit Material';
    document.getElementById('inv-form-id').value = i.id;
    document.getElementById('inv-sku').value = i.sku;
    document.getElementById('inv-barcode').value = i.barcode || '';
    document.getElementById('inv-nama').value = i.nama;
    document.getElementById('inv-kategori').value = i.kategori || '';
    document.getElementById('inv-satuan').value = i.satuan;
    document.getElementById('inv-harga').value = i.harga_satuan;
    document.getElementById('inv-stok-min').value = i.stok_min;
    document.getElementById('inv-lokasi').value = i.lokasi_rak || '';
    document.getElementById('inv-status').value = i.status;
    setInventoryStockField('edit', i);
  }
  document.getElementById('inventory-modal').classList.remove('hidden');
}

function closeInventoryItemModal() {
  document.getElementById('inventory-modal').classList.add('hidden');
}

async function handleInventoryItemSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('inv-form-id').value;
  const payload = {
    sku: document.getElementById('inv-sku').value,
    barcode: document.getElementById('inv-barcode').value,
    nama: document.getElementById('inv-nama').value,
    kategori: document.getElementById('inv-kategori').value,
    satuan: document.getElementById('inv-satuan').value,
    harga_satuan: document.getElementById('inv-harga').value,
    stok_min: document.getElementById('inv-stok-min').value,
    lokasi_rak: document.getElementById('inv-lokasi').value,
    status: document.getElementById('inv-status').value,
  };
  try {
    if (id) {
      payload.id = id;
      const stokInput = document.getElementById('inv-stok-awal');
      const stokChanged = IS_ADMIN && stokInput.value !== '' && Number(stokInput.value) !== Number(stokInput.dataset.original);
      if (stokChanged) {
        const ok = await showConfirm(`Stok akan dikoreksi dari ${formatQty(stokInput.dataset.original)} menjadi ${formatQty(stokInput.value)}. Selisihnya dicatat di Riwayat Pergerakan sebagai koreksi stok (ADJUSTMENT). Lanjutkan?`,
          { title: 'Koreksi Stok', danger: false, yesText: 'Ya, Koreksi' });
        if (!ok) return;
        payload.stok_qty = stokInput.value;
      }
      await api('api/inventory_items.php', 'PUT', payload);
      showToast(stokChanged ? 'Material diperbarui. Koreksi stok dicatat di Riwayat Pergerakan.' : 'Data Material berhasil diperbarui.');
      if (stokChanged) await refresh('inventoryMovements');
    } else {
      payload.stok_qty = document.getElementById('inv-stok-awal').value;
      await api('api/inventory_items.php', 'POST', payload);
      showToast('Material baru berhasil ditambahkan.');
    }
    closeInventoryItemModal();
    await refresh('inventoryItems');
    renderStokTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteInventoryItem(id) {
  if (!(await showConfirm('Hapus material ini dari Gudang?'))) return;
  try {
    await api(`api/inventory_items.php?id=${id}`, 'DELETE');
    showToast('Material berhasil dihapus.');
    await refresh('inventoryItems');
    renderStokTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== GUDANG: INCOMING & RECEIVING GOODS =====================

function updateIncomingBadge() {
  const badge = document.getElementById('incoming-badge');
  if (!badge) return;
  const count = prItems.filter(p => p.status === 'STORE ROOM').length;
  if (count > 0) { badge.textContent = count; badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }
}

function renderIncomingTable() {
  const tbody = document.getElementById('incoming-table-tbody');
  const incoming = tfApply('incoming');
  updateIncomingBadge();

  if (incoming.length === 0 && TABLE_FILTERS.incoming.data().length > 0) {
    tbody.innerHTML = tfNoMatchRow(8);
    return;
  }
  if (incoming.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">Tidak ada barang yang menunggu diterima. Barang PR berstatus STORE ROOM akan muncul di sini.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows('incoming', incoming).map(p => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-4 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <button onclick="openReceiveGoodsModal(${p.id})" class="bg-lime-600 hover:bg-lime-700 text-white text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 whitespace-nowrap"><i class="fa-solid fa-check"></i> Terima Barang</button>
      </td>
      <td class="py-2.5 px-4 font-extrabold text-orange-900">${esc(p.pr_number)}</td>
      <td class="py-2.5 px-4 font-semibold">${esc(p.product)}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatQty(p.qty)} ${esc(p.uom || '')}</td>
      <td class="py-2.5 px-4">${esc(p.supplier_nama || '-')}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatDateID(p.tgl_datang)}</td>
      <td class="py-2.5 px-4 text-[11px] text-slate-500">${esc(p.wo_number || '-')}${p.project ? ' - ' + esc(p.project) : ''}</td>
      <td class="py-2.5 px-4 text-[11px] text-slate-400">${esc(p.penerima_barang || '-')}</td>
    </tr>
  `).join('');
}

function renderReceivingTable() {
  const tbody = document.getElementById('receiving-table-tbody');
  const received = tfApply('receiving');

  if (received.length === 0 && TABLE_FILTERS.receiving.data().length > 0) {
    tbody.innerHTML = tfNoMatchRow(7);
    return;
  }
  if (received.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-semibold">Belum ada riwayat barang diterima.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows('receiving', received).map(p => `
    <tr class="hover:bg-slate-50 transition">
      <td class="py-2.5 px-4 font-extrabold text-lime-900">${esc(p.pr_number)}</td>
      <td class="py-2.5 px-4 font-semibold">${esc(p.product)}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatQty(p.qty)} ${esc(p.uom || '')}</td>
      <td class="py-2.5 px-4">${esc(p.supplier_nama || '-')}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatDateID(p.tgl_datang)}</td>
      <td class="py-2.5 px-4 text-[11px] text-slate-500">${esc(p.wo_number || '-')}${p.project ? ' - ' + esc(p.project) : ''}</td>
      <td class="py-2.5 px-4 font-semibold text-slate-700">${esc(p.penerima_barang || '-')}</td>
    </tr>
  `).join('');
}

function openReceiveGoodsModal(prId) {
  const p = prItems.find(x => x.id === prId);
  if (!p) return;
  document.getElementById('receive-goods-form').reset();
  document.getElementById('rg-form-id').value = p.id;
  document.getElementById('rg-penerima').value = p.penerima_barang || '';
  document.getElementById('rg-info-box').innerHTML = `
    <div class="flex justify-between"><span class="text-slate-500">No. PR</span><span class="font-bold">${esc(p.pr_number)}</span></div>
    <div class="flex justify-between"><span class="text-slate-500">Nama Barang</span><span class="font-bold">${esc(p.product)}</span></div>
    <div class="flex justify-between"><span class="text-slate-500">Qty</span><span class="font-bold">${formatQty(p.qty)} ${esc(p.uom || '')}</span></div>
    <div class="flex justify-between"><span class="text-slate-500">Supplier</span><span class="font-bold">${esc(p.supplier_nama || '-')}</span></div>
  `;
  document.getElementById('receive-goods-modal').classList.remove('hidden');
}
function closeReceiveGoodsModal() { document.getElementById('receive-goods-modal').classList.add('hidden'); }

async function handleReceiveGoodsSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('rg-form-id').value;
  const payload = { id, penerima_barang: document.getElementById('rg-penerima').value };
  try {
    await api('api/pr_items.php?action=receive', 'POST', payload);
    showToast('Barang berhasil diterima & Stok Gudang diperbarui.');
    closeReceiveGoodsModal();
    await refresh('prItems', 'inventoryItems', 'inventoryMovements');
    renderIncomingTable();
    if (!document.getElementById('tab-content-stok').classList.contains('hidden')) renderStokTable();
  } catch (err) { showApiError(err); }
}

// ===================== GUDANG: RIWAYAT PERGERAKAN MODULE =====================

const MOVEMENT_BADGE = {
  IN: 'bg-emerald-100 text-emerald-700',
  OUT: 'bg-rose-100 text-rose-700',
  ADJUSTMENT: 'bg-amber-100 text-amber-700',
};

function renderRiwayatTable() {
  const tbody = document.getElementById('riwayat-table-tbody');
  const rows = tfApply('riwayat');
  if (inventoryMovements.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 font-semibold">Belum ada Riwayat Pergerakan Stok.</td></tr>`;
    return;
  }
  if (rows.length === 0) {
    tbody.innerHTML = tfNoMatchRow(9);
    return;
  }
  tbody.innerHTML = pageRows('riwayat', rows).map(m => {
    const ref = m.wo_number ? `WO: ${esc(m.wo_number)}` : (m.ref_production_id ? `Produksi #${m.ref_production_id}` : (m.ref_pr_id ? `PR #${m.ref_pr_id}` : '-'));
    return `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-4 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <button onclick="deleteMovement(${m.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition" title="Batalkan pergerakan ini & kembalikan saldo stok"><i class="fa-solid fa-rotate-left"></i></button>
      </td>
      <td class="py-2.5 px-4 font-mono">${formatDateID(m.tanggal)}</td>
      <td class="py-2.5 px-4 font-semibold">${esc(m.sku)} - ${esc(m.item_nama)}</td>
      <td class="py-2.5 px-4 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${MOVEMENT_BADGE[m.tipe] || 'bg-slate-100 text-slate-600'}">${esc(m.tipe)}</span></td>
      <td class="py-2.5 px-4 text-center font-mono font-bold">${formatQty(m.qty)} ${esc(m.satuan)}</td>
      <td class="py-2.5 px-4">${esc(m.sumber)}</td>
      <td class="py-2.5 px-4 text-[11px] text-slate-500">${ref}</td>
      <td class="py-2.5 px-4 text-[11px]">${esc(m.keterangan || '-')}</td>
      <td class="py-2.5 px-4 text-[11px] text-slate-500">${esc(m.user_nama || '-')}</td>
    </tr>`;
  }).join('');
}

function handleMovementItemChange() {
  const itemId = document.getElementById('mv-item-select').value;
  const i = inventoryItems.find(x => String(x.id) === String(itemId));
  document.getElementById('mv-stok-info').textContent = i ? `Stok saat ini: ${formatQty(i.stok_qty)} ${i.satuan}` : 'Stok saat ini: -';
}

function openMovementModal() {
  document.getElementById('movement-form').reset();
  document.getElementById('mv-tanggal').value = new Date().toISOString().slice(0, 10);
  document.getElementById('mv-stok-info').textContent = 'Stok saat ini: -';
  updateDropdownOptions();
  document.getElementById('movement-modal').classList.remove('hidden');
}

function closeMovementModal() {
  document.getElementById('movement-modal').classList.add('hidden');
}

async function handleMovementSubmit(e) {
  e.preventDefault();
  const payload = {
    item_id: document.getElementById('mv-item-select').value,
    tipe: document.getElementById('mv-tipe').value,
    tanggal: document.getElementById('mv-tanggal').value,
    qty: document.getElementById('mv-qty').value,
    sumber: document.getElementById('mv-sumber').value,
    wo_id: document.getElementById('mv-wo-select').value,
    keterangan: document.getElementById('mv-keterangan').value,
  };
  try {
    await api('api/inventory_movements.php', 'POST', payload);
    showToast('Pergerakan stok berhasil dicatat.');
    closeMovementModal();
    await refresh('inventoryItems', 'inventoryMovements');
    renderRiwayatTable();
    if (!document.getElementById('tab-content-stok').classList.contains('hidden')) renderStokTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteMovement(id) {
  if (!(await showConfirm('Batalkan pergerakan stok ini? Saldo stok akan dikembalikan ke kondisi sebelumnya.'))) return;
  try {
    await api(`api/inventory_movements.php?id=${id}`, 'DELETE');
    showToast('Pergerakan stok berhasil dibatalkan.');
    await refresh('inventoryItems', 'inventoryMovements', 'productionOrders');
    renderRiwayatTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== GUDANG: PRODUKSI & BOM MODULE =====================

function renderProduksiTable() {
  const tbody = document.getElementById('produksi-table-tbody');
  const rows = tfApply('produksi');
  if (productionOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Produksi.</td></tr>`;
    return;
  }
  const STATUS_BADGE = {
    DRAFT: 'bg-slate-100 text-slate-600', 'ON PROGRESS': 'bg-blue-100 text-blue-700',
    HOLD: 'bg-amber-100 text-amber-700', SELESAI: 'bg-emerald-100 text-emerald-700', CANCEL: 'bg-rose-100 text-rose-700',
  };
  if (rows.length === 0) {
    tbody.innerHTML = tfNoMatchRow(8);
    return;
  }
  tbody.innerHTML = pageRows('produksi', rows).map(p => {
    const totalButuh = (p.bom_items || []).reduce((s, b) => s + Number(b.qty_dibutuhkan), 0);
    const totalPakai = (p.bom_items || []).reduce((s, b) => s + Number(b.qty_terpakai), 0);
    const pct = totalButuh > 0 ? Math.min(100, Math.round((totalPakai / totalButuh) * 100)) : 0;
    return `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-4 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="consumeProductionMaterial(${p.id})" title="Konsumsi sisa kebutuhan BOM dari Gudang" class="p-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
          <button onclick="openProductionModal('edit', ${p.id})" class="p-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteProductionOrder(${p.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-4 font-mono font-bold text-teal-900">${esc(p.po_number)}</td>
      <td class="py-2.5 px-4">${p.wo_number ? esc(p.wo_number) + ' - ' + esc(p.customer_nama || '') : '-'}</td>
      <td class="py-2.5 px-4 font-semibold">${esc(p.product)}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatQty(p.qty_target)}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatQty(p.qty_selesai)}</td>
      <td class="py-2.5 px-4 text-center">
        <div class="w-24 mx-auto bg-slate-200 rounded-full h-2"><div class="bg-teal-600 h-2 rounded-full" style="width:${pct}%"></div></div>
        <span class="text-[10px] text-slate-500">${pct}%</span>
      </td>
      <td class="py-2.5 px-4 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[p.status] || 'bg-slate-100 text-slate-600'}">${esc(p.status)}</span></td>
    </tr>`;
  }).join('');
}

// --- BOM item block (mode multi-item di form Produksi, sama seperti pola Seal CNC) ---

function buildBomItemBlockHTML() {
  return `
  <div class="bomi-block bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
    <div class="flex items-center justify-between">
      <span class="bomi-item-label text-xs font-extrabold text-teal-700">Material #1</span>
      <button type="button" onclick="removeBomItemBlock(this)" class="bomi-remove-btn text-rose-500 hover:text-rose-700 text-[11px] font-bold flex items-center gap-1"><i class="fa-solid fa-trash-can"></i> Hapus</button>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="sm:col-span-2"><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Material (dari Stok Gudang)</label><select class="bomi-item w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs"></select></div>
      <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Qty per Unit Produk *</label><input type="number" class="bomi-perunit w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs" min="0.0001" step="any" value="1" required oninput="calcBomItemBlockTotal(this)"></div>
    </div>
    <div><label class="block font-semibold text-slate-600 mb-1 text-[11px]">Total Dibutuhkan (Qty per Unit x Qty Target)</label><input type="text" class="bomi-total w-full p-2 bg-slate-900 text-teal-300 border border-slate-800 rounded-lg font-extrabold text-xs" readonly></div>
  </div>`;
}

function populateBomItemBlockDropdown(block) {
  const sel = block.querySelector('.bomi-item');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- Pilih Material --</option>' +
    inventoryItems.map(i => opt(i.id, `${i.sku} - ${i.nama} (Stok: ${formatQty(i.stok_qty)} ${i.satuan})`)).join('');
  if (cur) sel.value = cur;
}

function addBomItemBlock(data = null) {
  const container = document.getElementById('bom-items-container');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildBomItemBlockHTML();
  const block = wrapper.firstElementChild;
  container.appendChild(block);

  populateBomItemBlockDropdown(block);

  if (data) {
    block.querySelector('.bomi-item').value = data.item_id;
    block.querySelector('.bomi-perunit').value = qtyInputValue(data.qty_per_unit);
  }
  calcBomItemBlockTotal(block.querySelector('.bomi-perunit'));
  updateBomItemLabels();
  return block;
}

function removeBomItemBlock(btn) {
  btn.closest('.bomi-block').remove();
  updateBomItemLabels();
}

function updateBomItemLabels() {
  document.querySelectorAll('#bom-items-container .bomi-block').forEach((block, idx) => {
    block.querySelector('.bomi-item-label').textContent = `Material #${idx + 1}`;
  });
}

function calcBomItemBlockTotal(el) {
  const block = el.closest('.bomi-block');
  const perUnit = parseFloat(block.querySelector('.bomi-perunit').value) || 0;
  const qtyTarget = parseFloat(document.getElementById('prod-qty-target').value) || 0;
  block.querySelector('.bomi-total').value = (perUnit * qtyTarget).toLocaleString('id-ID', { maximumFractionDigits: 3 });
}

function recalcAllBomQty() {
  document.querySelectorAll('#bom-items-container .bomi-block').forEach(block => {
    calcBomItemBlockTotal(block.querySelector('.bomi-perunit'));
  });
}

function openProductionModal(mode, id = null) {
  document.getElementById('production-form').reset();
  document.getElementById('prod-form-id').value = '';
  document.getElementById('bom-items-container').innerHTML = '';
  updateDropdownOptions();

  const title = document.getElementById('production-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Produksi Baru';
    document.getElementById('prod-qty-target').value = 1;
    addBomItemBlock();
  } else {
    const p = productionOrders.find(x => x.id === id);
    if (!p) return;
    title.textContent = 'Edit Produksi';
    document.getElementById('prod-form-id').value = p.id;
    document.getElementById('prod-po-number').value = p.po_number;
    document.getElementById('prod-wo-select').value = p.wo_id || '';
    document.getElementById('prod-product').value = p.product;
    document.getElementById('prod-qty-target').value = qtyInputValue(p.qty_target);
    document.getElementById('prod-tgl-mulai').value = p.tgl_mulai || '';
    document.getElementById('prod-tgl-target').value = p.tgl_target || '';
    document.getElementById('prod-status').value = p.status;
    (p.bom_items || []).forEach(b => addBomItemBlock(b));
    if ((p.bom_items || []).length === 0) addBomItemBlock();
  }
  document.getElementById('production-modal').classList.remove('hidden');
}

function closeProductionModal() {
  document.getElementById('production-modal').classList.add('hidden');
}

async function handleProductionSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('prod-form-id').value;
  const bomItems = Array.from(document.querySelectorAll('#bom-items-container .bomi-block')).map(block => ({
    item_id: block.querySelector('.bomi-item').value,
    qty_per_unit: block.querySelector('.bomi-perunit').value,
  })).filter(b => b.item_id);

  const payload = {
    po_number: document.getElementById('prod-po-number').value,
    wo_id: document.getElementById('prod-wo-select').value,
    product: document.getElementById('prod-product').value,
    qty_target: document.getElementById('prod-qty-target').value,
    tgl_mulai: document.getElementById('prod-tgl-mulai').value,
    tgl_target: document.getElementById('prod-tgl-target').value,
    status: document.getElementById('prod-status').value,
    bom_items: bomItems,
  };

  try {
    if (id) {
      payload.id = id;
      payload.qty_selesai = productionOrders.find(x => x.id === Number(id))?.qty_selesai || 0;
      await api('api/production_orders.php', 'PUT', payload);
      showToast('Data Produksi berhasil diperbarui.');
    } else {
      await api('api/production_orders.php', 'POST', payload);
      showToast('Data Produksi berhasil ditambahkan.');
    }
    closeProductionModal();
    await refresh('productionOrders');
    renderProduksiTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteProductionOrder(id) {
  if (!(await showConfirm('Hapus data Produksi ini? Riwayat pergerakan stok yang sudah tercatat TIDAK akan terhapus.'))) return;
  try {
    await api(`api/production_orders.php?id=${id}`, 'DELETE');
    showToast('Data Produksi berhasil dihapus.');
    await refresh('productionOrders');
    renderProduksiTable();
  } catch (err) {
    showApiError(err);
  }
}

async function consumeProductionMaterial(id) {
  if (!(await showConfirm('Catat konsumsi sisa kebutuhan material (BOM) untuk Produksi ini dari Stok Gudang?'))) return;
  try {
    const res = await api('api/production_orders.php?action=consume', 'POST', { id });
    showToast(res && res.consumed && res.consumed.length ? `${res.consumed.length} material berhasil dikonsumsi.` : 'Tidak ada material yang perlu dikonsumsi lagi.');
    await refresh('productionOrders', 'inventoryItems', 'inventoryMovements');
    renderProduksiTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== MTC PRODUKSI: MASTER DATA =====================

function renderMTCMasterLists() {
  document.getElementById('mtc-mesin-count').textContent = mtcMesinList.length;
  const mesinList = document.getElementById('mtc-mesin-list');
  mesinList.innerHTML = mtcMesinList.length ? mtcMesinList.map(m => `
    <li class="flex items-center justify-between py-2">
      <div>
        <span class="font-mono font-extrabold text-indigo-700">${esc(m.kode)}</span> <span class="font-semibold text-slate-700">${esc(m.nama)}</span>
        <div class="text-[10px] text-slate-400">${formatRupiah(m.harga)} / pemakaian &middot; ${esc(m.status)}</div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="openMTCMesinModal('edit',${m.id})" class="text-indigo-600 hover:text-indigo-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
        <button onclick="deleteMTCMesin(${m.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </li>`).join('') : '<li class="py-4 text-center text-slate-300">Belum ada data</li>';

  document.getElementById('mtc-mp-count').textContent = mtcMpList.length;
  const mpList = document.getElementById('mtc-mp-list');
  mpList.innerHTML = mtcMpList.length ? mtcMpList.map(m => `
    <li class="flex items-center justify-between py-2">
      <div>
        <span class="font-mono font-extrabold text-teal-700">${esc(m.kode)}</span> <span class="font-semibold text-slate-700">${esc(m.divisi)}</span>
        <div class="text-[10px] text-slate-400">${formatRupiah(m.harga)} / jam &middot; ${esc(m.status)}</div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="openMTCMpModal('edit',${m.id})" class="text-teal-600 hover:text-teal-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
        <button onclick="deleteMTCMp(${m.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </li>`).join('') : '<li class="py-4 text-center text-slate-300">Belum ada data</li>';
}

function openMTCMesinModal(mode, id = null) {
  document.getElementById('mtc-mesin-form').reset();
  document.getElementById('mtcm-form-id').value = '';
  const title = document.getElementById('mtc-mesin-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Master Mesin';
  } else {
    const m = mtcMesinList.find(x => x.id === id);
    if (!m) return;
    title.textContent = `Edit Mesin - ${m.nama}`;
    document.getElementById('mtcm-form-id').value = m.id;
    document.getElementById('mtcm-kode').value = m.kode;
    document.getElementById('mtcm-nama').value = m.nama;
    document.getElementById('mtcm-harga').value = m.harga;
    document.getElementById('mtcm-status').value = m.status;
  }
  document.getElementById('mtc-mesin-modal').classList.remove('hidden');
}
function closeMTCMesinModal() { document.getElementById('mtc-mesin-modal').classList.add('hidden'); }

async function handleMTCMesinSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('mtcm-form-id').value;
  const payload = {
    kode: document.getElementById('mtcm-kode').value, nama: document.getElementById('mtcm-nama').value,
    harga: document.getElementById('mtcm-harga').value, status: document.getElementById('mtcm-status').value,
  };
  try {
    if (id) { payload.id = id; await api('api/mtc.php?resource=mesin', 'PUT', payload); showToast('Master Mesin berhasil diperbarui.'); }
    else { await api('api/mtc.php?resource=mesin', 'POST', payload); showToast('Master Mesin berhasil ditambahkan.'); }
    closeMTCMesinModal();
    await refresh('mtcMesinList');
    renderMTCMasterLists();
  } catch (err) { showApiError(err); }
}

async function deleteMTCMesin(id) {
  if (!(await showConfirm('Hapus mesin ini dari Master Data?'))) return;
  try {
    await api(`api/mtc.php?resource=mesin&id=${id}`, 'DELETE');
    showToast('Master Mesin berhasil dihapus.');
    await refresh('mtcMesinList');
    renderMTCMasterLists();
  } catch (err) { showApiError(err); }
}

function openMTCMpModal(mode, id = null) {
  document.getElementById('mtc-mp-form').reset();
  document.getElementById('mtcmp-form-id').value = '';
  const divSel = document.getElementById('mtcmp-divisi');
  divSel.innerHTML = mtcDivisiList.map(d => opt(d, d)).join('');
  const title = document.getElementById('mtc-mp-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Tarif Divisi';
  } else {
    const m = mtcMpList.find(x => x.id === id);
    if (!m) return;
    title.textContent = `Edit Tarif - ${m.divisi}`;
    document.getElementById('mtcmp-form-id').value = m.id;
    document.getElementById('mtcmp-kode').value = m.kode;
    divSel.value = m.divisi;
    document.getElementById('mtcmp-harga').value = m.harga;
    document.getElementById('mtcmp-status').value = m.status;
  }
  document.getElementById('mtc-mp-modal').classList.remove('hidden');
}
function closeMTCMpModal() { document.getElementById('mtc-mp-modal').classList.add('hidden'); }

async function handleMTCMpSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('mtcmp-form-id').value;
  const payload = {
    kode: document.getElementById('mtcmp-kode').value, divisi: document.getElementById('mtcmp-divisi').value,
    harga: document.getElementById('mtcmp-harga').value, status: document.getElementById('mtcmp-status').value,
  };
  try {
    if (id) { payload.id = id; await api('api/mtc.php?resource=mp', 'PUT', payload); showToast('Tarif Divisi berhasil diperbarui.'); }
    else { await api('api/mtc.php?resource=mp', 'POST', payload); showToast('Tarif Divisi berhasil ditambahkan.'); }
    closeMTCMpModal();
    await refresh('mtcMpList');
    renderMTCMasterLists();
  } catch (err) { showApiError(err); }
}

async function deleteMTCMp(id) {
  if (!(await showConfirm('Hapus tarif divisi ini?'))) return;
  try {
    await api(`api/mtc.php?resource=mp&id=${id}`, 'DELETE');
    showToast('Tarif Divisi berhasil dihapus.');
    await refresh('mtcMpList');
    renderMTCMasterLists();
  } catch (err) { showApiError(err); }
}

// ===================== MTC PRODUKSI: DASHBOARD =====================

function buildMTCDashTableHeader() {
  const row = document.getElementById('mtc-dash-thead-row');
  let html = `<th class="py-3 px-3 border-r border-slate-700 min-w-[180px] sticky left-0 bg-slate-800 z-20">WO & Project</th>`;
  html += `<th class="py-3 px-3 border-r border-slate-700 min-w-[160px]">Customer & No PO</th>`;
  if (CAN_NILAI) html += `<th class="py-3 px-3 border-r border-slate-700 text-right min-w-[130px]">Total PO</th>`;
  html += `<th class="py-3 px-3 border-r border-slate-700 text-center min-w-[110px]">Status WO</th>`;
  mtcDivisiList.forEach(d => { html += `<th class="py-3 px-3 border-r border-slate-700 text-right min-w-[110px]">${esc(d)}</th>`; });
  html += `<th class="py-3 px-3 border-r border-slate-700 text-center min-w-[130px]">Surat Jalan</th>`;
  html += `<th class="py-3 px-3 border-r border-slate-700 text-right min-w-[130px] bg-slate-900 text-amber-400">Total Biaya</th>`;
  html += `<th class="py-3 px-3 text-center min-w-[100px] bg-slate-900">Aksi</th>`;
  row.innerHTML = html;
}

/** Jumlah kolom tabel Dashboard MTC (kolom Total PO hanya untuk yang punya izin Nilai PO). */
function mtcDashColCount() { return mtcDivisiList.length + (CAN_NILAI ? 7 : 6); }

async function renderMTCDashboard() {
  buildMTCDashTableHeader();
  const tbody = document.getElementById('mtc-dash-matrix-tbody');
  tbody.innerHTML = `<tr><td colspan="${mtcDashColCount()}" class="text-center py-8 text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
  try {
    mtcDashboardData = await api('api/mtc.php?resource=dashboard');
  } catch (err) {
    showApiError(err);
    return;
  }

  const search = (document.getElementById('mtc-dash-search')?.value || '').toLowerCase();
  const filtered = mtcDashboardData.filter(w =>
    !search || w.wo_number.toLowerCase().includes(search) || (w.project || '').toLowerCase().includes(search) || (w.customer_nama || '').toLowerCase().includes(search)
  );

  // Total kartu dihitung dari SEMUA WO yang cocok filter (bukan hanya halaman yang tampil).
  let grandTotalPO = 0, grandTotalCost = 0;
  filtered.forEach(w => { grandTotalPO += Number(w.nilai_po) || 0; grandTotalCost += Number(w.total_biaya) || 0; });
  const STATUS_BADGE = {
    'ON PROGRESS': 'bg-blue-100 text-blue-700', HOLD: 'bg-amber-100 text-amber-700', CANCEL: 'bg-rose-100 text-rose-700',
    DELIVERY: 'bg-purple-100 text-purple-700', FINISHED: 'bg-emerald-100 text-emerald-700',
  };
  const WORKFLOW_BADGE_SM = { NORMAL: 'bg-blue-100 text-blue-700', REWORK: 'bg-amber-100 text-amber-800', CLAIM: 'bg-orange-100 text-orange-800', REJECT: 'bg-rose-100 text-rose-800' };

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${mtcDashColCount()}" class="text-center py-10 text-slate-400 text-sm">Belum ada WO dengan "Item Pekerjaan" tercatat. Tambahkan Item Pekerjaan lewat Edit WO (Tracking WO & Budget) dulu, baru catat biaya per divisi di "Modul Divisi Produksi".</td></tr>`;
  } else {
    tbody.innerHTML = pageRows('mtcdash', sortRows('mtcdash', filtered)).map(w => {
      const divSums = {}; mtcDivisiList.forEach(d => divSums[d] = 0);
      let lastSJ = '-';
      w.items.forEach(it => it.divisi_records.forEach(r => {
        if (r.surat_jalan) lastSJ = r.surat_jalan;
        if (divSums.hasOwnProperty(r.divisi)) divSums[r.divisi] += Number(r.total_biaya) || 0;
      }));
      // Biaya otomatis dari PR / Seal CNC / Transportasi (dihitung server, lihat mtc_auto_costs).
      (w.auto_records || []).forEach(a => {
        if (divSums.hasOwnProperty(a.divisi)) divSums[a.divisi] += Number(a.total_biaya) || 0;
      });

      let rowHtml = `
        <tr class="hover:bg-indigo-50/40 cursor-pointer transition-colors" onclick="toggleMTCDashDetail(${w.wo_id})">
          <td class="py-2.5 px-3 border-r border-slate-100 font-bold text-slate-800 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
            <span class="text-indigo-600"><i class="fa-solid fa-chevron-right text-[10px] mr-1 mtc-toggle-icon" id="mtc-toggle-${w.wo_id}"></i>${esc(w.wo_number)}</span>
            <div class="text-[11px] font-normal text-slate-500">${esc(w.project)}</div>
          </td>
          <td class="py-2.5 px-3 border-r border-slate-100"><div class="font-semibold text-slate-700">${esc(w.customer_nama || '-')}</div></td>
          ${CAN_NILAI ? `<td class="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-indigo-600">${formatRupiah(w.nilai_po)}</td>` : ''}
          <td class="py-2.5 px-3 border-r border-slate-100 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[w.status] || 'bg-slate-100 text-slate-600'}">${esc(w.status || '-')}</span></td>
      `;
      mtcDivisiList.forEach(d => {
        const val = divSums[d];
        rowHtml += `<td class="py-2.5 px-3 border-r border-slate-100 text-right ${val > 0 ? 'font-semibold text-slate-700' : 'text-slate-300'}">${val > 0 ? formatRupiah(val) : '-'}</td>`;
      });
      rowHtml += `
          <td class="py-2.5 px-3 border-r border-slate-100 text-center font-medium text-slate-600">${(w.surat_jalan || []).length
            ? `<div class="font-semibold text-slate-700">${esc(w.surat_jalan[0].no_sj)}${w.surat_jalan.length > 1 ? ` <span class="text-[10px] text-slate-400">(+${w.surat_jalan.length - 1})</span>` : ''}</div>${sjStatusBadge(w.surat_jalan[0].status)}`
            : esc(lastSJ)}</td>
          <td class="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-amber-600 bg-amber-50/50">${formatRupiah(w.total_biaya)}</td>
          <td class="py-2.5 px-3 text-center" onclick="event.stopPropagation()">
            <button onclick="jumpToEditWO(${w.wo_id})" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] px-2.5 py-1 rounded shadow"><i class="fa-solid fa-pen"></i> Edit WO</button>
          </td>
        </tr>`;

      let detailHtml = '';
      w.items.forEach(it => {
        it.divisi_records.forEach(r => {
          (r.items || []).forEach(line => {
            detailHtml += `
              <tr class="border-b border-slate-100 hover:bg-slate-100 transition-colors">
                <td class="py-2 px-3 font-bold text-indigo-700">${esc(it.nama_item)}</td>
                <td class="py-2 px-3 font-semibold text-slate-800">${esc(r.divisi)}</td>
                <td class="py-2 px-3 text-slate-800 font-medium">${esc(line.pekerjaan)} <span class="text-slate-400 font-normal">(${esc(line.deskripsi || '-')})</span></td>
                <td class="py-2 px-3 text-center font-medium">${formatQty(line.qty)} ${esc(line.satuan)}</td>
                <td class="py-2 px-3 font-mono text-slate-500">${esc(line.kode_mesin || '-')}</td>
                <td class="py-2 px-3 text-right">${formatRupiah(line.harga)}</td>
                <td class="py-2 px-3 text-right font-bold text-slate-800">${formatRupiah(line.total)}</td>
                <td class="py-2 px-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${WORKFLOW_BADGE_SM[r.status_workflow] || 'bg-slate-100 text-slate-600'}">${esc(r.status_workflow)}</span></td>
                <td class="py-2 px-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${line.status === 'FINISH' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}">${esc(line.status)}</span></td>
                <td class="py-2 px-3 text-center font-semibold text-slate-600">${esc(r.pic || '-')}</td>
                <td class="py-2 px-3 text-center" onclick="event.stopPropagation()">
                  <button onclick="jumpToMTCRecordEdit(${w.wo_id}, ${r.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded text-[10px] shadow"><i class="fa-solid fa-pen"></i></button>
                  <button onclick="deleteMTCRecordFromDash(${r.id})" class="bg-rose-500 hover:bg-rose-600 text-white px-2 py-0.5 rounded text-[10px] shadow"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>`;
          });
        });
      });
      const AUTO_TAB = { PR: 'dashboard', 'Seal CNC': 'seal', Transportasi: 'transport' };
      (w.auto_records || []).forEach(a => {
        a.lines.forEach(line => {
          const tab = AUTO_TAB[a.sumber];
          detailHtml += `
            <tr class="border-b border-slate-100 bg-emerald-50/40 hover:bg-emerald-50 transition-colors">
              <td class="py-2 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700" title="Otomatis dari menu ${esc(a.sumber)}"><i class="fa-solid fa-link mr-1"></i>Otomatis</span></td>
              <td class="py-2 px-3 font-semibold text-slate-800">${esc(a.divisi)}</td>
              <td class="py-2 px-3 text-slate-800 font-medium">${esc(line.pekerjaan || '-')} <span class="text-slate-400 font-normal">(${esc(line.deskripsi || '-')})</span></td>
              <td class="py-2 px-3 text-center font-medium">${formatQty(line.qty)} ${esc(line.satuan || '')}</td>
              <td class="py-2 px-3 font-mono text-slate-500">-</td>
              <td class="py-2 px-3 text-right">${formatRupiah(line.harga)}</td>
              <td class="py-2 px-3 text-right font-bold text-slate-800">${formatRupiah(line.total)}</td>
              <td class="py-2 px-3 text-center text-[10px] font-bold text-emerald-700">${esc(a.sumber)}</td>
              <td class="py-2 px-3 text-center">${line.status ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">${esc(line.status)}</span>` : '-'}</td>
              <td class="py-2 px-3 text-center font-semibold text-slate-600">${esc(line.pic || '-')}</td>
              <td class="py-2 px-3 text-center" onclick="event.stopPropagation()">
                ${tab && canView(tab) ? `<button onclick="switchTab('${tab}')" title="Buka menu ${esc(a.sumber)}" class="bg-slate-600 hover:bg-slate-700 text-white px-2 py-0.5 rounded text-[10px] shadow"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : ''}
              </td>
            </tr>`;
        });
      });
      if (!detailHtml) detailHtml = `<tr><td colspan="11" class="text-center py-3 text-slate-400">Belum ada rincian divisi yang diinput untuk WO ini.</td></tr>`;

      rowHtml += `
        <tr id="mtc-detail-${w.wo_id}" class="hidden bg-slate-50/90">
          <td colspan="${mtcDashColCount()}" class="p-4">
            <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-inner space-y-2">
              <div class="flex justify-between items-center border-b border-slate-100 pb-2">
                <h4 class="font-bold text-xs text-indigo-900 uppercase tracking-wider"><i class="fa-solid fa-list-ul mr-1"></i> Rincian Pekerjaan Divisi (${esc(w.wo_number)})</h4>
                <button onclick="jumpToModulDivisi(${w.wo_id})" class="text-xs text-indigo-600 hover:underline font-semibold"><i class="fa-solid fa-circle-plus mr-1"></i> + Input Record Divisi Baru</button>
              </div>
              <div class="overflow-x-auto custom-scrollbar">
                <table class="w-full text-xs text-left">
                  <thead class="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th class="py-2 px-3">Item Pekerjaan</th><th class="py-2 px-3">Divisi</th><th class="py-2 px-3">Pekerjaan & Deskripsi</th>
                      <th class="py-2 px-3 text-center">Qty & Satuan</th><th class="py-2 px-3">Kode Mesin</th><th class="py-2 px-3 text-right">Harga</th>
                      <th class="py-2 px-3 text-right">Total</th><th class="py-2 px-3 text-center">Workflow</th><th class="py-2 px-3 text-center">Status</th>
                      <th class="py-2 px-3 text-center">PIC</th><th class="py-2 px-3 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>${detailHtml}</tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>`;
      return rowHtml;
    }).join('');
  }

  document.getElementById('mtc-dash-total-wo').textContent = filtered.length;
  document.getElementById('mtc-dash-total-cost').textContent = formatRupiah(grandTotalCost);
  if (CAN_NILAI) {
    document.getElementById('mtc-dash-total-po').textContent = formatRupiah(grandTotalPO);
    document.getElementById('mtc-dash-total-margin').textContent = formatRupiah(grandTotalPO - grandTotalCost);
  }
}

function toggleMTCDashDetail(woId) {
  const detail = document.getElementById(`mtc-detail-${woId}`);
  const icon = document.getElementById(`mtc-toggle-${woId}`);
  detail.classList.toggle('hidden');
  icon.classList.toggle('rotate-90');
}

function jumpToEditWO(woId) {
  switchTab('tracking');
  setTimeout(() => openWOModal('edit', woId), 150);
}

function jumpToModulDivisi(woId) {
  switchTab('mtcdivisi');
  setTimeout(() => {
    document.getElementById('mtcdivisi-wo-select').value = woId;
    handleMTCDivisiWOChange();
  }, 150);
}

async function jumpToMTCRecordEdit(woId, recordId) {
  switchTab('mtcdivisi');
  document.getElementById('mtcdivisi-wo-select').value = woId;
  await handleMTCDivisiWOChange();
  openMTCRecordModal('edit', recordId);
}

async function deleteMTCRecordFromDash(id) {
  if (!(await showConfirm('Hapus catatan biaya divisi ini?'))) return;
  try {
    await api(`api/mtc.php?resource=records&id=${id}`, 'DELETE');
    showToast('Data Divisi Produksi berhasil dihapus.');
    renderMTCDashboard();
  } catch (err) { showApiError(err); }
}

// ===================== MTC PRODUKSI: MODUL DIVISI PRODUKSI =====================

function renderMTCDivisiTab() {
  const sel = document.getElementById('mtcdivisi-wo-select');
  const cur = sel.value;
  sel.innerHTML = '<option value="">-- Pilih WO --</option>' + workOrders.map(w => opt(w.id, `${w.wo_number} - ${w.project}`)).join('');
  if (cur) sel.value = cur;
  if (mtcCurrentWOId) {
    sel.value = mtcCurrentWOId;
    handleMTCDivisiWOChange();
  }
}

async function handleMTCDivisiWOChange() {
  mtcCurrentWOId = document.getElementById('mtcdivisi-wo-select').value;
  const addBtn = document.getElementById('mtc-add-record-btn');
  const emptyHint = document.getElementById('mtcdivisi-empty-hint');
  const listEl = document.getElementById('mtcdivisi-records-list');
  const exportBtn = document.getElementById('mtc-export-wo-btn');
  if (exportBtn) exportBtn.disabled = !mtcCurrentWOId;

  if (!mtcCurrentWOId) {
    addBtn.disabled = true;
    emptyHint.classList.remove('hidden');
    listEl.innerHTML = '';
    return;
  }

  const w = workOrders.find(x => String(x.id) === String(mtcCurrentWOId));
  mtcCurrentWOBudgetItems = (w && w.budget_items) || [];

  // Item Pekerjaan diisi langsung dari sini (ketik item baru di form Catat Biaya Divisi),
  // jadi WO tanpa Item Pekerjaan tetap bisa dicatat.
  addBtn.disabled = false;
  emptyHint.classList.add('hidden');
  listEl.innerHTML = '<div class="text-center py-6 text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin"></i> Memuat...</div>';

  try {
    mtcCurrentRecords = await api(`api/mtc.php?resource=records&wo_id=${mtcCurrentWOId}`);
  } catch (err) { showApiError(err); return; }

  renderMTCDivisiRecordsList();
}

function renderMTCDivisiRecordsList() {
  const listEl = document.getElementById('mtcdivisi-records-list');
  if (mtcCurrentRecords.length === 0) {
    listEl.innerHTML = '<div class="text-center py-6 text-slate-300 text-sm">Belum ada biaya divisi yang dicatat untuk WO ini.</div>';
    return;
  }
  const WORKFLOW_BADGE = { NORMAL: 'bg-blue-100 text-blue-700', REWORK: 'bg-amber-100 text-amber-800', CLAIM: 'bg-orange-100 text-orange-800', REJECT: 'bg-rose-100 text-rose-800' };

  // Group by nama_item supaya rapi per Item Pekerjaan
  const grouped = {};
  mtcCurrentRecords.forEach(r => { (grouped[r.nama_item] = grouped[r.nama_item] || []).push(r); });

  listEl.innerHTML = Object.entries(grouped).map(([itemName, records]) => `
    <div class="border border-slate-200 rounded-xl p-3">
      <div class="font-bold text-slate-700 text-xs mb-2 border-b border-slate-100 pb-2">${esc(itemName)}</div>
      <div class="space-y-2">
        ${records.map(r => `
          <div class="bg-slate-50 rounded-lg p-3 flex items-center justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-teal-800">${esc(r.divisi)}</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${WORKFLOW_BADGE[r.status_workflow] || 'bg-slate-100 text-slate-600'}">${esc(r.status_workflow)}</span>
              </div>
              <div class="text-[11px] text-slate-500 mt-0.5">PIC: ${esc(r.pic || '-')} &middot; SJ: ${esc(r.surat_jalan || '-')} &middot; ${r.items.length} baris pekerjaan</div>
            </div>
            <div class="flex items-center gap-3">
              <div class="text-right"><div class="text-[10px] text-slate-400">Total Biaya</div><div class="font-extrabold text-slate-800">${formatRupiah(r.total_biaya)}</div></div>
              <div class="flex gap-1">
                <button onclick="openMTCRecordModal('edit', ${r.id})" class="p-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
                <button onclick="deleteMTCRecord(${r.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition"><i class="fa-solid fa-trash-can"></i></button>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function handleMTCDivisiSelectChange() {
  const divisi = document.getElementById('mtcr-divisi-select').value;
  const mp = mtcMpList.find(x => x.divisi === divisi);
  // Set harga default utk baris BARU yang belum diisi manual (heuristik sederhana: isi kalau masih 0)
  document.querySelectorAll('#mtc-items-container .mtci-block').forEach(block => {
    const hargaInput = block.querySelector('.mtci-harga');
    if (mp && (!hargaInput.value || Number(hargaInput.value) === 0)) {
      hargaInput.value = mp.harga;
      calcMTCItemTotal(hargaInput);
    }
  });
}

function buildMTCItemBlockHTML() {
  const mesinOptions = '<option value="">-- Tanpa Mesin --</option>' + mtcMesinList.map(m => `<option value="${esc(m.kode)}" data-harga="${m.harga}">${esc(m.kode)} - ${esc(m.nama)} (${formatRupiah(m.harga)})</option>`).join('');
  return `
  <div class="mtci-block bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
    <div class="flex items-center justify-between">
      <input type="text" class="mtci-pekerjaan flex-1 p-2 bg-white border border-slate-300 rounded-lg font-bold text-xs mr-2" placeholder="Nama pekerjaan (mis. DRAWING, CEK DIMENSI)" required>
      <button type="button" onclick="removeMTCItemBlock(this)" class="text-rose-500 hover:text-rose-700 text-[11px] font-bold px-1"><i class="fa-solid fa-trash-can"></i></button>
    </div>
    <input type="text" class="mtci-deskripsi w-full p-2 bg-white border border-slate-300 rounded-lg text-xs" placeholder="Deskripsi singkat (opsional)">
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <div><label class="block text-[10px] text-slate-500 mb-0.5">Qty</label><input type="number" class="mtci-qty w-full p-1.5 bg-white border border-slate-300 rounded text-xs" min="0" step="any" value="1" oninput="calcMTCItemTotal(this)"></div>
      <div><label class="block text-[10px] text-slate-500 mb-0.5">Satuan</label><input type="text" class="mtci-satuan w-full p-1.5 bg-white border border-slate-300 rounded text-xs" value="Jam"></div>
      <div class="col-span-2"><label class="block text-[10px] text-slate-500 mb-0.5">Kode Mesin (opsional)</label><select class="mtci-mesin w-full p-1.5 bg-white border border-slate-300 rounded text-xs" onchange="handleMTCMesinPick(this)">${mesinOptions}</select></div>
      <div><label class="block text-[10px] text-slate-500 mb-0.5">Harga/Satuan (Rp)</label><input type="number" class="mtci-harga w-full p-1.5 bg-white border border-slate-300 rounded text-xs font-bold" min="0" value="0" oninput="calcMTCItemTotal(this)"></div>
    </div>
    <div class="flex items-center justify-between">
      <select class="mtci-status p-1.5 bg-white border border-slate-300 rounded text-[11px] font-bold"><option value="ON PROCESS">ON PROCESS</option><option value="FINISH">FINISH</option></select>
      <div class="text-xs font-extrabold text-teal-700">Subtotal: <span class="mtci-subtotal">Rp 0</span></div>
    </div>
  </div>`;
}

function handleMTCMesinPick(selectEl) {
  const selectedOpt = selectEl.selectedOptions[0];
  const harga = selectedOpt ? selectedOpt.getAttribute('data-harga') : null;
  if (harga) {
    const block = selectEl.closest('.mtci-block');
    block.querySelector('.mtci-harga').value = harga;
    calcMTCItemTotal(block.querySelector('.mtci-harga'));
  }
}

function addMTCItemBlock(data = null) {
  const container = document.getElementById('mtc-items-container');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildMTCItemBlockHTML();
  const block = wrapper.firstElementChild;
  container.appendChild(block);
  if (data) {
    block.querySelector('.mtci-pekerjaan').value = data.pekerjaan || '';
    block.querySelector('.mtci-deskripsi').value = data.deskripsi || '';
    block.querySelector('.mtci-qty').value = qtyInputValue(data.qty, 1);
    block.querySelector('.mtci-satuan').value = data.satuan || 'Jam';
    if (data.kode_mesin) block.querySelector('.mtci-mesin').value = data.kode_mesin;
    block.querySelector('.mtci-harga').value = data.harga || 0;
    block.querySelector('.mtci-status').value = data.status || 'ON PROCESS';
  }
  calcMTCItemTotal(block.querySelector('.mtci-harga'));
  return block;
}

function removeMTCItemBlock(btn) {
  btn.closest('.mtci-block').remove();
  recalcMTCGrandTotal();
}

function calcMTCItemTotal(el) {
  const block = el.closest('.mtci-block');
  const qty = parseFloat(block.querySelector('.mtci-qty').value) || 0;
  const harga = parseFloat(block.querySelector('.mtci-harga').value) || 0;
  block.querySelector('.mtci-subtotal').textContent = formatRupiah(qty * harga);
  recalcMTCGrandTotal();
}

function recalcMTCGrandTotal() {
  let total = 0;
  document.querySelectorAll('#mtc-items-container .mtci-block').forEach(block => {
    const qty = parseFloat(block.querySelector('.mtci-qty').value) || 0;
    const harga = parseFloat(block.querySelector('.mtci-harga').value) || 0;
    total += qty * harga;
  });
  document.getElementById('mtcr-grand-total').textContent = formatRupiah(total);
}

function openMTCRecordModal(mode, id = null) {
  document.getElementById('mtc-record-form').reset();
  document.getElementById('mtcr-form-id').value = '';
  document.getElementById('mtc-items-container').innerHTML = '';

  const itemSel = document.getElementById('mtcr-item-select');
  // Saran item: Item Pekerjaan WO + item yang sudah pernah dicatat di MTC untuk WO ini.
  const itemNames = [...new Set([...mtcCurrentWOBudgetItems.map(bi => bi.nama_item), ...mtcCurrentRecords.map(r => r.nama_item)])];
  document.getElementById('mtcr-item-options').innerHTML = itemNames.map(n => `<option value="${esc(n)}"></option>`).join('');
  itemSel.value = itemNames.length === 1 ? itemNames[0] : '';
  const divSel = document.getElementById('mtcr-divisi-select');
  divSel.innerHTML = mtcDivisiList.map(d => opt(d, d)).join('');

  const title = document.getElementById('mtc-record-modal-title');
  if (mode === 'add') {
    title.textContent = 'Catat Biaya Divisi Produksi';
    addMTCItemBlock();
  } else {
    const r = mtcCurrentRecords.find(x => x.id === id);
    if (!r) return;
    title.textContent = `Edit Biaya Divisi - ${r.divisi}`;
    document.getElementById('mtcr-form-id').value = r.id;
    itemSel.value = r.nama_item;
    divSel.value = r.divisi;
    document.getElementById('mtcr-pic').value = r.pic || '';
    document.getElementById('mtcr-suratjalan').value = r.surat_jalan || '';
    document.getElementById('mtcr-status-workflow').value = r.status_workflow;
    (r.items || []).forEach(it => addMTCItemBlock(it));
    if ((r.items || []).length === 0) addMTCItemBlock();
  }
  recalcMTCGrandTotal();
  document.getElementById('mtc-record-modal').classList.remove('hidden');
}
function closeMTCRecordModal() { document.getElementById('mtc-record-modal').classList.add('hidden'); }

async function handleMTCRecordSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('mtcr-form-id').value;
  const items = Array.from(document.querySelectorAll('#mtc-items-container .mtci-block')).map(block => ({
    pekerjaan: block.querySelector('.mtci-pekerjaan').value,
    deskripsi: block.querySelector('.mtci-deskripsi').value,
    qty: block.querySelector('.mtci-qty').value,
    satuan: block.querySelector('.mtci-satuan').value,
    kode_mesin: block.querySelector('.mtci-mesin').value || null,
    harga: block.querySelector('.mtci-harga').value,
    status: block.querySelector('.mtci-status').value,
  })).filter(i => i.pekerjaan.trim() !== '');

  const payload = {
    wo_id: mtcCurrentWOId,
    nama_item: document.getElementById('mtcr-item-select').value.trim().toUpperCase(),
    divisi: document.getElementById('mtcr-divisi-select').value,
    pic: document.getElementById('mtcr-pic').value,
    surat_jalan: document.getElementById('mtcr-suratjalan').value,
    status_workflow: document.getElementById('mtcr-status-workflow').value,
    items,
  };

  try {
    if (id) { payload.id = id; await api('api/mtc.php?resource=records', 'PUT', payload); showToast('Data Divisi Produksi berhasil diperbarui.'); }
    else { await api('api/mtc.php?resource=records', 'POST', payload); showToast('Data Divisi Produksi berhasil disimpan.'); }
    closeMTCRecordModal();
    await refresh('workOrders'); // Item Pekerjaan & Aktual WO ikut berubah
    await handleMTCDivisiWOChange();
  } catch (err) { showApiError(err); }
}

async function deleteMTCRecord(id) {
  if (!(await showConfirm('Hapus catatan biaya divisi ini?'))) return;
  try {
    await api(`api/mtc.php?resource=records&id=${id}`, 'DELETE');
    showToast('Data Divisi Produksi berhasil dihapus.');
    await refresh('workOrders');
    await handleMTCDivisiWOChange();
  } catch (err) { showApiError(err); }
}

// ===================== TRANSPORTASI MODULE =====================

function renderTransportTable() {
  const tbody = document.getElementById('transport-table-tbody');
  const rows = tfApply('transport');
  if (transportItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Transportasi.</td></tr>`;
    syncBulkBar('transport');
    return;
  }
  if (rows.length === 0) {
    tbody.innerHTML = tfNoMatchRow(10);
    syncBulkBar('transport');
    return;
  }
  tbody.innerHTML = pageRows('transport', rows).map(t => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-4 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          ${bulkCheckbox('transport', t.id)}
          <button onclick="openTransportModal('edit', ${t.id})" class="p-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteTransportItem(${t.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-4 font-bold text-blue-900">${esc(t.wo_number || '-')}</td>
      <td class="py-2.5 px-4">${esc(t.project || '-')}</td>
      <td class="py-2.5 px-4">${esc(t.customer_nama || '-')}</td>
      <td class="py-2.5 px-4 font-semibold">${esc(t.deskripsi || '-')}</td>
      <td class="py-2.5 px-4">${esc(t.asal || '-')}</td>
      <td class="py-2.5 px-4">${esc(t.tujuan || '-')}</td>
      <td class="py-2.5 px-4 text-center font-mono">${formatQty(t.qty)}</td>
      <td class="py-2.5 px-4 text-right font-mono">${formatRupiah(t.harga)}</td>
      <td class="py-2.5 px-4 text-right font-extrabold">${formatRupiah(t.total)}</td>
    </tr>
  `).join('');
  syncBulkBar('transport');
}

function handleTransportWOChange() {
  const woId = document.getElementById('transport-wo-select').value;
  const w = workOrders.find(x => String(x.id) === String(woId));
  document.getElementById('transport-project-input').value = w ? w.project : '';
  document.getElementById('transport-customer-input').value = w ? (w.customer_nama || '') : '';
}

function calcTransportTotal() {
  const qty = parseFloat(document.getElementById('transport-qty').value) || 0;
  const harga = parseFloat(document.getElementById('transport-harga').value) || 0;
  document.getElementById('transport-total-display').value = formatRupiah(qty * harga);
}

function openTransportModal(mode, id = null) {
  document.getElementById('transport-form').reset();
  document.getElementById('trans-form-id').value = '';
  updateDropdownOptions();

  const title = document.getElementById('transport-modal-title');
  if (mode === 'add') {
    title.textContent = 'Form Logistik & Transportasi - Tambah Baru';
    calcTransportTotal();
  } else {
    const t = transportItems.find(x => x.id === id);
    if (!t) return;
    title.textContent = 'Edit Data Transportasi';
    document.getElementById('trans-form-id').value = t.id;
    document.getElementById('transport-wo-select').value = t.wo_id || '';
    document.getElementById('transport-project-input').value = t.project || '';
    document.getElementById('transport-customer-input').value = t.customer_nama || '';
    document.getElementById('transport-deskripsi').value = t.deskripsi || '';
    document.getElementById('transport-asal').value = t.asal || '';
    document.getElementById('transport-tujuan').value = t.tujuan || '';
    document.getElementById('transport-qty').value = qtyInputValue(t.qty);
    document.getElementById('transport-harga').value = t.harga;
    calcTransportTotal();
  }
  document.getElementById('transport-modal').classList.remove('hidden');
}

function closeTransportModal() {
  document.getElementById('transport-modal').classList.add('hidden');
}

async function handleTransportSubmit(e) {
  e.preventDefault();
  const woId = document.getElementById('transport-wo-select').value;
  const w = workOrders.find(x => String(x.id) === String(woId));
  const id = document.getElementById('trans-form-id').value;

  const payload = {
    id: id || undefined,
    wo_id: woId,
    project: w ? w.project : document.getElementById('transport-project-input').value,
    customer_id: w ? w.customer_id : null,
    deskripsi: document.getElementById('transport-deskripsi').value,
    asal: document.getElementById('transport-asal').value,
    tujuan: document.getElementById('transport-tujuan').value,
    qty: document.getElementById('transport-qty').value,
    harga: document.getElementById('transport-harga').value,
  };

  try {
    if (id) {
      await api('api/transport_items.php', 'PUT', payload);
      showToast('Data Transportasi berhasil diperbarui.');
    } else {
      await api('api/transport_items.php', 'POST', payload);
      showToast('Data Transportasi berhasil ditambahkan.');
    }
    closeTransportModal();
    await refresh('transportItems', 'workOrders');
    renderTransportTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteTransportItem(id) {
  if (!(await showConfirm('Hapus item Transportasi ini?'))) return;
  try {
    await api(`api/transport_items.php?id=${id}`, 'DELETE');
    showToast('Data Transportasi berhasil dihapus.');
    await refresh('transportItems', 'workOrders');
    renderTransportTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== CUSTOMER DIRECTORY MODULE =====================

function renderCustomerDirectory() {
  const container = document.getElementById('customer-cards-container');
  const search = (document.getElementById('filter-customer-directory-search')?.value || '').toLowerCase().trim();
  const status = document.getElementById('filter-customer-directory-status')?.value || 'ALL';

  const filtered = customers.filter(c => {
    if (status !== 'ALL' && c.status !== status) return false;
    if (search) {
      const haystack = `${c.nama} ${c.kota || ''} ${c.pic || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-8 text-slate-400 font-semibold">Tidak ada data Customer yang cocok.</div>`;
    return;
  }

  container.innerHTML = pageRows('customers', sortRows('customers', filtered)).map(c => {
    const relatedWO = workOrders.filter(w => w.customer_id === c.id);
    return `
    <div class="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden flex flex-col">
      <div class="p-4 bg-blue-600 text-white flex items-start justify-between">
        <div>
          <h4 class="font-extrabold text-sm">${esc(c.nama)}</h4>
          <p class="text-[10px] text-blue-100">${esc(c.kota || '-')}, ${esc(c.provinsi || '-')}</p>
        </div>
        <span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${c.status === 'AKTIF' ? 'bg-emerald-400/30 text-emerald-100' : 'bg-rose-400/30 text-rose-100'}">${esc(c.status)}</span>
      </div>
      <div class="p-4 space-y-2 text-xs flex-grow">
        <p class="text-slate-500"><i class="fa-solid fa-location-dot w-4 text-blue-500"></i> ${esc(c.alamat || '-')}</p>
        <p class="text-slate-500"><i class="fa-solid fa-user w-4 text-blue-500"></i> ${esc(c.pic || '-')} (${esc(c.cp || '-')})</p>
        <p class="text-slate-500"><i class="fa-solid fa-phone w-4 text-blue-500"></i> ${esc(c.telepon || '-')}</p>
        <p class="text-slate-500"><i class="fa-solid fa-id-card w-4 text-blue-500"></i> NPWP: ${esc(c.npwp || '-')}</p>
        <div class="pt-2 border-t border-slate-100">
          <p class="font-bold text-slate-600 mb-1">Work Order (${relatedWO.length})</p>
          ${relatedWO.length ? relatedWO.slice(0, 3).map(w => `<div class="text-[11px] text-slate-500">&bull; ${esc(w.wo_number)} - ${esc(w.project)}</div>`).join('') : '<div class="text-[11px] text-slate-300">Belum ada WO</div>'}
          ${relatedWO.length > 3 ? `<div class="text-[10px] text-slate-400">+${relatedWO.length - 3} WO lainnya</div>` : ''}
        </div>
      </div>
      <div class="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
        <button onclick="openAddCustomerModal('edit', ${c.id})" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
        <button onclick="deleteCustomer(${c.id})" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold"><i class="fa-solid fa-trash-can"></i> Hapus</button>
      </div>
    </div>`;
  }).join('');
}

function openAddCustomerModal(mode, id = null) {
  document.getElementById('customer-form').reset();
  document.getElementById('cust-form-id').value = '';
  document.getElementById('cust-negara').value = 'Indonesia';

  const title = document.getElementById('customer-modal-title');
  if (mode === 'add') {
    title.textContent = 'Form Data Customer - Tambah Baru';
  } else {
    const c = customers.find(x => x.id === id);
    if (!c) return;
    title.textContent = `Edit Customer - ${c.nama}`;
    document.getElementById('cust-form-id').value = c.id;
    document.getElementById('cust-nama').value = c.nama;
    document.getElementById('cust-alamat').value = c.alamat || '';
    document.getElementById('cust-kelurahan').value = c.kelurahan || '';
    document.getElementById('cust-kecamatan').value = c.kecamatan || '';
    document.getElementById('cust-kota').value = c.kota || '';
    document.getElementById('cust-provinsi').value = c.provinsi || '';
    document.getElementById('cust-kodepos').value = c.kodepos || '';
    document.getElementById('cust-negara').value = c.negara || 'Indonesia';
    document.getElementById('cust-pic').value = c.pic || '';
    document.getElementById('cust-cp').value = c.cp || '';
    document.getElementById('cust-telepon').value = c.telepon || '';
    document.getElementById('cust-npwp').value = c.npwp || '';
    document.getElementById('cust-status').value = c.status;
  }
  document.getElementById('customer-modal').classList.remove('hidden');
}

function closeAddCustomerModal() {
  document.getElementById('customer-modal').classList.add('hidden');
}

async function handleCustomerSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('cust-form-id').value;
  const payload = {
    id: id || undefined,
    nama: document.getElementById('cust-nama').value.trim().toUpperCase(),
    alamat: document.getElementById('cust-alamat').value,
    kelurahan: document.getElementById('cust-kelurahan').value,
    kecamatan: document.getElementById('cust-kecamatan').value,
    kota: document.getElementById('cust-kota').value,
    provinsi: document.getElementById('cust-provinsi').value,
    kodepos: document.getElementById('cust-kodepos').value,
    negara: document.getElementById('cust-negara').value,
    pic: document.getElementById('cust-pic').value,
    cp: document.getElementById('cust-cp').value,
    telepon: document.getElementById('cust-telepon').value,
    npwp: document.getElementById('cust-npwp').value,
    status: document.getElementById('cust-status').value,
  };

  try {
    if (id) {
      await api('api/customers.php', 'PUT', payload);
      showToast('Customer berhasil diperbarui.');
    } else {
      await api('api/customers.php', 'POST', payload);
      showToast('Customer berhasil ditambahkan.');
    }
    closeAddCustomerModal();
    await refresh('customers');
    renderCustomerDirectory();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteCustomer(id) {
  if (!(await showConfirm('Hapus customer ini? Customer yang masih punya WO tidak bisa dihapus.'))) return;
  try {
    await api(`api/customers.php?id=${id}`, 'DELETE');
    showToast('Customer berhasil dihapus.');
    await refresh('customers');
    renderCustomerDirectory();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== SUPPLIER DIRECTORY MODULE =====================

function renderSupplierDirectory() {
  const tbody = document.getElementById('supplier-detail-tbody');
  const search = (document.getElementById('filter-supplier-directory-search')?.value || '').toLowerCase().trim();
  const status = document.getElementById('filter-supplier-directory-status')?.value || 'ALL';

  const filtered = suppliers.filter(s => {
    if (status !== 'ALL' && s.status !== status) return false;
    if (search) {
      const haystack = `${s.nama} ${s.kota || ''} ${s.npwp || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-semibold">Tidak ada data Supplier yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows('suppliers', sortRows('suppliers', filtered)).map(s => {
    // Rekap DPP/PPN/Total dihitung dari data PR yang sudah dimuat (bukan CANCEL).
    const relatedPR = prItems.filter(p => p.supplier_id === s.id && p.status !== 'CANCEL');
    const totalDPP = relatedPR.reduce((acc, p) => acc + (Number(p.dpp) || 0), 0);
    const totalPPN = relatedPR.reduce((acc, p) => acc + (Number(p.ppn_amount) || 0), 0);
    const totalTagihan = relatedPR.reduce((acc, p) => acc + (Number(p.total) || 0), 0);

    return `
    <tr class="hover:bg-slate-50 transition">
      <td class="py-2.5 px-4 font-extrabold text-purple-900">${esc(s.nama)}</td>
      <td class="py-2.5 px-4">${esc(s.kota || '-')}, ${esc(s.provinsi || '-')}</td>
      <td class="py-2.5 px-4">${esc(s.pic || '-')}<br><span class="text-[10px] text-slate-400">${esc(s.telepon || '-')}</span></td>
      <td class="py-2.5 px-4 font-mono text-[11px]">${esc(s.npwp || '-')}</td>
      <td class="py-2.5 px-4 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'AKTIF' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${esc(s.status)}</span></td>
      <td class="py-2.5 px-4 text-center font-mono">${relatedPR.length}</td>
      <td class="py-2.5 px-4 text-right font-mono">${formatRupiah(totalDPP)}</td>
      <td class="py-2.5 px-4 text-right font-mono text-purple-600">${formatRupiah(totalPPN)}</td>
      <td class="py-2.5 px-4 text-right font-extrabold">${formatRupiah(totalTagihan)}</td>
      <td class="py-2.5 px-4 text-center">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="openAddSupplierModal('edit', ${s.id})" class="p-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteSupplier(${s.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openAddSupplierModal(mode, id = null) {
  document.getElementById('supplier-form').reset();
  document.getElementById('supp-form-id').value = '';
  document.getElementById('supp-negara').value = 'Indonesia';

  const title = document.getElementById('supplier-modal-title');
  if (mode === 'add') {
    title.textContent = 'Form Data Supplier - Tambah Baru';
  } else {
    const s = suppliers.find(x => x.id === id);
    if (!s) return;
    title.textContent = `Edit Supplier - ${s.nama}`;
    document.getElementById('supp-form-id').value = s.id;
    document.getElementById('supp-nama').value = s.nama;
    document.getElementById('supp-alamat').value = s.alamat || '';
    document.getElementById('supp-kelurahan').value = s.kelurahan || '';
    document.getElementById('supp-kecamatan').value = s.kecamatan || '';
    document.getElementById('supp-kota').value = s.kota || '';
    document.getElementById('supp-provinsi').value = s.provinsi || '';
    document.getElementById('supp-kodepos').value = s.kodepos || '';
    document.getElementById('supp-negara').value = s.negara || 'Indonesia';
    document.getElementById('supp-pic').value = s.pic || '';
    document.getElementById('supp-cp').value = s.cp || '';
    document.getElementById('supp-telepon').value = s.telepon || '';
    document.getElementById('supp-npwp').value = s.npwp || '';
    document.getElementById('supp-status').value = s.status;
  }
  document.getElementById('supplier-modal').classList.remove('hidden');
}

function closeAddSupplierModal() {
  document.getElementById('supplier-modal').classList.add('hidden');
}

async function handleSupplierSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('supp-form-id').value;
  const payload = {
    id: id || undefined,
    nama: document.getElementById('supp-nama').value.trim().toUpperCase(),
    alamat: document.getElementById('supp-alamat').value,
    kelurahan: document.getElementById('supp-kelurahan').value,
    kecamatan: document.getElementById('supp-kecamatan').value,
    kota: document.getElementById('supp-kota').value,
    provinsi: document.getElementById('supp-provinsi').value,
    kodepos: document.getElementById('supp-kodepos').value,
    negara: document.getElementById('supp-negara').value,
    pic: document.getElementById('supp-pic').value,
    cp: document.getElementById('supp-cp').value,
    telepon: document.getElementById('supp-telepon').value,
    npwp: document.getElementById('supp-npwp').value,
    status: document.getElementById('supp-status').value,
  };

  try {
    if (id) {
      await api('api/suppliers.php', 'PUT', payload);
      showToast('Supplier berhasil diperbarui.');
    } else {
      await api('api/suppliers.php', 'POST', payload);
      showToast('Supplier berhasil ditambahkan.');
    }
    closeAddSupplierModal();
    await refresh('suppliers');
    renderSupplierDirectory();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteSupplier(id) {
  if (!(await showConfirm('Hapus supplier ini? Supplier yang masih dipakai di data PR tidak bisa dihapus.'))) return;
  try {
    await api(`api/suppliers.php?id=${id}`, 'DELETE');
    showToast('Supplier berhasil dihapus.');
    await refresh('suppliers');
    renderSupplierDirectory();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== MASTER DIRECTORY MODULE =====================

function renderMasterLists() {
  document.getElementById('master-product-count').textContent = masterProducts.length;
  document.getElementById('master-buyer-count').textContent = masterBuyers.length;

  const prodList = document.getElementById('master-product-list');
  prodList.innerHTML = masterProducts.length ? masterProducts.map(p => `
    <li class="flex items-center justify-between py-2">
      <span class="font-semibold text-slate-700">${esc(p.nama)}</span>
      <div class="flex items-center gap-1">
        <button onclick="openAddMasterModal('product','edit',${p.id})" class="text-indigo-600 hover:text-indigo-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
        <button onclick="deleteMasterItem('products',${p.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </li>`).join('') : '<li class="py-4 text-center text-slate-300">Belum ada data</li>';

  const buyerList = document.getElementById('master-buyer-list');
  buyerList.innerHTML = masterBuyers.length ? masterBuyers.map(b => `
    <li class="flex items-center justify-between py-2">
      <span class="font-semibold text-slate-700">${esc(b.nama)}</span>
      <div class="flex items-center gap-1">
        <button onclick="openAddMasterModal('buyer','edit',${b.id})" class="text-emerald-600 hover:text-emerald-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
        <button onclick="deleteMasterItem('buyers',${b.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </li>`).join('') : '<li class="py-4 text-center text-slate-300">Belum ada data</li>';
}

/** Menu Administrator (khusus admin): Master User & Divisi + Role Management. */
// ===================== RIWAYAT / LOG APLIKASI (Administrator) =====================
const LOG_MODULE_LABELS = {
  pr_items: 'Purchase Request (PR)', work_orders: 'Work Order (WO)', seal_items: 'Seal CNC', transport_items: 'Transportasi',
  account_receivable: 'AR (Piutang)', account_payable: 'AP (Hutang)', dana_talangan: 'Dana Talangan', manual_cashflow: 'Cash Flow',
  surat_jalan: 'Surat Jalan', customers: 'Customer', suppliers: 'Supplier', inventory_items: 'Stok Material',
  inventory_movements: 'Pergerakan Stok', production_orders: 'Produksi & BOM', mtc_divisi_records: 'MTC Divisi Produksi',
  mtc_divisi_items: 'MTC Pekerjaan', mtc_master_mesin: 'MTC Master Mesin', mtc_master_mp: 'MTC Tarif Manpower',
  master_products: 'Master Product', master_buyers: 'Master Buyer', master_karyawan: 'Master Karyawan', master_users: 'User',
  roles: 'Role', auth: 'Login', account: 'Akun Saya',
  // nama tipe pada log "Import (ringkasan)"
  ar: 'AR (Piutang)', ap: 'AP (Hutang)', sj: 'Surat Jalan', mtc: 'MTC Pekerjaan', karyawan: 'Master Karyawan',
  products: 'Master Product', buyers: 'Master Buyer', users: 'User',
};
const LOG_ACTION_LABELS = {
  create: ['Buat', 'bg-emerald-100 text-emerald-700'], update: ['Ubah', 'bg-blue-100 text-blue-700'],
  delete: ['Hapus', 'bg-rose-100 text-rose-700'], bulk_delete: ['Hapus Massal', 'bg-rose-100 text-rose-700'],
  import: ['Import', 'bg-teal-100 text-teal-700'], import_summary: ['Import (ringkasan)', 'bg-teal-50 text-teal-700'],
  spv_approve: ['Approve Supervisor', 'bg-amber-100 text-amber-800'], spv_reject: ['Tolak Supervisor', 'bg-rose-100 text-rose-700'],
  mgr_approve: ['Approve Manager', 'bg-indigo-100 text-indigo-700'], mgr_reject: ['Tolak Manager', 'bg-rose-100 text-rose-700'],
  leader_approve: ['Approve Supervisor', 'bg-amber-100 text-amber-800'], leader_reject: ['Tolak Supervisor', 'bg-rose-100 text-rose-700'],
  manager_approve: ['Approve Manager', 'bg-indigo-100 text-indigo-700'], manager_reject: ['Tolak Manager', 'bg-rose-100 text-rose-700'],
  resubmit: ['Kirim Ulang', 'bg-slate-200 text-slate-700'], receive: ['Terima Barang', 'bg-emerald-100 text-emerald-700'],
  consume: ['Pakai Material', 'bg-teal-100 text-teal-700'], stock_adjust: ['Koreksi Stok', 'bg-amber-100 text-amber-800'],
  login: ['Login', 'bg-slate-100 text-slate-600'], logout: ['Logout', 'bg-slate-100 text-slate-600'],
  login_failed: ['Login Gagal', 'bg-rose-50 text-rose-600'], change_password: ['Ganti Password', 'bg-slate-100 text-slate-600'],
};
let logFacetsLoaded = false;
let logState = { page: 1, size: 50, total: 0 };
let logDebounce = null;
function debouncedLoadLog() { clearTimeout(logDebounce); logDebounce = setTimeout(() => loadActivityLog(1), 350); }

function logQueryString(page, size) {
  const v = id => encodeURIComponent(document.getElementById(id)?.value || '');
  return `q=${v('log-q')}&module=${v('log-module')}&action=${v('log-action')}&user_id=${v('log-user')}&from=${v('log-from')}&to=${v('log-to')}&page=${page}&size=${size}`;
}

async function loadActivityLog(page = 1) {
  const tbody = document.getElementById('log-tbody');
  if (!tbody || !IS_ADMIN) return;
  try {
    if (!logFacetsLoaded) {
      const f = await api('api/activity_log.php?action=facets');
      document.getElementById('log-module').innerHTML = '<option value="">Semua Modul</option>' + f.modules.map(m => opt(m, LOG_MODULE_LABELS[m] || m)).join('');
      document.getElementById('log-action').innerHTML = '<option value="">Semua Aksi</option>' + f.actions.map(a => opt(a, (LOG_ACTION_LABELS[a] || [a])[0])).join('');
      document.getElementById('log-user').innerHTML = '<option value="">Semua User</option>' + f.users.map(u => opt(u.id, `${u.full_name} (@${u.username})`)).join('');
      logFacetsLoaded = true;
    }
    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Memuat log...</td></tr>';
    const d = await api(`api/activity_log.php?${logQueryString(page, logState.size)}`);
    logState = { page: d.page, size: d.size, total: d.total };
    tbody.innerHTML = d.rows.length ? d.rows.map(r => {
      const [aLabel, aCls] = LOG_ACTION_LABELS[r.action] || [r.action, 'bg-slate-100 text-slate-600'];
      return `<tr class="hover:bg-slate-50 align-top">
        <td class="py-2 px-3 whitespace-nowrap font-mono text-[11px]">${esc(formatDateTimeID(r.created_at))}</td>
        <td class="py-2 px-3 whitespace-nowrap"><div class="font-semibold">${esc(r.user_nama || '-')}</div><div class="text-[10px] text-slate-400">${r.username ? '@' + esc(r.username) : ''}</div></td>
        <td class="py-2 px-3 whitespace-nowrap"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${aCls}">${esc(aLabel)}</span></td>
        <td class="py-2 px-3 whitespace-nowrap">${esc(LOG_MODULE_LABELS[r.module] || r.module)}${r.record_id ? ` <span class="text-slate-400">#${r.record_id}</span>` : ''}</td>
        <td class="py-2 px-3 min-w-[320px]">${esc(r.detail || '-')}</td>
        <td class="py-2 px-3 whitespace-nowrap text-[10px] text-slate-400">${esc(r.ip_address || '')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="py-6 text-center text-slate-400">Tidak ada log yang cocok.</td></tr>';
    const pages = Math.max(1, Math.ceil(d.total / d.size));
    document.getElementById('log-pager').innerHTML = `
      <span>${d.total.toLocaleString('id-ID')} catatan &middot; halaman ${d.page} dari ${pages}</span>
      <div class="flex items-center gap-1.5">
        <select onchange="logState.size = Number(this.value); loadActivityLog(1)" class="p-1.5 border border-slate-300 rounded-lg bg-white">
          ${[25, 50, 100, 200].map(n => `<option value="${n}" ${n === d.size ? 'selected' : ''}>${n} / halaman</option>`).join('')}
        </select>
        <button type="button" ${d.page <= 1 ? 'disabled' : ''} onclick="loadActivityLog(${d.page - 1})" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold disabled:opacity-40">&larr; Sebelumnya</button>
        <button type="button" ${d.page >= pages ? 'disabled' : ''} onclick="loadActivityLog(${d.page + 1})" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold disabled:opacity-40">Berikutnya &rarr;</button>
      </div>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-rose-600">${esc(err.message || 'Gagal memuat log.')}</td></tr>`;
  }
}

/** Export log sesuai filter (maks 1000 baris terbaru) ke Excel. */
async function exportActivityLog() {
  if (typeof XLSX === 'undefined') { showToast('Library Excel belum termuat, coba lagi.', 'error'); return; }
  try {
    const d = await api(`api/activity_log.php?${logQueryString(1, 1000)}`);
    if (!d.rows.length) { showToast('Tidak ada log untuk diexport.', 'error'); return; }
    const rows = [['Waktu', 'User', 'Username', 'Aksi', 'Modul', 'ID Data', 'Data / Keterangan', 'IP'],
      ...d.rows.map(r => [r.created_at, r.user_nama || '', r.username || '', (LOG_ACTION_LABELS[r.action] || [r.action])[0],
        LOG_MODULE_LABELS[r.module] || r.module, r.record_id || '', r.detail || '', r.ip_address || ''])];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [18, 22, 14, 18, 22, 8, 80, 14].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Log Aplikasi');
    XLSX.writeFile(wb, `Log_Aplikasi_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(`Export ${d.rows.length} baris log berhasil${d.total > 1000 ? ' (1000 terbaru dari ' + d.total + ')' : ''}.`);
  } catch (err) { showApiError(err); }
}

function renderAdminSection() {
  loadActivityLog(logState.page || 1);
  document.getElementById('master-user-count').textContent = masterUsers.length;
  document.getElementById('master-role-count').textContent = roles.length;

  const userList = document.getElementById('master-user-list');
  userList.innerHTML = masterUsers.length ? masterUsers.map(u => `
    <li class="flex items-center justify-between py-2">
      <div>
        <span class="font-semibold text-slate-700">${esc(u.full_name)}</span>
        <div class="text-[10px] text-slate-400">${esc(u.divisi)} &middot; @${esc(u.username)} &middot; ${esc(roleLabel(u.role))} &middot; ${esc(u.status)}</div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="openMasterUserModal('edit',${u.id})" class="text-blue-600 hover:text-blue-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
        <button onclick="deleteMasterItem('users',${u.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </li>`).join('') : '<li class="py-4 text-center text-slate-300">Belum ada data</li>';

  // Ringkasan: role & user yang boleh melihat Nilai PO / Profit / Margin.
  const capBox = document.getElementById('nilai-access-summary');
  if (capBox) {
    const capRoles = roles.filter(r => Number(r.is_admin) || (r.access || {}).cap_nilai_po);
    const capKeys = capRoles.map(r => r.role_key);
    const capUsers = masterUsers.filter(u => capKeys.includes(u.role) && u.status !== 'NON AKTIF');
    capBox.innerHTML = `
      <div class="font-bold text-amber-900 mb-1"><i class="fa-solid fa-lock mr-1"></i> Yang bisa melihat Nilai PO, DPP, PPN, Profit/Loss &amp; Margin</div>
      <div><span class="text-amber-800">Role:</span> ${capRoles.map(r => `<span class="inline-block px-1.5 py-0.5 mr-1 mb-0.5 rounded bg-white border border-amber-200 font-semibold">${esc(r.label)}</span>`).join('')}</div>
      <div class="mt-0.5"><span class="text-amber-800">User (${capUsers.length}):</span> ${esc(capUsers.map(u => u.full_name || u.username).join(', ') || '-')}</div>
      <div class="mt-1 text-[10px] text-amber-700">Atur lewat Edit Role &rarr; bagian <b>Akses Data Sensitif</b>. Role lain tidak menerima nilai tsb sama sekali dari server.</div>`;
  }

  const roleList = document.getElementById('master-role-list');
  roleList.innerHTML = roles.length ? roles.map(r => `
    <li class="flex items-center justify-between py-2">
      <div>
        <span class="font-semibold text-slate-700">${esc(r.label)}</span>
        ${Number(r.is_admin) ? '<span class="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-100 text-rose-700 uppercase">Admin Penuh</span>' : ''}
        ${Number(r.is_system) ? '<span class="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-200 text-slate-600 uppercase">Bawaan</span>' : ''}
        <div class="text-[10px] text-slate-400">${esc(r.role_key)}</div>
        <div class="flex flex-wrap gap-1 mt-1">${roleAccessBadges(r)}</div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="openRoleModal('edit',${r.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
        ${Number(r.is_system) ? '' : `<button onclick="deleteRole(${r.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>`}
      </div>
    </li>`).join('') : '<li class="py-4 text-center text-slate-300">Belum ada data</li>';
}

// --- Role Management ---
/** Ringkasan hak akses role per modul, mis. "PURCHASING 2/2", untuk daftar role. */
function roleAccessBadges(r) {
  if (Number(r.is_admin)) {
    return '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-600 border border-rose-100">SEMUA MENU</span>';
  }
  const access = r.access || {};
  const badges = Object.values(appModules).map(mod => {
    const keys = Object.keys(mod.menus);
    const viewN = keys.filter(k => access[k]).length;
    if (!viewN) return '';
    const editN = keys.filter(k => access[k] === 'edit').length;
    const title = keys.filter(k => access[k]).map(k => `${mod.menus[k]}: ${access[k] === 'edit' ? 'Ubah' : 'Lihat'}`).join('\n');
    const tone = editN ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-slate-100 text-slate-600 border-slate-200';
    return `<span title="${esc(title)}" class="px-1.5 py-0.5 rounded text-[9px] font-bold border ${tone}">${esc(mod.label.toUpperCase())} ${viewN}/${keys.length}${editN ? '' : ' (LIHAT)'}</span>`;
  }).join('');
  const capBadges = Object.entries(appCapabilities).filter(([k]) => access[k]).map(([, c]) =>
    `<span title="${esc(c.label)}" class="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-100"><i class="fa-solid fa-key"></i> ${esc(c.short || c.label)}</span>`).join('');
  return (badges + capBadges) || '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">BELUM ADA AKSES</span>';
}

/**
 * Render matriks hak akses (mirip policy editor AWS IAM):
 * tiap modul = 1 grup, tiap menu = 1 baris dengan centang Lihat & Ubah.
 */
function renderRolePermissionMatrix(access = {}) {
  const box = document.getElementById('role-perm-matrix');
  box.innerHTML = Object.entries(appModules).map(([modKey, mod]) => `
    <div class="role-perm-group" data-module="${esc(modKey)}">
      <div class="flex items-center justify-between px-4 py-2 bg-slate-100/70">
        <div class="font-bold text-slate-700 text-[11px] uppercase tracking-wide">${esc(mod.label)}</div>
        <div class="flex items-center gap-4 text-[10px] font-bold text-slate-500">
          <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="perm-group-cb w-3.5 h-3.5 accent-slate-600" data-level="view" onchange="toggleRolePermGroup('${esc(modKey)}', 'view', this.checked)"> Lihat semua</label>
          <label class="flex items-center gap-1 cursor-pointer"><input type="checkbox" class="perm-group-cb w-3.5 h-3.5 accent-rose-600" data-level="edit" onchange="toggleRolePermGroup('${esc(modKey)}', 'edit', this.checked)"> Ubah semua</label>
        </div>
      </div>
      ${Object.entries(mod.menus).map(([menuKey, label]) => `
        <div class="flex items-center justify-between px-4 py-1.5 pl-7 hover:bg-slate-50">
          <span class="text-slate-700">${esc(label)}</span>
          <div class="flex items-center gap-4 text-[10px] font-semibold text-slate-500">
            <label class="flex items-center gap-1 cursor-pointer w-[72px]"><input type="checkbox" class="perm-cb w-4 h-4 accent-slate-600" data-menu="${esc(menuKey)}" data-level="view" ${access[menuKey] ? 'checked' : ''} onchange="onRolePermChange(this)"> Lihat</label>
            <label class="flex items-center gap-1 cursor-pointer w-[72px]"><input type="checkbox" class="perm-cb w-4 h-4 accent-rose-600" data-menu="${esc(menuKey)}" data-level="edit" ${access[menuKey] === 'edit' ? 'checked' : ''} onchange="onRolePermChange(this)"> Ubah</label>
          </div>
        </div>`).join('')}
    </div>`).join('') + renderRoleCapabilities(access);
  syncRolePermissionMatrix();
}

/**
 * Izin khusus data sensitif (Nilai PO, Profit/Loss, Margin). Sengaja TIDAK ikut tombol
 * "Semua Lihat / Semua Ubah" supaya harus dicentang sadar oleh Admin.
 */
function renderRoleCapabilities(access = {}) {
  const caps = Object.entries(appCapabilities);
  if (!caps.length) return '';
  return `
    <div class="role-cap-group border-t-2 border-amber-200">
      <div class="px-4 py-2 bg-amber-50 font-bold text-amber-800 text-[11px] uppercase tracking-wide"><i class="fa-solid fa-lock mr-1"></i> Akses Data Sensitif</div>
      ${caps.map(([key, c]) => `
        <label class="flex items-start gap-2 px-4 py-2 pl-7 hover:bg-amber-50/50 cursor-pointer">
          <input type="checkbox" class="cap-cb w-4 h-4 mt-0.5 accent-emerald-600" data-cap="${esc(key)}" ${access[key] ? 'checked' : ''} onchange="syncRolePermissionMatrix()">
          <span><span class="font-semibold text-slate-800">${esc(c.label)}</span><br><span class="text-[10px] text-slate-500">${esc(c.desc)}</span></span>
        </label>`).join('')}
    </div>`;
}

/** Ubah otomatis mencentang Lihat; mencabut Lihat otomatis mencabut Ubah. */
function onRolePermChange(cb) {
  const menu = cb.dataset.menu;
  const view = document.querySelector(`.perm-cb[data-menu="${menu}"][data-level="view"]`);
  const edit = document.querySelector(`.perm-cb[data-menu="${menu}"][data-level="edit"]`);
  if (cb === edit && edit.checked) view.checked = true;
  if (cb === view && !view.checked) edit.checked = false;
  syncRolePermissionMatrix();
}

function toggleRolePermGroup(modKey, level, checked) {
  document.querySelectorAll(`.role-perm-group[data-module="${modKey}"] .perm-cb[data-level="${level}"]`).forEach(cb => {
    cb.checked = checked;
    onRolePermChange(cb);
  });
  syncRolePermissionMatrix();
}

/** level: 'view' | 'edit' | '' (kosongkan semua) */
function setAllRolePermissions(level) {
  document.querySelectorAll('.perm-cb').forEach(cb => {
    cb.checked = level === 'edit' || (level === 'view' && cb.dataset.level === 'view');
  });
  syncRolePermissionMatrix();
}

/** Sinkronkan centang grup, kunci matriks kalau Admin Penuh, dan tampilkan ringkasan. */
function syncRolePermissionMatrix() {
  const isAdmin = document.getElementById('role-is-admin').checked;
  document.querySelectorAll('.perm-cb, .perm-group-cb, .cap-cb').forEach(cb => { cb.disabled = isAdmin; });
  if (isAdmin) document.querySelectorAll('.perm-cb, .cap-cb').forEach(cb => { cb.checked = true; });
  document.getElementById('role-perm-admin-note').classList.toggle('hidden', !isAdmin);

  document.querySelectorAll('.role-perm-group').forEach(g => {
    ['view', 'edit'].forEach(level => {
      const cbs = [...g.querySelectorAll(`.perm-cb[data-level="${level}"]`)];
      const groupCb = g.querySelector(`.perm-group-cb[data-level="${level}"]`);
      const n = cbs.filter(c => c.checked).length;
      groupCb.checked = n === cbs.length;
      groupCb.indeterminate = n > 0 && n < cbs.length;
    });
  });

  const access = readRolePermissionMatrix();
  const menuKeys = Object.keys(access).filter(k => !(k in appCapabilities));
  const viewN = menuKeys.length;
  const editN = menuKeys.filter(k => access[k] === 'edit').length;
  const nilaiNote = access.cap_nilai_po ? ' Boleh melihat Nilai PO / Profit / Margin.' : ' Nilai PO / Profit / Margin disembunyikan.';
  document.getElementById('role-perm-summary').textContent = isAdmin
    ? 'Role ini bisa membuka dan mengubah semua menu.'
    : `${viewN} menu bisa dibuka, ${editN} di antaranya boleh diubah.${viewN ? '' : ' User dengan role ini hanya akan melihat Dashboard & Akun Saya.'}${nilaiNote}`;
}

/** Baca matriks jadi {"dashboard":"edit","stok":"view"}. */
function readRolePermissionMatrix() {
  const access = {};
  document.querySelectorAll('.perm-cb[data-level="view"]:checked').forEach(cb => { access[cb.dataset.menu] = 'view'; });
  document.querySelectorAll('.perm-cb[data-level="edit"]:checked').forEach(cb => { access[cb.dataset.menu] = 'edit'; });
  document.querySelectorAll('.cap-cb:checked').forEach(cb => { access[cb.dataset.cap] = 'view'; });
  return access;
}

function openRoleModal(mode, id = null) {
  document.getElementById('role-form').reset();
  document.getElementById('role-form-id').value = '';
  document.getElementById('role-is-admin').checked = false;
  document.getElementById('role-is-admin').disabled = false;
  document.getElementById('role-system-note').classList.add('hidden');
  document.getElementById('role-key-preview').textContent = '';

  const title = document.getElementById('role-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Role Baru';
    document.getElementById('role-key-preview').textContent = 'Kode teknis role akan dibuat otomatis dari nama ini.';
    renderRolePermissionMatrix({});
  } else {
    const r = roles.find(x => x.id === id);
    if (!r) return;
    title.textContent = `Edit Role - ${r.label}`;
    document.getElementById('role-form-id').value = r.id;
    document.getElementById('role-label').value = r.label;
    document.getElementById('role-is-admin').checked = !!Number(r.is_admin);
    document.getElementById('role-key-preview').textContent = `Kode teknis: ${r.role_key}`;
    if (r.role_key === 'admin') {
      document.getElementById('role-is-admin').disabled = true; // role admin wajib selalu admin penuh
    }
    if (Number(r.is_system)) {
      document.getElementById('role-system-note').classList.remove('hidden');
    }
    renderRolePermissionMatrix(r.access || {});
  }
  document.getElementById('role-modal').classList.remove('hidden');
}

function closeRoleModal() {
  document.getElementById('role-modal').classList.add('hidden');
}

function previewRoleKey() {
  const preview = document.getElementById('role-key-preview');
  // Hanya tampilkan live-preview kalau sedang mode Tambah (form-id kosong).
  if (document.getElementById('role-form-id').value) return;
  const label = document.getElementById('role-label').value.trim();
  if (!label) {
    preview.textContent = 'Kode teknis role akan dibuat otomatis dari nama ini.';
    return;
  }
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role';
  preview.textContent = `Kode teknis: ${slug}`;
}

async function handleRoleSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('role-form-id').value;
  const payload = {
    id: id || undefined,
    label: document.getElementById('role-label').value.trim(),
    is_admin: document.getElementById('role-is-admin').checked,
    access: readRolePermissionMatrix(),
  };

  try {
    if (id) {
      await api('api/roles.php', 'PUT', payload);
      showToast('Role berhasil diperbarui.');
    } else {
      await api('api/roles.php', 'POST', payload);
      showToast('Role berhasil ditambahkan. Sekarang sudah bisa dipilih saat tambah/edit user.');
    }
    closeRoleModal();
    await refresh('roles');
    renderAdminSection();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteRole(id) {
  if (!(await showConfirm('Hapus role ini? Role yang masih dipakai user tidak bisa dihapus.'))) return;
  try {
    await api(`api/roles.php?id=${id}`, 'DELETE');
    showToast('Role berhasil dihapus.');
    await refresh('roles');
    renderAdminSection();
  } catch (err) {
    showApiError(err);
  }
}

// --- Product & Buyer (modal sederhana: 1 field nama) ---
function openAddMasterModal(type, mode, id = null) {
  document.getElementById('master-type').value = type === 'product' ? 'products' : 'buyers';
  document.getElementById('master-mode').value = mode;
  document.getElementById('master-old-id').value = id || '';
  document.getElementById('master-input-name').value = '';

  const title = document.getElementById('master-add-title');
  if (mode === 'add') {
    title.textContent = `Tambah Master ${type === 'product' ? 'Product' : 'Buyer'}`;
  } else {
    title.textContent = `Edit Master ${type === 'product' ? 'Product' : 'Buyer'}`;
    const list = type === 'product' ? masterProducts : masterBuyers;
    const item = list.find(x => x.id === id);
    if (item) document.getElementById('master-input-name').value = item.nama;
  }
  document.getElementById('master-add-modal').classList.remove('hidden');
}

function closeAddMasterModal() {
  document.getElementById('master-add-modal').classList.add('hidden');
}

async function handleMasterAddSubmit(e) {
  e.preventDefault();
  const type = document.getElementById('master-type').value; // 'products' | 'buyers'
  const mode = document.getElementById('master-mode').value;
  const oldId = document.getElementById('master-old-id').value;
  const nama = document.getElementById('master-input-name').value.trim().toUpperCase();

  try {
    if (mode === 'edit') {
      await api(`api/master.php?type=${type}`, 'PUT', { id: oldId, nama });
      showToast('Data berhasil diperbarui.');
    } else {
      await api(`api/master.php?type=${type}`, 'POST', { nama });
      showToast('Data berhasil ditambahkan.');
    }
    closeAddMasterModal();
    await refresh(type === 'products' ? 'masterProducts' : 'masterBuyers');
    renderMasterLists();
  } catch (err) {
    showApiError(err);
  }
}

// --- Import Data Excel ---
const IMPORT_TEMPLATE_MAP = {
  karyawan: 'api/download_template.php?type=karyawan',
  customers: 'api/download_template.php?type=customers',
  suppliers: 'api/download_template.php?type=suppliers',
  buyers: 'api/download_template.php?type=buyers',
  products: 'api/download_template.php?type=products',
  work_orders: 'api/download_template.php?type=work_orders',
  pr_items: 'api/download_template.php?type=pr_items',
  mtc: 'api/download_template.php?type=mtc',
  ar: 'api/download_template.php?type=ar',
  ap: 'api/download_template.php?type=ap',
  sj: 'api/download_template.php?type=sj',
};

// --- Import Excel dari menu AR / AP / Surat Jalan (tombol "Import Excel" di tiap tab) ---
const FIN_IMPORT = {
  ar: { title: 'Import Excel - AR (Piutang)', reload: ['arData', 'workOrders', 'cashflowCombined'], render: () => renderARTable() },
  ap: { title: 'Import Excel - AP (Hutang)', reload: ['apData', 'cashflowCombined'], render: () => renderAPTable() },
  sj: { title: 'Import Excel - Surat Jalan', reload: ['sjData', 'workOrders'], render: () => renderSJTable() },
};
let finImportType = null;

function openFinImportModal(type) {
  finImportType = type;
  document.getElementById('fin-import-title').textContent = FIN_IMPORT[type].title;
  document.getElementById('fin-import-template').href = IMPORT_TEMPLATE_MAP[type];
  document.getElementById('fin-import-file').value = '';
  document.getElementById('fin-import-result').classList.add('hidden');
  document.getElementById('fin-import-modal').classList.remove('hidden');
}

function closeFinImportModal() {
  document.getElementById('fin-import-modal').classList.add('hidden');
}

async function handleFinImportUpload() {
  const type = finImportType;
  const input = document.getElementById('fin-import-file');
  const btn = document.getElementById('fin-import-btn');
  const box = document.getElementById('fin-import-result');
  if (!input.files || !input.files.length) { showToast('Pilih file .xlsx dulu.', 'error'); return; }
  if (!/\.xlsx$/i.test(input.files[0].name)) { showToast('File harus .xlsx (Excel Workbook).', 'error'); return; }

  const form = new FormData();
  form.append('type', type);
  form.append('file', input.files[0]);
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengimport...';
  box.classList.add('hidden');
  try {
    const res = await fetch('api/import.php', { method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-CSRF-Token': CSRF_TOKEN } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(`Respons server tidak valid (HTTP ${res.status}).`); }
    if (!res.ok || !data.success) throw new Error(data.message || 'Import gagal.');

    const d = data.data;
    box.className = 'text-xs rounded-lg p-3 border space-y-2 ' + (d.gagal > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200');
    box.innerHTML = `<div class="font-bold ${d.gagal > 0 ? 'text-amber-800' : 'text-emerald-800'}">
        ${d.berhasil} baris berhasil &middot; ${d.dilewati} dilewati (sudah ada / contoh) &middot; ${d.gagal} gagal</div>` +
      (d.errors && d.errors.length ? '<div class="max-h-48 overflow-y-auto bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">' +
        d.errors.map(e => `<div class="px-3 py-1.5"><span class="font-bold text-rose-600">Baris ${e.baris}:</span> ${esc(e.pesan)}</div>`).join('') + '</div>' : '');
    box.classList.remove('hidden');
    if (d.berhasil > 0) {
      showToast(`${d.berhasil} baris berhasil diimport.`);
      input.value = '';
      await refresh(...FIN_IMPORT[type].reload);
      FIN_IMPORT[type].render();
    }
  } catch (err) {
    box.className = 'text-xs rounded-lg p-3 border bg-rose-50 border-rose-200 text-rose-700 font-semibold';
    box.textContent = err.message || 'Terjadi kesalahan saat import.';
    box.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload &amp; Import';
  }
}

function updateImportTemplateLink() {
  const type = document.getElementById('import-type-select').value;
  // Tipe baru yang lupa didaftarkan tetap memakai pola link yang sama (tidak jadi "undefined").
  document.getElementById('import-download-template').href =
    IMPORT_TEMPLATE_MAP[type] || `api/download_template.php?type=${encodeURIComponent(type)}`;
}

async function handleImportUpload() {
  const type = document.getElementById('import-type-select').value;
  const fileInput = document.getElementById('import-file-input');
  const resultBox = document.getElementById('import-result-box');
  const btn = document.getElementById('import-upload-btn');

  if (!fileInput.files || fileInput.files.length === 0) {
    showToast('Pilih file .xlsx dulu.');
    return;
  }

  const formData = new FormData();
  formData.append('type', type);
  formData.append('file', fileInput.files[0]);

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengimport...';
  resultBox.classList.add('hidden');

  try {
    const res = await fetch('api/import.php', { method: 'POST', body: formData, credentials: 'same-origin', headers: { 'X-CSRF-Token': CSRF_TOKEN } });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Import gagal.');
    }

    const d = data.data;
    resultBox.classList.remove('hidden');
    resultBox.className = 'text-xs rounded-lg p-3 border space-y-2 ' + (d.gagal > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200');
    let html = `<div class="font-bold ${d.gagal > 0 ? 'text-amber-800' : 'text-emerald-800'}">
      ${d.berhasil} baris berhasil diimport &middot; ${d.dilewati} dilewati (sudah ada) &middot; ${d.gagal} gagal
    </div>`;
    if (d.errors && d.errors.length > 0) {
      html += '<div class="max-h-48 overflow-y-auto bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">' +
        d.errors.map(e => `<div class="px-3 py-1.5"><span class="font-bold text-rose-600">Baris ${e.baris}:</span> ${esc(e.pesan)}</div>`).join('') +
        '</div>';
    }
    resultBox.innerHTML = html;

    if (d.berhasil > 0) {
      showToast(`${d.berhasil} baris berhasil diimport.`);
      await loadAllData();
      switchTab('admin');
    }
    fileInput.value = '';
  } catch (err) {
    resultBox.classList.remove('hidden');
    resultBox.className = 'text-xs rounded-lg p-3 border space-y-2 bg-rose-50 border-rose-200 text-rose-700 font-semibold';
    resultBox.innerHTML = esc(err.message || 'Terjadi kesalahan saat import.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload & Import';
  }
}


function renderKaryawanList() {
  const countEl = document.getElementById('master-karyawan-count');
  if (countEl) countEl.textContent = karyawanList.length;
  const list = document.getElementById('master-karyawan-list');
  if (!list) return;
  list.innerHTML = karyawanList.length ? karyawanList.map(k => `
    <li class="flex items-center justify-between py-2">
      <div>
        <span class="font-semibold text-slate-700">${esc(k.nama)}</span>
        <div class="text-[10px] text-slate-400">${esc(k.divisi)}${k.jabatan ? ' &middot; ' + esc(k.jabatan) : ''} &middot; ${esc(k.status)}</div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="openKaryawanModal('edit',${k.id})" class="text-amber-600 hover:text-amber-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
        <button onclick="deleteKaryawan(${k.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </li>`).join('') : '<li class="py-4 text-center text-slate-300">Belum ada data</li>';
}

function openKaryawanModal(mode, id = null) {
  document.getElementById('karyawan-form').reset();
  document.getElementById('kar-form-id').value = '';
  document.getElementById('kar-divisi').value = 'GENERAL';

  const title = document.getElementById('karyawan-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Karyawan';
  } else {
    const k = karyawanList.find(x => x.id === id);
    if (!k) return;
    title.textContent = `Edit Karyawan - ${k.nama}`;
    document.getElementById('kar-form-id').value = k.id;
    document.getElementById('kar-nama').value = k.nama;
    document.getElementById('kar-divisi').value = k.divisi;
    document.getElementById('kar-jabatan').value = k.jabatan || '';
    document.getElementById('kar-status').value = k.status;
  }
  document.getElementById('karyawan-modal').classList.remove('hidden');
}

function closeKaryawanModal() {
  document.getElementById('karyawan-modal').classList.add('hidden');
}

async function handleKaryawanSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('kar-form-id').value;
  const payload = {
    nama: document.getElementById('kar-nama').value,
    divisi: document.getElementById('kar-divisi').value,
    jabatan: document.getElementById('kar-jabatan').value,
    status: document.getElementById('kar-status').value,
  };
  try {
    if (id) {
      payload.id = id;
      await api('api/master.php?type=karyawan', 'PUT', payload);
      showToast('Data Karyawan berhasil diperbarui.');
    } else {
      await api('api/master.php?type=karyawan', 'POST', payload);
      showToast('Karyawan baru berhasil ditambahkan.');
    }
    closeKaryawanModal();
    await refresh('karyawanList');
  } catch (err) {
    showApiError(err);
  }
}

async function deleteKaryawan(id) {
  if (!(await showConfirm('Hapus data karyawan ini? Referensi di PR/WO lama yang sudah memakai nama ini akan menjadi kosong.'))) return;
  try {
    await api(`api/master.php?type=karyawan&id=${id}`, 'DELETE');
    showToast('Data Karyawan berhasil dihapus.');
    await refresh('karyawanList');
  } catch (err) {
    showApiError(err);
  }
}

async function deleteMasterItem(type, id) {
  if (!(await showConfirm('Hapus data master ini?'))) return;
  if (type === 'users' && currentUser && Number(currentUser.id) === Number(id)) {
    showToast('Tidak bisa menghapus akun Anda sendiri yang sedang login.', 'error');
    return;
  }
  try {
    await api(`api/master.php?type=${type}&id=${id}`, 'DELETE');
    showToast('Data master berhasil dihapus.');
    await refresh(type === 'products' ? 'masterProducts' : type === 'buyers' ? 'masterBuyers' : 'masterUsers');
    if (type === 'users') {
      renderAdminSection();
    } else {
      renderMasterLists();
    }
  } catch (err) {
    showApiError(err);
  }
}

// --- User (akun login, field lebih lengkap) ---
function openMasterUserModal(mode, id = null) {
  document.getElementById('master-user-form').reset();
  document.getElementById('mu-form-id').value = '';
  updateDropdownOptions(); // pastikan pilihan role paling baru (kalau baru saja tambah role)
  document.getElementById('mu-role').value = 'user';
  document.getElementById('mu-status').value = 'AKTIF';

  const title = document.getElementById('master-user-title');
  const hint = document.getElementById('mu-password-hint');
  const usernameField = document.getElementById('mu-username');

  if (mode === 'add') {
    title.textContent = 'Tambah User Baru';
    hint.textContent = '*';
    document.getElementById('mu-password').required = true;
    usernameField.disabled = false;
  } else {
    const u = masterUsers.find(x => x.id === id);
    if (!u) return;
    title.textContent = `Edit User - ${u.full_name}`;
    hint.textContent = '(kosongkan jika tidak diubah)';
    document.getElementById('mu-password').required = false;
    document.getElementById('mu-form-id').value = u.id;
    usernameField.value = u.username;
    usernameField.disabled = true; // username tidak diubah setelah dibuat
    document.getElementById('mu-fullname').value = u.full_name;
    document.getElementById('mu-divisi').value = u.divisi;
    document.getElementById('mu-role').value = u.role;
    document.getElementById('mu-status').value = u.status;
  }
  document.getElementById('master-user-modal').classList.remove('hidden');
}

function closeMasterUserModal() {
  document.getElementById('master-user-modal').classList.add('hidden');
}

async function handleMasterUserSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('mu-form-id').value;
  const payload = {
    id: id || undefined,
    username: document.getElementById('mu-username').value.trim().toLowerCase(),
    full_name: document.getElementById('mu-fullname').value.trim().toUpperCase(),
    divisi: document.getElementById('mu-divisi').value.trim().toUpperCase() || 'GENERAL',
    role: document.getElementById('mu-role').value,
    status: document.getElementById('mu-status').value,
    password: document.getElementById('mu-password').value,
  };

  try {
    if (id) {
      await api('api/master.php?type=users', 'PUT', payload);
      showToast('User berhasil diperbarui.');
    } else {
      await api('api/master.php?type=users', 'POST', payload);
      showToast('User berhasil ditambahkan.');
    }
    closeMasterUserModal();
    await refresh('masterUsers');
    renderAdminSection();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== EXCEL EXPORT & TEMPLATE =====================

function downloadExcelTemplate() {
  const templateData = [
    ['Kategori (PROJECT/GENERAL)', 'Tanggal PR (YYYY-MM-DD)', 'No PR', 'No Item', 'Nama Customer', 'Nama Project',
     'No WO', 'Product Part', 'Type', 'Dimensi', 'Brand', 'Qty', 'UOM', 'Harga Satuan', 'Kena PPN (YA/TIDAK)', 'Tarif PPN',
     'Nama Supplier', 'Tanggal Beli (YYYY-MM-DD)', 'Tanggal Datang (YYYY-MM-DD)', 'No PO', 'No Invoice',
     'Username Pemohon', 'Nama Buyer', 'Status', 'Keterangan'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(templateData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template PR');
  XLSX.writeFile(wb, 'Template_Import_PR.xlsx');
  showToast('Template Excel berhasil diunduh. Catatan: nama Customer/Supplier/WO/User harus persis sama dengan data master yang sudah ada.', 'info');
}

function exportToExcel() {
  const exportData = getFilteredPRData().map(p => ({
    'Kategori': p.sheet,
    'Tanggal PR': p.tanggal,
    'No PR': p.pr_number,
    'No Item': p.item_no,
    'Customer': p.customer_nama || '',
    'Project': p.project || '',
    'No WO': p.wo_number || '',
    'Product Part': p.product || '',
    'Type': p.type || '',
    'Dimensi': p.dimensi || '',
    'Brand': p.brand || '',
    'Qty': Number(p.qty),
    'UOM': p.uom || '',
    'Harga Satuan': p.harga,
    'Kenakan PPN': Number(p.is_ppn) ? 'YA' : 'TIDAK',
    'Tarif PPN (%)': p.ppn_rate,
    'Nominal PPN': p.ppn_amount,
    'DPP': p.dpp,
    'Total Tagihan': p.total,
    'Supplier': p.supplier_nama || '',
    'Tanggal Beli': p.tgl_beli || '',
    'Tanggal Datang': p.tgl_datang || '',
    'No PO': p.po_number || '',
    'No Invoice': p.invoice_number || '',
    'Buyer': p.buyer_nama || '',
    'User': p.user_nama || '',
    'Divisi': p.divisi || '',
    'Status': p.status,
    'Keterangan': p.keterangan || '',
  }));

  if (exportData.length === 0) {
    showToast('Tidak ada data untuk diekspor (cek filter aktif).', 'error');
    return;
  }

  const ws = XLSX.utils.json_to_sheet(exportData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data PR');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Purchasing_Request_Export_${today}.xlsx`);
}

// ===================== MODUL FINANCE: CASH FLOW =====================

function filterByMonthYearJS(dateStr, monthVal, yearVal) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const m = (d.getMonth() + 1).toString();
  const y = d.getFullYear().toString();
  return (monthVal === 'ALL' || monthVal === m) && (yearVal === 'ALL' || yearVal === y);
}

function cfStatusBadgeClass(status) {
  if (status === 'TERBAYAR LUNAS') return 'bg-emerald-100 text-emerald-700';
  if (status === 'PARTIAL') return 'bg-blue-100 text-blue-700';
  return 'bg-amber-100 text-amber-700';
}

function resetCashflowFilters() {
  ['filter-cf-from', 'filter-cf-to', 'filter-cf-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['filter-cf-month', 'filter-cf-year', 'filter-cf-kode', 'filter-cf-tp', 'filter-cf-status'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 'ALL'; });
  renderCashflowTable();
}

function renderCashflowTable() {
  const tbody = document.getElementById('cashflow-tbody');
  if (!tbody) return;

  const search = (document.getElementById('filter-cf-search')?.value || '').toLowerCase();
  const monthVal = document.getElementById('filter-cf-month')?.value || 'ALL';
  const yearVal = document.getElementById('filter-cf-year')?.value || 'ALL';
  const kodeVal = document.getElementById('filter-cf-kode')?.value || 'ALL';
  const tpVal = document.getElementById('filter-cf-tp')?.value || 'ALL';
  const statusVal = document.getElementById('filter-cf-status')?.value || 'ALL';
  const fromVal = document.getElementById('filter-cf-from')?.value || '';
  const toVal = document.getElementById('filter-cf-to')?.value || '';

  const filtered = cashflowCombined.filter(c => {
    const tgl = String(c.tanggal || '').slice(0, 10);
    if (fromVal && (!tgl || tgl < fromVal)) return false; // filter rentang tanggal (Dari - Sampai)
    if (toVal && (!tgl || tgl > toVal)) return false;
    const matchKeyword = !search ||
      (c.deskripsi || '').toLowerCase().includes(search) ||
      (c.invoice || '').toLowerCase().includes(search) ||
      (c.pic || '').toLowerCase().includes(search) ||
      (c.wo || '').toLowerCase().includes(search) ||
      (c.po || '').toLowerCase().includes(search);
    const matchMonthYear = filterByMonthYearJS(c.tanggal, monthVal, yearVal);
    const matchKode = kodeVal === 'ALL' || c.kode === kodeVal;
    const matchTp = tpVal === 'ALL' || c.tp === tpVal;
    const matchStatus = statusVal === 'ALL' || c.status === statusVal;
    return matchKeyword && matchMonthYear && matchKode && matchTp && matchStatus;
  });

  document.getElementById('cf-record-count').textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-slate-400 font-semibold">Tidak ada transaksi Cash Flow yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows('cashflow', sortRows('cashflow', filtered.slice().reverse())).map(c => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-3 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="editCashflowRow('${c.id}')" class="text-blue-600 hover:text-blue-800 p-1" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteCashflowRow('${c.id}')" class="text-rose-600 hover:text-rose-800 p-1" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-3 font-semibold">${formatDateID(c.tanggal)}</td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">${esc(c.kode)}</span></td>
      <td class="py-2.5 px-3 font-medium text-slate-800">${esc(c.deskripsi)}</td>
      <td class="py-2.5 px-3 text-slate-600">${esc(c.pic)}</td>
      <td class="py-2.5 px-3 text-blue-600 font-semibold">${esc(c.wo)}</td>
      <td class="py-2.5 px-3 text-[11px] whitespace-nowrap">
        <div><span class="text-slate-400">INV:</span> <span class="font-semibold">${esc(c.invoice || '-')}</span></div>
        <div><span class="text-slate-400">PO:</span> <span class="font-semibold">${esc(c.po || '-')}</span></div>
      </td>
      <td class="py-2.5 px-3 text-right text-[11px]">
        <div>DPP: ${formatRupiah(c.dpp)}</div>
        <div class="text-indigo-600">PPh23: ${formatRupiah(c.pph23)}</div>
      </td>
      <td class="py-2.5 px-3 text-right text-emerald-600 font-semibold">${c.debit > 0 ? formatRupiah(c.debit) : '-'}</td>
      <td class="py-2.5 px-3 text-right text-rose-600 font-semibold">${c.kredit > 0 ? formatRupiah(c.kredit) : '-'}</td>
      <td class="py-2.5 px-3 text-right font-bold text-slate-900">${formatRupiah(c.saldo)}</td>
      <td class="py-2.5 px-3 text-center"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${cfStatusBadgeClass(c.status)}">${esc(c.status)}</span></td>
    </tr>
  `).join('');
}

function openCashflowModal(mode) {
  document.getElementById('cashflow-form').reset();
  document.getElementById('cf-form-id').value = '';
  document.getElementById('cf-tanggal').value = new Date().toISOString().slice(0, 10);
  document.getElementById('cashflow-modal-title').textContent = 'Tambah Transaksi Cash Flow';
  document.getElementById('cashflow-modal').classList.remove('hidden');
}

function closeCashflowModal() {
  document.getElementById('cashflow-modal').classList.add('hidden');
}

function editCashflowRow(id) {
  const item = cashflowCombined.find(x => x.id === id);
  if (!item) return;

  if (item.source === 'MANUAL') {
    document.getElementById('cashflow-form').reset();
    document.getElementById('cf-form-id').value = item.ref_id;
    document.getElementById('cf-tanggal').value = item.tanggal;
    document.getElementById('cf-kode').value = item.kode;
    document.getElementById('cf-tp').value = item.tp;
    document.getElementById('cf-nominal').value = item.debit > 0 ? item.debit : item.kredit;
    document.getElementById('cf-deskripsi').value = item.deskripsi;
    document.getElementById('cf-pic').value = item.pic === '-' ? '' : item.pic;
    document.getElementById('cf-invoice').value = item.invoice === '-' ? '' : item.invoice;
    document.getElementById('cf-wo').value = item.wo === '-' ? '' : item.wo;
    document.getElementById('cf-po').value = item.po === '-' ? '' : item.po;
    document.getElementById('cf-pph23').value = item.pph23 || 0;
    document.getElementById('cf-status').value = item.status;
    document.getElementById('cashflow-modal-title').textContent = 'Edit Transaksi Cash Flow';
    document.getElementById('cashflow-modal').classList.remove('hidden');
  } else if (item.source === 'AR') {
    switchTab('ar');
    showToast('Transaksi ini berasal dari AR — edit lewat tab AR.', 'info');
    openARModal('edit', item.ref_id);
  } else if (item.source === 'AP') {
    switchTab('ap');
    showToast('Transaksi ini berasal dari AP — edit lewat tab AP.', 'info');
    openAPModal('edit', item.ref_id);
  }
}

async function handleCashflowSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('cf-form-id').value;
  const payload = {
    id: id || undefined,
    tanggal: document.getElementById('cf-tanggal').value,
    kode: document.getElementById('cf-kode').value,
    tp: document.getElementById('cf-tp').value,
    nominal: document.getElementById('cf-nominal').value,
    deskripsi: document.getElementById('cf-deskripsi').value,
    pic: document.getElementById('cf-pic').value,
    invoice_ref: document.getElementById('cf-invoice').value,
    wo_no: document.getElementById('cf-wo').value,
    po_no: document.getElementById('cf-po').value,
    pph23: document.getElementById('cf-pph23').value,
    status: document.getElementById('cf-status').value,
  };

  try {
    if (id) {
      await api('api/cashflow.php', 'PUT', payload);
      showToast('Transaksi Cash Flow berhasil diperbarui.');
    } else {
      await api('api/cashflow.php', 'POST', payload);
      showToast('Transaksi Cash Flow berhasil ditambahkan.');
    }
    closeCashflowModal();
    await refresh('cashflowCombined', 'danaTalangan');
    renderCashflowTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteCashflowRow(id) {
  if (!(await showConfirm('Hapus transaksi Cash Flow ini?'))) return;
  try {
    await api(`api/cashflow.php?id=${id}`, 'DELETE');
    showToast('Transaksi Cash Flow berhasil dihapus.');
    await refresh('cashflowCombined', 'arData', 'apData', 'danaTalangan', 'workOrders');
    renderCashflowTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== MODUL FINANCE: ACCOUNT RECEIVABLE (AR) =====================

function renderARTable() {
  const tbody = document.getElementById('ar-tbody');
  if (!tbody) return;

  const search = (document.getElementById('filter-ar-search')?.value || '').toLowerCase();
  const custVal = document.getElementById('filter-ar-customer')?.value || 'ALL';
  const statusVal = document.getElementById('filter-ar-status')?.value || 'ALL';

  const filtered = arData.filter(a => {
    const matchSearch = !search ||
      a.invoice_no.toLowerCase().includes(search) ||
      (a.customer_nama || '').toLowerCase().includes(search) ||
      (a.po_no || '').toLowerCase().includes(search) ||
      (a.wo_numbers || a.wo_number || '').toLowerCase().includes(search) ||
      (a.deskripsi || '').toLowerCase().includes(search);
    const matchCust = custVal === 'ALL' || a.customer_nama === custVal;
    const matchStatus = statusVal === 'ALL' || a.status === statusVal;
    return matchSearch && matchCust && matchStatus;
  });

  document.getElementById('ar-record-count').textContent = filtered.length;

  const totalPenjualan = filtered.reduce((s, a) => s + Number(a.penjualan), 0);
  const totalPiutang = filtered.reduce((s, a) => s + Number(a.penjualan) + Number(a.ppn), 0);
  const totalTerbayar = filtered.reduce((s, a) => s + Number(a.terbayar), 0);
  const totalSisa = filtered.reduce((s, a) => s + Number(a.sisa_piutang), 0);
  document.getElementById('ar-sum-penjualan').textContent = formatRupiah(totalPenjualan);
  document.getElementById('ar-sum-piutang').textContent = formatRupiah(totalPiutang);
  document.getElementById('ar-sum-terbayar').textContent = formatRupiah(totalTerbayar);
  document.getElementById('ar-sum-sisa').textContent = formatRupiah(totalSisa);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-slate-400 font-semibold">Tidak ada data AR yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows('ar', sortRows('ar', filtered)).map(a => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-3 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="printAR(${a.id})" class="text-slate-600 hover:text-slate-800 p-1" title="Print Invoice"><i class="fa-solid fa-print"></i></button>
          <button onclick="openARModal('edit', ${a.id})" class="text-blue-600 hover:text-blue-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteAR(${a.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-3 font-bold text-slate-800">${esc(a.invoice_no)}</td>
      <td class="py-2.5 px-3">${formatDateID(a.tgl_invoice)}</td>
      <td class="py-2.5 px-3 font-medium">${esc(a.customer_nama || '-')}</td>
      <td class="py-2.5 px-3 font-semibold">${esc(a.po_no || '-')}<div class="text-[10px] text-blue-600">${esc(a.wo_numbers || a.wo_number || '')}</div></td>
      <td class="py-2.5 px-3 text-slate-600">${esc(a.deskripsi || '-')}</td>
      <td class="py-2.5 px-3 text-right font-medium">${formatRupiah(a.penjualan)}</td>
      <td class="py-2.5 px-3 text-right text-blue-600">${formatRupiah(a.ppn)}</td>
      <td class="py-2.5 px-3 text-right text-indigo-600">${formatRupiah(a.pph23)}</td>
      <td class="py-2.5 px-3 text-center font-semibold">${a.top_days} Hari</td>
      <td class="py-2.5 px-3 font-bold">${formatDateID(a.due_date)}</td>
      <td class="py-2.5 px-3 text-right text-emerald-600 font-bold">${formatRupiah(a.terbayar)}</td>
      <td class="py-2.5 px-3 text-right font-bold text-amber-600">${formatRupiah(a.sisa_piutang)}</td>
      <td class="py-2.5 px-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${cfStatusBadgeClass(a.status)}">${esc(a.status)}</span></td>
    </tr>
  `).join('');
}

/** WO milik customer yang dipilih di form AR. */
function arCustomerWOs() {
  const custId = document.getElementById('ar-customer-select').value;
  return custId ? workOrders.filter(w => String(w.customer_id) === String(custId)) : [];
}

/** Daftar No PO unik milik customer (1 PO bisa berisi beberapa WO). */
function populateARPOList() {
  const counts = {};
  arCustomerWOs().forEach(w => { if (w.po_no && w.po_no.trim() && w.po_no.trim() !== '-') counts[w.po_no.trim()] = (counts[w.po_no.trim()] || 0) + 1; });
  document.getElementById('ar-po-list').innerHTML = Object.keys(counts).sort()
    .map(po => `<option value="${esc(po)}">${counts[po]} WO</option>`).join('');
  renderWOPicker('ar');
}

// ===================== PILIH WO (CENTANG) - dipakai form AR & Surat Jalan =====================
// 1 invoice / 1 Surat Jalan bisa memuat beberapa WO. WO yang dicentang disimpan di WO_PICK[name].
const WO_PICK = { ar: new Set(), sj: new Set() };
const WO_PICK_CFG = {
  ar: {
    title: 'WO yang masuk Invoice ini', customerEl: 'ar-customer-select', poEl: 'ar-po',
    onChange: () => autoFillARFromWOs(),
    badge: w => (w.ar_invoices || []).length
      ? `<span class="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-bold">Invoice: ${esc(w.ar_invoices.join(', '))}</span>` : '',
  },
  sj: {
    title: 'WO yang dikirim dengan Surat Jalan ini', customerEl: 'sj-customer-select', poEl: null,
    onChange: () => syncSJAutoFields(),
    badge: w => (w.surat_jalan || []).length ? sjStatusBadge(w.surat_jalan[0].status, ` &middot; ${esc(w.surat_jalan[0].no_sj)}`) : '',
  },
};

/** Bangun kotak "Pilih WO" (dipanggil saat modal dibuka). */
function initWOPicker(name) {
  const box = document.getElementById(`${name}-wo-picker-box`);
  box.innerHTML = `
    <div class="border border-slate-200 rounded-xl overflow-hidden">
      <div class="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div class="font-semibold text-slate-700">${esc(WO_PICK_CFG[name].title)} <span id="${name}-wo-count" class="ml-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold">0 dipilih</span></div>
        <div class="flex items-center gap-2 text-[10px] font-bold">
          <button type="button" id="${name}-wo-po-all" onclick="pickWOsInPO('${name}')" class="hidden text-orange-700 hover:underline">Centang semua WO di PO ini</button>
          <button type="button" onclick="pickVisibleWOs('${name}', true)" class="text-indigo-600 hover:underline">Centang semua yang tampil</button>
          <button type="button" onclick="pickVisibleWOs('${name}', false)" class="text-rose-600 hover:underline">Kosongkan</button>
        </div>
      </div>
      <div class="px-3 py-2 border-b border-slate-100">
        <input type="text" id="${name}-wo-search" oninput="renderWOPicker('${name}')" placeholder="Cari No WO / project / No PO..." class="w-full p-1.5 bg-white border border-slate-300 rounded-lg">
      </div>
      <div id="${name}-wo-list" class="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-slate-100"></div>
      <div id="${name}-wo-summary" class="px-3 py-1.5 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500"></div>
    </div>`;
  renderWOPicker(name);
}

/** WO yang tampil di daftar: milik customer terpilih (+ yang sudah dicentang), sesuai pencarian. */
function woPickerVisible(name) {
  const cfg = WO_PICK_CFG[name];
  const custId = document.getElementById(cfg.customerEl)?.value || '';
  const q = (document.getElementById(`${name}-wo-search`)?.value || '').toLowerCase().trim();
  const po = cfg.poEl ? (document.getElementById(cfg.poEl)?.value || '').trim().toUpperCase() : '';
  const sel = WO_PICK[name];
  const inPO = w => po && (w.po_no || '').trim().toUpperCase() === po;
  return workOrders
    .filter(w => sel.has(w.id) || (custId && String(w.customer_id) === String(custId)))
    .filter(w => !q || `${w.wo_number} ${w.project || ''} ${w.po_no || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || (inPO(b) - inPO(a))
      || String(b.wo_number).localeCompare(String(a.wo_number), 'id', { numeric: true }))
    .map(w => ({ w, inPO: inPO(w) }));
}

function renderWOPicker(name) {
  const list = document.getElementById(`${name}-wo-list`);
  if (!list) return;
  const cfg = WO_PICK_CFG[name];
  const sel = WO_PICK[name];
  const custId = document.getElementById(cfg.customerEl)?.value || '';
  const rows = woPickerVisible(name);
  const po = cfg.poEl ? (document.getElementById(cfg.poEl)?.value || '').trim() : '';
  document.getElementById(`${name}-wo-po-all`)?.classList.toggle('hidden', !rows.some(r => r.inPO));

  if (!rows.length) {
    list.innerHTML = `<div class="px-3 py-4 text-center text-slate-400">${custId ? 'Tidak ada WO yang cocok.' : 'Pilih Customer dulu untuk menampilkan daftar WO-nya.'}</div>`;
  } else {
    list.innerHTML = rows.map(({ w, inPO }) => `
      <label class="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-indigo-50/50 ${sel.has(w.id) ? 'bg-indigo-50/70' : (inPO ? 'bg-orange-50/50' : '')}">
        <input type="checkbox" class="mt-0.5 w-4 h-4 accent-indigo-600" ${sel.has(w.id) ? 'checked' : ''} onchange="toggleWOPick('${name}', ${w.id}, this.checked)">
        <span class="flex-1 min-w-0">
          <span class="flex flex-wrap items-center gap-1.5">
            <b class="text-slate-800">${esc(w.wo_number)}</b>
            ${w.po_no && w.po_no !== '-' ? `<span class="px-1.5 py-0.5 rounded ${inPO ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-600'} text-[9px] font-bold">PO ${esc(w.po_no)}</span>` : ''}
            ${cfg.badge(w)}
          </span>
          <span class="block text-[10px] text-slate-500 truncate">${esc(w.project || '-')}${String(w.customer_id) !== String(custId) ? ` &middot; ${esc(w.customer_nama || '')}` : ''}</span>
        </span>
      </label>`).join('');
  }
  const picked = workOrders.filter(w => sel.has(w.id)).map(w => w.wo_number);
  document.getElementById(`${name}-wo-count`).textContent = `${picked.length} dipilih`;
  document.getElementById(`${name}-wo-summary`).innerHTML = picked.length
    ? `<b>Dipilih:</b> ${esc(picked.join(', '))}` + (name === 'ar' ? ` <button type="button" onclick="autoFillARFromWOs(true)" class="ml-2 text-orange-700 font-bold hover:underline">Isi nilai dari WO</button>` : '')
    : (po ? 'WO dengan No PO terpilih diberi warna oranye.' : 'Belum ada WO yang dicentang.');
}

function toggleWOPick(name, id, checked) {
  if (checked) WO_PICK[name].add(id); else WO_PICK[name].delete(id);
  renderWOPicker(name);
  WO_PICK_CFG[name].onChange();
}
function pickVisibleWOs(name, checked) {
  woPickerVisible(name).forEach(({ w }) => { if (checked) WO_PICK[name].add(w.id); else WO_PICK[name].delete(w.id); });
  renderWOPicker(name);
  WO_PICK_CFG[name].onChange();
}
function pickWOsInPO(name) {
  woPickerVisible(name).forEach(({ w, inPO }) => { if (inPO) WO_PICK[name].add(w.id); });
  renderWOPicker(name);
  WO_PICK_CFG[name].onChange();
}

/**
 * Isi Penjualan (jumlah DPP WO yang dicentang), PPN & PPh23 - untuk record BARU otomatis,
 * saat EDIT hanya lewat tombol "Isi nilai dari WO" (force) supaya angka invoice tidak tertimpa.
 */
async function autoFillARFromWOs(force = false) {
  const ids = [...WO_PICK.ar];
  if (!ids.length) return;
  if (!force && document.getElementById('ar-form-id').value) return;
  try {
    const data = await api(`api/account_receivable.php?action=auto_fill&wo_ids=${ids.join(',')}`);
    if (data.penjualan !== null) document.getElementById('ar-penjualan').value = data.penjualan; // null = tanpa izin Nilai PO
    document.getElementById('ar-is-ppn').value = Number(data.is_ppn) ? '1' : '0';
    if (data.pph23 !== null) document.getElementById('ar-pph23').value = data.pph23;
    const desk = document.getElementById('ar-deskripsi');
    if (!desk.value.trim() || force) desk.value = data.deskripsi;
    calcARSisa();
  } catch (err) {
    showApiError(err);
  }
}

function calcARDueDate() {
  const tglKirim = document.getElementById('ar-tgl-kirim').value;
  const topDays = parseInt(document.getElementById('ar-top').value) || 0;
  if (!tglKirim) return;
  const d = new Date(tglKirim);
  d.setDate(d.getDate() + topDays);
  document.getElementById('ar-due-date').value = d.toISOString().slice(0, 10);
}

function calcARSisa() {
  const penjualan = parseFloat(document.getElementById('ar-penjualan').value) || 0;
  const isPpn = document.getElementById('ar-is-ppn').value === '1';
  const isPpn030 = document.getElementById('ar-is-ppn030').value === '1';
  const pph23 = parseFloat(document.getElementById('ar-pph23').value) || 0;
  const biayaLain = parseFloat(document.getElementById('ar-biaya-lain').value) || 0;
  const terbayar = parseFloat(document.getElementById('ar-terbayar').value) || 0;

  const ppn = isPpn ? penjualan * 0.11 : 0;
  const ppn030 = isPpn030 ? penjualan * 0.11 : 0;
  const sisa = (penjualan + ppn) - terbayar - pph23 - ppn030 - biayaLain;
  document.getElementById('ar-calc-sisa').textContent = formatRupiah(sisa);
}

function openARModal(mode, id = null) {
  document.getElementById('ar-form').reset();
  document.getElementById('ar-form-id').value = '';
  updateDropdownOptions();

  const title = document.getElementById('ar-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Record AR';
    WO_PICK.ar = new Set();
    initWOPicker('ar');
    document.getElementById('ar-tgl-invoice').value = new Date().toISOString().slice(0, 10);
    document.getElementById('ar-tgl-kirim').value = new Date().toISOString().slice(0, 10);
    populateARPOList();
    calcARDueDate();
    calcARSisa();
  } else {
    const a = arData.find(x => x.id === id);
    if (!a) return;
    title.textContent = `Edit Record AR - ${a.invoice_no}`;
    document.getElementById('ar-form-id').value = a.id;
    document.getElementById('ar-invoice').value = a.invoice_no;
    document.getElementById('ar-tgl-invoice').value = a.tgl_invoice;
    document.getElementById('ar-tgl-kirim').value = a.tgl_kirim || a.tgl_invoice;
    document.getElementById('ar-customer-select').value = a.customer_id || '';
    document.getElementById('ar-po').value = a.po_no || '';
    WO_PICK.ar = new Set(a.wo_ids || []);
    initWOPicker('ar');
    populateARPOList();
    document.getElementById('ar-deskripsi').value = a.deskripsi || '';
    document.getElementById('ar-penjualan').value = a.penjualan;
    document.getElementById('ar-is-ppn').value = Number(a.is_ppn) ? '1' : '0';
    document.getElementById('ar-is-ppn030').value = Number(a.is_ppn030) ? '1' : '0';
    document.getElementById('ar-pph23').value = a.pph23;
    document.getElementById('ar-biaya-lain').value = a.biaya_lain;
    document.getElementById('ar-top').value = a.top_days;
    document.getElementById('ar-faktur-pajak').value = a.faktur_pajak || '';
    document.getElementById('ar-terbayar').value = a.terbayar;
    document.getElementById('ar-tgl-bayar').value = a.tgl_bayar || '';
    document.getElementById('ar-due-date').value = a.due_date || '';
    calcARSisa();
  }

  document.getElementById('ar-modal').classList.remove('hidden');
}

function closeARModal() {
  document.getElementById('ar-modal').classList.add('hidden');
}

async function handleARSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('ar-form-id').value;
  const payload = {
    id: id || undefined,
    invoice_no: document.getElementById('ar-invoice').value.trim().toUpperCase(),
    tgl_invoice: document.getElementById('ar-tgl-invoice').value,
    tgl_kirim: document.getElementById('ar-tgl-kirim').value,
    customer_id: document.getElementById('ar-customer-select').value || null,
    po_no: document.getElementById('ar-po').value.trim(),
    wo_ids: [...WO_PICK.ar],
    deskripsi: document.getElementById('ar-deskripsi').value,
    penjualan: document.getElementById('ar-penjualan').value,
    is_ppn: document.getElementById('ar-is-ppn').value === '1',
    is_ppn030: document.getElementById('ar-is-ppn030').value === '1',
    pph23: document.getElementById('ar-pph23').value,
    biaya_lain: document.getElementById('ar-biaya-lain').value,
    top_days: document.getElementById('ar-top').value,
    due_date: document.getElementById('ar-due-date').value || null,
    faktur_pajak: document.getElementById('ar-faktur-pajak').value,
    terbayar: document.getElementById('ar-terbayar').value,
    tgl_bayar: document.getElementById('ar-tgl-bayar').value || null,
  };

  try {
    if (id) {
      await api('api/account_receivable.php', 'PUT', payload);
      showToast('Record AR berhasil diperbarui.');
    } else {
      await api('api/account_receivable.php', 'POST', payload);
      showToast('Record AR berhasil ditambahkan.');
    }
    closeARModal();
    await refresh('arData', 'cashflowCombined', 'danaTalangan', 'workOrders');
    renderARTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteAR(id) {
  if (!(await showConfirm('Hapus record AR ini?'))) return;
  try {
    await api(`api/account_receivable.php?id=${id}`, 'DELETE');
    showToast('Record AR berhasil dihapus.');
    await refresh('arData', 'cashflowCombined', 'danaTalangan', 'workOrders');
    renderARTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== MODUL FINANCE: ACCOUNT PAYABLE (AP) =====================

function renderAPTable() {
  const tbody = document.getElementById('ap-tbody');
  if (!tbody) return;

  const search = (document.getElementById('filter-ap-search')?.value || '').toLowerCase();
  const suppVal = document.getElementById('filter-ap-supplier')?.value || 'ALL';
  const statusVal = document.getElementById('filter-ap-status')?.value || 'ALL';

  const filtered = apData.filter(a => {
    const matchSearch = !search ||
      a.invoice_no.toLowerCase().includes(search) ||
      (a.supplier_nama || '').toLowerCase().includes(search) ||
      (a.po_no || '').toLowerCase().includes(search) ||
      (a.deskripsi || '').toLowerCase().includes(search);
    const matchSupp = suppVal === 'ALL' || a.supplier_nama === suppVal;
    const matchStatus = statusVal === 'ALL' || a.status === statusVal;
    return matchSearch && matchSupp && matchStatus;
  });

  document.getElementById('ap-record-count').textContent = filtered.length;

  const totalPembelian = filtered.reduce((s, a) => s + Number(a.pembelian), 0);
  const totalHutang = filtered.reduce((s, a) => s + Number(a.pembelian) + Number(a.ppn), 0);
  const totalTerbayar = filtered.reduce((s, a) => s + Number(a.terbayar), 0);
  const totalSisa = filtered.reduce((s, a) => s + Number(a.sisa_hutang), 0);
  document.getElementById('ap-sum-pembelian').textContent = formatRupiah(totalPembelian);
  document.getElementById('ap-sum-hutang').textContent = formatRupiah(totalHutang);
  document.getElementById('ap-sum-terbayar').textContent = formatRupiah(totalTerbayar);
  document.getElementById('ap-sum-sisa').textContent = formatRupiah(totalSisa);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-slate-400 font-semibold">Tidak ada data AP yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageRows('ap', sortRows('ap', filtered)).map(a => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-3 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="printAP(${a.id})" class="text-slate-600 hover:text-slate-800 p-1" title="Print Invoice"><i class="fa-solid fa-print"></i></button>
          <button onclick="openAPModal('edit', ${a.id})" class="text-blue-600 hover:text-blue-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteAP(${a.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-3 font-bold text-slate-800">${esc(a.invoice_no)}</td>
      <td class="py-2.5 px-3">${formatDateID(a.tgl_invoice)}</td>
      <td class="py-2.5 px-3 font-medium">${esc(a.supplier_nama || '-')}</td>
      <td class="py-2.5 px-3 font-semibold">${esc(a.po_no || '-')}</td>
      <td class="py-2.5 px-3 text-slate-600">${esc(a.deskripsi || '-')}</td>
      <td class="py-2.5 px-3 text-right font-medium">${formatRupiah(a.pembelian)}</td>
      <td class="py-2.5 px-3 text-right text-blue-600">${formatRupiah(a.ppn)}</td>
      <td class="py-2.5 px-3 text-right text-indigo-600">${formatRupiah(a.pph23)}</td>
      <td class="py-2.5 px-3 text-center font-semibold">${a.top_days} Hari</td>
      <td class="py-2.5 px-3 font-bold">${formatDateID(a.due_date)}</td>
      <td class="py-2.5 px-3 text-right text-emerald-600 font-bold">${formatRupiah(a.terbayar)}</td>
      <td class="py-2.5 px-3 text-right font-bold text-rose-600">${formatRupiah(a.sisa_hutang)}</td>
      <td class="py-2.5 px-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${cfStatusBadgeClass(a.status)}">${esc(a.status)}</span></td>
    </tr>
  `).join('');
}

function calcAPDueDate() {
  const tglTerima = document.getElementById('ap-tgl-terima').value;
  const topDays = parseInt(document.getElementById('ap-top').value) || 0;
  if (!tglTerima) return;
  const d = new Date(tglTerima);
  d.setDate(d.getDate() + topDays);
  document.getElementById('ap-due-date').value = d.toISOString().slice(0, 10);
}

function calcAPSisa() {
  const pembelian = parseFloat(document.getElementById('ap-pembelian').value) || 0;
  const isPpn = document.getElementById('ap-is-ppn').value === '1';
  const isPph23 = document.getElementById('ap-is-pph23').value === '1';
  const biayaLain = parseFloat(document.getElementById('ap-biaya-lain').value) || 0;
  const terbayar = parseFloat(document.getElementById('ap-terbayar').value) || 0;

  const ppn = isPpn ? pembelian * 0.11 : 0;
  const pph23 = isPph23 ? pembelian * 0.02 : 0;
  const sisa = (pembelian + ppn) - terbayar - pph23 - biayaLain;
  document.getElementById('ap-calc-sisa').textContent = formatRupiah(sisa);
}

function openAPModal(mode, id = null) {
  document.getElementById('ap-form').reset();
  document.getElementById('ap-form-id').value = '';
  updateDropdownOptions();

  const title = document.getElementById('ap-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Record AP';
    document.getElementById('ap-tgl-invoice').value = new Date().toISOString().slice(0, 10);
    document.getElementById('ap-tgl-terima').value = new Date().toISOString().slice(0, 10);
    calcAPDueDate();
    calcAPSisa();
  } else {
    const a = apData.find(x => x.id === id);
    if (!a) return;
    title.textContent = `Edit Record AP - ${a.invoice_no}`;
    document.getElementById('ap-form-id').value = a.id;
    document.getElementById('ap-invoice').value = a.invoice_no;
    document.getElementById('ap-tgl-invoice').value = a.tgl_invoice;
    document.getElementById('ap-tgl-terima').value = a.tgl_terima || a.tgl_invoice;
    document.getElementById('ap-supplier-select').value = a.supplier_id || '';
    document.getElementById('ap-po').value = a.po_no || '';
    document.getElementById('ap-deskripsi').value = a.deskripsi || '';
    document.getElementById('ap-pembelian').value = a.pembelian;
    document.getElementById('ap-is-ppn').value = Number(a.is_ppn) ? '1' : '0';
    document.getElementById('ap-is-pph23').value = Number(a.is_pph23) ? '1' : '0';
    document.getElementById('ap-biaya-lain').value = a.biaya_lain;
    document.getElementById('ap-top').value = a.top_days;
    document.getElementById('ap-faktur-pajak').value = a.faktur_pajak || '';
    document.getElementById('ap-terbayar').value = a.terbayar;
    document.getElementById('ap-tgl-bayar').value = a.tgl_bayar || '';
    document.getElementById('ap-due-date').value = a.due_date || '';
    calcAPSisa();
  }

  document.getElementById('ap-modal').classList.remove('hidden');
}

function closeAPModal() {
  document.getElementById('ap-modal').classList.add('hidden');
}

async function handleAPSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('ap-form-id').value;

  const payload = {
    id: id || undefined,
    invoice_no: document.getElementById('ap-invoice').value.trim().toUpperCase(),
    tgl_invoice: document.getElementById('ap-tgl-invoice').value,
    tgl_terima: document.getElementById('ap-tgl-terima').value,
    supplier_id: document.getElementById('ap-supplier-select').value || null,
    po_no: document.getElementById('ap-po').value,
    deskripsi: document.getElementById('ap-deskripsi').value,
    pembelian: document.getElementById('ap-pembelian').value,
    is_ppn: document.getElementById('ap-is-ppn').value === '1',
    is_pph23: document.getElementById('ap-is-pph23').value === '1',
    biaya_lain: document.getElementById('ap-biaya-lain').value,
    top_days: document.getElementById('ap-top').value,
    due_date: document.getElementById('ap-due-date').value || null,
    faktur_pajak: document.getElementById('ap-faktur-pajak').value,
    terbayar: document.getElementById('ap-terbayar').value,
    tgl_bayar: document.getElementById('ap-tgl-bayar').value || null,
  };

  try {
    if (id) {
      await api('api/account_payable.php', 'PUT', payload);
      showToast('Record AP berhasil diperbarui.');
    } else {
      await api('api/account_payable.php', 'POST', payload);
      showToast('Record AP berhasil ditambahkan.');
    }
    closeAPModal();
    await refresh('apData', 'cashflowCombined', 'danaTalangan');
    renderAPTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteAP(id) {
  if (!(await showConfirm('Hapus record AP ini?'))) return;
  try {
    await api(`api/account_payable.php?id=${id}`, 'DELETE');
    showToast('Record AP berhasil dihapus.');
    await refresh('apData', 'cashflowCombined', 'danaTalangan');
    renderAPTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== MODUL FINANCE: SURAT JALAN (SJ) =====================

async function loadSJTab() {
  try {
    await refresh('sjData');
  } catch (err) {
    showApiError(err);
  }
  renderSJTable();
}

function renderSJTable() {
  const tbody = document.getElementById('sj-tbody');
  if (!tbody) return;
  // Kartu ringkasan jumlah SJ per status
  document.getElementById('sj-summary').innerHTML = Object.entries(SJ_STATUS_CFG).map(([k, c]) => `
    <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
      <span class="text-[10px] font-bold text-slate-400 uppercase block">${esc(c.l)}</span>
      <span class="text-lg font-bold text-slate-800">${sjData.filter(x => x.status === k).length}</span>
    </div>`).join('');

  const rows = tfApply('sj');
  const cols = CAN_NILAI ? 10 : 9;
  if (!sjData.length) {
    tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center py-8 text-slate-400 font-semibold">Belum ada Surat Jalan. Klik "Buat Surat Jalan".</td></tr>`;
    return;
  }
  if (!rows.length) { tbody.innerHTML = tfNoMatchRow(cols); return; }

  tbody.innerHTML = pageRows('sj', rows).map(s => `
    <tr class="hover:bg-slate-50 transition group align-top">
      <td class="py-2.5 px-3 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] whitespace-nowrap">
        <button onclick="printSJ(${s.id})" class="text-slate-600 hover:text-slate-800 p-1" title="Cetak Surat Jalan"><i class="fa-solid fa-print"></i></button>
        <button onclick="openSJModal('edit', ${s.id})" class="text-blue-600 hover:text-blue-800 p-1" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
        <button onclick="deleteSJ(${s.id})" class="text-rose-600 hover:text-rose-800 p-1" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
      </td>
      <td class="py-2.5 px-3 font-semibold whitespace-nowrap">${formatDateID(s.tgl_kirim)}</td>
      <td class="py-2.5 px-3 font-bold text-sky-700 whitespace-nowrap">${esc(s.no_sj)}</td>
      <td class="py-2.5 px-3">
        ${s.wos.length > 1 ? `<span class="inline-block mb-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[9px] font-bold">${s.wos.length} WO</span>` : ''}
        ${s.wos.map(w => `<div class="leading-tight mb-1"><b class="text-indigo-900">${esc(w.wo_number)}</b> <span class="text-slate-500">${esc(w.project || '')}</span></div>`).join('') || '-'}
      </td>
      <td class="py-2.5 px-3 font-medium">${esc(s.customer_nama || '-')}</td>
      <td class="py-2.5 px-3 whitespace-nowrap">${esc(s.po_numbers || '-')}</td>
      ${CAN_NILAI ? `<td class="py-2.5 px-3 text-right font-bold whitespace-nowrap">${formatRupiah(s.nilai_total)}</td>` : ''}
      <td class="py-2.5 px-3">${s.nomor_invoice ? `<span class="font-semibold text-emerald-700">${esc(s.nomor_invoice)}</span>`
        : (s.auto_invoices ? `<span class="text-emerald-700">${esc(s.auto_invoices)}</span> <span class="text-[9px] text-slate-400">(dari AR)</span>` : '<span class="text-slate-400">Belum invoice</span>')}</td>
      <td class="py-2.5 px-3 text-center">${sjStatusBadge(s.status)}</td>
      <td class="py-2.5 px-3 text-slate-600">${esc(s.keterangan || '-')}</td>
    </tr>`).join('');
}

/** Ringkasan otomatis (PO, project, nilai, invoice) dari WO yang dicentang di form SJ. */
function syncSJAutoFields() {
  const wos = workOrders.filter(w => WO_PICK.sj.has(w.id));
  const pos = [...new Set(wos.map(w => (w.po_no || '').trim()).filter(p => p && p !== '-'))];
  document.getElementById('sj-auto-po').textContent = pos.join(', ') || '-';
  document.getElementById('sj-auto-project').textContent = wos.map((w, i) => (wos.length > 1 ? `${i + 1}) ` : '') + (w.project || w.wo_number)).join(' | ') || '-';
  const nilaiEl = document.getElementById('sj-auto-nilai');
  if (nilaiEl) nilaiEl.textContent = formatRupiah(wos.reduce((t, w) => t + (Number(w.nilai_po) || 0), 0));
  const inv = document.getElementById('sj-invoice');
  const autoInv = [...new Set(wos.flatMap(w => w.ar_invoices || []))].join(', ');
  if (!inv.value.trim() || inv.dataset.auto === '1') { inv.value = autoInv; inv.dataset.auto = '1'; }
}

async function fillNextSJNo() {
  try {
    const d = await api('api/surat_jalan.php?action=next_no');
    document.getElementById('sj-no').value = d.no_sj;
  } catch (err) { showApiError(err); }
}

function openSJModal(mode, id = null) {
  document.getElementById('sj-form').reset();
  document.getElementById('sj-form-id').value = '';
  updateDropdownOptions();
  const inv = document.getElementById('sj-invoice');
  inv.dataset.auto = '1';
  inv.oninput = () => { inv.dataset.auto = '0'; };
  const title = document.getElementById('sj-modal-title');
  if (mode === 'add') {
    title.textContent = 'Buat Surat Jalan';
    document.getElementById('sj-tgl').value = new Date().toISOString().slice(0, 10);
    WO_PICK.sj = new Set();
    fillNextSJNo();
  } else {
    const s = sjData.find(x => x.id === id);
    if (!s) return;
    title.textContent = `Edit Surat Jalan - ${s.no_sj}`;
    document.getElementById('sj-form-id').value = s.id;
    document.getElementById('sj-tgl').value = s.tgl_kirim;
    document.getElementById('sj-no').value = s.no_sj;
    document.getElementById('sj-customer-select').value = s.customer_id || (workOrders.find(w => s.wo_ids.includes(w.id)) || {}).customer_id || '';
    document.getElementById('sj-status').value = s.status;
    document.getElementById('sj-keterangan').value = s.keterangan || '';
    inv.value = s.nomor_invoice || '';
    inv.dataset.auto = s.nomor_invoice ? '0' : '1';
    WO_PICK.sj = new Set(s.wo_ids);
  }
  initWOPicker('sj');
  syncSJAutoFields();
  document.getElementById('sj-modal').classList.remove('hidden');
}

function closeSJModal() {
  document.getElementById('sj-modal').classList.add('hidden');
}

async function handleSJSubmit(e) {
  e.preventDefault();
  if (!WO_PICK.sj.size) { showToast('Centang minimal 1 WO untuk Surat Jalan ini.', 'error'); return; }
  const id = document.getElementById('sj-form-id').value;
  const payload = {
    id: id || undefined,
    no_sj: document.getElementById('sj-no').value.trim(),
    tgl_kirim: document.getElementById('sj-tgl').value,
    customer_id: document.getElementById('sj-customer-select').value || null,
    status: document.getElementById('sj-status').value,
    wo_ids: [...WO_PICK.sj],
    nomor_invoice: document.getElementById('sj-invoice').value.trim(),
    keterangan: document.getElementById('sj-keterangan').value.trim(),
  };
  try {
    await api('api/surat_jalan.php', id ? 'PUT' : 'POST', payload);
    showToast(id ? 'Surat Jalan berhasil diperbarui.' : 'Surat Jalan berhasil dibuat.');
    closeSJModal();
    await refresh('sjData', 'workOrders');
    renderSJTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteSJ(id) {
  const s = sjData.find(x => x.id === id);
  if (!(await showConfirm(`Hapus Surat Jalan ${s ? s.no_sj : ''}?`))) return;
  try {
    await api(`api/surat_jalan.php?id=${id}`, 'DELETE');
    showToast('Surat Jalan berhasil dihapus.');
    await refresh('sjData', 'workOrders');
    renderSJTable();
  } catch (err) {
    showApiError(err);
  }
}

function printSJ(id) {
  const s = sjData.find(x => x.id === id);
  if (!s) return;
  const rows = s.wos.map((w, i) => `
    <tr><td class="center">${i + 1}</td><td><b>${esc(w.wo_number)}</b></td><td>${esc(w.project || '-')}</td><td>${esc(w.po_no || '-')}</td>
    ${CAN_NILAI ? `<td class="num">${formatRupiah(w.nilai)}</td>` : ''}</tr>`).join('');
  const body = `
    <div class="print-header">
      <div><div class="company">PANCA PUTRA MADANI</div><div style="color:#64748b;">Sistem Purchasing, Work Order &amp; Keuangan</div></div>
      <div class="doc-no">SURAT JALAN<br><span style="font-size:16px;">${esc(s.no_sj)}</span></div>
    </div>
    <div class="meta-grid">
      <div><span class="lbl">Tanggal Kirim</span> ${formatDateID(s.tgl_kirim)}</div>
      <div><span class="lbl">Status</span> ${esc((SJ_STATUS_CFG[s.status] || {}).l || s.status)}</div>
      <div><span class="lbl">Penerima / Customer</span> ${esc(s.customer_nama || '-')}</div>
      <div><span class="lbl">No. PO</span> ${esc(s.po_numbers || '-')}</div>
      <div><span class="lbl">No. WO</span> ${esc(s.wo_numbers || '-')}</div>
      <div><span class="lbl">No. Invoice</span> ${esc(s.nomor_invoice || s.auto_invoices || '-')}</div>
    </div>
    <h2>Rincian Pekerjaan / Work Order</h2>
    <table>
      <thead><tr><th style="width:30px;">No</th><th>No. WO</th><th>Deskripsi / Nama Project</th><th>No. PO</th>${CAN_NILAI ? '<th class="num">Nilai WO</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody>
      ${CAN_NILAI ? `<tfoot><tr><td colspan="4" class="num"><b>Total</b></td><td class="num"><b>${formatRupiah(s.nilai_total)}</b></td></tr></tfoot>` : ''}
    </table>
    <h2 style="margin-top:14px;">Catatan</h2>
    <div style="border:1px solid #cbd5e1;border-radius:6px;padding:8px;min-height:40px;">${esc(s.keterangan || 'Barang diserahkan dalam kondisi lengkap dan sesuai spesifikasi.')}</div>
    <div class="sign-grid" style="grid-template-columns:repeat(4,1fr);">
      <div class="box">Pengirim (Logistik)</div><div class="box">Driver / Ekspedisi</div>
      <div class="box">Penerima (Customer)</div><div class="box">Finance</div>
    </div>`;
  openPrintWindow(`Surat Jalan ${s.no_sj}`, body);
}

function exportSJExcel() {
  if (typeof XLSX === 'undefined') { showToast('Library Excel belum termuat, coba lagi.', 'error'); return; }
  const rows = tfApply('sj');
  if (!rows.length) { showToast('Tidak ada data Surat Jalan untuk diexport.', 'error'); return; }
  const head = ['No SJ', 'Tgl Kirim', 'No WO', 'Customer', 'Nama Project', 'No PO', ...(CAN_NILAI ? ['Nilai WO'] : []), 'Nomor Invoice', 'Status', 'Keterangan'];
  const data = rows.map(s => [s.no_sj, s.tgl_kirim, s.wo_numbers, s.customer_nama || '', s.projects, s.po_numbers,
    ...(CAN_NILAI ? [Number(s.nilai_total) || 0] : []), s.nomor_invoice || s.auto_invoices || '', (SJ_STATUS_CFG[s.status] || {}).l || s.status, s.keterangan || '']);
  const ws = XLSX.utils.aoa_to_sheet([head, ...data]);
  ws['!cols'] = head.map((h, i) => ({ wch: [16, 12, 24, 28, 40, 20][i] || 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Surat Jalan');
  XLSX.writeFile(wb, `Surat_Jalan_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast(`Export Surat Jalan berhasil (${rows.length} data).`);
}

// ===================== MODUL FINANCE: DANA TALANGAN =====================

function renderTalanganTable() {
  const tbody = document.getElementById('talangan-tbody');
  const rows = tfApply('talangan');
  if (!tbody) return;

  let sumPinjaman = 0, sumTerbayar = 0, sumSisa = 0;
  rows.forEach(t => {
    sumPinjaman += Number(t.pinjaman);
    sumTerbayar += Number(t.pelunasan);
    sumSisa += Math.max(0, Number(t.sisa));
  });
  document.getElementById('talangan-sum-pinjaman').textContent = formatRupiah(sumPinjaman);
  document.getElementById('talangan-sum-terbayar').textContent = formatRupiah(sumTerbayar);
  document.getElementById('talangan-sum-sisa').textContent = formatRupiah(sumSisa);

  if (danaTalangan.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Dana Talangan.</td></tr>`;
    return;
  }

  const statusBadge = { LUNAS: 'bg-emerald-100 text-emerald-700', PARTIAL: 'bg-blue-100 text-blue-700', PENDING: 'bg-amber-100 text-amber-700' };

  if (rows.length === 0) {
    tbody.innerHTML = tfNoMatchRow(10);
    return;
  }
  tbody.innerHTML = pageRows('talangan', rows).map(t => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-3 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="openTalanganModal('edit', ${t.id})" class="text-blue-600 hover:text-blue-800 p-1"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteTalangan(${t.id})" class="text-rose-600 hover:text-rose-800 p-1"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-3 font-bold text-blue-600">${esc(t.no_dt)}</td>
      <td class="py-2.5 px-3 font-semibold">${formatDateID(t.tanggal)}</td>
      <td class="py-2.5 px-3 font-medium">${esc(t.pic)}</td>
      <td class="py-2.5 px-3 text-slate-600">${esc(t.deskripsi)}</td>
      <td class="py-2.5 px-3 text-right font-bold">${formatRupiah(t.pinjaman)}</td>
      <td class="py-2.5 px-3 text-right text-emerald-600 font-bold">${formatRupiah(t.pelunasan)}</td>
      <td class="py-2.5 px-3 text-right font-bold text-amber-600">${formatRupiah(Math.max(0, t.sisa))}</td>
      <td class="py-2.5 px-3">${formatDateID(t.tgl_penggantian)}</td>
      <td class="py-2.5 px-3 text-center"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${statusBadge[t.status] || 'bg-slate-100 text-slate-600'}">${esc(t.status)}</span></td>
    </tr>
  `).join('');
}

function openTalanganModal(mode, id = null) {
  document.getElementById('talangan-form').reset();
  document.getElementById('talangan-form-id').value = '';

  const title = document.getElementById('talangan-modal-title');
  if (mode === 'add') {
    title.textContent = 'Tambah Dana Talangan';
    document.getElementById('talangan-tanggal').value = new Date().toISOString().slice(0, 10);
  } else {
    const t = danaTalangan.find(x => x.id === id);
    if (!t) return;
    title.textContent = `Edit Dana Talangan - ${t.no_dt}`;
    document.getElementById('talangan-form-id').value = t.id;
    document.getElementById('talangan-no').value = t.no_dt;
    document.getElementById('talangan-tanggal').value = t.tanggal;
    document.getElementById('talangan-pic').value = t.pic;
    document.getElementById('talangan-pinjaman').value = t.pinjaman;
    document.getElementById('talangan-deskripsi').value = t.deskripsi;
    document.getElementById('talangan-tgl-penggantian').value = t.tgl_penggantian || '';
  }

  document.getElementById('talangan-modal').classList.remove('hidden');
}

function closeTalanganModal() {
  document.getElementById('talangan-modal').classList.add('hidden');
}

async function handleTalanganSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('talangan-form-id').value;
  const payload = {
    id: id || undefined,
    no_dt: document.getElementById('talangan-no').value,
    tanggal: document.getElementById('talangan-tanggal').value,
    pic: document.getElementById('talangan-pic').value,
    pinjaman: document.getElementById('talangan-pinjaman').value,
    deskripsi: document.getElementById('talangan-deskripsi').value,
    tgl_penggantian: document.getElementById('talangan-tgl-penggantian').value || null,
  };

  try {
    if (id) {
      await api('api/dana_talangan.php', 'PUT', payload);
      showToast('Dana Talangan berhasil diperbarui.');
    } else {
      await api('api/dana_talangan.php', 'POST', payload);
      showToast('Dana Talangan berhasil ditambahkan.');
    }
    closeTalanganModal();
    await refresh('danaTalangan');
    renderTalanganTable();
  } catch (err) {
    showApiError(err);
  }
}

async function deleteTalangan(id) {
  if (!(await showConfirm('Hapus data Dana Talangan ini?'))) return;
  try {
    await api(`api/dana_talangan.php?id=${id}`, 'DELETE');
    showToast('Dana Talangan berhasil dihapus.');
    await refresh('danaTalangan');
    renderTalanganTable();
  } catch (err) {
    showApiError(err);
  }
}

// ===================== FINANCE DASHBOARD =====================

function renderFinanceDashboard() {
  const monthVal = document.getElementById('findash-filter-month')?.value || 'ALL';
  const yearVal = document.getElementById('findash-filter-year')?.value || 'ALL';
  const filterByDate = (dateStr) => filterByMonthYearJS(dateStr, monthVal, yearVal);

  // --- Saldo Kas ---
  const currentSaldo = cashflowCombined.length > 0 ? cashflowCombined[cashflowCombined.length - 1].saldo : 0;
  document.getElementById('findash-saldo-kas').textContent = formatRupiah(currentSaldo);

  // --- AR ---
  const filteredAR = arData.filter(a => filterByDate(a.tgl_invoice) || filterByDate(a.due_date));
  const totalARPenjualan = filteredAR.reduce((acc, a) => acc + Number(a.penjualan) + Number(a.ppn), 0);
  const totalSisaAR = filteredAR.reduce((acc, a) => acc + Number(a.sisa_piutang), 0);
  document.getElementById('findash-sisa-ar').textContent = formatRupiah(totalSisaAR);
  document.getElementById('findash-sub-ar').textContent = `Total Penjualan: ${formatRupiah(totalARPenjualan)}`;

  // --- AP ---
  const filteredAP = apData.filter(a => filterByDate(a.tgl_invoice) || filterByDate(a.due_date));
  const totalAPPembelian = filteredAP.reduce((acc, a) => acc + Number(a.pembelian) + Number(a.ppn), 0);
  const totalSisaAP = filteredAP.reduce((acc, a) => acc + Number(a.sisa_hutang), 0);
  const totalTerbayarAP = filteredAP.reduce((acc, a) => acc + Number(a.terbayar), 0);
  document.getElementById('findash-sisa-ap').textContent = formatRupiah(totalSisaAP);
  document.getElementById('findash-sub-ap').textContent = `Total Pembelian: ${formatRupiah(totalAPPembelian)}`;

  const apPctTerbayar = totalAPPembelian > 0 ? Math.round((totalTerbayarAP / totalAPPembelian) * 100) : 0;
  const apPctPending = 100 - apPctTerbayar;
  document.getElementById('findash-ap-pct-terbayar').textContent = `${apPctTerbayar}%`;
  document.getElementById('findash-ap-bar-terbayar').style.width = `${apPctTerbayar}%`;
  document.getElementById('findash-ap-val-terbayar').textContent = formatRupiah(totalTerbayarAP);
  document.getElementById('findash-ap-pct-pending').textContent = `${apPctPending}%`;
  document.getElementById('findash-ap-bar-pending').style.width = `${apPctPending}%`;
  document.getElementById('findash-ap-val-pending').textContent = formatRupiah(totalSisaAP);
  document.getElementById('findash-ap-stat-total').textContent = formatRupiah(totalAPPembelian);
  document.getElementById('findash-ap-stat-badge').textContent = apPctPending === 0 ? 'TERBAYAR LUNAS' : (apPctTerbayar > 0 ? 'PARTIAL' : 'PENDING');

  // --- Sisa Dana Talangan ---
  const totalSisaTalangan = danaTalangan.reduce((acc, t) => acc + Math.max(0, Number(t.sisa)), 0);
  document.getElementById('findash-sisa-talangan').textContent = formatRupiah(totalSisaTalangan);

  // --- Alerts ---
  const alertContainer = document.getElementById('findash-alerts-container');
  const today = new Date();
  const overdueAR = arData.filter(a => Number(a.sisa_piutang) > 0 && a.due_date && new Date(a.due_date) < today).length;
  const overdueAP = apData.filter(a => Number(a.sisa_hutang) > 0 && a.due_date && new Date(a.due_date) < today).length;
  let alertsHtml = '';
  if (overdueAR > 0) {
    alertsHtml += `<div class="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-r-xl flex items-center justify-between text-xs text-amber-800">
      <div class="flex items-center gap-2"><i class="fa-solid fa-triangle-exclamation text-amber-600"></i><span><b>PERHATIAN PIUTANG:</b> ${overdueAR} Invoice AR telah melewati Due Date!</span></div>
      <button onclick="switchTab('ar')" class="font-bold underline text-amber-900">Lihat AR</button>
    </div>`;
  }
  if (overdueAP > 0) {
    alertsHtml += `<div class="bg-rose-50 border-l-4 border-rose-500 p-3 rounded-r-xl flex items-center justify-between text-xs text-rose-800">
      <div class="flex items-center gap-2"><i class="fa-solid fa-circle-exclamation text-rose-600"></i><span><b>PERINGATAN HUTANG:</b> ${overdueAP} Invoice AP telah jatuh tempo!</span></div>
      <button onclick="switchTab('ap')" class="font-bold underline text-rose-900">Lihat AP</button>
    </div>`;
  }
  alertContainer.innerHTML = alertsHtml;

  // --- Chart: Cashflow Trend ---
  const cfFiltered = cashflowCombined.filter(c => filterByDate(c.tanggal)).slice(-10);
  const ctxTrend = document.getElementById('chart-cashflow-trend').getContext('2d');
  if (chartCashflowTrendInstance) chartCashflowTrendInstance.destroy();
  chartCashflowTrendInstance = new Chart(ctxTrend, {
    type: 'bar',
    data: {
      labels: cfFiltered.length > 0 ? cfFiltered.map(c => formatDateID(c.tanggal)) : ['No Data'],
      datasets: [
        { label: 'Debit (Kas Masuk)', data: cfFiltered.map(c => c.debit), backgroundColor: 'rgba(16,185,129,0.85)', borderRadius: 6 },
        { label: 'Kredit (Kas Keluar)', data: cfFiltered.map(c => c.kredit), backgroundColor: 'rgba(244,63,94,0.85)', borderRadius: 6 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });

  // --- Chart: AR Aging ---
  let age0_30 = 0, age31_60 = 0, age61_90 = 0, age90plus = 0;
  arData.forEach(a => {
    if (Number(a.sisa_piutang) > 0 && a.due_date) {
      const diffDays = Math.ceil((today - new Date(a.due_date)) / 86400000);
      if (diffDays <= 30) age0_30 += Number(a.sisa_piutang);
      else if (diffDays <= 60) age31_60 += Number(a.sisa_piutang);
      else if (diffDays <= 90) age61_90 += Number(a.sisa_piutang);
      else age90plus += Number(a.sisa_piutang);
    }
  });
  const ctxAging = document.getElementById('chart-ar-aging').getContext('2d');
  if (chartArAgingInstance) chartArAgingInstance.destroy();
  chartArAgingInstance = new Chart(ctxAging, {
    type: 'bar',
    data: {
      labels: ['Current (0-30 Hr)', '31-60 Hari', '61-90 Hari', '> 90 Hari'],
      datasets: [{ label: 'Sisa Piutang (Rp)', data: [age0_30, age31_60, age61_90, age90plus], backgroundColor: ['#3b82f6', '#f59e0b', '#f97316', '#ef4444'], borderRadius: 6 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  // --- Chart: WO Pipeline ---
  let woLunas = 0, woPending = 0, woBelum = 0, woLunasVal = 0, woPendingVal = 0, woBelumVal = 0;
  workOrders.forEach(w => {
    if (w.invoice_status === 'LUNAS') { woLunas++; woLunasVal += Number(w.wo_total); }
    else if (w.invoice_status === 'PENDING') { woPending++; woPendingVal += Number(w.wo_total); }
    else { woBelum++; woBelumVal += Number(w.wo_total); }
  });
  // Nilai jual WO hanya untuk role berizin "Lihat Nilai PO"; lainnya cukup jumlah WO.
  const woVal = (v, n) => CAN_NILAI ? formatRupiah(v) : `${n} WO`;
  document.getElementById('findash-wo-val-lunas').textContent = woVal(woLunasVal, woLunas);
  document.getElementById('findash-wo-val-pending').textContent = woVal(woPendingVal, woPending);
  document.getElementById('findash-wo-val-belum').textContent = woVal(woBelumVal, woBelum);

  const ctxWO = document.getElementById('chart-wo-pipeline').getContext('2d');
  if (chartWOPipelineInstance) chartWOPipelineInstance.destroy();
  chartWOPipelineInstance = new Chart(ctxWO, {
    type: 'doughnut',
    data: {
      labels: [`Lunas Invoiced (${woLunas})`, `Pending Invoice (${woPending})`, `Belum Terinvoice (${woBelum})`],
      datasets: [{ data: [woLunas, woPending, woBelum], backgroundColor: ['#10b981', '#f59e0b', '#94a3b8'] }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } },
  });
}

// ===================== DASHBOARD OVERVIEW (gabungan Purchasing + Finance) =====================

let chartOverviewPurchasingInstance = null;
let chartOverviewFinanceInstance = null;

function renderOverviewDashboard() {
  // Sapaan + tanggal hari ini.
  const greeting = document.getElementById('overview-greeting');
  const dateEl = document.getElementById('overview-date');
  if (greeting) greeting.textContent = `Selamat datang, ${currentUser ? currentUser.full_name : ''}`;
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  // --- KPI gabungan ---
  // Kartu KPI hanya dirender kalau role punya akses modulnya (lihat index.php).
  const setText = (elId, text) => { const el = document.getElementById(elId); if (el) el.textContent = text; };

  const totalPurchasing = prItems.filter(p => p.status !== 'CANCEL').reduce((s, p) => s + (Number(p.total) || 0), 0);
  setText('ov-total-purchasing', formatRupiah(totalPurchasing));

  const saldoKas = cashflowCombined.length > 0 ? cashflowCombined[cashflowCombined.length - 1].saldo : 0;
  setText('ov-saldo-kas', formatRupiah(saldoKas));

  const sisaAR = arData.reduce((s, a) => s + (Number(a.sisa_piutang) || 0), 0);
  setText('ov-sisa-ar', formatRupiah(sisaAR));

  const sisaAP = apData.reduce((s, a) => s + (Number(a.sisa_hutang) || 0), 0);
  setText('ov-sisa-ap', formatRupiah(sisaAP));

  // --- Chart Purchasing: pengeluaran per supplier (ambil dari data PR yang sudah dimuat) ---
  const supplierSpend = {};
  prItems.filter(p => p.status !== 'CANCEL').forEach(p => {
    const supp = p.supplier_nama || 'Unassigned';
    supplierSpend[supp] = (supplierSpend[supp] || 0) + (Number(p.total) || 0);
  });
  const canvasPurchasing = document.getElementById('chart-overview-purchasing');
  if (canvasPurchasing) {
    const ctx = canvasPurchasing.getContext('2d');
    if (chartOverviewPurchasingInstance) chartOverviewPurchasingInstance.destroy();
    chartOverviewPurchasingInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: Object.keys(supplierSpend).length ? Object.keys(supplierSpend) : ['Belum ada data'],
        datasets: [{ label: 'Total (Rp)', data: Object.values(supplierSpend), backgroundColor: '#4f46e5', borderRadius: 6 }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  }

  // --- Chart Finance: tren debit/kredit cashflow (10 transaksi terakhir) ---
  const cfRecent = cashflowCombined.slice(-10);
  const canvasFinance = document.getElementById('chart-overview-finance');
  if (canvasFinance) {
    const ctx = canvasFinance.getContext('2d');
    if (chartOverviewFinanceInstance) chartOverviewFinanceInstance.destroy();
    chartOverviewFinanceInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: cfRecent.length ? cfRecent.map(c => formatDateID(c.tanggal)) : ['Belum ada data'],
        datasets: [
          { label: 'Debit (Masuk)', data: cfRecent.map(c => c.debit), backgroundColor: 'rgba(16,185,129,0.85)', borderRadius: 6 },
          { label: 'Kredit (Keluar)', data: cfRecent.map(c => c.kredit), backgroundColor: 'rgba(244,63,94,0.85)', borderRadius: 6 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } },
    });
  }
}


// ===================== AKUN SAYA =====================
async function openAccountModal() {
  document.getElementById('account-password-form').reset();
  document.getElementById('account-modal').classList.remove('hidden');
  const list = document.getElementById('account-access-list');
  list.textContent = 'Memuat...';
  try {
    const me = await api('api/account.php');
    if (me.is_admin) {
      list.innerHTML = '<span class="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-100 font-bold">Akses Admin Penuh &mdash; semua menu + Administrator</span>';
    } else if (!me.access.length) {
      list.innerHTML = '<span class="text-amber-700">Belum ada menu yang diizinkan untuk role Anda. Hubungi admin.</span>';
    } else {
      list.innerHTML = me.access.map(g => `
        <div class="border border-slate-200 rounded-lg px-3 py-2">
          <div class="font-bold text-slate-700 text-[11px] uppercase mb-1">${esc(g.module)}</div>
          <div class="flex flex-wrap gap-1.5">${g.menus.map(m => `
            <span class="px-2 py-0.5 rounded-full border text-[10px] font-semibold ${m.level === 'edit' ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-slate-100 text-slate-600 border-slate-200'}">
              ${esc(m.menu)}${g.module === 'Akses Data Sensitif' ? '' : ` &middot; ${m.level === 'edit' ? 'Lihat &amp; Ubah' : 'Lihat saja'}`}
            </span>`).join('')}</div>
        </div>`).join('');
    }
  } catch (err) {
    list.textContent = err.message;
  }
}

function closeAccountModal() {
  document.getElementById('account-modal').classList.add('hidden');
}

async function handleChangeOwnPassword(e) {
  e.preventDefault();
  const btn = document.getElementById('acc-submit-btn');
  btn.disabled = true;
  try {
    await api('api/account.php?action=change_password', 'POST', {
      current_password: document.getElementById('acc-current-password').value,
      new_password: document.getElementById('acc-new-password').value,
      confirm_password: document.getElementById('acc-confirm-password').value,
    });
    showToast('Password berhasil diganti.');
    closeAccountModal();
    // Muat ulang supaya peringatan "password lemah" hilang & sesi baru dipakai.
    setTimeout(() => window.location.reload(), 900);
  } catch (err) {
    showApiError(err);
  } finally {
    btn.disabled = false;
  }
}

// ===================== MENU USER (header) =====================
function toggleUserMenu(e) {
  e.stopPropagation();
  document.getElementById('user-menu-panel').classList.toggle('hidden');
}
function closeUserMenu() {
  const panel = document.getElementById('user-menu-panel');
  if (panel) panel.classList.add('hidden');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#user-menu')) closeUserMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeUserMenu(); });


// ===================== EXPORT EXCEL: MTC PRODUKSI =====================
/**
 * Export biaya MTC ke Excel (3 sheet):
 *   1. Rekap per WO      : nilai PO, biaya per divisi, total biaya, margin
 *   2. Rincian Pekerjaan : semua baris pekerjaan per divisi (manual + otomatis PR/Seal/Transport)
 *   3. Rekap per Item    : budget vs aktual tiap Item Pekerjaan WO
 * woId diisi  -> hanya WO itu (tombol di Modul Divisi Produksi).
 * woId kosong -> WO yang sedang tampil di Dashboard MTC (ikut pencarian & urutan).
 */
async function exportMTCExcel(woId = null) {
  if (typeof XLSX === 'undefined') {
    showToast('Library Excel belum termuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
    return;
  }
  let data;
  try {
    data = await api('api/mtc.php?resource=dashboard'); // selalu ambil data terbaru
  } catch (err) {
    showApiError(err);
    return;
  }

  let wos;
  if (woId) {
    wos = data.filter(w => String(w.wo_id) === String(woId));
  } else {
    const search = (document.getElementById('mtc-dash-search')?.value || '').toLowerCase();
    wos = sortRows('mtcdash', data.filter(w =>
      !search || w.wo_number.toLowerCase().includes(search) || (w.project || '').toLowerCase().includes(search) || (w.customer_nama || '').toLowerCase().includes(search)));
  }
  if (!wos.length) {
    showToast(woId ? 'WO ini belum punya rincian biaya MTC untuk diexport.' : 'Tidak ada data MTC untuk diexport.', 'error');
    return;
  }

  const num = v => Math.round((Number(v) || 0) * 100) / 100; // 2 desimal, hindari 17025.400000000023
  const divisi = mtcDivisiList.length ? mtcDivisiList : [...new Set(wos.flatMap(w => [
    ...w.items.flatMap(it => it.divisi_records.map(r => r.divisi)), ...(w.auto_records || []).map(a => a.divisi)]))];
  const woInfo = w => [w.wo_number, w.project || '', w.customer_nama || '', w.status || ''];

  // ---- Sheet 1: Rekap per WO
  const rekap = [['No WO', 'Project', 'Customer', 'Status WO', 'Nilai PO', ...divisi, 'Total Biaya', 'Margin', 'Margin %']];
  const totals = { po: 0, cost: 0, div: Object.fromEntries(divisi.map(d => [d, 0])) };
  wos.forEach(w => {
    const perDiv = Object.fromEntries(divisi.map(d => [d, 0]));
    w.items.forEach(it => it.divisi_records.forEach(r => { if (r.divisi in perDiv) perDiv[r.divisi] += num(r.total_biaya); }));
    (w.auto_records || []).forEach(a => { if (a.divisi in perDiv) perDiv[a.divisi] += num(a.total_biaya); });
    const po = num(w.nilai_po), cost = num(w.total_biaya);
    rekap.push([...woInfo(w), po, ...divisi.map(d => perDiv[d]), cost, num(po - cost), po ? (po - cost) / po : 0]);
    totals.po += po; totals.cost += cost;
    divisi.forEach(d => { totals.div[d] += perDiv[d]; });
  });
  rekap.push(['TOTAL', '', '', '', totals.po, ...divisi.map(d => totals.div[d]), num(totals.cost), num(totals.po - totals.cost), totals.po ? (totals.po - totals.cost) / totals.po : 0]);

  // ---- Sheet 2: Rincian Pekerjaan
  const rincian = [['No WO', 'Project', 'Customer', 'Item Pekerjaan', 'Divisi', 'Sumber', 'Status Workflow', 'PIC', 'No. Surat Jalan',
    'Pekerjaan', 'Deskripsi', 'Qty', 'Satuan', 'Kode Mesin', 'Harga/Satuan', 'Total', 'Status']];
  wos.forEach(w => {
    w.items.forEach(it => it.divisi_records.forEach(r => (r.items || []).forEach(line => {
      rincian.push([w.wo_number, w.project || '', w.customer_nama || '', it.nama_item, r.divisi, 'Manual (MTC)', r.status_workflow || '',
        r.pic || '', r.surat_jalan || '', line.pekerjaan || '', line.deskripsi || '', num(line.qty), line.satuan || '',
        line.kode_mesin || '', num(line.harga), num(line.total), line.status || '']);
    })));
    (w.auto_records || []).forEach(a => a.lines.forEach(line => {
      rincian.push([w.wo_number, w.project || '', w.customer_nama || '', '(Otomatis)', a.divisi, `Otomatis - ${a.sumber}`, '',
        line.pic || '', '', line.pekerjaan || '', line.deskripsi || '', num(line.qty), line.satuan || '',
        '', num(line.harga), num(line.total), line.status || '']);
    }));
  });
  const rincianTotal = num(rincian.slice(1).reduce((s, r) => s + r[15], 0));
  rincian.push(['TOTAL', '', '', '', '', '', '', '', '', '', '', '', '', '', '', rincianTotal, '']);

  // ---- Sheet 3: Rekap per Item Pekerjaan (budget vs aktual)
  const perItem = [['No WO', 'Project', 'Item Pekerjaan', 'Qty', 'Budget', 'Aktual (MTC)', 'Selisih (Budget - Aktual)', 'Status Item']];
  wos.forEach(w => w.items.forEach(it => {
    perItem.push([w.wo_number, w.project || '', it.nama_item, num(it.qty), num(it.budget), num(it.aktual), num(num(it.budget) - num(it.aktual)), it.status || '']);
  }));

  // ---- Format: lebar kolom, angka ribuan, persen, baris header & total tebal
  const sheet = (rows, moneyCols, pctCols = [], widths = {}) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 0; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!cell || cell.t !== 'n') continue;
        if (moneyCols.includes(C)) cell.z = '#,##0';
        else if (pctCols.includes(C)) cell.z = '0.0%';
      }
    }
    ws['!cols'] = rows[0].map((h, i) => ({ wch: widths[i] || Math.max(10, Math.min(40, String(h).length + 4)) }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: range.e.r - (rows[rows.length - 1][0] === 'TOTAL' ? 1 : 0), c: range.e.c } }) };
    return ws;
  };
  const wb = XLSX.utils.book_new();
  if (CAN_NILAI) {
    const divCols = divisi.map((_, i) => 5 + i);
    XLSX.utils.book_append_sheet(wb, sheet(rekap, [4, ...divCols, 5 + divisi.length, 6 + divisi.length], [7 + divisi.length], { 1: 36, 2: 28 }), 'Rekap per WO');
  } else {
    // Tanpa izin Nilai PO: buang kolom Nilai PO, Margin & Margin % dari file.
    const rekapNoNilai = rekap.map(r => [...r.slice(0, 4), ...r.slice(5, r.length - 2)]);
    const divCols = divisi.map((_, i) => 4 + i);
    XLSX.utils.book_append_sheet(wb, sheet(rekapNoNilai, [...divCols, 4 + divisi.length], [], { 1: 36, 2: 28 }), 'Rekap per WO');
  }
  XLSX.utils.book_append_sheet(wb, sheet(rincian, [14, 15], [], { 1: 32, 2: 26, 3: 20, 4: 18, 5: 22, 9: 28, 10: 30 }), 'Rincian Pekerjaan');
  XLSX.utils.book_append_sheet(wb, sheet(perItem, [4, 5, 6], [], { 1: 36, 2: 24 }), 'Rekap per Item');

  const today = new Date().toISOString().slice(0, 10);
  const label = woId ? `WO_${String(wos[0].wo_number).replace(/[^\w-]+/g, '_')}` : `${wos.length}_WO`;
  XLSX.writeFile(wb, `MTC_Produksi_${label}_${today}.xlsx`);
  showToast(`Export Excel MTC berhasil (${wos.length} WO, ${rincian.length - 2} baris pekerjaan).`);
}


// ===================== IMPORT EXCEL: PEKERJAAN MTC =====================
async function handleMTCImportUpload() {
  const input = document.getElementById('mtc-import-file');
  const btn = document.getElementById('mtc-import-btn');
  const box = document.getElementById('mtc-import-result');
  if (!input.files || !input.files.length) { showToast('Pilih file .xlsx dulu.', 'error'); return; }

  const form = new FormData();
  form.append('type', 'mtc');
  form.append('file', input.files[0]);
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengimport...';
  box.classList.add('hidden');
  try {
    const res = await fetch('api/import.php', { method: 'POST', body: form, credentials: 'same-origin', headers: { 'X-CSRF-Token': CSRF_TOKEN } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(`Respons server tidak valid (HTTP ${res.status}).`); }
    if (!res.ok || !data.success) throw new Error(data.message || 'Import gagal.');

    const d = data.data;
    box.className = 'text-xs rounded-lg p-3 border space-y-2 ' + (d.gagal > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200');
    box.innerHTML = `<div class="font-bold ${d.gagal > 0 ? 'text-amber-800' : 'text-emerald-800'}">
        ${d.berhasil} pekerjaan berhasil diimport &middot; ${d.dilewati} dilewati (sudah ada / contoh) &middot; ${d.gagal} gagal</div>` +
      (d.errors && d.errors.length ? '<div class="max-h-48 overflow-y-auto bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">' +
        d.errors.map(e => `<div class="px-3 py-1.5"><span class="font-bold text-rose-600">Baris ${e.baris}:</span> ${esc(e.pesan)}</div>`).join('') + '</div>' : '');
    box.classList.remove('hidden');

    if (d.berhasil > 0) {
      showToast(`${d.berhasil} pekerjaan MTC berhasil diimport.`);
      input.value = '';
      await refresh('workOrders'); // Aktual Item Pekerjaan ikut berubah
      if (mtcCurrentWOId) handleMTCDivisiWOChange();
    }
  } catch (err) {
    showApiError(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload &amp; Import';
  }
}
