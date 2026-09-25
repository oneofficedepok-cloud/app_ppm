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
  try {
    json = await res.json();
  } catch (err) {
    throw new Error('Respons server tidak valid.');
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
function formatRupiah(num) {
  return 'Rp ' + (Number(num) || 0).toLocaleString('id-ID');
}

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
      <div class="box">Atasan / Leader<div class="nm">${esc(head.atasan_karyawan_nama || head.leader_nama || '')}</div></div>
      <div class="box">Manager Purchasing<div class="nm">${esc(head.manager_karyawan_nama || head.manager_nama || '')}</div></div>
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
    <h2>Perhitungan Nilai Jual</h2>
    <table>
      <thead><tr><th>Qty</th><th>Satuan</th><th class="num">Harga Satuan</th><th class="num">Diskon</th><th class="num">DPP</th><th class="num">PPN</th><th class="num">PPh23</th><th class="num">Total</th></tr></thead>
      <tbody><tr>
        <td class="center">${formatQty(w.qty)}</td><td class="center">${esc(w.satuan)}</td>
        <td class="num">${formatRupiah(w.harga_satuan)}</td><td class="num">${formatRupiah(w.diskon)}</td>
        <td class="num">${formatRupiah(w.nilai_po)}</td><td class="num">${formatRupiah(w.ppn)}</td>
        <td class="num">${formatRupiah(w.pph23)}</td><td class="num" style="font-weight:800;">${formatRupiah(w.wo_total)}</td>
      </tr></tbody>
    </table>
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
      <div class="grand"><span>PROFIT / LOSS</span><span>${formatRupiah(w.profit_loss)}</span></div>
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
      <div><span class="lbl">No. WO</span> ${esc(a.wo_number || '-')}</div>
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
  findash: 'finance', cashflow: 'finance', ar: 'finance', ap: 'finance', talangan: 'finance',
  mtcdash: 'mtc', mtcdivisi: 'mtc', mtcmaster: 'mtc',
  admin: 'admin',
};
const SECTION_TABS = {
  purchasing: ['dashboard', 'transport'],
  produksi: ['tracking', 'seal'],
  masterdata: ['customers', 'suppliers', 'master'],
  gudang: ['stok', 'incoming', 'receiving', 'produksi', 'riwayat'],
  finance: ['findash', 'cashflow', 'ar', 'ap', 'talangan'],
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
    roles = rolesData.roles; appModules = rolesData.modules;
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
    roles: async () => { const d = await api('api/roles.php'); roles = d.roles; appModules = d.modules; },
    arData: async () => (arData = await apiIf(READ_RULES.ar(), 'api/account_receivable.php')),
    apData: async () => (apData = await apiIf(READ_RULES.ap(), 'api/account_payable.php')),
    danaTalangan: async () => (danaTalangan = await apiIf(READ_RULES.talangan(), 'api/dana_talangan.php')),
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
  const arCustSel = document.getElementById('ar-customer-select');
  if (arCustSel) {
    const cur = arCustSel.value;
    arCustSel.innerHTML = '<option value="">-- Pilih Customer --</option>' + customers.map(c => opt(c.id, c.nama)).join('');
    if (cur) arCustSel.value = cur;
  }
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
    if (approval !== 'ALL' && p.approval_status !== approval) return false;
    if (search) {
      const haystack = `${p.pr_number} ${p.wo_number || ''} ${p.po_number || ''} ${p.invoice_number || ''} ${p.customer_nama || ''} ${p.project || ''} ${p.product || ''} ${p.type || ''} ${p.dimensi || ''} ${p.brand || ''} ${p.supplier_nama || ''} ${p.user_nama || ''}`.toLowerCase();
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
  document.getElementById('kpi-received-count').textContent = receivedCount;
  document.getElementById('kpi-received-percent').textContent = (totalItems ? Math.round(receivedCount / totalItems * 100) : 0) + '% item';
  document.getElementById('kpi-cancel-count').textContent = cancelCount;
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

// ===================== ALUR APPROVAL: Buyer buat -> Leader cek -> Manager Purchasing approve =====================
const APPROVAL_LABELS = {
  PENDING_LEADER: 'Menunggu Leader',
  PENDING_MANAGER: 'Menunggu Manager',
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
  const canAct = currentUser.is_admin;

  if (p.approval_status === 'PENDING_LEADER' && (canAct || currentUser.role === 'leader')) {
    return `<button onclick="openApprovalModal(${p.id})" class="px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold" title="Cek sebagai Leader"><i class="fa-solid fa-magnifying-glass"></i> Cek</button>`;
  }
  if (p.approval_status === 'PENDING_MANAGER' && (canAct || currentUser.role === 'manager_purchasing')) {
    return `<button onclick="openApprovalModal(${p.id})" class="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold" title="Approve sebagai Manager Purchasing"><i class="fa-solid fa-stamp"></i> Approve</button>`;
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

function renderPRTable() {
  const SHEET_BADGE = {
    PROJECT: 'bg-indigo-100 text-indigo-800', GENERAL: 'bg-slate-200 text-slate-700',
    CONSUMABLE: 'bg-emerald-100 text-emerald-800', MAINTENANCE: 'bg-amber-100 text-amber-800', INVENTARIS: 'bg-purple-100 text-purple-800',
  };
  const tbody = document.getElementById('pr-table-body');
  const filtered = getFilteredPRData();
  document.getElementById('table-count').textContent = `${filtered.length} Items`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="17" class="text-center py-8 text-slate-400 font-semibold">Tidak ada data Purchasing Request yang cocok.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => `
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
      <td class="py-2.5 px-3 text-center"><span class="px-2 py-1 rounded-full text-[10px] uppercase font-bold ${statusBadgeClass(p.status)}">${esc(p.status)}</span></td>
      <td class="py-2.5 px-3 text-center bg-rose-50/30">
        <span class="px-2 py-1 rounded-full text-[10px] uppercase font-bold ${approvalBadgeClass(p.approval_status)}" title="${p.approval_status === 'REJECTED' ? esc((p.leader_note || p.manager_note) ? 'Catatan: ' + (p.manager_note || p.leader_note) : '') : ''}">${approvalLabel(p.approval_status)}</span>
        <div class="mt-1">${approvalActionButton(p)}</div>
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
    document.getElementById('form-customer').value = p.customer_nama || '';
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

// ===================== ALUR APPROVAL PR (Cek Leader / Approve Manager) =====================

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
    title.textContent = 'Cek PR (sebagai Leader)';
    approveBtn.textContent = 'Setujui & Teruskan ke Manager';
    approveBtn.className = 'px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-md';
  } else if (p.approval_status === 'PENDING_MANAGER') {
    document.getElementById('approval-stage').value = 'manager_approve';
    header.className = 'px-6 py-4 bg-blue-600 text-white flex items-center justify-between';
    title.textContent = 'Approve PR (sebagai Manager Purchasing)';
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
  if (!(await showConfirm('Kirim ulang PR ini untuk direview dari awal (menunggu cek Leader lagi)?'))) return;
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
  return [...tbody.querySelectorAll(`input[data-bulk="${key}"]`)].map(cb => Number(cb.value));
}

function toggleBulkRow(key, id, checked) {
  if (checked) bulkSelected[key].add(Number(id)); else bulkSelected[key].delete(Number(id));
  syncBulkBar(key);
}

function toggleBulkAll(key, checked) {
  const tbody = document.getElementById(BULK_CFG[key].tbody);
  tbody.querySelectorAll(`input[data-bulk="${key}"]`).forEach(cb => {
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
      const haystack = `${w.wo_number} ${w.project} ${w.customer_nama || ''}`.toLowerCase();
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

  tbody.innerHTML = filtered.map(w => {
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
      <td class="py-3 px-3 text-center font-mono">${formatDateID(w.est_kirim)}</td>
      <td class="py-3 px-3 text-right font-mono font-bold text-emerald-700">${formatRupiah(w.wo_total)}</td>
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.budget_prod)}</td>
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.aktual_prod)}</td>
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.budget_pem)}</td>
      <td class="py-3 px-3 text-right font-mono bg-indigo-50/70 font-bold text-indigo-900">${formatRupiah(w.aktual_pem)}</td>
      <td class="py-3 px-3 text-right font-mono bg-amber-50/70 font-bold text-amber-900">${formatRupiah(w.total_seal)}</td>
      <td class="py-3 px-3 text-right font-mono bg-blue-50/70 font-bold text-blue-900">${formatRupiah(w.total_transport)}</td>
      <td class="py-3 px-3 text-right font-mono">${formatRupiah(w.total_lain)}</td>
      <td class="py-3 px-3 text-right font-mono font-extrabold text-slate-900 bg-slate-100">${formatRupiah(w.total_produksi)}</td>
      <td class="py-3 px-3 text-right font-mono font-extrabold ${isProfit ? 'text-emerald-600' : 'text-rose-600'}">
        <span class="px-2 py-0.5 rounded ${plBadgeClass}">${formatRupiah(w.profit_loss)}</span>
      </td>
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
        <span class="px-2.5 py-1 rounded-full text-[10px] uppercase font-bold ${invBadge[w.invoice_status] || 'bg-slate-100 text-slate-600'}">${esc(w.invoice_status)}</span>
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

function renderSealTable() {
  const tbody = document.getElementById('seal-table-tbody');
  if (sealItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Seal CNC.</td></tr>`;
    syncBulkBar('seal');
    return;
  }
  tbody.innerHTML = sealItems.map(s => `
    <tr class="hover:bg-slate-50 transition group">
      <td class="py-2.5 px-4 text-center sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
        <div class="flex items-center justify-center space-x-1">
          ${bulkCheckbox('seal', s.id)}
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

function renderStokTable() {
  const tbody = document.getElementById('stok-table-tbody');
  if (inventoryItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Material.</td></tr>`;
    return;
  }
  tbody.innerHTML = inventoryItems.map(i => {
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

function openInventoryItemModal(mode, id = null) {
  document.getElementById('inventory-form').reset();
  document.getElementById('inv-form-id').value = '';
  const title = document.getElementById('inventory-modal-title');
  const stokAwalWrapper = document.getElementById('inv-stok-awal-wrapper');

  if (mode === 'add') {
    title.textContent = 'Tambah Material Baru';
    document.getElementById('inv-sku').value = nextSkuSuggestion();
    document.getElementById('inv-satuan').value = 'Pcs';
    stokAwalWrapper.classList.remove('hidden');
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
    // Stok berjalan tidak diedit lewat form ini (lihat komentar di API) - sembunyikan field opening balance.
    stokAwalWrapper.classList.add('hidden');
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
      await api('api/inventory_items.php', 'PUT', payload);
      showToast('Data Material berhasil diperbarui.');
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
  const incoming = prItems.filter(p => p.status === 'STORE ROOM');
  updateIncomingBadge();

  if (incoming.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">Tidak ada barang yang menunggu diterima. Barang PR berstatus STORE ROOM akan muncul di sini.</td></tr>`;
    return;
  }

  tbody.innerHTML = incoming.map(p => `
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
  const search = (document.getElementById('receiving-search')?.value || '').toLowerCase();
  const received = prItems.filter(p => p.status === 'RECEIVED' &&
    (!search || p.pr_number.toLowerCase().includes(search) || (p.product || '').toLowerCase().includes(search)))
    .sort((a, b) => (b.tgl_datang || '').localeCompare(a.tgl_datang || ''));

  if (received.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-semibold">Belum ada riwayat barang diterima.</td></tr>`;
    return;
  }

  tbody.innerHTML = received.map(p => `
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
  if (inventoryMovements.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 font-semibold">Belum ada Riwayat Pergerakan Stok.</td></tr>`;
    return;
  }
  tbody.innerHTML = inventoryMovements.map(m => {
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
  if (productionOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Produksi.</td></tr>`;
    return;
  }
  const STATUS_BADGE = {
    DRAFT: 'bg-slate-100 text-slate-600', 'ON PROGRESS': 'bg-blue-100 text-blue-700',
    HOLD: 'bg-amber-100 text-amber-700', SELESAI: 'bg-emerald-100 text-emerald-700', CANCEL: 'bg-rose-100 text-rose-700',
  };
  tbody.innerHTML = productionOrders.map(p => {
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
  html += `<th class="py-3 px-3 border-r border-slate-700 text-right min-w-[130px]">Total PO</th>`;
  html += `<th class="py-3 px-3 border-r border-slate-700 text-center min-w-[110px]">Status WO</th>`;
  mtcDivisiList.forEach(d => { html += `<th class="py-3 px-3 border-r border-slate-700 text-right min-w-[110px]">${esc(d)}</th>`; });
  html += `<th class="py-3 px-3 border-r border-slate-700 text-center min-w-[130px]">Surat Jalan</th>`;
  html += `<th class="py-3 px-3 border-r border-slate-700 text-right min-w-[130px] bg-slate-900 text-amber-400">Total Biaya</th>`;
  html += `<th class="py-3 px-3 text-center min-w-[100px] bg-slate-900">Aksi</th>`;
  row.innerHTML = html;
}

async function renderMTCDashboard() {
  buildMTCDashTableHeader();
  const tbody = document.getElementById('mtc-dash-matrix-tbody');
  tbody.innerHTML = `<tr><td colspan="${mtcDivisiList.length + 7}" class="text-center py-8 text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin"></i> Memuat data...</td></tr>`;
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

  let grandTotalPO = 0, grandTotalCost = 0;
  const STATUS_BADGE = {
    'ON PROGRESS': 'bg-blue-100 text-blue-700', HOLD: 'bg-amber-100 text-amber-700', CANCEL: 'bg-rose-100 text-rose-700',
    DELIVERY: 'bg-purple-100 text-purple-700', FINISHED: 'bg-emerald-100 text-emerald-700',
  };
  const WORKFLOW_BADGE_SM = { NORMAL: 'bg-blue-100 text-blue-700', REWORK: 'bg-amber-100 text-amber-800', CLAIM: 'bg-orange-100 text-orange-800', REJECT: 'bg-rose-100 text-rose-800' };

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${mtcDivisiList.length + 7}" class="text-center py-10 text-slate-400 text-sm">Belum ada WO dengan "Item Pekerjaan" tercatat. Tambahkan Item Pekerjaan lewat Edit WO (Tracking WO & Budget) dulu, baru catat biaya per divisi di "Modul Divisi Produksi".</td></tr>`;
  } else {
    tbody.innerHTML = filtered.map(w => {
      const divSums = {}; mtcDivisiList.forEach(d => divSums[d] = 0);
      let lastSJ = '-';
      w.items.forEach(it => it.divisi_records.forEach(r => {
        if (r.surat_jalan) lastSJ = r.surat_jalan;
        if (divSums.hasOwnProperty(r.divisi)) divSums[r.divisi] += Number(r.total_biaya) || 0;
      }));

      grandTotalPO += Number(w.nilai_po) || 0;
      grandTotalCost += Number(w.total_biaya) || 0;

      let rowHtml = `
        <tr class="hover:bg-indigo-50/40 cursor-pointer transition-colors" onclick="toggleMTCDashDetail(${w.wo_id})">
          <td class="py-2.5 px-3 border-r border-slate-100 font-bold text-slate-800 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
            <span class="text-indigo-600"><i class="fa-solid fa-chevron-right text-[10px] mr-1 mtc-toggle-icon" id="mtc-toggle-${w.wo_id}"></i>${esc(w.wo_number)}</span>
            <div class="text-[11px] font-normal text-slate-500">${esc(w.project)}</div>
          </td>
          <td class="py-2.5 px-3 border-r border-slate-100"><div class="font-semibold text-slate-700">${esc(w.customer_nama || '-')}</div></td>
          <td class="py-2.5 px-3 border-r border-slate-100 text-right font-bold text-indigo-600">${formatRupiah(w.nilai_po)}</td>
          <td class="py-2.5 px-3 border-r border-slate-100 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[w.status] || 'bg-slate-100 text-slate-600'}">${esc(w.status || '-')}</span></td>
      `;
      mtcDivisiList.forEach(d => {
        const val = divSums[d];
        rowHtml += `<td class="py-2.5 px-3 border-r border-slate-100 text-right ${val > 0 ? 'font-semibold text-slate-700' : 'text-slate-300'}">${val > 0 ? formatRupiah(val) : '-'}</td>`;
      });
      rowHtml += `
          <td class="py-2.5 px-3 border-r border-slate-100 text-center font-medium text-slate-600">${esc(lastSJ)}</td>
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
      if (!detailHtml) detailHtml = `<tr><td colspan="10" class="text-center py-3 text-slate-400">Belum ada rincian divisi yang diinput untuk WO ini.</td></tr>`;

      rowHtml += `
        <tr id="mtc-detail-${w.wo_id}" class="hidden bg-slate-50/90">
          <td colspan="${mtcDivisiList.length + 7}" class="p-4">
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
  document.getElementById('mtc-dash-total-po').textContent = formatRupiah(grandTotalPO);
  document.getElementById('mtc-dash-total-cost').textContent = formatRupiah(grandTotalCost);
  document.getElementById('mtc-dash-total-margin').textContent = formatRupiah(grandTotalPO - grandTotalCost);
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

  if (!mtcCurrentWOId) {
    addBtn.disabled = true;
    emptyHint.classList.remove('hidden');
    listEl.innerHTML = '';
    return;
  }

  const w = workOrders.find(x => String(x.id) === String(mtcCurrentWOId));
  mtcCurrentWOBudgetItems = (w && w.budget_items) || [];

  if (mtcCurrentWOBudgetItems.length === 0) {
    addBtn.disabled = true;
    emptyHint.classList.remove('hidden');
    emptyHint.textContent = 'WO ini belum punya "Item Pekerjaan" - tambahkan dulu lewat tombol Edit WO di menu Tracking WO & Budget (bagian Budgeting Produksi Perusahaan).';
    listEl.innerHTML = '';
    return;
  }

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
  itemSel.innerHTML = mtcCurrentWOBudgetItems.map(bi => opt(bi.nama_item, `${bi.nama_item} (Qty: ${formatQty(bi.qty)})`)).join('');
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
    nama_item: document.getElementById('mtcr-item-select').value,
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
    await handleMTCDivisiWOChange();
  } catch (err) { showApiError(err); }
}

async function deleteMTCRecord(id) {
  if (!(await showConfirm('Hapus catatan biaya divisi ini?'))) return;
  try {
    await api(`api/mtc.php?resource=records&id=${id}`, 'DELETE');
    showToast('Data Divisi Produksi berhasil dihapus.');
    await handleMTCDivisiWOChange();
  } catch (err) { showApiError(err); }
}

// ===================== TRANSPORTASI MODULE =====================

function renderTransportTable() {
  const tbody = document.getElementById('transport-table-tbody');
  if (transportItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-semibold">Belum ada data Transportasi.</td></tr>`;
    syncBulkBar('transport');
    return;
  }
  tbody.innerHTML = transportItems.map(t => `
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

  container.innerHTML = filtered.map(c => {
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

  tbody.innerHTML = filtered.map(s => {
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
function renderAdminSection() {
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
  return badges || '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">BELUM ADA AKSES</span>';
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
    </div>`).join('');
  syncRolePermissionMatrix();
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
  document.querySelectorAll('.perm-cb, .perm-group-cb').forEach(cb => { cb.disabled = isAdmin; });
  if (isAdmin) document.querySelectorAll('.perm-cb').forEach(cb => { cb.checked = true; });
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
  const viewN = Object.keys(access).length;
  const editN = Object.values(access).filter(v => v === 'edit').length;
  document.getElementById('role-perm-summary').textContent = isAdmin
    ? 'Role ini bisa membuka dan mengubah semua menu.'
    : `${viewN} menu bisa dibuka, ${editN} di antaranya boleh diubah.${viewN ? '' : ' User dengan role ini hanya akan melihat Dashboard & Akun Saya.'}`;
}

/** Baca matriks jadi {"dashboard":"edit","stok":"view"}. */
function readRolePermissionMatrix() {
  const access = {};
  document.querySelectorAll('.perm-cb[data-level="view"]:checked').forEach(cb => { access[cb.dataset.menu] = 'view'; });
  document.querySelectorAll('.perm-cb[data-level="edit"]:checked').forEach(cb => { access[cb.dataset.menu] = 'edit'; });
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
};

function updateImportTemplateLink() {
  const type = document.getElementById('import-type-select').value;
  document.getElementById('import-download-template').href = IMPORT_TEMPLATE_MAP[type];
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

function renderCashflowTable() {
  const tbody = document.getElementById('cashflow-tbody');
  if (!tbody) return;

  const search = (document.getElementById('filter-cf-search')?.value || '').toLowerCase();
  const monthVal = document.getElementById('filter-cf-month')?.value || 'ALL';
  const yearVal = document.getElementById('filter-cf-year')?.value || 'ALL';
  const kodeVal = document.getElementById('filter-cf-kode')?.value || 'ALL';
  const tpVal = document.getElementById('filter-cf-tp')?.value || 'ALL';
  const statusVal = document.getElementById('filter-cf-status')?.value || 'ALL';

  const filtered = cashflowCombined.filter(c => {
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

  tbody.innerHTML = filtered.map(c => `
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
      <td class="py-2.5 px-3">${esc(c.po)}</td>
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

  tbody.innerHTML = filtered.map(a => `
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
      <td class="py-2.5 px-3 font-semibold">${esc(a.po_no || '-')}<div class="text-[10px] text-blue-600">${esc(a.wo_number || '')}</div></td>
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

function populateARWODropdown(selectedWoId = '') {
  const custId = document.getElementById('ar-customer-select').value;
  const select = document.getElementById('ar-wo-select');
  const matchingWOs = custId ? workOrders.filter(w => String(w.customer_id) === String(custId)) : [];
  select.innerHTML = '<option value="">-- Pilih PO dari WO --</option>' +
    matchingWOs.map(w => opt(w.id, `${w.po_no || w.wo_number} (${w.wo_number})`)).join('');
  if (selectedWoId) select.value = selectedWoId;
}

async function autoFillARFromWO() {
  const woId = document.getElementById('ar-wo-select').value;
  if (!woId) return;
  try {
    const data = await api(`api/account_receivable.php?action=auto_fill&wo_id=${woId}`);
    document.getElementById('ar-penjualan').value = data.penjualan;
    document.getElementById('ar-deskripsi').value = data.deskripsi;
    document.getElementById('ar-is-ppn').value = Number(data.is_ppn) ? '1' : '0';
    document.getElementById('ar-pph23').value = data.pph23;
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
    document.getElementById('ar-tgl-invoice').value = new Date().toISOString().slice(0, 10);
    document.getElementById('ar-tgl-kirim').value = new Date().toISOString().slice(0, 10);
    populateARWODropdown();
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
    populateARWODropdown(a.wo_id || '');
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
  const woId = document.getElementById('ar-wo-select').value;
  const w = workOrders.find(x => String(x.id) === String(woId));

  const payload = {
    id: id || undefined,
    invoice_no: document.getElementById('ar-invoice').value.trim().toUpperCase(),
    tgl_invoice: document.getElementById('ar-tgl-invoice').value,
    tgl_kirim: document.getElementById('ar-tgl-kirim').value,
    customer_id: document.getElementById('ar-customer-select').value || null,
    wo_id: woId || null,
    po_no: w ? (w.po_no || w.wo_number) : '',
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

  tbody.innerHTML = filtered.map(a => `
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

// ===================== MODUL FINANCE: DANA TALANGAN =====================

function renderTalanganTable() {
  const tbody = document.getElementById('talangan-tbody');
  if (!tbody) return;

  let sumPinjaman = 0, sumTerbayar = 0, sumSisa = 0;
  danaTalangan.forEach(t => {
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

  tbody.innerHTML = danaTalangan.map(t => `
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
  document.getElementById('findash-wo-val-lunas').textContent = formatRupiah(woLunasVal);
  document.getElementById('findash-wo-val-pending').textContent = formatRupiah(woPendingVal);
  document.getElementById('findash-wo-val-belum').textContent = formatRupiah(woBelumVal);

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
              ${esc(m.menu)} &middot; ${m.level === 'edit' ? 'Lihat &amp; Ubah' : 'Lihat saja'}
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
