// =====================================================================
// REPORT & PIVOT TABLE
// Sumber data = data yang sudah dimuat app.js sesuai hak akses user (PR, MTC, AR, AP, Cash Flow),
// jadi Report tidak pernah menampilkan data dari menu yang tidak boleh dilihat user tsb.
// Nilai sensitif (Nilai PO / margin) sudah dikosongkan server untuk role tanpa izin.
// =====================================================================

const RPT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const RPT_EMPTY = '(Kosong)';
const RPT_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16',
  '#f97316', '#14b8a6', '#6366f1', '#a855f7', '#0ea5e9', '#eab308', '#64748b'];
const RPT_AGING_ORDER = ['Belum Jatuh Tempo', '1-30 hari', '31-60 hari', '61-90 hari', '> 90 hari', 'Tanpa Jatuh Tempo', 'Lunas'];

let rptMtcLoaded = false;
let rptPresets = [];          // report favorit tersimpan (server)
let rptPresetsLoaded = false;
let rptChartObj = null;
let rptLast = null;           // hasil pivot terakhir (untuk drill-down, export, print)
let rptDrillRows = [];
let rpt = null;               // pengaturan report yang sedang tampil

const rptDay = d => (d ? String(d).slice(0, 10) : null);

/** Dimensi waktu otomatis untuk sumber yang punya tanggal. */
function rptDateDims(getDate) {
  return {
    bulan: { label: 'Bulan', get: r => (rptDay(getDate(r)) || '').slice(0, 7) || null, fmt: k => { const [y, m] = k.split('-'); return `${RPT_MONTHS[Number(m) - 1]} ${y}`; } },
    kuartal: { label: 'Kuartal', get: r => { const d = rptDay(getDate(r)); return d ? `${d.slice(0, 4)}-Q${Math.ceil(Number(d.slice(5, 7)) / 3)}` : null; }, fmt: k => k.replace('-', ' ') },
    tahun: { label: 'Tahun', get: r => (rptDay(getDate(r)) || '').slice(0, 4) || null },
    tanggal: { label: 'Tanggal', get: r => rptDay(getDate(r)), fmt: k => formatDateID(k) },
  };
}

