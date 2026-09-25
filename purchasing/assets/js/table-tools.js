/**
 * TABLE TOOLS - fitur CARI & SORTIR untuk semua tabel dan daftar di aplikasi.
 *
 * Cara kerja (tanpa perlu mengubah fungsi render yang sudah ada):
 *  - Tabel: klik judul kolom untuk sortir naik / turun / kembali ke urutan asli.
 *    Kotak "Cari cepat" menyaring baris yang tampil (semua kata harus cocok).
 *  - Daftar / kartu: kotak cari + tombol sortir A-Z / Z-A.
 *  - Setiap kali tabel di-render ulang (data berubah, filter diganti), pencarian
 *    & sortir yang sedang aktif otomatis diterapkan lagi (MutationObserver).
 *
 * Baris yang tersembunyi oleh pencarian diberi atribut `hidden`. Fungsi hapus
 * massal (bulkVisibleIds / toggleBulkAll di app.js) mengabaikan baris ini,
 * jadi "Hapus Semua" hanya menghapus baris yang benar-benar terlihat.
 */
(function () {
  'use strict';

  const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });

  // ---------------------------------------------------------------------
  // Konfigurasi: tabel & daftar mana yang diberi fitur.
  // search:false = tabel sudah punya kotak pencarian sendiri, cukup tambah sortir.
  // ---------------------------------------------------------------------
  const TABLES = [
    { tbody: 'pr-table-body', search: false },
    { tbody: 'wo-tracking-tbody', search: false },
    { tbody: 'seal-table-tbody', search: true, placeholder: 'Cari WO, project, part, dimensi...' },
    { tbody: 'transport-table-tbody', search: true, placeholder: 'Cari WO, tujuan, kendaraan, driver...' },
    { tbody: 'supplier-detail-tbody', search: false },
    { tbody: 'stok-table-tbody', search: true, placeholder: 'Cari SKU, nama material, kategori...' },
    { tbody: 'incoming-table-tbody', search: true, placeholder: 'Cari No. PR, barang, supplier...' },
    { tbody: 'receiving-table-tbody', search: false },
    { tbody: 'produksi-table-tbody', search: true, placeholder: 'Cari No. produksi, WO, produk...' },
    { tbody: 'riwayat-table-tbody', search: true, placeholder: 'Cari material, tipe, sumber, keterangan...' },
    { tbody: 'mtc-dash-matrix-tbody', search: false },
    { tbody: 'cashflow-tbody', search: false },
    { tbody: 'ar-tbody', search: false },
    { tbody: 'ap-tbody', search: false },
    { tbody: 'talangan-tbody', search: true, placeholder: 'Cari nama, keterangan, status...' },
  ];

  // key: elemen di dalam item yang dipakai untuk sortir A-Z (default: teks item).
  const LISTS = [
    { el: 'master-product-list', placeholder: 'Cari product...' },
    { el: 'master-buyer-list', placeholder: 'Cari buyer...' },
    { el: 'master-karyawan-list', placeholder: 'Cari karyawan / divisi...' },
    { el: 'mtc-mesin-list', placeholder: 'Cari mesin...' },
    { el: 'mtc-mp-list', placeholder: 'Cari tarif / divisi...' },
    { el: 'master-user-list', placeholder: 'Cari nama, username, role...' },
    { el: 'master-role-list', placeholder: 'Cari role...' },
    { el: 'mtcdivisi-records-list', placeholder: 'Cari divisi, item, surat jalan...' },
    { el: 'customer-cards-container', search: false, key: 'h4, h3, .font-bold' },
  ];

  const INPUT_CLASS = 'w-full pl-8 pr-7 py-1.5 bg-white border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none';

  // ---------------------------------------------------------------------
  // Util
  // ---------------------------------------------------------------------

  /** Normalisasi teks untuk pencarian: huruf kecil, spasi rapat. */
  function norm(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Ubah isi sel jadi nilai yang bisa disortir:
   *  - tanggal DD/MM/YYYY atau YYYY-MM-DD  -> angka YYYYMMDD
   *  - angka / rupiah format Indonesia (Rp 1.250.000,50) -> number
   *  - selain itu -> teks
   */
  function sortValue(cell) {
    if (!cell) return { empty: true };
    if (cell.dataset && cell.dataset.sort !== undefined) {
      const n = Number(cell.dataset.sort);
      return isNaN(n) ? { text: cell.dataset.sort } : { num: n };
    }
    const full = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    if (full === '' || full === '-' || full === '—') return { empty: true };
    const first = full.split(' ').slice(0, 3).join(' ');

    let m = full.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return { num: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
    m = full.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { num: Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) };

    const numText = first.replace(/^Rp\.?\s*/i, '').replace(/\s*(%|pcs|unit|kg)$/i, '').replace(/\s/g, '');
    if (/^-?\d+\.\d{1,2}$/.test(numText)) return { num: parseFloat(numText) }; // 12.50 (desimal titik)
    if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(numText) || /^-?\d+(,\d+)?$/.test(numText)) {
      return { num: parseFloat(numText.replace(/\./g, '').replace(',', '.')) };
    }
    return { text: full };
  }

  /** Bandingkan dua nilai sortir. Kosong selalu di bawah, angka sebelum teks. */
  function compareValues(a, b) {
    if (a.empty || b.empty) return a.empty && b.empty ? 0 : (a.empty ? 1 : -1);
    const aNum = a.num !== undefined, bNum = b.num !== undefined;
    if (aNum && bNum) return a.num - b.num;
    if (aNum !== bNum) return aNum ? -1 : 1;
    return collator.compare(a.text, b.text);
  }

  function makeSearchBox(placeholder, onInput) {
    const wrap = document.createElement('div');
    wrap.className = 'relative flex-1 min-w-[180px] max-w-sm';
    wrap.innerHTML = `
      <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]"></i>
      <input type="search" class="${INPUT_CLASS}" placeholder="${placeholder || 'Cari cepat...'}" autocomplete="off">`;
    const input = wrap.querySelector('input');
    input.addEventListener('input', () => onInput(input.value));
    return { wrap, input };
  }

  /** Jalankan fn tanpa memicu observer kita sendiri. */
  function silently(state, fn) {
    state.observer.disconnect();
    try { fn(); } finally { state.observer.observe(state.container, { childList: true }); }
  }

  // ---------------------------------------------------------------------
  // TABEL
  // ---------------------------------------------------------------------

  function enhanceTable(cfg) {
    const tbody = document.getElementById(cfg.tbody);
    if (!tbody || tbody.dataset.tt) return;
    const table = tbody.closest('table');
    if (!table) return;
    tbody.dataset.tt = '1';

    const state = { cfg, container: tbody, table, query: '', col: null, dir: 0, originalOrder: new WeakMap(), seq: 0 };

    // --- Toolbar (cari + jumlah data) di atas area scroll tabel.
    const toolbar = document.createElement('div');
    toolbar.className = 'tt-toolbar flex flex-wrap items-center gap-2 mb-2';
    if (cfg.search) {
      const { wrap } = makeSearchBox(cfg.placeholder, q => { state.query = q; apply(state); });
      toolbar.appendChild(wrap);
    }
    const info = document.createElement('span');
    info.className = 'tt-info text-[11px] text-slate-400 font-semibold ml-auto';
    toolbar.appendChild(info);
    state.info = info;
    const anchor = table.parentElement && /overflow/.test(table.parentElement.className) ? table.parentElement : table;
    anchor.parentElement.insertBefore(toolbar, anchor);

    // --- Klik judul kolom = sortir (delegasi, jadi tetap jalan walau thead dibuat ulang).
    const thead = table.tHead;
    if (thead) {
      thead.addEventListener('click', e => {
        const th = e.target.closest('th');
        if (!th || !thead.contains(th) || !isSortable(th)) return;
        if (e.target.closest('input, button, select, a, label')) return;
        const col = [...th.parentElement.children].indexOf(th);
        if (state.col !== col) { state.col = col; state.dir = 1; }
        else { state.dir = state.dir === 1 ? -1 : (state.dir === -1 ? 0 : 1); }
        if (state.dir === 0) state.col = null;
        apply(state);
      });
      decorateHeader(state);
      new MutationObserver(() => decorateHeader(state)).observe(thead, { childList: true, subtree: true });
    }

    state.observer = new MutationObserver(() => apply(state, true));
    state.observer.observe(tbody, { childList: true });
    apply(state, true);
  }

  function isSortable(th) {
    const text = norm(th.textContent);
    return text !== '' && text !== 'aksi' && !th.querySelector('input[type=checkbox]');
  }

  /** Tambah ikon ↕ / ▲ / ▼ di judul kolom. */
  function decorateHeader(state) {
    const row = state.table.tHead && state.table.tHead.rows[state.table.tHead.rows.length - 1];
    if (!row) return;
    [...row.cells].forEach((th, i) => {
      if (!isSortable(th)) return;
      let icon = th.querySelector('.tt-sort-icon');
      if (!icon) {
        icon = document.createElement('i');
        th.appendChild(icon);
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.title = 'Klik untuk sortir';
      }
      const active = state.col === i && state.dir !== 0;
      const cls = 'tt-sort-icon fa-solid ml-1 text-[9px] ' +
        (active ? (state.dir === 1 ? 'fa-sort-up opacity-100' : 'fa-sort-down opacity-100') : 'fa-sort opacity-30');
      if (icon.className !== cls) icon.className = cls;
    });
  }

  /**
   * Kelompokkan baris: baris data utama + baris "detail" yang menempel di
   * bawahnya (baris dengan 1 sel colspan, mis. rincian yang bisa dibuka-tutup).
   */
  function rowGroups(tbody) {
    const groups = [];
    [...tbody.rows].forEach(tr => {
      const isAttached = tr.cells.length === 1 && tr.cells[0].colSpan > 1 && groups.length > 0;
      if (isAttached) groups[groups.length - 1].push(tr);
      else groups.push([tr]);
    });
    return groups;
  }

  function apply(state, rerendered = false) {
    const tbody = state.container;
    const groups = rowGroups(tbody);
    // Baris "Belum ada data" (1 sel colspan saja) -> tidak ada yang perlu diolah.
    const dataGroups = groups.filter(g => !(g[0].cells.length === 1 && g[0].cells[0].colSpan > 1));

    silently(state, () => {
      if (rerendered) {
        state.seq = 0;
        dataGroups.forEach(g => state.originalOrder.set(g[0], state.seq++));
      }

      // Cari
      const terms = norm(state.query).split(' ').filter(Boolean);
      let shown = 0;
      dataGroups.forEach(g => {
        const hay = norm(g.map(tr => tr.textContent).join(' '));
        const match = terms.every(t => hay.includes(t));
        g.forEach(tr => { tr.hidden = !match; });
        if (match) shown++;
      });

      // Sortir (atau kembalikan urutan asli)
      const ordered = [...dataGroups];
      if (state.col !== null && state.dir !== 0) {
        const keyed = ordered.map(g => ({ g, v: sortValue(g[0].cells[state.col]), o: state.originalOrder.get(g[0]) ?? 0 }));
        keyed.sort((a, b) => {
          const c = compareValues(a.v, b.v);
          if (a.v.empty || b.v.empty) return c || a.o - b.o; // kosong tetap di bawah
          return (c * state.dir) || (a.o - b.o);
        });
        ordered.splice(0, ordered.length, ...keyed.map(k => k.g));
      } else {
        ordered.sort((a, b) => (state.originalOrder.get(a[0]) ?? 0) - (state.originalOrder.get(b[0]) ?? 0));
      }
      const frag = document.createDocumentFragment();
      ordered.forEach(g => g.forEach(tr => frag.appendChild(tr)));
      tbody.appendChild(frag);

      // Pesan kalau pencarian tidak menemukan apa-apa.
      let empty = tbody.querySelector('tr.tt-empty');
      if (terms.length && shown === 0 && dataGroups.length) {
        if (!empty) {
          empty = document.createElement('tr');
          empty.className = 'tt-empty';
          const colCount = state.table.tHead ? state.table.tHead.rows[0].cells.length : 1;
          empty.innerHTML = `<td colspan="${colCount}" class="text-center py-6 text-slate-400 font-semibold"></td>`;
        }
        empty.cells[0].textContent = `Tidak ada data yang cocok dengan "${state.query.trim()}".`;
        tbody.appendChild(empty);
      } else if (empty) {
        empty.remove();
      }

      state.info.textContent = !dataGroups.length ? ''
        : (terms.length ? `${shown} dari ${dataGroups.length} data` : `${dataGroups.length} data`);
    });
    decorateHeader(state);

    // Beri tahu fitur hapus massal bahwa baris yang terlihat berubah.
    const bulkInput = tbody.querySelector('input[data-bulk]');
    if (bulkInput && typeof window.syncBulkBar === 'function') {
      try { window.syncBulkBar(bulkInput.dataset.bulk); } catch (e) { /* abaikan */ }
    }
  }

  // ---------------------------------------------------------------------
  // DAFTAR / KARTU
  // ---------------------------------------------------------------------

  function isPlaceholderItem(el) {
    return /text-center/.test(el.className) && el.children.length === 0;
  }

  function enhanceList(cfg) {
    const list = document.getElementById(cfg.el);
    if (!list || list.dataset.tt) return;
    list.dataset.tt = '1';
    const state = { cfg, container: list, query: '', dir: 0, originalOrder: new WeakMap() };

    const toolbar = document.createElement('div');
    toolbar.className = 'tt-toolbar flex items-center gap-2 mb-2';
    if (cfg.search !== false) {
      const { wrap } = makeSearchBox(cfg.placeholder, q => { state.query = q; applyList(state); });
      toolbar.appendChild(wrap);
    }
    const sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'shrink-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold text-slate-600 hover:bg-slate-100 flex items-center gap-1';
    sortBtn.title = 'Urutkan';
    sortBtn.addEventListener('click', () => { state.dir = state.dir === 1 ? -1 : (state.dir === -1 ? 0 : 1); applyList(state); });
    toolbar.appendChild(sortBtn);
    const info = document.createElement('span');
    info.className = 'text-[11px] text-slate-400 font-semibold ml-auto whitespace-nowrap';
    toolbar.appendChild(info);
    Object.assign(state, { sortBtn, info });

    // Letakkan di atas area scroll daftar (kalau ada), selain itu tepat di atas daftar.
    const anchor = list.parentElement && /overflow|max-h/.test(list.parentElement.className) && list.parentElement.children.length === 1
      ? list.parentElement : list;
    anchor.parentElement.insertBefore(toolbar, anchor);

    state.observer = new MutationObserver(() => applyList(state, true));
    state.observer.observe(list, { childList: true });
    applyList(state, true);
  }

  function itemKey(state, el) {
    const keyEl = state.cfg.key ? el.querySelector(state.cfg.key) : el.querySelector('.font-semibold, .font-bold');
    return (keyEl || el).textContent.replace(/\s+/g, ' ').trim();
  }

  function applyList(state, rerendered = false) {
    const list = state.container;
    const items = [...list.children].filter(el => !el.classList.contains('tt-empty') && !isPlaceholderItem(el));

    silently(state, () => {
      if (rerendered) items.forEach((el, i) => state.originalOrder.set(el, i));
      const terms = norm(state.query).split(' ').filter(Boolean);
      let shown = 0;
      items.forEach(el => {
        const match = terms.every(t => norm(el.textContent).includes(t));
        el.hidden = !match;
        if (match) shown++;
      });

      const ordered = [...items];
      if (state.dir !== 0) ordered.sort((a, b) => collator.compare(itemKey(state, a), itemKey(state, b)) * state.dir);
      else ordered.sort((a, b) => (state.originalOrder.get(a) ?? 0) - (state.originalOrder.get(b) ?? 0));
      const frag = document.createDocumentFragment();
      ordered.forEach(el => frag.appendChild(el));
      list.appendChild(frag);

      let empty = list.querySelector('.tt-empty');
      if (terms.length && shown === 0 && items.length) {
        if (!empty) {
          empty = document.createElement(list.tagName === 'UL' ? 'li' : 'div');
          empty.className = 'tt-empty col-span-full py-4 text-center text-slate-400 text-xs';
        }
        empty.textContent = `Tidak ada yang cocok dengan "${state.query.trim()}".`;
        list.appendChild(empty);
      } else if (empty) {
        empty.remove();
      }

      state.info.textContent = !items.length ? '' : (terms.length ? `${shown}/${items.length}` : `${items.length} data`);
    });

    state.sortBtn.innerHTML = state.dir === 1 ? '<i class="fa-solid fa-arrow-down-a-z"></i> A-Z'
      : state.dir === -1 ? '<i class="fa-solid fa-arrow-down-z-a"></i> Z-A'
      : '<i class="fa-solid fa-sort"></i> Urutkan';
  }

  // ---------------------------------------------------------------------
  function init() {
    TABLES.forEach(enhanceTable);
    LISTS.forEach(enhanceList);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.TableTools = { init, sortValue, compareValues };
})();
