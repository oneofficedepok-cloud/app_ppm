/**
 * Produksi -> Master Sealkit.
 *  - Daftar & form Master Sealkit (header cylinder + komponen seal).
 *  - Form WO: pilih No. Sealkit untuk WO tsb.
 *  - Form PR: saat No. WO dipilih dan WO punya sealkit, semua item sealkit otomatis
 *    masuk ke Detail Barang PR (Qty = qty sealkit x Qty WO / jumlah cylinder).
 * Memakai helper dari app.js: api, esc, opt, showToast, showConfirm, canEdit, customers, workOrders.
 */
let sealkits = [];
let sealkitsLoaded = false;
let skCurType = '';

async function loadSealkits(force = false) {
  if (sealkitsLoaded && !force) return sealkits;
  try {
    sealkits = await api('api/sealkits.php');
    sealkitsLoaded = true;
  } catch (e) {
    console.warn('Gagal memuat Master Sealkit:', e.message);
  }
  return sealkits;
}
document.addEventListener('DOMContentLoaded', () => {
  loadSealkits();
  const woCust = document.getElementById('wo-form-customer-select');
  if (woCust) woCust.addEventListener('change', () => fillWOSealkitSelect(document.getElementById('wo-form-sealkit-select').value));
  const woSk = document.getElementById('wo-form-sealkit-select');
  if (woSk) woSk.addEventListener('change', updateWOSealkitInfo);
});

const skTypeLabel = t => (t === 'H' ? 'H - Hydraulic' : t === 'P' ? 'P - Pneumatic' : '-');
const skFmtDate = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');
const skCanEdit = () => canEdit('sealkit');

// ===================== DAFTAR =====================
async function renderSealkitTab() {
  showSealkitList();
  await loadSealkits(true);
  renderSealkitList();
}

function showSealkitList() {
  document.getElementById('sk-view-form').classList.add('hidden');
  document.getElementById('sk-view-list').classList.remove('hidden');
  document.querySelectorAll('#tab-content-sealkit [data-sk-edit]').forEach(b => b.classList.toggle('hidden', !skCanEdit()));
  renderSealkitList();
}