/** Lead Time PR (hari) = Tanggal Datang - Tanggal Approve Manager. null bila salah satu belum ada. */
function rptLeadTime(r) {
  const a = rptDay(r.manager_approved_at), d = rptDay(r.tgl_datang);
  if (!a || !d) return null;
  return Math.round((new Date(d + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

/** Umur piutang / hutang dari due date (hanya yang masih ada sisa). */
function rptAging(due, sisa) {
  if (!(Number(sisa) > 0.5)) return 'Lunas';
  if (!due) return 'Tanpa Jatuh Tempo';
  const days = Math.floor((Date.now() - new Date(rptDay(due) + 'T00:00:00').getTime()) / 86400000);
  if (days <= 0) return 'Belum Jatuh Tempo';
  if (days <= 30) return '1-30 hari';
  if (days <= 60) return '31-60 hari';
  if (days <= 90) return '61-90 hari';
  return '> 90 hari';
}

/** Baris data MTC: tiap pekerjaan divisi + biaya otomatis (PR / Seal / Transport) per WO. */
function rptMtcCostRows() {
  const out = [];
  (mtcDashboardData || []).forEach(w => {
    const base = { wo: w.wo_number, customer: w.customer_nama, project: w.project, wo_status: w.status };
    (w.items || []).forEach(item => (item.divisi_records || []).forEach(rec => (rec.items || []).forEach(line => {
      out.push({ ...base, item: item.nama_item, divisi: rec.divisi, sumber: 'Divisi Produksi', workflow: rec.status_workflow,
        pic: rec.pic, pekerjaan: line.pekerjaan, mesin: line.kode_mesin, qty: Number(line.qty) || 0, satuan: line.satuan,
        total: Number(line.total) || 0, tanggal: rptDay(rec.created_at) });
    })));
    (w.auto_records || []).forEach(a => (a.lines || []).forEach(line => {
      out.push({ ...base, item: '-', divisi: a.divisi, sumber: a.sumber, workflow: '-', pic: line.pic, pekerjaan: line.pekerjaan,
        mesin: '', qty: Number(line.qty) || 0, satuan: line.satuan, total: Number(line.total) || 0, tanggal: null });
    }));
  });
  return out;
}

function rptMtcWoRows() {
  return (mtcDashboardData || []).map(w => {
    const wo = (workOrders || []).find(x => Number(x.id) === Number(w.wo_id)) || {};
    return { wo: w.wo_number, customer: w.customer_nama, project: w.project, status: w.status,
      nilai_po: w.nilai_po, total_biaya: Number(w.total_biaya) || 0, margin: w.margin,
      tanggal: rptDay(wo.tgl_wo || wo.tanggal || wo.created_at) };
  });
}

const rptMoney = (label, get) => ({ label, get, money: true });

const REPORT_SOURCES = {
  pr: {
    group: 'Purchasing', label: 'Purchase Request (PR)', menuNote: 'menu Purchase Request',
    available: () => READ_RULES.prItems(),
    rows: () => prItems || [],
    date: r => r.tanggal, dateLabel: 'Tanggal PR',
    dims: {
      sheet: { label: 'Kategori PR', get: r => r.sheet, order: ['PROJECT', 'GENERAL', 'CONSUMABLE', 'MAINTENANCE', 'INVENTARIS'] },
      status: { label: 'Status PR', get: r => r.status, order: ['ON PROSES', 'PO ISSUED', 'RECEIVED', 'STORE ROOM', 'CANCEL'] },
      approval: { label: 'Status Approval', get: r => approvalLabel(r.approval_status), order: ['Menunggu Supervisor', 'Menunggu Manager Produksi', 'Disetujui', 'Ditolak'] },
      divisi: { label: 'Divisi Peminta', get: r => (r.divisi || '').toUpperCase() },
      peminta: { label: 'User Peminta', get: r => r.user_nama || r.karyawan_nama },
      buyer: { label: 'Buyer', get: r => r.buyer_nama },
      supplier: { label: 'Supplier', get: r => r.supplier_nama },
      customer: { label: 'Customer', get: r => r.customer_nama },
      wo: { label: 'No. WO', get: r => r.wo_number },
      produk: { label: 'Produk', get: r => r.product },
      lead_grp: { label: 'Kelompok Lead Time', get: r => { const d = rptLeadTime(r); return d === null ? null : d <= 3 ? '0-3 hari' : d <= 7 ? '4-7 hari' : d <= 14 ? '8-14 hari' : d <= 30 ? '15-30 hari' : '> 30 hari'; }, order: ['0-3 hari', '4-7 hari', '8-14 hari', '15-30 hari', '> 30 hari'] },
    },
    measures: {
      items: { label: 'Jumlah Item PR', count: true },
      pr: { label: 'Jumlah No. PR (unik)', distinct: r => r.pr_number },
      qty: { label: 'Qty', get: r => Number(r.qty) },
      dpp: rptMoney('DPP (Rp)', r => Number(r.dpp)),
      ppn: rptMoney('PPN (Rp)', r => Number(r.ppn_amount)),
      total: rptMoney('Total Nilai PR (Rp)', r => Number(r.total)),
      lead: { label: 'Lead Time (hari) - Approve MGR s/d Datang', get: r => rptLeadTime(r), optional: true, defaultAgg: 'avg' },
    },
    filters: ['sheet', 'status', 'approval', 'divisi', 'buyer', 'supplier'],
    // [judul, nilai, angka Rupiah?, tampil default?] - kolom lain bisa dimunculkan lewat "Atur Kolom".
    detail: [
      ['Tanggal', r => formatDateID(r.tanggal)], ['No PR', r => r.pr_number], ['Item', r => r.item_no], ['Kategori', r => r.sheet],
      ['No WO', r => r.wo_number || '-'], ['Customer', r => r.customer_nama || '-'],
      ['Produk', r => r.product], ['Type', r => r.type || '-', false, false], ['Dimensi', r => r.dimensi || '-', false, false],
      ['Material', r => r.brand || '-', false, false], ['Qty', r => `${formatQty(r.qty)} ${r.uom || ''}`],
      ['Harga Satuan', r => Number(r.harga), true, false], ['Supplier', r => r.supplier_nama], ['No PO', r => r.po_number || '-', false, false],
      ['Buyer', r => r.buyer_nama], ['Peminta', r => r.user_nama || r.karyawan_nama], ['Divisi', r => r.divisi || '-', false, false],
      ['Status', r => r.status], ['Approval', r => approvalLabel(r.approval_status)],
      ['Tgl Approve SPV', r => formatDateID(rptDay(r.leader_checked_at)), false, false],
      ['Tgl Approve MGR', r => formatDateID(rptDay(r.manager_approved_at))],
      ['Tgl Beli', r => formatDateID(r.tgl_beli), false, false],
      ['Tgl Datang', r => formatDateID(r.tgl_datang)],
      ['Lead Time', r => { const d = rptLeadTime(r); return d === null ? '-' : `${d} hari`; }],
      ['Total', r => Number(r.total), true],
    ],
  },
  mtc_cost: {
    group: 'MTC Produksi', label: 'MTC - Biaya Produksi per Divisi', menuNote: 'menu Dashboard MTC / Modul Divisi',
    available: () => canView('mtcdash', 'mtcdivisi'),
    rows: rptMtcCostRows,
    date: r => r.tanggal, dateLabel: 'Tanggal input (biaya otomatis PR/Seal/Transport tanpa tanggal)',
    dims: {
      divisi: { label: 'Divisi', get: r => r.divisi },
      sumber: { label: 'Sumber Biaya', get: r => r.sumber },
      wo: { label: 'No. WO', get: r => r.wo },
      customer: { label: 'Customer', get: r => r.customer },
      item: { label: 'Item Pekerjaan', get: r => r.item },
      workflow: { label: 'Status Workflow', get: r => r.workflow },
      wo_status: { label: 'Status WO', get: r => r.wo_status },
      pic: { label: 'PIC', get: r => r.pic },
      mesin: { label: 'Kode Mesin', get: r => r.mesin },
    },
    measures: {
      total: rptMoney('Total Biaya (Rp)', r => r.total),
      qty: { label: 'Qty', get: r => r.qty },
      lines: { label: 'Jumlah Pekerjaan', count: true },
      wos: { label: 'Jumlah WO (unik)', distinct: r => r.wo },
    },
    filters: ['divisi', 'sumber', 'customer', 'workflow', 'wo_status'],
    detail: [
      ['Tanggal', r => formatDateID(r.tanggal)], ['No WO', r => r.wo], ['Customer', r => r.customer], ['Item Pekerjaan', r => r.item],
      ['Divisi', r => r.divisi], ['Sumber', r => r.sumber], ['Pekerjaan', r => r.pekerjaan], ['Qty', r => `${formatQty(r.qty)} ${r.satuan || ''}`],
      ['Workflow', r => r.workflow], ['Total', r => r.total, true],
    ],
  },
  mtc_wo: {
    group: 'MTC Produksi', label: 'MTC - Ringkasan per WO (Nilai PO vs Biaya)', menuNote: 'menu Dashboard MTC / Modul Divisi',
    available: () => canView('mtcdash', 'mtcdivisi'),
    rows: rptMtcWoRows,
    date: r => r.tanggal, dateLabel: 'Tanggal WO dibuat',
    dims: {
      customer: { label: 'Customer', get: r => r.customer },
      status: { label: 'Status WO', get: r => r.status },
      wo: { label: 'No. WO', get: r => r.wo },
    },
    measures: {
      total_biaya: rptMoney('Total Biaya Aktual (Rp)', r => r.total_biaya),
      nilai_po: { ...rptMoney('Nilai PO / DPP (Rp)', r => Number(r.nilai_po) || 0), sensitive: true },
      margin: { ...rptMoney('Margin (Rp)', r => Number(r.margin) || 0), sensitive: true },
      wos: { label: 'Jumlah WO', count: true },
    },
    filters: ['customer', 'status'],
    detail: [
      ['No WO', r => r.wo], ['Customer', r => r.customer], ['Project', r => r.project], ['Status', r => r.status],
      ['Nilai PO', r => (CAN_NILAI ? Number(r.nilai_po) || 0 : '-'), true], ['Total Biaya', r => r.total_biaya, true],
      ['Margin', r => (CAN_NILAI ? Number(r.margin) || 0 : '-'), true],
    ],
  },
  ar: {
    group: 'Finance', label: 'AR - Piutang Customer', menuNote: 'menu AR',
    available: () => READ_RULES.ar(),
    rows: () => arData || [],
    date: r => r.tgl_invoice, dateLabel: 'Tanggal Invoice',
    dims: {
      customer: { label: 'Customer', get: r => r.customer_nama },
      status: { label: 'Status Bayar', get: r => r.status, order: ['PENDING', 'PARTIAL', 'TERBAYAR LUNAS'] },
      aging: { label: 'Umur Piutang', get: r => rptAging(r.due_date, r.sisa_piutang), order: RPT_AGING_ORDER },
      jatuh_tempo: { label: 'Bulan Jatuh Tempo', get: r => (r.due_date || '').slice(0, 7) || null, fmt: k => { const [y, m] = k.split('-'); return `${RPT_MONTHS[Number(m) - 1]} ${y}`; } },
      wo: { label: 'No. WO', get: r => r.wo_numbers || r.wo_number },
      po: { label: 'No. PO Customer', get: r => r.po_no },
    },
    measures: {
      tagihan: rptMoney('Total Tagihan (DPP + PPN)', r => Number(r.penjualan) + Number(r.ppn)),
      dpp: rptMoney('Penjualan / DPP (Rp)', r => Number(r.penjualan)),
      ppn: rptMoney('PPN (Rp)', r => Number(r.ppn)),
      pph23: rptMoney('PPh 23 (Rp)', r => Number(r.pph23)),
      terbayar: rptMoney('Terbayar (Rp)', r => Number(r.terbayar)),
      sisa: rptMoney('Sisa Piutang (Rp)', r => Math.max(Number(r.sisa_piutang) || 0, 0)),
      count: { label: 'Jumlah Invoice', count: true },
    },
    filters: ['customer', 'status', 'aging'],
    detail: [
      ['Tgl Invoice', r => formatDateID(r.tgl_invoice)], ['No Invoice', r => r.invoice_no], ['Customer', r => r.customer_nama],
      ['No PO', r => r.po_no], ['WO', r => r.wo_numbers || r.wo_number], ['Due Date', r => formatDateID(r.due_date)],
      ['Tagihan', r => Number(r.penjualan) + Number(r.ppn), true], ['Terbayar', r => Number(r.terbayar), true],
      ['Sisa', r => Math.max(Number(r.sisa_piutang) || 0, 0), true], ['Status', r => r.status],
    ],
  },
  ap: {
    group: 'Finance', label: 'AP - Hutang Supplier', menuNote: 'menu AP',
    available: () => READ_RULES.ap(),
    rows: () => apData || [],
    date: r => r.tgl_invoice, dateLabel: 'Tanggal Invoice',
    dims: {
      supplier: { label: 'Supplier', get: r => r.supplier_nama },
      status: { label: 'Status Bayar', get: r => r.status, order: ['PENDING', 'PARTIAL', 'TERBAYAR LUNAS'] },
      aging: { label: 'Umur Hutang', get: r => rptAging(r.due_date, r.sisa_hutang), order: RPT_AGING_ORDER },
      po: { label: 'No. PO', get: r => r.po_no },
    },
    measures: {
      tagihan: rptMoney('Total Tagihan (DPP + PPN)', r => Number(r.pembelian) + Number(r.ppn)),
      dpp: rptMoney('Pembelian / DPP (Rp)', r => Number(r.pembelian)),
      ppn: rptMoney('PPN (Rp)', r => Number(r.ppn)),
      terbayar: rptMoney('Terbayar (Rp)', r => Number(r.terbayar)),
      sisa: rptMoney('Sisa Hutang (Rp)', r => Math.max(Number(r.sisa_hutang) || 0, 0)),
      count: { label: 'Jumlah Invoice', count: true },
    },
    filters: ['supplier', 'status', 'aging'],
    detail: [
      ['Tgl Invoice', r => formatDateID(r.tgl_invoice)], ['No Invoice', r => r.invoice_no], ['Supplier', r => r.supplier_nama],
      ['No PO', r => r.po_no], ['Due Date', r => formatDateID(r.due_date)], ['Tagihan', r => Number(r.pembelian) + Number(r.ppn), true],
      ['Terbayar', r => Number(r.terbayar), true], ['Sisa', r => Math.max(Number(r.sisa_hutang) || 0, 0), true], ['Status', r => r.status],
    ],
  },
  cashflow: {
    group: 'Finance', label: 'Cash Flow (Kas Masuk & Keluar)', menuNote: 'menu Cash Flow',
    available: () => READ_RULES.cashflow(),
    rows: () => cashflowCombined || [],
    date: r => r.tanggal, dateLabel: 'Tanggal Transaksi',
    dims: {
      arah: { label: 'Masuk / Keluar', get: r => (r.tp === 'OUT' ? 'Keluar' : 'Masuk'), order: ['Masuk', 'Keluar'] },
      kode: { label: 'Kode', get: r => r.kode },
      status: { label: 'Status', get: r => r.status, order: ['PENDING', 'PARTIAL', 'TERBAYAR LUNAS'] },
      sumber: { label: 'Sumber', get: r => ({ AR: 'AR (Piutang)', AP: 'AP (Hutang)', MANUAL: 'Manual' })[r.source] || r.source },
      pic: { label: 'Customer / Supplier / PIC', get: r => (r.pic === '-' ? null : r.pic) },
      wo: { label: 'No. WO', get: r => (r.wo === '-' ? null : r.wo) },
    },
    measures: {
      nominal: rptMoney('Nominal (Masuk + Keluar)', r => Number(r.debit) + Number(r.kredit)),
      masuk: rptMoney('Kas Masuk (Rp)', r => Number(r.debit)),
      keluar: rptMoney('Kas Keluar (Rp)', r => Number(r.kredit)),
      net: rptMoney('Net (Masuk - Keluar)', r => Number(r.debit) - Number(r.kredit)),
      count: { label: 'Jumlah Transaksi', count: true },
    },
    filters: ['arah', 'kode', 'status', 'sumber'],
    detail: [
      ['Tanggal', r => formatDateID(r.tanggal)], ['Kode', r => r.kode], ['Deskripsi', r => r.deskripsi], ['PIC', r => r.pic],
      ['Invoice', r => r.invoice], ['Masuk', r => Number(r.debit), true], ['Keluar', r => Number(r.kredit), true], ['Status', r => r.status],
    ],
  },
};

/** Report bawaan (siap pakai). period: 'year' | 'month' | 'all'. */
const RPT_BUILTIN = [
  { id: 'pr_kat_status', group: 'Purchasing', name: 'PR per Kategori × Status PR', cfg: { source: 'pr', row1: 'sheet', col: 'status', measure: 'items', chart: 'stacked', period: 'year' } },
  { id: 'pr_nilai_bulan', group: 'Purchasing', name: 'Nilai PR per Bulan × Kategori', cfg: { source: 'pr', row1: 'bulan', col: 'sheet', measure: 'total', chart: 'stacked', period: 'year' } },
  { id: 'pr_supplier', group: 'Purchasing', name: 'Pembelian per Supplier (Top)', cfg: { source: 'pr', row1: 'supplier', measure: 'total', chart: 'hbar', sort: 'desc', period: 'year', filters: { status: ['ON PROSES', 'PO ISSUED', 'RECEIVED', 'STORE ROOM'] } } },
  { id: 'pr_divisi_approval', group: 'Purchasing', name: 'PR per Divisi × Status Approval', cfg: { source: 'pr', row1: 'divisi', col: 'approval', measure: 'items', chart: 'stacked', period: 'year' } },
  { id: 'pr_buyer', group: 'Purchasing', name: 'Kinerja Buyer (PR per Buyer × Status)', cfg: { source: 'pr', row1: 'buyer', col: 'status', measure: 'items', chart: 'stacked', sort: 'desc', period: 'year' } },
  { id: 'pr_kat_detail', group: 'Purchasing', name: 'Kategori → Status (sub-baris) - Nilai PR', cfg: { source: 'pr', row1: 'sheet', row2: 'status', measure: 'total', chart: 'doughnut', period: 'year' } },
  { id: 'pr_lead_supplier', group: 'Purchasing', name: 'Lead Time rata-rata per Supplier (hari)', cfg: { source: 'pr', row1: 'supplier', measure: 'lead', agg: 'avg', chart: 'hbar', sort: 'desc', period: 'year' } },
  { id: 'pr_lead_grp', group: 'Purchasing', name: 'Sebaran Lead Time PR per Kategori', cfg: { source: 'pr', row1: 'lead_grp', col: 'sheet', measure: 'items', chart: 'stacked', period: 'year' } },
  { id: 'mtc_divisi', group: 'MTC Produksi', name: 'Biaya Produksi per Divisi', cfg: { source: 'mtc_cost', row1: 'divisi', measure: 'total', chart: 'hbar', sort: 'desc', period: 'all' } },
  { id: 'mtc_wo_divisi', group: 'MTC Produksi', name: 'Biaya per WO × Sumber Biaya', cfg: { source: 'mtc_cost', row1: 'wo', col: 'sumber', measure: 'total', chart: 'stacked', sort: 'desc', period: 'all' } },
  { id: 'mtc_customer', group: 'MTC Produksi', name: 'Biaya Aktual per Customer', cfg: { source: 'mtc_wo', row1: 'customer', measure: 'total_biaya', chart: 'bar', sort: 'desc', period: 'all' } },
  { id: 'mtc_margin', group: 'MTC Produksi', name: 'Margin per Customer (khusus izin Nilai PO)', cfg: { source: 'mtc_wo', row1: 'customer', measure: 'margin', chart: 'bar', sort: 'desc', period: 'all' } },
  { id: 'ar_bulan', group: 'Finance', name: 'Penjualan (AR) per Bulan', cfg: { source: 'ar', row1: 'bulan', measure: 'tagihan', chart: 'line', period: 'year' } },
  { id: 'ar_customer_status', group: 'Finance', name: 'Piutang per Customer × Status Bayar', cfg: { source: 'ar', row1: 'customer', col: 'status', measure: 'tagihan', chart: 'stacked', sort: 'desc', period: 'all' } },
  { id: 'ar_aging', group: 'Finance', name: 'Umur Piutang (Aging) per Customer', cfg: { source: 'ar', row1: 'customer', col: 'aging', measure: 'sisa', chart: 'stacked', sort: 'desc', period: 'all', filters: { status: ['PENDING', 'PARTIAL'] } } },
  { id: 'ap_supplier', group: 'Finance', name: 'Hutang (AP) per Supplier × Status', cfg: { source: 'ap', row1: 'supplier', col: 'status', measure: 'tagihan', chart: 'stacked', sort: 'desc', period: 'all' } },
  { id: 'cf_bulan', group: 'Finance', name: 'Cash Flow: Masuk vs Keluar per Bulan', cfg: { source: 'cashflow', row1: 'bulan', col: 'arah', measure: 'nominal', chart: 'bar', period: 'year' } },
  { id: 'cf_kode', group: 'Finance', name: 'Cash Flow per Kode × Status', cfg: { source: 'cashflow', row1: 'kode', col: 'status', measure: 'nominal', chart: 'stacked', sort: 'desc', period: 'year' } },
];

// ---------------- helper sumber / dimensi ----------------
function rptSource(key) { return REPORT_SOURCES[key || (rpt && rpt.source)]; }
function rptDims(src) { return { ...src.dims, ...(src.date ? rptDateDims(src.date) : {}) }; }
function rptMeasures(src) {
  return Object.fromEntries(Object.entries(src.measures).filter(([, m]) => !m.sensitive || CAN_NILAI));
}
function rptKey(dim, r) {
  const v = dim.get(r);
  return v === null || v === undefined || String(v).trim() === '' ? '' : String(v).trim();
}
function rptLabel(dim, key) {
  if (key === '') return RPT_EMPTY;
  return dim && dim.fmt ? dim.fmt(key) : key;
}
function rptIsMoney(m) { return !!(m && m.money); }
function rptFmt(m, v) {
  if (rptIsMoney(m)) return formatRupiah(v);
  return Number(v || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
function rptCompact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e6) return (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  if (a >= 1e3) return (v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' rb';
  return v.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}
function rptSortKeys(keys, dim, mode, valueOf) {
  const order = dim && dim.order;
  const byLabel = (a, b) => {
    if (a === '') return 1;
    if (b === '') return -1;
    if (order) {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a.localeCompare(b, 'id', { numeric: true });
  };
  if (mode === 'desc' && valueOf) return keys.sort((a, b) => valueOf(b) - valueOf(a) || byLabel(a, b));
  if (mode === 'asc' && valueOf) return keys.sort((a, b) => valueOf(a) - valueOf(b) || byLabel(a, b));
  return keys.sort(byLabel);
}

// ---------------- pengaturan default & periode ----------------
function rptPeriodRange(kind) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (kind === 'month') return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (kind === 'lastmonth') return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
  if (kind === 'year') return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
  return ['', ''];
}

function rptNormalize(cfg) {
  const src = rptSource(cfg.source) ? cfg.source : Object.keys(REPORT_SOURCES).find(k => REPORT_SOURCES[k].available()) || 'pr';
  const S = REPORT_SOURCES[src];
  const dims = rptDims(S);
  const meas = rptMeasures(S);
  const firstDim = Object.keys(S.dims)[0];
  let [from, to] = [cfg.from, cfg.to];
  if (cfg.period) [from, to] = rptPeriodRange(cfg.period);
  return {
    source: src,
    from: from || '', to: to || '',
    filters: Object.fromEntries(Object.entries(cfg.filters || {}).filter(([k, v]) => dims[k] && Array.isArray(v) && v.length)),
    row1: dims[cfg.row1] ? cfg.row1 : firstDim,
    row2: dims[cfg.row2] && cfg.row2 !== cfg.row1 ? cfg.row2 : '',
    col: dims[cfg.col] && cfg.col !== cfg.row1 && cfg.col !== cfg.row2 ? cfg.col : '',
    measure: meas[cfg.measure] ? cfg.measure : Object.keys(meas)[0],
    agg: ['sum', 'avg', 'min', 'max'].includes(cfg.agg) ? cfg.agg : 'sum',
    chart: cfg.chart || 'bar',
    sort: cfg.sort || 'label',
  };
}

function rptStore() {
  try { localStorage.setItem('rpt_last_cfg', JSON.stringify(rpt)); } catch (e) { /* abaikan */ }
}
function rptRestore() {
  try { return JSON.parse(localStorage.getItem('rpt_last_cfg') || 'null'); } catch (e) { return null; }
}

// ---------------- render tab ----------------
async function renderReportTab() {
  if (!rpt) rpt = rptNormalize(rptRestore() || RPT_BUILTIN[0].cfg);
  await rptEnsureData(rpt.source);
  if (!rptPresetsLoaded) {
    rptPresetsLoaded = true;
    try { rptPresets = await api('api/reports.php'); } catch (e) { rptPresets = []; }
  }
  rptRenderPresetSelect();
  rptRenderControls();
  runReport();
}

async function rptEnsureData(sourceKey) {
  if (String(sourceKey).startsWith('mtc') && !rptMtcLoaded && canView('mtcdash', 'mtcdivisi')) {
    try {
      mtcDashboardData = await api('api/mtc.php?resource=dashboard');
      rptMtcLoaded = true;
    } catch (err) { showApiError(err); }
  }
}

function rptRenderPresetSelect(selected = '') {
  const sel = document.getElementById('rpt-preset');
  const groups = {};
  RPT_BUILTIN.filter(b => REPORT_SOURCES[b.cfg.source].available()).forEach(b => {
    (groups[`Report Bawaan - ${b.group}`] ||= []).push(`<option value="b:${b.id}">${esc(b.name)}</option>`);
  });
  const mine = rptPresets.filter(p => p.mine), shared = rptPresets.filter(p => !p.mine);
  if (mine.length) groups['Favorit Saya'] = mine.map(p => `<option value="s:${p.id}">${esc(p.name)}${p.is_shared ? ' (dibagikan)' : ''}</option>`);
  if (shared.length) groups['Dibagikan Rekan'] = shared.map(p => `<option value="s:${p.id}">${esc(p.name)} - ${esc(p.owner_nama || '')}</option>`);
  sel.innerHTML = '<option value="">-- Pilih report favorit --</option>' +
    Object.entries(groups).map(([g, opts]) => `<optgroup label="${esc(g)}">${opts.join('')}</optgroup>`).join('');
  sel.value = selected;
  rptUpdateDeleteBtn();
}

function rptUpdateDeleteBtn() {
  const v = document.getElementById('rpt-preset').value;
  const p = v.startsWith('s:') ? rptPresets.find(x => `s:${x.id}` === v) : null;
  document.getElementById('rpt-preset-del').classList.toggle('hidden', !(p && (p.mine || IS_ADMIN)));
}

async function applyReportPreset(value) {
  if (!value) { rptUpdateDeleteBtn(); return; }
  let cfg = null;
  if (value.startsWith('b:')) cfg = (RPT_BUILTIN.find(b => `b:${b.id}` === value) || {}).cfg;
  else cfg = (rptPresets.find(p => `s:${p.id}` === value) || {}).config;
  if (!cfg) return;
  if (!REPORT_SOURCES[cfg.source] || !REPORT_SOURCES[cfg.source].available()) {
    showToast('Anda tidak punya akses ke sumber data report ini.', 'error');
    return;
  }
  rpt = rptNormalize(cfg);
  await rptEnsureData(rpt.source);
  rptRenderControls();
  rptUpdateDeleteBtn();
  runReport();
}

function rptRenderControls() {
  const srcSel = document.getElementById('rpt-source');
  const byGroup = {};
  Object.entries(REPORT_SOURCES).forEach(([k, s]) => {
    (byGroup[s.group] ||= []).push(`<option value="${k}" ${s.available() ? '' : 'disabled'}>${esc(s.label)}${s.available() ? '' : ' (tidak ada akses)'}</option>`);
  });
  srcSel.innerHTML = Object.entries(byGroup).map(([g, o]) => `<optgroup label="${esc(g)}">${o.join('')}</optgroup>`).join('');
  srcSel.value = rpt.source;

  const S = rptSource();
  document.getElementById('rpt-source-note').textContent = `Data mengikuti hak akses Anda di ${S.menuNote}.`;
  document.getElementById('rpt-date-label').textContent = S.dateLabel ? `(${S.dateLabel})` : '';
  document.getElementById('rpt-from').value = rpt.from;
  document.getElementById('rpt-to').value = rpt.to;

  const dims = rptDims(S);
  const dimOpts = (blank) => (blank ? `<option value="">${blank}</option>` : '') +
    Object.entries(dims).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join('');
  document.getElementById('rpt-row1').innerHTML = dimOpts('');
  document.getElementById('rpt-row2').innerHTML = dimOpts('-- Tidak ada --');
  document.getElementById('rpt-col').innerHTML = dimOpts('-- Tidak ada (1 kolom nilai) --');
  document.getElementById('rpt-row1').value = rpt.row1;
  document.getElementById('rpt-row2').value = rpt.row2;
  document.getElementById('rpt-col').value = rpt.col;
  document.getElementById('rpt-measure').innerHTML = Object.entries(rptMeasures(S))
    .map(([k, m]) => `<option value="${k}">${esc(m.label)}</option>`).join('');
  document.getElementById('rpt-measure').value = rpt.measure;
  document.getElementById('rpt-agg').value = rpt.agg;
  document.getElementById('rpt-chart-type').value = rpt.chart;
  document.getElementById('rpt-sort').value = rpt.sort;
  rptRenderFilters();
}

/** Filter per dimensi: dropdown berisi checkbox nilai (kosong = semua). */
function rptRenderFilters() {
  const S = rptSource();
  const dims = rptDims(S);
  const rows = S.rows();
  const box = document.getElementById('rpt-filters');
  box.innerHTML = S.filters.map(fk => {
    const dim = dims[fk];
    const counts = {};
    rows.forEach(r => { const k = rptKey(dim, r); counts[k] = (counts[k] || 0) + 1; });
    const keys = rptSortKeys(Object.keys(counts), dim, 'label');
    const chosen = rpt.filters[fk] || [];
    const summary = chosen.length ? `${chosen.length} dipilih` : 'Semua';
    return `<details class="rpt-filter border border-slate-200 rounded-lg bg-slate-50" data-dim="${fk}">
      <summary class="cursor-pointer px-2.5 py-1.5 flex justify-between items-center gap-2 font-semibold text-slate-700">
        <span>${esc(dim.label)}</span><span class="text-[10px] ${chosen.length ? 'text-indigo-600 font-bold' : 'text-slate-400'}">${summary}</span></summary>
      <div class="px-2.5 pb-2 pt-1 border-t border-slate-200 bg-white rounded-b-lg">
        <div class="flex gap-2 mb-1 text-[10px]"><a href="javascript:void(0)" onclick="rptFilterAll('${fk}', true)" class="text-indigo-600 font-bold">Pilih semua</a><a href="javascript:void(0)" onclick="rptFilterAll('${fk}', false)" class="text-rose-600 font-bold">Reset (semua)</a></div>
        <div class="max-h-44 overflow-y-auto custom-scrollbar space-y-0.5">
          ${keys.map(k => `<label class="flex items-center gap-1.5 py-0.5 cursor-pointer"><input type="checkbox" value="${esc(k)}" ${chosen.includes(k) ? 'checked' : ''} onchange="rptFilterChange('${fk}')" class="accent-indigo-600">
            <span class="flex-1 truncate">${esc(rptLabel(dim, k))}</span><span class="text-[10px] text-slate-400">${counts[k]}</span></label>`).join('') || '<div class="text-slate-400">Belum ada data</div>'}
        </div>
      </div>
    </details>`;
  }).join('');
}

function rptFilterChange(fk) {
  const vals = [...document.querySelectorAll(`.rpt-filter[data-dim="${fk}"] input[type=checkbox]:checked`)].map(i => i.value);
  if (vals.length) rpt.filters[fk] = vals; else delete rpt.filters[fk];
  const det = document.querySelector(`.rpt-filter[data-dim="${fk}"] summary span:last-child`);
  det.textContent = vals.length ? `${vals.length} dipilih` : 'Semua';
  det.className = `text-[10px] ${vals.length ? 'text-indigo-600 font-bold' : 'text-slate-400'}`;
  runReport(false);
}

function rptFilterAll(fk, all) {
  document.querySelectorAll(`.rpt-filter[data-dim="${fk}"] input[type=checkbox]`).forEach(i => { i.checked = all; });
  rptFilterChange(fk);
}

async function onReportMeasureChange() {
  const m = rptMeasures(rptSource())[document.getElementById('rpt-measure').value];
  if (m && m.defaultAgg) document.getElementById('rpt-agg').value = m.defaultAgg;
  runReport();
}

async function onReportSourceChange() {
  const src = document.getElementById('rpt-source').value;
  rpt = rptNormalize({ source: src, from: rpt.from, to: rpt.to });
  document.getElementById('rpt-preset').value = '';
  await rptEnsureData(src);
  rptRenderControls();
  rptUpdateDeleteBtn();
  runReport();
}

function setReportPeriod(kind) {
  const [f, t] = rptPeriodRange(kind);
  document.getElementById('rpt-from').value = f;
  document.getElementById('rpt-to').value = t;
  runReport();
}

/** Baca kontrol -> pengaturan rpt. */
function rptReadControls() {
  rpt.from = document.getElementById('rpt-from').value;
  rpt.to = document.getElementById('rpt-to').value;
  rpt.row1 = document.getElementById('rpt-row1').value;
  rpt.row2 = document.getElementById('rpt-row2').value;
  rpt.col = document.getElementById('rpt-col').value;
  if (rpt.row2 === rpt.row1) { rpt.row2 = ''; document.getElementById('rpt-row2').value = ''; }
  if (rpt.col && (rpt.col === rpt.row1 || rpt.col === rpt.row2)) { rpt.col = ''; document.getElementById('rpt-col').value = ''; }
  rpt.measure = document.getElementById('rpt-measure').value;
  rpt.agg = document.getElementById('rpt-agg').value;
  rpt.chart = document.getElementById('rpt-chart-type').value;
  rpt.sort = document.getElementById('rpt-sort').value;
}

// ---------------- perhitungan pivot ----------------
function rptFilteredRows(cfg) {
  const S = rptSource(cfg.source);
  const dims = rptDims(S);
  return S.rows().filter(r => {
    if ((cfg.from || cfg.to) && S.date) {
      const d = rptDay(S.date(r));
      if (!d) return false;
      if (cfg.from && d < cfg.from) return false;
      if (cfg.to && d > cfg.to) return false;
    }
    for (const [fk, vals] of Object.entries(cfg.filters || {})) {
      if (dims[fk] && vals.length && !vals.includes(rptKey(dims[fk], r))) return false;
    }
    return true;
  });
}

function rptNewCell() { return { n: 0, sum: 0, min: Infinity, max: -Infinity, set: null }; }
function rptAdd(cell, m, r) {
  if (m.optional) { const raw = m.get(r); if (raw === null || raw === undefined) return; } // mis. Lead Time yang belum lengkap
  cell.n++;
  if (m.distinct) { (cell.set ||= new Set()).add(m.distinct(r)); return; }
  const v = m.count ? 1 : Number(m.get(r)) || 0;
  cell.sum += v;
  if (v < cell.min) cell.min = v;
  if (v > cell.max) cell.max = v;
}
function rptValue(cell, m, agg) {
  if (!cell || !cell.n) return 0;
  if (m.count) return cell.n;
  if (m.distinct) return cell.set ? cell.set.size : 0;
  if (agg === 'avg') return cell.sum / cell.n;
  if (agg === 'min') return cell.min;
  if (agg === 'max') return cell.max;
  return cell.sum;
}

function rptCompute(cfg) {
  const S = rptSource(cfg.source);
  const dims = rptDims(S);
  const m = rptMeasures(S)[cfg.measure];
  const d1 = dims[cfg.row1], d2 = cfg.row2 ? dims[cfg.row2] : null, dc = cfg.col ? dims[cfg.col] : null;
  let rows = rptFilteredRows(cfg);
  // Ukuran opsional (mis. Lead Time): baris yang nilainya belum lengkap tidak ikut dihitung.
  if (m.optional) rows = rows.filter(r => { const v = m.get(r); return v !== null && v !== undefined; });
  const groups = new Map();
  const colTotals = new Map();
  const grand = rptNewCell();
  rows.forEach(r => {
    const k1 = rptKey(d1, r), k2 = d2 ? rptKey(d2, r) : null, kc = dc ? rptKey(dc, r) : null;
    let g = groups.get(k1);
    if (!g) { g = { cell: rptNewCell(), cols: new Map(), subs: new Map() }; groups.set(k1, g); }
    rptAdd(g.cell, m, r);
    rptAdd(grand, m, r);
    if (dc) {
      if (!g.cols.has(kc)) g.cols.set(kc, rptNewCell());
      rptAdd(g.cols.get(kc), m, r);
      if (!colTotals.has(kc)) colTotals.set(kc, rptNewCell());
      rptAdd(colTotals.get(kc), m, r);
    }
    if (d2) {
      let s = g.subs.get(k2);
      if (!s) { s = { cell: rptNewCell(), cols: new Map() }; g.subs.set(k2, s); }
      rptAdd(s.cell, m, r);
      if (dc) {
        if (!s.cols.has(kc)) s.cols.set(kc, rptNewCell());
        rptAdd(s.cols.get(kc), m, r);
      }
    }
  });
  const val = c => rptValue(c, m, cfg.agg);
  const r1Keys = rptSortKeys([...groups.keys()], d1, cfg.sort, k => val(groups.get(k).cell));
  const colKeys = dc ? rptSortKeys([...colTotals.keys()], dc, 'label') : [];
  const r2Keys = {};
  if (d2) r1Keys.forEach(k => { const g = groups.get(k); r2Keys[k] = rptSortKeys([...g.subs.keys()], d2, cfg.sort, k2 => val(g.subs.get(k2).cell)); });
  return { cfg, S, m, d1, d2, dc, rows, groups, colTotals, grand, r1Keys, r2Keys, colKeys, val };
}

// ---------------- jalankan & tampilkan ----------------
function runReport(readControls = true) {
  if (!rpt) return;
  if (readControls) rptReadControls();
  const S = rptSource();
  if (!S.available()) {
    document.getElementById('rpt-table').innerHTML = '<div class="p-8 text-center text-slate-400">Anda tidak punya akses ke sumber data ini.</div>';
    return;
  }
  rptStore();
  const res = rptCompute(rpt);
  rptLast = res;
  rptRenderKpi(res);
  rptRenderTable(res);
  rptRenderChart(res);
}

function rptAggLabel(res) {
  const { m, cfg } = res;
  if (m.count || m.distinct) return m.label;
  return ({ sum: '', avg: 'Rata-rata ', min: 'Terkecil ', max: 'Terbesar ' })[cfg.agg] + m.label;
}

function rptPeriodText(cfg) {
  if (!cfg.from && !cfg.to) return 'Semua periode';
  return `${cfg.from ? formatDateID(cfg.from) : '...'} s/d ${cfg.to ? formatDateID(cfg.to) : '...'}`;
}

function rptFilterText(res) {
  const dims = rptDims(res.S);
  const parts = Object.entries(res.cfg.filters || {}).map(([k, v]) => `${dims[k].label}: ${v.map(x => rptLabel(dims[k], x)).join(', ')}`);
  return parts.join(' | ') || 'Tanpa filter';
}

function rptRenderKpi(res) {
  const { m, val, groups, r1Keys, d1 } = res;
  const grandVal = val(res.grand);
  let topKey = null, topVal = -Infinity;
  r1Keys.forEach(k => { const v = val(groups.get(k).cell); if (v > topVal) { topVal = v; topKey = k; } });
  const avg = r1Keys.length ? grandVal / r1Keys.length : 0;
  const card = (icon, color, label, value, sub = '') => `
    <div class="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><i class="fa-solid ${icon} ${color}"></i>${esc(label)}</div>
      <div class="mt-1 text-lg font-extrabold text-slate-800 truncate" title="${esc(value)}">${esc(value)}</div>
      ${sub ? `<div class="text-[10px] text-slate-400 truncate" title="${esc(sub)}">${esc(sub)}</div>` : ''}
    </div>`;
  document.getElementById('rpt-kpi').innerHTML =
    card('fa-database', 'text-slate-500', 'Jumlah Data', res.rows.length.toLocaleString('id-ID'), `${res.S.label}`) +
    card('fa-calculator', 'text-indigo-500', rptAggLabel(res), rptFmt(m, grandVal), rptPeriodText(res.cfg)) +
    card('fa-layer-group', 'text-emerald-500', `Rata-rata per ${d1.label}`, rptFmt(m, avg), `${r1Keys.length} ${d1.label}`) +
    card('fa-trophy', 'text-amber-500', `${d1.label} Tertinggi`, topKey === null ? '-' : rptLabel(d1, topKey), topKey === null ? '' : rptFmt(m, topVal));
}

function rptRenderTable(res) {
  const { m, val, groups, colTotals, r1Keys, r2Keys, colKeys, d1, d2, dc, cfg } = res;
  const S = res.S;
  document.getElementById('rpt-table-title').textContent = `${rptAggLabel(res)} per ${d1.label}${d2 ? ' › ' + d2.label : ''}${dc ? ' × ' + dc.label : ''}`;
  document.getElementById('rpt-table-note').textContent = `${S.label} · ${rptPeriodText(cfg)} · ${rptFilterText(res)}`;
  if (!res.rows.length) {
    document.getElementById('rpt-table').innerHTML = '<div class="p-10 text-center text-slate-400"><i class="fa-regular fa-folder-open text-3xl mb-2 block"></i>Tidak ada data untuk periode / filter ini.</div>';
    return;
  }
  const grandVal = val(res.grand);
  const td = (v, i, j, k, cls = '') => `<td class="py-2 px-3 text-right whitespace-nowrap ${cls}"><a href="javascript:void(0)" onclick="rptDrill(${i},${j},${k})" class="hover:underline hover:text-indigo-700">${v ? rptFmt(m, v) : '<span class="text-slate-300">-</span>'}</a></td>`;
  const pct = v => (grandVal && cfg.agg === 'sum' && !m.distinct ? `<span class="ml-1 text-[10px] text-slate-400 font-normal">${(v / grandVal * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%</span>` : '');
  const head = `<thead class="sticky top-0 z-10"><tr class="bg-slate-900 text-white text-[11px] uppercase tracking-wider">
    <th class="py-2.5 px-3 text-left sticky left-0 bg-slate-900 z-20">${esc(d1.label)}${d2 ? ` <span class="text-slate-400">› ${esc(d2.label)}</span>` : ''}</th>
    ${dc ? colKeys.map(k => `<th class="py-2.5 px-3 text-right whitespace-nowrap">${esc(rptLabel(dc, k))}</th>`).join('') : ''}
    <th class="py-2.5 px-3 text-right whitespace-nowrap bg-indigo-700">${dc ? 'Total' : esc(rptAggLabel(res))}</th></tr></thead>`;
  let body = '';
  r1Keys.forEach((k1, i) => {
    const g = groups.get(k1);
    const rowCells = (cols, j, cls) => (dc ? colKeys.map((kc, kk) => td(val(cols.get(kc)), i, j, kk, cls)).join('') : '');
    body += `<tr class="${d2 ? 'bg-indigo-50/70 font-bold text-slate-800' : 'hover:bg-slate-50'} border-b border-slate-100">
      <td class="py-2 px-3 sticky left-0 ${d2 ? 'bg-indigo-50' : 'bg-white'} font-semibold">${esc(rptLabel(d1, k1))}${d2 ? ` <span class="text-[10px] font-normal text-slate-400">(${g.subs.size})</span>` : ''}</td>
      ${rowCells(g.cols, -1, '')}
      <td class="py-2 px-3 text-right whitespace-nowrap font-bold bg-slate-50"><a href="javascript:void(0)" onclick="rptDrill(${i},-1,-1)" class="hover:underline hover:text-indigo-700">${rptFmt(m, val(g.cell))}</a>${pct(val(g.cell))}</td></tr>`;
    if (d2) {
      (r2Keys[k1] || []).forEach((k2, j) => {
        const s = g.subs.get(k2);
        body += `<tr class="hover:bg-slate-50 border-b border-slate-100 text-slate-600">
          <td class="py-1.5 px-3 pl-8 sticky left-0 bg-white">${esc(rptLabel(d2, k2))}</td>
          ${dc ? colKeys.map((kc, kk) => td(val(s.cols.get(kc)), i, j, kk)).join('') : ''}
          ${td(val(s.cell), i, j, -1, 'bg-slate-50/60')}</tr>`;
      });
    }
  });
  const foot = `<tfoot class="sticky bottom-0"><tr class="bg-slate-800 text-white font-extrabold">
    <td class="py-2.5 px-3 sticky left-0 bg-slate-800">GRAND TOTAL</td>
    ${dc ? colKeys.map((kc, kk) => `<td class="py-2.5 px-3 text-right whitespace-nowrap"><a href="javascript:void(0)" onclick="rptDrill(-1,-1,${kk})" class="hover:underline">${rptFmt(m, val(colTotals.get(kc)))}</a></td>`).join('') : ''}
    <td class="py-2.5 px-3 text-right whitespace-nowrap bg-indigo-700"><a href="javascript:void(0)" onclick="rptDrill(-1,-1,-1)" class="hover:underline">${rptFmt(m, grandVal)}</a></td></tr></tfoot>`;
  document.getElementById('rpt-table').innerHTML = `<table class="w-full text-xs">${head}<tbody>${body}</tbody>${foot}</table>`;
}

function rptRenderChart(res) {
  const card = document.getElementById('rpt-chart-card');
  if (rptChartObj) { rptChartObj.destroy(); rptChartObj = null; }
  const type = res.cfg.chart;
  if (type === 'none' || !res.rows.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const { m, val, groups, colKeys, r1Keys, d1, dc } = res;
  const MAX_ROWS = type === 'doughnut' ? 10 : 25, MAX_COLS = 10;
  let keys = r1Keys, note = '';
  if (keys.length > MAX_ROWS) {
    // Grafik menampilkan nilai terbesar saja supaya terbaca; tabel tetap lengkap.
    keys = [...r1Keys].sort((a, b) => val(groups.get(b).cell) - val(groups.get(a).cell)).slice(0, MAX_ROWS);
    keys = r1Keys.filter(k => keys.includes(k));
    note = `Grafik: ${MAX_ROWS} ${d1.label} dengan nilai terbesar dari ${r1Keys.length} (tabel tetap lengkap).`;
  }
  const labels = keys.map(k => rptLabel(d1, k));
  let datasets;
  const useCols = dc && type !== 'doughnut';
  if (useCols) {
    let cks = colKeys;
    if (cks.length > MAX_COLS) {
      cks = [...colKeys].sort((a, b) => val(res.colTotals.get(b)) - val(res.colTotals.get(a))).slice(0, MAX_COLS);
      note += ` Kolom: ${MAX_COLS} terbesar dari ${colKeys.length}.`;
    }
    datasets = cks.map((kc, i) => ({
      label: rptLabel(dc, kc),
      data: keys.map(k => val(groups.get(k).cols.get(kc))),
      backgroundColor: RPT_COLORS[i % RPT_COLORS.length], borderColor: RPT_COLORS[i % RPT_COLORS.length],
      borderWidth: type === 'line' ? 2 : 0, tension: 0.3, borderRadius: type === 'line' ? 0 : 4,
    }));
  } else {
    const data = keys.map(k => val(groups.get(k).cell));
    datasets = [{
      label: rptAggLabel(res), data,
      backgroundColor: type === 'doughnut' ? keys.map((_, i) => RPT_COLORS[i % RPT_COLORS.length]) : (type === 'line' ? 'rgba(79,70,229,.15)' : '#4f46e5'),
      borderColor: type === 'doughnut' ? '#fff' : '#4f46e5', borderWidth: type === 'doughnut' ? 2 : (type === 'line' ? 2.5 : 0),
      fill: type === 'line', tension: 0.3, borderRadius: type === 'line' || type === 'doughnut' ? 0 : 4,
    }];
  }
  document.getElementById('rpt-chart-title').textContent = `${rptAggLabel(res)} per ${d1.label}${useCols ? ' × ' + dc.label : ''}`;
  document.getElementById('rpt-chart-note').textContent = note.trim();
  const fmtTick = v => (rptIsMoney(m) ? 'Rp ' + rptCompact(Number(v)) : rptCompact(Number(v)));
  const stacked = type === 'stacked';
  const horizontal = type === 'hbar';
  const chartType = type === 'doughnut' ? 'doughnut' : type === 'line' ? 'line' : 'bar';
  const valueAxis = { beginAtZero: true, stacked, ticks: { callback: fmtTick, font: { size: 10 } }, grid: { color: '#f1f5f9' } };
  const catAxis = { stacked, ticks: { font: { size: 10 }, autoSkip: false, maxRotation: 50 }, grid: { display: false } };
  rptChartObj = new Chart(document.getElementById('rpt-chart'), {
    type: chartType,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? 'y' : 'x',
      onClick: (e, els) => {
        if (!els.length) return;
        const k1 = keys[els[0].index];
        const i = r1Keys.indexOf(k1);
        let kk = -1;
        if (useCols) kk = colKeys.indexOf(colKeys.find(kc => rptLabel(dc, kc) === datasets[els[0].datasetIndex].label));
        rptDrill(i, -1, kk);
      },
      plugins: {
        legend: { display: useCols || type === 'doughnut', position: type === 'doughnut' ? 'right' : 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label === rptAggLabel(res) ? c.label : c.dataset.label}: ${rptFmt(m, c.parsed.y ?? c.parsed.x ?? c.parsed)}` } },
      },
      scales: chartType === 'doughnut' ? {} : (horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis }),
    },
  });
}

// ---------------- rincian (drill-down) ----------------
function rptDrill(i, j, k) {
  const res = rptLast;
  if (!res) return;
  const k1 = i >= 0 ? res.r1Keys[i] : null;
  const k2 = j >= 0 && k1 !== null ? res.r2Keys[k1][j] : null;
  const kc = k >= 0 ? res.colKeys[k] : null;
  rptDrillRows = res.rows.filter(r =>
    (k1 === null || rptKey(res.d1, r) === k1) &&
    (k2 === null || rptKey(res.d2, r) === k2) &&
    (kc === null || rptKey(res.dc, r) === kc));
  const parts = [];
  if (k1 !== null) parts.push(`${res.d1.label}: ${rptLabel(res.d1, k1)}`);
  if (k2 !== null) parts.push(`${res.d2.label}: ${rptLabel(res.d2, k2)}`);
  if (kc !== null) parts.push(`${res.dc.label}: ${rptLabel(res.dc, kc)}`);
  document.getElementById('rpt-drill-title').textContent = `Rincian ${res.S.label} (${rptDrillRows.length.toLocaleString('id-ID')} data)`;
  document.getElementById('rpt-drill-sub').textContent = `${parts.join(' · ') || 'Semua data'} · ${rptPeriodText(res.cfg)}`;
  document.getElementById('rpt-drill-cols').classList.add('hidden');
  rptRenderDrill();
  document.getElementById('rpt-drill-modal').classList.remove('hidden');
}

// Kolom rincian yang tampil, per sumber data (disimpan di browser). Default = kolom bertanda tampil.
function rptDrillColKey() { return `rpt_drill_cols_${rptLast.cfg.source}`; }
function rptDrillVisible() {
  const all = rptLast.S.detail;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(rptDrillColKey()) || 'null'); } catch (e) { saved = null; }
  return all.filter(c => (Array.isArray(saved) ? saved.includes(c[0]) : c[3] !== false));
}

function toggleReportDrillCols() {
  const box = document.getElementById('rpt-drill-cols');
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
  const vis = rptDrillVisible().map(c => c[0]);
  box.innerHTML = `<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
    ${rptLast.S.detail.map(c => `<label class="flex items-center gap-1.5 cursor-pointer whitespace-nowrap"><input type="checkbox" value="${esc(c[0])}" ${vis.includes(c[0]) ? 'checked' : ''} onchange="rptDrillColsChange()" class="accent-indigo-600">${esc(c[0])}</label>`).join('')}
    <a href="javascript:void(0)" onclick="rptDrillColsReset()" class="text-rose-600 font-bold ml-auto">Kembalikan default</a></div>`;
  box.classList.remove('hidden');
}

function rptDrillColsChange() {
  const vals = [...document.querySelectorAll('#rpt-drill-cols input:checked')].map(i => i.value);
  try { localStorage.setItem(rptDrillColKey(), JSON.stringify(vals.length ? vals : [rptLast.S.detail[0][0]])); } catch (e) { /* abaikan */ }
  rptRenderDrill();
}

function rptDrillColsReset() {
  try { localStorage.removeItem(rptDrillColKey()); } catch (e) { /* abaikan */ }
  document.getElementById('rpt-drill-cols').classList.add('hidden');
  rptRenderDrill();
  toggleReportDrillCols();
}

function rptRenderDrill() {
  const cols = rptDrillVisible();
  const MAX = 1000;
  const shown = rptDrillRows.slice(0, MAX);
  const sums = cols.map(([, get, num]) => (num ? rptDrillRows.reduce((t, r) => t + (Number(get(r)) || 0), 0) : null));
  document.getElementById('rpt-drill-body').innerHTML = `<table class="w-full">
    <thead class="sticky top-0"><tr class="bg-slate-100 text-slate-600 text-[11px] uppercase">${cols.map(([h, , num]) => `<th class="py-2 px-3 ${num ? 'text-right' : 'text-left'} whitespace-nowrap">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${shown.map(r => `<tr class="border-b border-slate-100 hover:bg-slate-50">${cols.map(([, get, num]) => {
      const v = get(r);
      return `<td class="py-1.5 px-3 whitespace-nowrap ${num ? 'text-right font-semibold' : ''}">${num && typeof v === 'number' ? formatRupiah(v) : esc(v ?? '-')}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
    <tfoot class="sticky bottom-0"><tr class="bg-slate-800 text-white font-bold">${cols.map(([, , num], idx) => `<td class="py-2 px-3 ${num ? 'text-right whitespace-nowrap' : ''}">${idx === 0 ? 'TOTAL' : (num ? formatRupiah(sums[idx]) : '')}</td>`).join('')}</tr></tfoot>
  </table>${rptDrillRows.length > MAX ? `<p class="p-3 text-[11px] text-amber-700">Ditampilkan ${MAX} dari ${rptDrillRows.length} data. Export untuk melihat semuanya.</p>` : ''}`;
}

function exportReportDrill() {
  if (!rptLast || typeof XLSX === 'undefined') return;
  const cols = rptDrillVisible();
  const aoa = [cols.map(c => c[0]), ...rptDrillRows.map(r => cols.map(([, get]) => { const v = get(r); return v ?? ''; }))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rincian');
  XLSX.writeFile(wb, `Rincian_${rptLast.cfg.source}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------- export & print ----------------
function rptMatrix(res) {
  const { val, groups, colTotals, r1Keys, r2Keys, colKeys, d1, d2, dc } = res;
  const header = [d1.label + (d2 ? ' / ' + d2.label : ''), ...(dc ? colKeys.map(k => rptLabel(dc, k)) : []), dc ? 'Total' : rptAggLabel(res)];
  const body = [];
  r1Keys.forEach(k1 => {
    const g = groups.get(k1);
    body.push({ level: 1, cells: [rptLabel(d1, k1), ...(dc ? colKeys.map(kc => val(g.cols.get(kc))) : []), val(g.cell)] });
    if (d2) (r2Keys[k1] || []).forEach(k2 => {
      const s = g.subs.get(k2);
      body.push({ level: 2, cells: ['    ' + rptLabel(d2, k2), ...(dc ? colKeys.map(kc => val(s.cols.get(kc))) : []), val(s.cell)] });
    });
  });
  const total = ['GRAND TOTAL', ...(dc ? colKeys.map(kc => val(colTotals.get(kc))) : []), val(res.grand)];
  return { header, body, total };
}

function rptTitle(res) {
  const sel = document.getElementById('rpt-preset');
  const opt = sel.value ? sel.options[sel.selectedIndex].text : '';
  return opt || `${rptAggLabel(res)} per ${res.d1.label}`;
}

function exportReportExcel() {
  const res = rptLast;
  if (!res || !res.rows.length) { showToast('Tidak ada data untuk di-export.', 'error'); return; }
  if (typeof XLSX === 'undefined') { showToast('Library Excel belum termuat.', 'error'); return; }
  const { header, body, total } = rptMatrix(res);
  const info = [[rptTitle(res)], [`Sumber: ${res.S.label}`], [`Periode: ${rptPeriodText(res.cfg)}`], [`Filter: ${rptFilterText(res)}`],
    [`Dicetak: ${new Date().toLocaleString('id-ID')} oleh ${currentUser?.full_name || ''}`], []];
  const ws = XLSX.utils.aoa_to_sheet([...info, header, ...body.map(b => b.cells), total]);
  ws['!cols'] = header.map((_, i) => ({ wch: i === 0 ? 34 : 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pivot');
  const cols = res.S.detail;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cols.map(c => c[0]), ...res.rows.map(r => cols.map(([, get]) => get(r) ?? ''))]), 'Data');
  XLSX.writeFile(wb, `Report_${res.cfg.source}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function printReport() {
  const res = rptLast;
  if (!res || !res.rows.length) { showToast('Tidak ada data untuk dicetak.', 'error'); return; }
  const { header, body, total } = rptMatrix(res);
  const img = rptChartObj ? rptChartObj.toBase64Image() : '';
  const f = v => (typeof v === 'number' ? rptFmt(res.m, v) : esc(v));
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) { showToast('Pop-up diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.'); return; }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(rptTitle(res))}</title><style>
    @page { size: A4 landscape; margin: 10mm; } body { font-family: Arial, sans-serif; font-size: 9pt; color: #1e293b; }
    h1 { font-size: 14pt; margin: 0; } .meta { color: #475569; margin: 4px 0 10px; font-size: 8.5pt; line-height: 1.5; }
    .co { font-weight: 800; font-size: 11pt; border-bottom: 2px solid #1e293b; padding-bottom: 4px; margin-bottom: 8px; }
    img { max-width: 100%; max-height: 80mm; display: block; margin: 0 auto 10px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #cbd5e1; padding: 3px 6px; }
    th { background: #1e293b; color: #fff; font-size: 8pt; } td.n { text-align: right; white-space: nowrap; }
    tr.l1 td { background: #eef2ff; font-weight: bold; } tr.t td { background: #1e293b; color: #fff; font-weight: bold; }
  </style></head><body>
    <div class="co">PT PANCA PUTRA MADANI</div>
    <h1>${esc(rptTitle(res))}</h1>
    <div class="meta">Sumber: ${esc(res.S.label)} · Periode: ${esc(rptPeriodText(res.cfg))}<br>Filter: ${esc(rptFilterText(res))} · Jumlah data: ${res.rows.length}<br>Dicetak: ${esc(new Date().toLocaleString('id-ID'))} oleh ${esc(currentUser?.full_name || '')}</div>
    ${img ? `<img src="${img}">` : ''}
    <table><thead><tr>${header.map((h, i) => `<th${i ? ' style="text-align:right"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body.map(b => `<tr class="${b.level === 1 && res.d2 ? 'l1' : ''}">${b.cells.map((c, i) => `<td${i ? ' class="n"' : ''}>${f(c)}</td>`).join('')}</tr>`).join('')}
    <tr class="t">${total.map((c, i) => `<td${i ? ' class="n"' : ''}>${f(c)}</td>`).join('')}</tr></tbody></table>
    <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
  </body></html>`);
  win.document.close();
}

// ---------------- report favorit ----------------
async function saveReportPreset() {
  if (!rpt) return;
  rptReadControls();
  const sel = document.getElementById('rpt-preset').value;
  const current = sel.startsWith('s:') ? rptPresets.find(p => `s:${p.id}` === sel && (p.mine || IS_ADMIN)) : null;
  let id = null, name = '';
  if (current && await showConfirm(`Perbarui report favorit "${current.name}" dengan pengaturan sekarang? Pilih TIDAK untuk menyimpan sebagai report baru.`, { title: 'Simpan Report Favorit', yesText: 'PERBARUI', noText: 'SIMPAN BARU', danger: false })) {
    id = current.id; name = current.name;
  } else {
    const def = `${rptAggLabel(rptCompute(rpt))} per ${rptDims(rptSource())[rpt.row1].label}`;
    name = (window.prompt('Nama report favorit:', def) || '').trim();
    if (!name) return;
  }
  let shared = current && id ? !!current.is_shared : false;
  if (canEdit('report')) {
    shared = await showConfirm('Bagikan report ini ke semua pengguna menu Report? (Mereka hanya melihat data sesuai hak aksesnya masing-masing.)',
      { title: 'Bagikan Report?', yesText: 'BAGIKAN', noText: 'HANYA SAYA', danger: false });
  }
  const { source, from, to, filters, row1, row2, col, measure, agg, chart, sort } = rpt;
  try {
    const r = await api('api/reports.php?action=save', 'POST', { id, name, source, shared, config: { source, from, to, filters, row1, row2, col, measure, agg, chart, sort } });
    rptPresets = await api('api/reports.php');
    rptRenderPresetSelect(`s:${r.id}`);
    showToast('Report favorit tersimpan.');
  } catch (err) { showApiError(err); }
}

async function removeReportPreset() {
  const sel = document.getElementById('rpt-preset').value;
  const p = rptPresets.find(x => `s:${x.id}` === sel);
  if (!p) return;
  if (!(await showConfirm(`Hapus report favorit "${p.name}"? Data aslinya tidak ikut terhapus.`, { title: 'Hapus Report Favorit', danger: true, yesText: 'HAPUS' }))) return;
  try {
    await api('api/reports.php?action=delete', 'POST', { id: p.id });
    rptPresets = await api('api/reports.php');
    rptRenderPresetSelect('');
    showToast('Report favorit dihapus.');
  } catch (err) { showApiError(err); }
}