function renderSealkitList() {
  const fc = document.getElementById('sk-f-cust');
  const curCust = fc.value;
  const usedCust = [...new Set(sealkits.map(s => String(s.customer_id || '')))];
  fc.innerHTML = '<option value="">Semua</option>' + customers.filter(c => usedCust.includes(String(c.id)))
    .map(c => opt(c.id, `${c.kode || '-'} - ${c.nama}`)).join('');
  fc.value = curCust;

  const q = document.getElementById('sk-q').value.trim().toLowerCase();
  const ft = document.getElementById('sk-f-type').value;
  const woBySk = {};
  (workOrders || []).forEach(w => { if (w.sealkit_id) (woBySk[w.sealkit_id] = woBySk[w.sealkit_id] || []).push(w.wo_number); });

  const rows = sealkits.filter(s => (!ft || s.cyl_type === ft) && (!fc.value || String(s.customer_id) === fc.value)
    && (!q || [s.sealkit_no, s.cylinder_name, s.customer_kode, s.customer_nama,
      ...s.items.map(i => `${i.part_name} ${i.part_type} ${i.part_no} ${i.material} ${i.dimension}`)].join(' ').toLowerCase().includes(q)));

  const editLbl = skCanEdit() ? '<i class="fa-solid fa-pen-to-square"></i>' : '<i class="fa-solid fa-eye"></i>';
  document.getElementById('sk-list-body').innerHTML = rows.map(s => `
    <tr class="hover:bg-teal-50/40">
      <td class="py-2.5 px-3 text-center">
        <div class="flex items-center justify-center gap-1.5">
          <button onclick="openSealkitForm(${s.id})" class="p-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg" title="${skCanEdit() ? 'Edit' : 'Lihat'} sealkit">${editLbl}</button>
          <button onclick="printSealkit(${s.id})" class="p-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg" title="Print sealkit"><i class="fa-solid fa-print"></i></button>
          <button onclick="deleteSealkit(${s.id})" class="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg" title="Hapus (Admin)"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </td>
      <td class="py-2.5 px-3 font-extrabold text-teal-800">${esc(s.sealkit_no)}</td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${s.cyl_type === 'H' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-orange-50 text-orange-700 border-orange-200'}">${skTypeLabel(s.cyl_type)}</span></td>
      <td class="py-2.5 px-3 font-bold">${esc(s.customer_kode || '-')}</td>
      <td class="py-2.5 px-3">${esc(s.customer_nama || '-')}</td>
      <td class="py-2.5 px-3 font-semibold">${esc(s.cylinder_name)}</td>
      <td class="py-2.5 px-3 text-center font-bold">${s.items.length}</td>
      <td class="py-2.5 px-3 text-slate-600">${esc((woBySk[s.id] || []).join(', ') || '-')}</td>
      <td class="py-2.5 px-3">${skFmtDate(s.tanggal)}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="py-8 text-center text-slate-400">Belum ada Master Sealkit. Klik "+ Tambah Sealkit".</td></tr>';
}

// ===================== FORM =====================
function openSealkitForm(id = null) {
  const s = id ? sealkits.find(x => x.id === id) : null;
  if (id && !s) return;
  document.getElementById('sk-id').value = s ? s.id : '';
  document.getElementById('sk-form-title').textContent = s ? `${skCanEdit() ? 'Edit' : 'Lihat'} Master Sealkit - ${s.sealkit_no}` : 'Form Master Sealkit - Tambah Baru';
  const cs = document.getElementById('sk-cust');
  cs.innerHTML = '<option value="">-- Pilih Kode Customer --</option>' + customers
    .filter(c => (c.kode || '').trim() && (c.status !== 'NON AKTIF' || (s && c.id === s.customer_id)))
    .sort((a, b) => String(a.kode).localeCompare(String(b.kode)))
    .map(c => opt(c.id, c.kode)).join('');
  cs.value = s ? s.customer_id : '';
  document.getElementById('sk-cyl').value = s ? s.cylinder_name : '';
  document.getElementById('sk-date').value = s ? String(s.tanggal || '').slice(0, 10) : new Date().toISOString().slice(0, 10);
  document.getElementById('sk-note').value = s ? (s.catatan || '') : '';
  document.querySelectorAll('#sk-type input').forEach(r => { r.checked = !!s && r.value === s.cyl_type; });
  skCurType = s ? s.cyl_type : '';
  setSealkitCustomer(false);
  setSealkitType(skCurType);
  document.getElementById('sk-item-body').innerHTML = '';
  (s && s.items.length ? s.items : [null]).forEach(it => addSealkitItem(it));

  const ro = !skCanEdit();
  document.querySelectorAll('#sk-view-form input, #sk-view-form select, #sk-view-form textarea').forEach(el => {
    if (el.id !== 'sk-no' && el.id !== 'sk-cust-nama') el.disabled = ro;
  });
  document.querySelectorAll('#tab-content-sealkit [data-sk-edit], #sk-item-body .sk-del').forEach(b => b.classList.toggle('hidden', ro));
  document.getElementById('sk-view-list').classList.add('hidden');
  document.getElementById('sk-view-form').classList.remove('hidden');
  document.getElementById('tab-content-sealkit').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setSealkitType(t) {
  skCurType = t;
  document.querySelectorAll('#sk-type .sk-type-opt').forEach(l => {
    const on = l.dataset.v === t;
    l.classList.toggle('bg-teal-600', on); l.classList.toggle('text-white', on); l.classList.toggle('border-teal-600', on);
    l.classList.toggle('bg-white', !on); l.classList.toggle('text-slate-700', !on);
  });
  refreshSealkitNo();
}

function setSealkitCustomer(refresh = true) {
  const c = customers.find(x => String(x.id) === document.getElementById('sk-cust').value);
  document.getElementById('sk-cust-nama').value = c ? c.nama : '';
  if (refresh) refreshSealkitNo();
}

/** No. Sealkit: edit dgn Type/Customer/Tahun sama -> nomor lama; selain itu minta nomor berikutnya ke server. */
let skNoReq = 0;
async function refreshSealkitNo() {
  const noEl = document.getElementById('sk-no');
  const c = customers.find(x => String(x.id) === document.getElementById('sk-cust').value);
  const year = (document.getElementById('sk-date').value || new Date().toISOString()).slice(0, 4);
  if (!skCurType || !c) { noEl.value = '(pilih Type & Kode Customer)'; return; }
  const s = sealkits.find(x => String(x.id) === document.getElementById('sk-id').value);
  if (s && s.cyl_type === skCurType && String(s.customer_id) === String(c.id) && String(s.tanggal || '').slice(0, 4) === year) {
    noEl.value = s.sealkit_no; return;
  }
  const req = ++skNoReq;
  try {
    const r = await api(`api/sealkits.php?action=next_number&type=${skCurType}&kode=${encodeURIComponent(c.kode || '')}&year=${year}`);
    if (req === skNoReq) noEl.value = r.sealkit_no;
  } catch (e) { noEl.value = '(otomatis saat disimpan)'; }
}

function addSealkitItem(it = null) {
  const v = it || { part_name: '', part_type: '', part_no: '', material: '', dimension: '', qty: 1, unit: 'Pc', keterangan: '' };
  const inp = 'w-full p-1.5 bg-white border border-slate-300 rounded-md';
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="py-1.5 px-2 text-center font-bold text-slate-500 sk-no-cell"></td>
    <td class="py-1.5 px-1"><input data-k="part_name" list="sk-dl-part" value="${esc(v.part_name)}" placeholder="Wiper Seal" class="${inp} font-semibold"></td>
    <td class="py-1.5 px-1"><input data-k="part_type" value="${esc(v.part_type)}" placeholder="W 002" class="${inp}"></td>
    <td class="py-1.5 px-1"><input data-k="part_no" value="${esc(v.part_no)}" placeholder="-" class="${inp}"></td>
    <td class="py-1.5 px-1"><input data-k="material" list="sk-dl-mat" value="${esc(v.material)}" placeholder="H-PU" class="${inp}"></td>
    <td class="py-1.5 px-1"><input data-k="dimension" value="${esc(v.dimension)}" placeholder="50 x 65 x L: 6 x H: 9 mm" class="${inp}"></td>
    <td class="py-1.5 px-1"><input data-k="qty" type="number" min="0.01" step="any" value="${esc(Number(v.qty) || 1)}" class="${inp} text-center font-bold"></td>
    <td class="py-1.5 px-1"><input data-k="unit" value="${esc(v.unit || 'Pc')}" class="${inp} text-center"></td>
    <td class="py-1.5 px-1"><input data-k="keterangan" value="${esc(v.keterangan)}" placeholder="Keterangan" class="${inp}"></td>
    <td class="py-1.5 px-1 text-center"><button type="button" onclick="this.closest('tr').remove(); renumSealkitItems();" class="sk-del p-1.5 text-rose-600 hover:bg-rose-50 rounded-md" title="Hapus item"><i class="fa-solid fa-xmark"></i></button></td>`;
  document.getElementById('sk-item-body').appendChild(tr);
  renumSealkitItems();
  if (!it) tr.querySelector('input').focus({ preventScroll: true });
}
function renumSealkitItems() {
  [...document.getElementById('sk-item-body').rows].forEach((r, i) => { r.querySelector('.sk-no-cell').textContent = i + 1; });
}

async function saveSealkit() {
  if (!skCurType) return showToast('Pilih Type Cylinder (H / P) dulu.', 'error');
  if (!document.getElementById('sk-cust').value) return showToast('Pilih Kode Customer dulu.', 'error');
  const cyl = document.getElementById('sk-cyl').value.trim().toUpperCase();
  if (!cyl) return showToast('Cylinder Name wajib diisi.', 'error');
  const items = [...document.getElementById('sk-item-body').rows].map(r => {
    const o = {};
    r.querySelectorAll('input[data-k]').forEach(i => { o[i.dataset.k] = i.value.trim(); });
    return o;
  }).filter(o => o.part_name || o.part_type || o.part_no || o.material || o.dimension);
  if (!items.length) return showToast('Tambahkan minimal 1 komponen sealkit.', 'error');
  const bad = items.findIndex(o => !o.part_name);
  if (bad >= 0) return showToast(`Item ke-${bad + 1}: Part Name wajib diisi.`, 'error');

  const id = document.getElementById('sk-id').value;
  const body = {
    cyl_type: skCurType, customer_id: document.getElementById('sk-cust').value, tanggal: document.getElementById('sk-date').value,
    cylinder_name: cyl, catatan: document.getElementById('sk-note').value, items,
  };
  const btn = document.getElementById('sk-save-btn');
  btn.disabled = true;
  try {
    const r = id ? await api('api/sealkits.php', 'PUT', { id: Number(id), ...body }) : await api('api/sealkits.php', 'POST', body);
    showToast(`Sealkit ${r.sealkit_no} tersimpan (${items.length} item).`);
    await loadSealkits(true);
    showSealkitList();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function deleteSealkit(id) {
  const s = sealkits.find(x => x.id === id);
  if (!s) return;
  if (!(await showConfirm(`Hapus Master Sealkit ${s.sealkit_no} (${s.cylinder_name})?`))) return;
  try {
    await api(`api/sealkits.php?id=${id}`, 'DELETE');
    showToast(`Sealkit ${s.sealkit_no} dihapus.`);
    await loadSealkits(true);
    renderSealkitList();
  } catch (e) { showToast(e.message, 'error'); }
}

function printSealkit(id) {
  const s = sealkits.find(x => x.id === id);
  if (!s) return;
  const w = window.open('', '_blank');
  if (!w) return showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak.', 'error');
  const rows = s.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.part_name)}</td><td>${esc(i.part_type)}</td><td>${esc(i.part_no)}</td><td>${esc(i.material)}</td><td>${esc(i.dimension)}</td><td class="c">${Number(i.qty)}</td><td class="c">${esc(i.unit)}</td><td>${esc(i.keterangan)}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Sealkit ${esc(s.sealkit_no)}</title><style>
    @page { size: A4 landscape; margin: 12mm; } body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
    h2 { margin: 0 0 2px; font-size: 16px; } .sub { color: #555; margin-bottom: 10px; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 16px; margin-bottom: 10px; } .meta b { display: inline-block; min-width: 110px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #333; padding: 4px 6px; } th { background: #e5e7eb; text-transform: uppercase; font-size: 10px; } .c { text-align: center; }
    .note { margin-top: 8px; } </style></head><body>
    <h2>MASTER SEALKIT CYLINDER</h2><div class="sub">PT Panca Putra Madani</div>
    <div class="meta"><div><b>No. Sealkit</b>: ${esc(s.sealkit_no)}</div><div><b>Type Cylinder</b>: ${skTypeLabel(s.cyl_type)}</div><div><b>Tanggal</b>: ${skFmtDate(s.tanggal)}</div>
    <div><b>Kode Customer</b>: ${esc(s.customer_kode || '-')}</div><div><b>Nama Customer</b>: ${esc(s.customer_nama || '-')}</div><div><b>Cylinder Name</b>: ${esc(s.cylinder_name)}</div></div>
    <table><thead><tr><th>No</th><th>Part Name</th><th>Type</th><th>Part No.</th><th>Material</th><th>Dimension</th><th>Qty</th><th>Unit</th><th>Keterangan</th></tr></thead><tbody>${rows}</tbody></table>
    ${s.catatan ? `<div class="note"><b>Catatan:</b> ${esc(s.catatan)}</div>` : ''}
    <script>window.onload = () => window.print();<\/script></body></html>`);
  w.document.close();
}

// ===================== FORM WO =====================
/** Isi pilihan No. Sealkit di form WO: sealkit milik customer WO (atau semua bila customer belum dipilih). */
async function fillWOSealkitSelect(selected = '') {
  const sel = document.getElementById('wo-form-sealkit-select');
  if (!sel) return;
  await loadSealkits();
  const custId = document.getElementById('wo-form-customer-select')?.value || '';
  const list = sealkits.filter(s => !custId || String(s.customer_id) === String(custId) || String(s.id) === String(selected));
  sel.innerHTML = `<option value="">-- Tanpa Sealkit${custId ? ` (${list.length} sealkit customer ini)` : ''} --</option>` +
    list.map(s => opt(s.id, `${s.sealkit_no} - ${s.cylinder_name} (${s.items.length} item)`)).join('');
  sel.value = list.some(s => String(s.id) === String(selected)) ? String(selected) : '';
  updateWOSealkitInfo();
}
function updateWOSealkitInfo() {
  const info = document.getElementById('wo-form-sealkit-info');
  if (!info) return;
  const s = sealkits.find(x => String(x.id) === document.getElementById('wo-form-sealkit-select').value);
  info.textContent = s
    ? `${s.items.length} item sealkit (${skTypeLabel(s.cyl_type)}) otomatis masuk ke PR saat No. WO ini dipilih — Qty x Qty WO.`
    : 'Item sealkit otomatis masuk ke PR saat No. WO ini dipilih (Qty x Qty WO).';
}

// ===================== FORM PR =====================
/** Blok item PR yang sudah diisi manual (selain item hasil sealkit). */
function prBlockHasManualData(b) {
  if (b.dataset.sealkit) return false;
  return ['.pri-type', '.pri-dimensi', '.pri-brand', '.pri-uom', '.pri-keterangan'].some(c => (b.querySelector(c)?.value || '').trim() !== '');
}

/** No. WO dipilih di form PR (mode tambah): isi Detail Barang dari Master Sealkit WO tsb. */
async function applySealkitToPR(w) {
  if (document.getElementById('form-id').value) return; // mode edit PR = 1 item, tidak diganti
  const container = document.getElementById('pr-items-container');
  const blocks = [...container.querySelectorAll('.pri-block')];
  const prevSk = blocks.some(b => b.dataset.sealkit);
  if (!w || !w.sealkit_id) {
    // Ganti ke WO tanpa sealkit -> buang item sealkit dari WO sebelumnya.
    if (prevSk) {
      blocks.filter(b => b.dataset.sealkit).forEach(b => b.remove());
      if (!container.querySelector('.pri-block')) addPRItemBlock();
      updatePRItemLabelsAndButtons();
    }
    return;
  }
  await loadSealkits();
  const s = sealkits.find(x => String(x.id) === String(w.sealkit_id));
  if (!s || !s.items.length) return;
  const mult = Number(w.qty) > 0 ? Number(w.qty) : 1;

  if (blocks.some(prBlockHasManualData)) {
    const ok = await showConfirm(`WO ${w.wo_number} memakai Sealkit ${s.sealkit_no} (${s.items.length} item). Ganti item yang sudah diisi dengan item sealkit?`,
      { title: 'Isi item dari Master Sealkit', yesText: 'GANTI DENGAN SEALKIT', noText: 'TIDAK', danger: false });
    if (!ok) return;
  }
  container.innerHTML = '';
  s.items.forEach(it => {
    const b = addPRItemBlock();
    b.dataset.sealkit = s.sealkit_no;
    setPRProductValue(b.querySelector('.pri-product'), it.part_name);
    b.querySelector('.pri-type').value = [it.part_type, it.part_no].filter(Boolean).join(' / ');
    b.querySelector('.pri-dimensi').value = it.dimension || '';
    b.querySelector('.pri-brand').value = it.material || '';
    b.querySelector('.pri-qty').value = Math.round(Number(it.qty) * mult * 100) / 100;
    b.querySelector('.pri-uom').value = it.unit || 'Pc';
    b.querySelector('.pri-keterangan').value = `Sealkit ${s.sealkit_no}${it.keterangan ? ' - ' + it.keterangan : ''}`;
    calcPRItemBlockTotal(b.querySelector('.pri-qty'));
  });
  updatePRItemLabelsAndButtons();
  showToast(`${s.items.length} item dari Sealkit ${s.sealkit_no} otomatis ditambahkan (Qty x ${mult}).`);
}
