<?php
require_once __DIR__ . '/includes/auth.php';

$user = require_login_redirect();
?>
<!DOCTYPE html>
<html lang="id" class="h-full bg-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Purchasing Cloud</title>

  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>

  <style>
    .custom-scrollbar::-webkit-scrollbar { height: 6px; width: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; border-radius: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
  </style>
</head>
<body class="h-full font-sans text-slate-800 antialiased flex flex-col min-h-screen">

  <!-- TOP HEADER -->
  <header class="bg-slate-900 text-white sticky top-0 z-30 shadow-md">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16 gap-4">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-xl shadow-lg">
            <i class="fa-solid fa-boxes-packing"></i>
          </div>
          <div>
            <h1 class="text-base sm:text-lg font-extrabold tracking-tight leading-none text-white flex items-center gap-2">
              PANCA PUTRA MADANI <span class="text-[10px] bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 px-2 py-0.5 rounded-full uppercase">PPM 2026</span>
            </h1>
            <p class="text-[11px] text-slate-400 mt-0.5">Sistem Purchasing, Work Order & Keuangan (Cash Flow / AR / AP)</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="downloadExcelTemplate()" class="hidden md:flex bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold transition items-center gap-1.5">
            <i class="fa-solid fa-file-csv"></i> Template Excel
          </button>
          <button onclick="exportToExcel()" class="hidden md:flex bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold transition items-center gap-1.5">
            <i class="fa-solid fa-file-export"></i> Export Excel
          </button>
          <button onclick="openWOModal('add')" class="bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md">
            <i class="fa-solid fa-folder-plus"></i> + WO Baru
          </button>
          <button onclick="openModal('add')" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md">
            <i class="fa-solid fa-plus-circle"></i> + PR Baru
          </button>

          <div class="pl-2 border-l border-slate-800 flex items-center gap-2">
            <div class="text-right hidden sm:block">
              <p class="text-xs font-bold text-white leading-tight"><?= esc_html($user['full_name']) ?></p>
              <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                <?= !empty($user['is_admin']) ? 'FULL ACCESS' : esc_html($user['divisi']) ?>
              </span>
            </div>
            <?php if (!empty($user['is_admin'])): ?>
            <button id="section-btn-admin" onclick="switchSection('admin')" class="bg-rose-700 hover:bg-rose-600 text-white p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 border border-rose-600">
              <i class="fa-solid fa-user-shield"></i>
              <span class="hidden sm:inline">Administrator</span>
            </button>
            <?php endif; ?>
            <a href="logout.php" onclick="return confirm('Yakin ingin logout?')" class="bg-slate-800 hover:bg-slate-700 text-slate-200 p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border border-slate-700">
              <i class="fa-solid fa-right-from-bracket text-rose-400"></i>
              <span class="hidden sm:inline">Logout</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- NAV TAB BAR -->
  <!-- LEVEL 1: PEMILIH MODUL (Overview / Purchasing / Finance) -->
  <nav class="bg-slate-900 sticky top-16 z-20 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex space-x-2 overflow-x-auto custom-scrollbar py-2.5 text-xs font-bold">
        <button id="section-btn-overview" onclick="switchSection('overview')" class="px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap">
          <i class="fa-solid fa-house"></i> DASHBOARD
        </button>
        <button id="section-btn-purchasing" onclick="switchSection('purchasing')" class="px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap">
          <i class="fa-solid fa-boxes-packing"></i> PURCHASING
        </button>
        <button id="section-btn-produksi" onclick="switchSection('produksi')" class="px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap">
          <i class="fa-solid fa-industry"></i> PRODUKSI
        </button>
        <button id="section-btn-masterdata" onclick="switchSection('masterdata')" class="px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap">
          <i class="fa-solid fa-database"></i> MASTER DATA
        </button>
        <button id="section-btn-gudang" onclick="switchSection('gudang')" class="px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap">
          <i class="fa-solid fa-warehouse"></i> GUDANG & PRODUKSI
        </button>
        <button id="section-btn-finance" onclick="switchSection('finance')" class="px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap">
          <i class="fa-solid fa-sack-dollar"></i> FINANCE
        </button>
        <button id="section-btn-mtc" onclick="switchSection('mtc')" class="px-4 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap">
          <i class="fa-solid fa-gears"></i> MTC PRODUKSI
        </button>
      </div>
    </div>
  </nav>

  <!-- LEVEL 2: SUB-MENU PURCHASING -->
  <nav id="subnav-purchasing" class="hidden bg-white border-b border-slate-200 sticky top-[104px] z-10 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex space-x-1 sm:space-x-2 overflow-x-auto custom-scrollbar py-2 text-xs font-bold">
        <button id="tab-btn-dashboard" onclick="switchTab('dashboard')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-table-cells"></i> PURCHASE REQUEST (PR)
        </button>
        <button id="tab-btn-transport" onclick="switchTab('transport')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-truck-fast text-blue-500"></i> TRANSPORTASI
        </button>
      </div>
    </div>
  </nav>

  <!-- LEVEL 2: SUB-MENU PRODUKSI -->
  <nav id="subnav-produksi" class="hidden bg-white border-b border-slate-200 sticky top-[104px] z-10 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex space-x-1 sm:space-x-2 overflow-x-auto custom-scrollbar py-2 text-xs font-bold">
        <button id="tab-btn-tracking" onclick="switchTab('tracking')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-diagram-project text-indigo-600"></i> WO & BUDGET
        </button>
        <button id="tab-btn-seal" onclick="switchTab('seal')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-compact-disc text-amber-500"></i> SEAL CNC
        </button>
      </div>
    </div>
  </nav>

  <!-- LEVEL 2: SUB-MENU MASTER DATA -->
  <nav id="subnav-masterdata" class="hidden bg-white border-b border-slate-200 sticky top-[104px] z-10 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex space-x-1 sm:space-x-2 overflow-x-auto custom-scrollbar py-2 text-xs font-bold">
        <button id="tab-btn-customers" onclick="switchTab('customers')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-building text-blue-600"></i> CUSTOMER
        </button>
        <button id="tab-btn-suppliers" onclick="switchTab('suppliers')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-truck-field-un text-purple-600"></i> SUPPLIER
        </button>
        <button id="tab-btn-master" onclick="switchTab('master')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-database text-slate-700"></i> MASTER DIRECTORY
        </button>
      </div>
    </div>
  </nav>

  <!-- LEVEL 2: SUB-MENU GUDANG & PRODUKSI -->
  <nav id="subnav-gudang" class="hidden bg-white border-b border-slate-200 sticky top-[104px] z-10 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex space-x-1 sm:space-x-2 overflow-x-auto custom-scrollbar py-2 text-xs font-bold">
        <button id="tab-btn-stok" onclick="switchTab('stok')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-cubes text-emerald-600"></i> STOK MATERIAL
        </button>
        <button id="tab-btn-incoming" onclick="switchTab('incoming')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-truck-ramp-box text-orange-600"></i> INCOMING GOODS
          <span id="incoming-badge" class="hidden bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">0</span>
        </button>
        <button id="tab-btn-receiving" onclick="switchTab('receiving')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-clipboard-check text-lime-600"></i> RECEIVING GOODS
        </button>
        <button id="tab-btn-produksi" onclick="switchTab('produksi')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-gears text-teal-600"></i> PRODUKSI & BOM
        </button>
        <button id="tab-btn-riwayat" onclick="switchTab('riwayat')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-clock-rotate-left text-cyan-600"></i> RIWAYAT PERGERAKAN
        </button>
      </div>
    </div>
  </nav>

  <!-- LEVEL 2: SUB-MENU FINANCE -->
  <nav id="subnav-finance" class="hidden bg-white border-b border-slate-200 sticky top-[104px] z-10 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex space-x-1 sm:space-x-2 overflow-x-auto custom-scrollbar py-2 text-xs font-bold">
        <button id="tab-btn-findash" onclick="switchTab('findash')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-chart-line text-emerald-600"></i> FINANCE DASHBOARD
        </button>
        <button id="tab-btn-cashflow" onclick="switchTab('cashflow')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-money-bill-transfer text-emerald-600"></i> CASH FLOW
        </button>
        <button id="tab-btn-ar" onclick="switchTab('ar')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-file-invoice-dollar text-amber-600"></i> AR (PIUTANG)
        </button>
        <button id="tab-btn-ap" onclick="switchTab('ap')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-receipt text-rose-600"></i> AP (HUTANG)
        </button>
        <button id="tab-btn-talangan" onclick="switchTab('talangan')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-hand-holding-dollar text-purple-600"></i> DANA TALANGAN
        </button>
      </div>
    </div>
  </nav>

  <!-- LEVEL 2: SUB-MENU MTC PRODUKSI -->
  <nav id="subnav-mtc" class="hidden bg-white border-b border-slate-200 sticky top-[104px] z-10 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex space-x-1 sm:space-x-2 overflow-x-auto custom-scrollbar py-2 text-xs font-bold">
        <button id="tab-btn-mtcdash" onclick="switchTab('mtcdash')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-chart-line text-indigo-600"></i> DASHBOARD MTC
        </button>
        <button id="tab-btn-mtcdivisi" onclick="switchTab('mtcdivisi')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-sitemap text-teal-600"></i> MODUL DIVISI PRODUKSI
        </button>
        <button id="tab-btn-mtcmaster" onclick="switchTab('mtcmaster')" class="px-3.5 py-2 rounded-xl transition flex items-center gap-2 whitespace-nowrap text-slate-600 hover:bg-slate-100">
          <i class="fa-solid fa-database text-amber-600"></i> MASTER DATA
        </button>
      </div>
    </div>
  </nav>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-grow w-full">

    <!-- 0. DASHBOARD OVERVIEW (gabungan Purchasing + Finance) -->
    <div id="tab-content-overview" class="space-y-6">
      <div class="bg-gradient-to-r from-slate-900 to-slate-700 text-white p-5 rounded-2xl shadow-sm">
        <h2 class="text-lg font-bold" id="overview-greeting">Selamat datang</h2>
        <p class="text-xs text-slate-300 mt-0.5" id="overview-date">-</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div class="flex justify-between items-start"><span class="text-[11px] font-bold text-slate-400 uppercase">Total Belanja Purchasing</span><span class="p-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs"><i class="fa-solid fa-cart-shopping"></i></span></div>
          <div id="ov-total-purchasing" class="text-lg font-bold text-slate-800 mt-2">Rp 0</div>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div class="flex justify-between items-start"><span class="text-[11px] font-bold text-slate-400 uppercase">Saldo Kas (Finance)</span><span class="p-2 bg-emerald-50 text-emerald-600 rounded-lg text-xs"><i class="fa-solid fa-wallet"></i></span></div>
          <div id="ov-saldo-kas" class="text-lg font-bold text-emerald-600 mt-2">Rp 0</div>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div class="flex justify-between items-start"><span class="text-[11px] font-bold text-slate-400 uppercase">Sisa Piutang (AR)</span><span class="p-2 bg-amber-50 text-amber-600 rounded-lg text-xs"><i class="fa-solid fa-hourglass-half"></i></span></div>
          <div id="ov-sisa-ar" class="text-lg font-bold text-amber-600 mt-2">Rp 0</div>
        </div>
        <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
          <div class="flex justify-between items-start"><span class="text-[11px] font-bold text-slate-400 uppercase">Sisa Hutang (AP)</span><span class="p-2 bg-rose-50 text-rose-600 rounded-lg text-xs"><i class="fa-solid fa-credit-card"></i></span></div>
          <div id="ov-sisa-ap" class="text-lg font-bold text-rose-600 mt-2">Rp 0</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col">
          <div class="flex items-center justify-between mb-1">
            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2"><i class="fa-solid fa-boxes-packing text-indigo-600"></i> Ringkasan Purchasing</h3>
            <button onclick="switchSection('purchasing')" class="text-[11px] font-bold text-indigo-600 hover:text-indigo-800">Buka Modul Purchasing <i class="fa-solid fa-arrow-right ml-0.5"></i></button>
          </div>
          <p class="text-[11px] text-slate-400 mb-3">Pengeluaran per Supplier (Termasuk PPN)</p>
          <div class="h-56 relative"><canvas id="chart-overview-purchasing"></canvas></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col">
          <div class="flex items-center justify-between mb-1">
            <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2"><i class="fa-solid fa-sack-dollar text-emerald-600"></i> Ringkasan Finance</h3>
            <button onclick="switchSection('finance')" class="text-[11px] font-bold text-emerald-600 hover:text-emerald-800">Buka Modul Finance <i class="fa-solid fa-arrow-right ml-0.5"></i></button>
          </div>
          <p class="text-[11px] text-slate-400 mb-3">Tren Debit/Kredit Cash Flow (10 transaksi terakhir)</p>
          <div class="h-56 relative"><canvas id="chart-overview-finance"></canvas></div>
        </div>
      </div>
    </div>

    <!-- 1. DASHBOARD & DETAIL PR -->
    <div id="tab-content-dashboard" class="hidden space-y-6">
      <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <div class="sm:col-span-2 lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase text-slate-400 tracking-wider">Grand Total Tagihan</p>
            <h2 id="kpi-total-spend" class="text-2xl font-extrabold text-slate-900 mt-1">Rp 0</h2>
            <p class="text-[11px] text-slate-500 mt-1">Akumulasi Pembayaran (Termasuk PPN)</p>
          </div>
          <div class="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-bold"><i class="fa-solid fa-wallet"></i></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase text-slate-400 tracking-wider">Total DPP</p>
            <h2 id="kpi-total-dpp" class="text-xl font-extrabold text-slate-800 mt-1">Rp 0</h2>
            <p class="text-[11px] text-slate-500 mt-1">Dasar Pengenaan Pajak</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg"><i class="fa-solid fa-file-invoice-dollar"></i></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase text-slate-400 tracking-wider">Total PPN (Pajak)</p>
            <h2 id="kpi-total-ppn" class="text-xl font-extrabold text-purple-600 mt-1">Rp 0</h2>
            <p class="text-[11px] text-purple-600 font-medium mt-1">PPN Terutang 11%/12%</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-lg"><i class="fa-solid fa-percent"></i></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase text-slate-400 tracking-wider">Selesai / Received</p>
            <h2 id="kpi-received-count" class="text-xl font-extrabold text-emerald-600 mt-1">0</h2>
            <p class="text-[11px] text-emerald-600 font-medium mt-1" id="kpi-received-percent">0% item</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg"><i class="fa-solid fa-circle-check"></i></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <p class="text-xs font-semibold uppercase text-slate-400 tracking-wider">Dibatalkan</p>
            <h2 id="kpi-cancel-count" class="text-xl font-extrabold text-rose-600 mt-1">0</h2>
            <p class="text-[11px] text-rose-500 font-medium mt-1" id="kpi-cancel-percent">0% item</p>
          </div>
          <div class="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-lg"><i class="fa-solid fa-circle-xmark"></i></div>
        </div>
      </section>

      <!-- Filter Bar -->
      <section class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2"><i class="fa-solid fa-filter text-indigo-600"></i> Multi-Column Filter & Quick Search</h3>
          <button onclick="resetFilters()" class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 sm:gap-4">
          <div class="sm:col-span-2 lg:col-span-2">
            <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Pencarian Multi-Kolom</label>
            <div class="relative">
              <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-3 text-slate-400 text-sm"></i>
              <input type="text" id="filter-search" oninput="applyFilters()" placeholder="Cari Type, Dimensi, WO, PO, Brand, Invoice..." class="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500">
            </div>
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Kategori (Sheet)</label>
            <select id="filter-sheet" onchange="applyFilters()" class="w-full py-2 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500">
              <option value="ALL">Semua Sheet</option><option value="PROJECT">PROJECT</option><option value="GENERAL">GENERAL</option><option value="CONSUMABLE">CONSUMABLE / GUDANG</option><option value="MAINTENANCE">MAINTENANCE</option><option value="INVENTARIS">INVENTARIS / ASET</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Status PR</label>
            <select id="filter-status" onchange="applyFilters()" class="w-full py-2 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500">
              <option value="ALL">Semua Status</option>
              <option value="RECEIVED">RECEIVED</option><option value="PO ISSUED">PO ISSUED</option>
              <option value="ON PROSES">ON PROSES</option><option value="STORE ROOM">STORE ROOM</option><option value="CANCEL">CANCEL</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Filter Pajak PPN</label>
            <select id="filter-ppn" onchange="applyFilters()" class="w-full py-2 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500">
              <option value="ALL">Semua Transaksi</option><option value="PPN">Kena PPN</option><option value="NON_PPN">Non-PPN</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Supplier</label>
            <select id="filter-supplier" onchange="applyFilters()" class="w-full py-2 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500">
              <option value="ALL">Semua Supplier</option>
            </select>
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Status Approval</label>
            <select id="filter-approval" onchange="applyFilters()" class="w-full py-2 px-3 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500">
              <option value="ALL">Semua</option>
              <option value="PENDING_LEADER">Menunggu Cek Leader</option>
              <option value="PENDING_MANAGER">Menunggu Approve Manager</option>
              <option value="APPROVED">Disetujui</option>
              <option value="REJECTED">Ditolak</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Charts -->
      <section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2"><i class="fa-solid fa-chart-column text-indigo-600"></i> Pengeluaran per Supplier (Rp)</h3>
            <span class="text-xs text-slate-400">Termasuk PPN</span>
          </div>
          <div class="h-60 relative"><canvas id="supplierChart"></canvas></div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-slate-800 text-sm sm:text-base flex items-center gap-2"><i class="fa-solid fa-chart-pie text-indigo-600"></i> Distribusi Status PR</h3>
            <span class="text-xs text-slate-400">Persentase (%)</span>
          </div>
          <div class="h-60 relative flex items-center justify-center"><canvas id="statusChart"></canvas></div>
        </div>
      </section>

      <!-- PR Table -->
      <section class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div class="p-5 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 class="font-bold text-slate-800 text-base">Detail Data Purchasing Request</h3>
            <p class="text-xs text-slate-400">Klik tombol Edit (pensil) pada baris item untuk melengkapi harga, supplier & logistik.</p>
          </div>
          <span id="table-count" class="bg-slate-100 text-slate-700 text-xs font-bold px-3 py-1 rounded-full">0 Items</span>
        </div>
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr class="bg-slate-50/80 text-slate-500 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
                <th class="py-3 px-3 text-center sticky left-0 z-20 bg-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
                <th class="py-3 px-3">Kat.</th>
                <th class="py-3 px-3">Tgl PR</th>
                <th class="py-3 px-3">No PR</th>
                <th class="py-3 px-3 text-center bg-indigo-50/60 text-indigo-900">No. Item</th>
                <th class="py-3 px-3">WO / Project / Customer</th>
                <th class="py-3 px-3">Product Part / Spesifikasi</th>
                <th class="py-3 px-3 text-center">Qty</th>
                <th class="py-3 px-3 text-right">Harga Satuan</th>
                <th class="py-3 px-3 text-right">DPP & PPN</th>
                <th class="py-3 px-3 text-right">Total Tagihan</th>
                <th class="py-3 px-3">Supplier & Logistik</th>
                <th class="py-3 px-3">No Invoice / No PO</th>
                <th class="py-3 px-3">Buyer/User & Divisi</th>
                <th class="py-3 px-3 text-center">Status</th>
                <th class="py-3 px-3 text-center bg-rose-50/60 text-rose-900">Approval</th>
                <th class="py-3 px-3 text-center">Drive</th>
              </tr>
            </thead>
            <tbody id="pr-table-body" class="divide-y divide-slate-100 text-xs text-slate-700"></tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- 2. TRACKING WO & BUDGET -->
    <div id="tab-content-tracking" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-diagram-project text-indigo-600"></i> Menu Tracking WO & Budget Manajemen</h3>
          <p class="text-xs text-slate-400">Pemantauan progress Work Order, Nilai PO, Total Seal CNC, Transportasi, Total Produksi, dan Profit & Loss (P/L)</p>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="openWOModal('add')" class="bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm"><i class="fa-solid fa-plus-circle"></i> + Tambah WO Baru</button>
          <button onclick="resetWOFilters()" class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"><i class="fa-solid fa-rotate-left"></i> Reset Filter</button>
        </div>
      </div>

      <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Pencarian WO / Project / Customer</label>
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-2.5 text-slate-400 text-xs"></i>
            <input type="text" id="filter-wo-search" oninput="renderWOTracking()" placeholder="Cari WO, Project, Customer..." class="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Filter Customer</label>
          <select id="filter-wo-customer" onchange="renderWOTracking()" class="w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"><option value="ALL">Semua Customer</option></select>
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Status Track</label>
          <select id="filter-wo-status" onchange="renderWOTracking()" class="w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
            <option value="ALL">Semua Status Track</option><option value="ON PROSES">ON PROSES</option><option value="RECEIVED">RECEIVED</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 bg-rose-50/60 border border-rose-100 rounded-xl px-4 py-2">
        <span id="bulk-count-wo" class="text-[11px] font-bold text-rose-800">Belum ada yang dipilih</span>
        <div class="flex items-center gap-2">
          <button id="bulk-del-selected-wo" onclick="bulkDelete('wo', 'selected')" disabled class="bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"><i class="fa-solid fa-trash-can"></i> Hapus Terpilih</button>
          <button id="bulk-del-all-wo" onclick="bulkDelete('wo', 'all')" class="bg-white hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed text-rose-700 border border-rose-300 px-3 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"><i class="fa-solid fa-dumpster"></i> Hapus Semua</button>
        </div>
      </div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-slate-100 text-slate-700 uppercase font-bold border-b border-slate-200 text-[10px] tracking-wider">
              <th class="py-3.5 px-3 text-center sticky left-0 z-20 bg-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]"><label class="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="bulk-all-wo" onchange="toggleBulkAll('wo', this.checked)" class="w-4 h-4 accent-rose-600 cursor-pointer" title="Pilih semua yang tampil"> Aksi</label></th>
              <th class="py-3.5 px-3">No. WO</th>
              <th class="py-3.5 px-3 text-center">Kategori</th>
              <th class="py-3.5 px-3">Nama Project</th>
              <th class="py-3.5 px-3">Customer</th>
              <th class="py-3.5 px-3 text-center">Est. Kirim</th>
              <th class="py-3.5 px-3 text-right bg-emerald-50 text-emerald-900">Total Nilai Jual (WO)</th>
              <th class="py-3.5 px-3 text-right">Budget Produksi</th>
              <th class="py-3.5 px-3 text-right">Aktual Produksi</th>
              <th class="py-3.5 px-3 text-right">Budget Pembelian</th>
              <th class="py-3.5 px-3 text-right bg-indigo-50 text-indigo-900">Aktual Pembelian (DPP)</th>
              <th class="py-3.5 px-3 text-right bg-amber-50 text-amber-900">Total Seal CNC (Auto)</th>
              <th class="py-3.5 px-3 text-right bg-blue-50 text-blue-900">Total Transportasi (Auto)</th>
              <th class="py-3.5 px-3 text-right">Total Lain-lain</th>
              <th class="py-3.5 px-3 text-right bg-slate-200 text-slate-900">Total Produksi</th>
              <th class="py-3.5 px-3 text-right bg-slate-900 text-amber-300">Profit & Loss (P/L)</th>
              <th class="py-3.5 px-3 text-center">Status Budget</th>
              <th class="py-3.5 px-3 text-center">Status Tracking</th>
              <th class="py-3.5 px-3 text-center">Status Track (PR)</th>
              <th class="py-3.5 px-3 text-center">Status Invoice</th>
            </tr>
          </thead>
          <tbody id="wo-tracking-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- 3. SEAL CNC -->
    <div id="tab-content-seal" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-compact-disc text-amber-500"></i> Menu Produksi & Pesanan SEAL CNC</h3>
          <p class="text-xs text-slate-400">Pencatatan item Seal CNC terikat Work Order (WO) dengan kalkulasi otomatis</p>
        </div>
        <button onclick="openSealModal('add')" class="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md"><i class="fa-solid fa-plus-circle"></i> + Tambah Data Seal CNC</button>
      </div>
      <div id="tf-bar-seal"></div>

      <div class="flex flex-wrap items-center justify-between gap-2 bg-rose-50/60 border border-rose-100 rounded-xl px-4 py-2">
        <span id="bulk-count-seal" class="text-[11px] font-bold text-rose-800">Belum ada yang dipilih</span>
        <div class="flex items-center gap-2">
          <button id="bulk-del-selected-seal" onclick="bulkDelete('seal', 'selected')" disabled class="bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"><i class="fa-solid fa-trash-can"></i> Hapus Terpilih</button>
          <button id="bulk-del-all-seal" onclick="bulkDelete('seal', 'all')" class="bg-white hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed text-rose-700 border border-rose-300 px-3 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"><i class="fa-solid fa-dumpster"></i> Hapus Semua</button>
        </div>
      </div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-amber-50 text-amber-900 uppercase font-bold border-b border-amber-200 text-[10px]">
              <th class="py-3.5 px-4 text-center sticky left-0 z-20 bg-amber-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]"><label class="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="bulk-all-seal" onchange="toggleBulkAll('seal', this.checked)" class="w-4 h-4 accent-rose-600 cursor-pointer" title="Pilih semua yang tampil"> Aksi</label></th>
              <th class="py-3.5 px-4">No. WO</th><th class="py-3.5 px-4">Nama Project</th><th class="py-3.5 px-4">Customer</th>
              <th class="py-3.5 px-4">Product Part</th><th class="py-3.5 px-4">Type</th><th class="py-3.5 px-4">Dimensi</th><th class="py-3.5 px-4">Brand</th>
              <th class="py-3.5 px-4 text-center">Qty</th><th class="py-3.5 px-4 text-right">Harga Satuan (Rp)</th><th class="py-3.5 px-4 text-right">Total (Rp)</th>
            </tr>
          </thead>
          <tbody id="seal-table-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- 4. TRANSPORTASI -->
    <div id="tab-content-transport" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-truck-fast text-blue-500"></i> Menu Logistik & Transportasi</h3>
          <p class="text-xs text-slate-400">Pencatatan pengiriman barang, moda transportasi, destinasi awal & tujuan per WO</p>
        </div>
        <button onclick="openTransportModal('add')" class="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md"><i class="fa-solid fa-plus-circle"></i> + Tambah Data Transportasi</button>
      </div>
      <div id="tf-bar-transport"></div>

      <div class="flex flex-wrap items-center justify-between gap-2 bg-rose-50/60 border border-rose-100 rounded-xl px-4 py-2">
        <span id="bulk-count-transport" class="text-[11px] font-bold text-rose-800">Belum ada yang dipilih</span>
        <div class="flex items-center gap-2">
          <button id="bulk-del-selected-transport" onclick="bulkDelete('transport', 'selected')" disabled class="bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"><i class="fa-solid fa-trash-can"></i> Hapus Terpilih</button>
          <button id="bulk-del-all-transport" onclick="bulkDelete('transport', 'all')" class="bg-white hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed text-rose-700 border border-rose-300 px-3 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5"><i class="fa-solid fa-dumpster"></i> Hapus Semua</button>
        </div>
      </div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-blue-50 text-blue-900 uppercase font-bold border-b border-blue-200 text-[10px]">
              <th class="py-3.5 px-4 text-center sticky left-0 z-20 bg-blue-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]"><label class="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="bulk-all-transport" onchange="toggleBulkAll('transport', this.checked)" class="w-4 h-4 accent-rose-600 cursor-pointer" title="Pilih semua yang tampil"> Aksi</label></th>
              <th class="py-3.5 px-4">No. WO</th><th class="py-3.5 px-4">Nama Project</th><th class="py-3.5 px-4">Customer</th>
              <th class="py-3.5 px-4">Deskripsi Armada/Jasa</th><th class="py-3.5 px-4">Destinasi Awal</th><th class="py-3.5 px-4">Destinasi Tujuan</th>
              <th class="py-3.5 px-4 text-center">Qty</th><th class="py-3.5 px-4 text-right">Harga Satuan (Rp)</th><th class="py-3.5 px-4 text-right">Total (Rp)</th>
            </tr>
          </thead>
          <tbody id="transport-table-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- 5. DETAIL CUSTOMER -->
    <div id="tab-content-customers" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-building text-blue-600"></i> Detail Directory Customer</h3>
          <p class="text-xs text-slate-400">Profil klien, alamat lengkap, kontak person, serta rincian daftar Work Order & Project</p>
        </div>
        <button onclick="openAddCustomerModal('add')" class="bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md"><i class="fa-solid fa-plus-circle"></i> + Tambah Customer Baru</button>
      </div>
      <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Cari Customer (Nama, Kota, PIC)</label>
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
            <input type="text" id="filter-customer-directory-search" oninput="renderCustomerDirectory()" placeholder="Ketik nama customer, kota, PIC..." class="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500">
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Status Keaktifan</label>
          <select id="filter-customer-directory-status" onchange="renderCustomerDirectory()" class="w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="ALL">Semua Status</option><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option>
          </select>
        </div>
      </div>
      <div id="customer-cards-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"></div>
    </div>

    <!-- 6. DETAIL SUPPLIER & PPN -->
    <div id="tab-content-suppliers" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-truck-field-un text-purple-600"></i> Detail Supplier & Rekap Pajak PPN</h3>
          <p class="text-xs text-slate-400">Direktori profil vendor, NPWP, alamat, serta rekapitulasi DPP & nominal PPN terutang</p>
        </div>
        <button onclick="openAddSupplierModal('add')" class="bg-purple-600 hover:bg-purple-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md"><i class="fa-solid fa-plus-circle"></i> + Tambah Supplier Baru</button>
      </div>
      <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Cari Supplier (Nama, Kota, NPWP)</label>
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
            <input type="text" id="filter-supplier-directory-search" oninput="renderSupplierDirectory()" placeholder="Ketik nama supplier, kota, PIC..." class="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500">
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Status Keaktifan</label>
          <select id="filter-supplier-directory-status" onchange="renderSupplierDirectory()" class="w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500">
            <option value="ALL">Semua Status</option><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option>
          </select>
        </div>
      </div>
      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-purple-50 text-purple-900 uppercase font-bold border-b border-purple-200 text-[10px]">
              <th class="py-3.5 px-4">Nama Supplier</th><th class="py-3.5 px-4">Lokasi (Kota/Prov)</th><th class="py-3.5 px-4">PIC & Kontak</th>
              <th class="py-3.5 px-4">NPWP</th><th class="py-3.5 px-4 text-center">Status</th><th class="py-3.5 px-4 text-center">Transaksi</th>
              <th class="py-3.5 px-4 text-right">Total DPP (Rp)</th><th class="py-3.5 px-4 text-right">Total PPN (Rp)</th><th class="py-3.5 px-4 text-right">Grand Total Tagihan (Rp)</th>
              <th class="py-3.5 px-4 text-center">Aksi</th>
            </tr>
          </thead>
          <tbody id="supplier-detail-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- 7. MASTER DIRECTORY -->
    <div id="tab-content-master" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="border-b border-slate-100 pb-4">
        <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-database text-indigo-600"></i> Database Master Directory</h3>
        <p class="text-xs text-slate-400">Pengelolaan entitas referensi utama: Master Product dan Master Buyer</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-cube text-indigo-600"></i> Master Product (<span id="master-product-count">0</span>)</h4>
            <button onclick="openAddMasterModal('product', 'add')" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold px-2.5 py-1 rounded transition">+ Tambah</button>
          </div>
          <div class="max-h-80 overflow-y-auto custom-scrollbar"><ul id="master-product-list" class="divide-y divide-slate-200 text-xs"></ul></div>
        </div>
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-user-tie text-emerald-600"></i> Master Buyer (<span id="master-buyer-count">0</span>)</h4>
            <button onclick="openAddMasterModal('buyer', 'add')" class="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold px-2.5 py-1 rounded transition">+ Tambah</button>
          </div>
          <div class="max-h-80 overflow-y-auto custom-scrollbar"><ul id="master-buyer-list" class="divide-y divide-slate-200 text-xs"></ul></div>
        </div>
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3 md:col-span-2">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-id-badge text-amber-600"></i> Master Karyawan (<span id="master-karyawan-count">0</span>)</h4>
            <button onclick="openKaryawanModal('add')" class="bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold px-2.5 py-1 rounded transition">+ Tambah Karyawan</button>
          </div>
          <p class="text-[10px] text-slate-400 -mt-2">Daftar nama karyawan (tanpa akun login) — dipakai untuk dropdown "User Peminta", "Atasan Direct" & "Manager Head" di form PR dan WO.</p>
          <div class="max-h-80 overflow-y-auto custom-scrollbar"><ul id="master-karyawan-list" class="divide-y divide-slate-200 text-xs"></ul></div>
        </div>
      </div>
    </div>

    <!-- ==================== GUDANG: STOK MATERIAL ==================== -->
    <div id="tab-content-stok" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-cubes text-emerald-600"></i> Stok Material Gudang</h3>
          <p class="text-xs text-slate-400">Master material, saldo stok berjalan & alert stok menipis. Saldo hanya berubah lewat Riwayat Pergerakan.</p>
        </div>
        <button onclick="openInventoryItemModal('add')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md"><i class="fa-solid fa-plus-circle"></i> + Tambah Material</button>
      </div>
      <!-- Ringkasan + Filter Stok -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button type="button" onclick="setStokFilterKondisi('ALL')" class="text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl p-3 transition">
          <div class="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Total Material</div>
          <div id="stok-sum-total" class="text-lg font-extrabold text-slate-800">0</div>
        </button>
        <button type="button" onclick="setStokFilterKondisi('HABIS')" class="text-left bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl p-3 transition">
          <div class="text-[10px] font-bold uppercase text-rose-400 tracking-wider">Stok Habis</div>
          <div id="stok-sum-habis" class="text-lg font-extrabold text-rose-700">0</div>
        </button>
        <button type="button" onclick="setStokFilterKondisi('MENIPIS')" class="text-left bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl p-3 transition">
          <div class="text-[10px] font-bold uppercase text-amber-500 tracking-wider">Stok Menipis</div>
          <div id="stok-sum-menipis" class="text-lg font-extrabold text-amber-700">0</div>
        </button>
        <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <div class="text-[10px] font-bold uppercase text-emerald-500 tracking-wider">Total Nilai (hasil filter)</div>
          <div id="stok-sum-nilai" class="text-lg font-extrabold text-emerald-800">Rp 0</div>
        </div>
      </div>

      <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div class="lg:col-span-2">
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Cari SKU / Nama Material</label>
          <div class="relative">
            <i class="fa-solid fa-magnifying-glass absolute left-3.5 top-2.5 text-slate-400 text-xs"></i>
            <input type="text" id="filter-stok-search" oninput="renderStokTable()" placeholder="Contoh: MAT-0001, amplas, schotbrite..." class="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500">
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Kategori</label>
          <select id="filter-stok-kategori" onchange="renderStokTable()" class="w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"><option value="ALL">Semua Kategori</option></select>
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Kondisi Stok</label>
          <select id="filter-stok-kondisi" onchange="renderStokTable()" class="w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500">
            <option value="ALL">Semua Kondisi</option>
            <option value="ADA">Ada Stok (&gt; 0)</option>
            <option value="AMAN">Aman (di atas minimum)</option>
            <option value="MENIPIS">Menipis (ada, &le; minimum)</option>
            <option value="HABIS">Habis (0)</option>
          </select>
        </div>
        <div class="flex gap-2">
          <div class="flex-1">
            <label class="block text-[11px] font-bold uppercase text-slate-400 tracking-wider mb-1">Status</label>
            <select id="filter-stok-status" onchange="renderStokTable()" class="w-full py-1.5 px-3 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500">
              <option value="ALL">Semua</option><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option>
            </select>
          </div>
          <button type="button" onclick="resetStokFilters()" title="Reset filter" class="self-end h-[30px] px-3 text-xs text-emerald-700 hover:text-emerald-900 bg-white border border-slate-300 rounded-lg font-semibold"><i class="fa-solid fa-rotate-left"></i></button>
        </div>
      </div>
      <div class="flex items-center justify-between -mt-2">
        <span id="stok-table-count" class="text-[11px] font-bold text-slate-500">0 material</span>
        <span class="text-[10px] text-slate-400">Klik kotak ringkasan di atas untuk filter cepat.</span>
      </div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-emerald-50 text-emerald-900 uppercase font-bold border-b border-emerald-200 text-[10px]">
              <th class="py-3.5 px-4 text-center sticky left-0 z-20 bg-emerald-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
              <th class="py-3.5 px-4">SKU</th><th class="py-3.5 px-4">Nama Material</th><th class="py-3.5 px-4">Kategori</th>
              <th class="py-3.5 px-4 text-center">Stok</th><th class="py-3.5 px-4 text-right">Harga Satuan (Rp)</th>
              <th class="py-3.5 px-4 text-right">Total Nilai (Rp)</th><th class="py-3.5 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody id="stok-table-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- ==================== GUDANG: INCOMING GOODS ==================== -->
    <div id="tab-content-incoming" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="border-b border-slate-100 pb-4">
        <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-truck-ramp-box text-orange-600"></i> Incoming Goods</h3>
        <p class="text-xs text-slate-400">Barang dari PR yang sudah berstatus <strong>STORE ROOM</strong> (sudah dibeli & datang) tapi belum dikonfirmasi diterima tim Gudang. Klik "Terima Barang" untuk konfirmasi — stok Gudang otomatis bertambah.</p>
      </div>
      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-orange-50 text-orange-900 uppercase font-bold border-b border-orange-200 text-[10px]">
              <th class="py-3.5 px-4 text-center sticky left-0 z-20 bg-orange-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
              <th class="py-3.5 px-4">No. PR</th><th class="py-3.5 px-4">Nama Barang</th><th class="py-3.5 px-4 text-center">Qty</th>
              <th class="py-3.5 px-4">Supplier</th><th class="py-3.5 px-4 text-center">Tgl Datang</th><th class="py-3.5 px-4">WO / Project</th>
              <th class="py-3.5 px-4">Penerima (opsional)</th>
            </tr>
          </thead>
          <tbody id="incoming-table-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- ==================== GUDANG: RECEIVING GOODS ==================== -->
    <div id="tab-content-receiving" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-clipboard-check text-lime-600"></i> Receiving Goods</h3>
          <p class="text-xs text-slate-400">Riwayat barang yang sudah dikonfirmasi diterima tim Gudang (status PR: RECEIVED) — stok Gudang sudah bertambah otomatis untuk semua baris ini.</p>
        </div>
        <input type="text" id="receiving-search" oninput="renderReceivingTable()" placeholder="Cari No. PR / Nama Barang..." class="w-full sm:w-72 p-2 bg-white border border-slate-300 rounded-lg text-xs">
      </div>
      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-lime-50 text-lime-900 uppercase font-bold border-b border-lime-200 text-[10px]">
              <th class="py-3.5 px-4">No. PR</th><th class="py-3.5 px-4">Nama Barang</th><th class="py-3.5 px-4 text-center">Qty</th>
              <th class="py-3.5 px-4">Supplier</th><th class="py-3.5 px-4 text-center">Tgl Diterima</th><th class="py-3.5 px-4">WO / Project</th>
              <th class="py-3.5 px-4">Penerima Barang</th>
            </tr>
          </thead>
          <tbody id="receiving-table-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- ==================== GUDANG: PRODUKSI & BOM ==================== -->
    <div id="tab-content-produksi" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-gears text-teal-600"></i> Progress Panel Produksi & BOM</h3>
          <p class="text-xs text-slate-400">Progress produksi per WO + kebutuhan material (Bill of Materials). Konsumsi material otomatis mengurangi Stok Gudang.</p>
        </div>
        <button onclick="openProductionModal('add')" class="bg-teal-600 hover:bg-teal-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md"><i class="fa-solid fa-plus-circle"></i> + Tambah Produksi</button>
      </div>
      <div id="tf-bar-produksi"></div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-teal-50 text-teal-900 uppercase font-bold border-b border-teal-200 text-[10px]">
              <th class="py-3.5 px-4 text-center sticky left-0 z-20 bg-teal-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
              <th class="py-3.5 px-4">No. Produksi</th><th class="py-3.5 px-4">No. WO & Customer</th><th class="py-3.5 px-4">Produk</th>
              <th class="py-3.5 px-4 text-center">Qty Target</th><th class="py-3.5 px-4 text-center">Qty Selesai</th>
              <th class="py-3.5 px-4 text-center">Konsumsi Material</th><th class="py-3.5 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody id="produksi-table-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- ==================== GUDANG: RIWAYAT PERGERAKAN STOK ==================== -->
    <div id="tab-content-riwayat" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-clock-rotate-left text-cyan-600"></i> Riwayat Pergerakan Stok</h3>
          <p class="text-xs text-slate-400">Semua mutasi masuk/keluar/koreksi stok — sumber kebenaran saldo Stok Material.</p>
        </div>
        <button onclick="openMovementModal()" class="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-md"><i class="fa-solid fa-plus-circle"></i> + Catat Pergerakan</button>
      </div>
      <div id="tf-bar-riwayat"></div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left border-collapse whitespace-nowrap text-xs">
          <thead>
            <tr class="bg-cyan-50 text-cyan-900 uppercase font-bold border-b border-cyan-200 text-[10px]">
              <th class="py-3.5 px-4 text-center sticky left-0 z-20 bg-cyan-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
              <th class="py-3.5 px-4">Tanggal</th><th class="py-3.5 px-4">Material</th><th class="py-3.5 px-4 text-center">Tipe</th>
              <th class="py-3.5 px-4 text-center">Qty</th><th class="py-3.5 px-4">Sumber</th><th class="py-3.5 px-4">Referensi</th>
              <th class="py-3.5 px-4">Keterangan</th><th class="py-3.5 px-4">User</th>
            </tr>
          </thead>
          <tbody id="riwayat-table-tbody" class="divide-y divide-slate-100 text-slate-700 font-medium"></tbody>
        </table>
      </div>
    </div>

    <!-- ==================== MTC: DASHBOARD ==================== -->
    <div id="tab-content-mtcdash" class="hidden space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold text-slate-800">Dashboard MTC WO</h2>
          <p class="text-sm text-slate-500">Klik baris WO untuk melihat rincian item pekerjaan ke bawah</p>
        </div>
        <div class="relative">
          <i class="fa-solid fa-magnifying-glass absolute left-3 top-3 text-slate-400 text-sm"></i>
          <input type="text" id="mtc-dash-search" oninput="renderMTCDashboard()" placeholder="Cari WO / Project / Customer..." class="ps-9 pe-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full md:w-72 bg-white shadow-sm">
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div><div class="text-slate-500 text-xs font-semibold uppercase">Total WO Aktif</div><div class="text-2xl font-bold text-slate-800 mt-1" id="mtc-dash-total-wo">0</div></div>
          <div class="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center text-xl"><i class="fa-solid fa-folder-open"></i></div>
        </div>
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div><div class="text-slate-500 text-xs font-semibold uppercase">Total Nilai PO Customer</div><div class="text-xl font-bold text-blue-600 mt-1" id="mtc-dash-total-po">Rp 0</div></div>
          <div class="w-12 h-12 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center text-xl"><i class="fa-solid fa-money-bill-wave"></i></div>
        </div>
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div><div class="text-slate-500 text-xs font-semibold uppercase">Total Biaya Produksi</div><div class="text-xl font-bold text-amber-600 mt-1" id="mtc-dash-total-cost">Rp 0</div></div>
          <div class="w-12 h-12 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center text-xl"><i class="fa-solid fa-calculator"></i></div>
        </div>
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div><div class="text-slate-500 text-xs font-semibold uppercase">Estimasi Margin</div><div class="text-xl font-bold text-emerald-600 mt-1" id="mtc-dash-total-margin">Rp 0</div></div>
          <div class="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center text-xl"><i class="fa-solid fa-chart-pie"></i></div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div class="flex justify-between items-center">
          <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2"><i class="fa-solid fa-table-cells text-indigo-600"></i> Rincian Biaya MTC Produksi Per Divisi</h3>
          <span class="text-xs text-indigo-600 font-medium"><i class="fa-solid fa-circle-info mr-1"></i>Klik baris untuk buka rincian pekerjaan</span>
        </div>
        <div class="overflow-x-auto custom-scrollbar border border-slate-200 rounded-lg">
          <table class="w-full text-xs text-left border-collapse" id="mtc-dash-table">
            <thead class="bg-slate-800 text-white font-semibold uppercase sticky top-0 z-20"><tr id="mtc-dash-thead-row"></tr></thead>
            <tbody id="mtc-dash-matrix-tbody" class="divide-y divide-slate-200"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== MTC: MODUL DIVISI PRODUKSI ==================== -->
    <div id="tab-content-mtcdivisi" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="border-b border-slate-100 pb-4">
        <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-sitemap text-teal-600"></i> Modul Divisi Produksi</h3>
        <p class="text-xs text-slate-400">Catat biaya aktual (mesin/manpower) yang dikeluarkan tiap divisi untuk mengerjakan Item Pekerjaan sebuah WO.</p>
      </div>
      <div class="bg-teal-50/60 p-4 rounded-xl border border-teal-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block font-semibold text-slate-600 mb-1 text-xs">Pilih Work Order *</label>
          <select id="mtcdivisi-wo-select" onchange="handleMTCDivisiWOChange()" class="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold"><option value="">-- Pilih WO --</option></select>
        </div>
        <div class="flex items-end">
          <button onclick="openMTCRecordModal('add')" id="mtc-add-record-btn" disabled class="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-lg transition flex items-center justify-center gap-2"><i class="fa-solid fa-plus-circle"></i> + Catat Biaya Divisi</button>
        </div>
      </div>
      <div id="mtcdivisi-empty-hint" class="text-center py-10 text-slate-400 text-sm">Pilih Work Order dulu untuk melihat/mencatat biaya per divisi.</div>
      <div id="mtcdivisi-records-list" class="space-y-3"></div>
    </div>

    <!-- ==================== MTC: MASTER DATA ==================== -->
    <div id="tab-content-mtcmaster" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="border-b border-slate-100 pb-4">
        <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-database text-amber-600"></i> Master Data MTC</h3>
        <p class="text-xs text-slate-400">Tarif mesin & tarif manpower per divisi - dipakai untuk auto-hitung biaya di Modul Divisi Produksi.</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-industry text-indigo-600"></i> Master Mesin (<span id="mtc-mesin-count">0</span>)</h4>
            <button onclick="openMTCMesinModal('add')" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold px-2.5 py-1 rounded transition">+ Tambah</button>
          </div>
          <div class="max-h-80 overflow-y-auto custom-scrollbar"><ul id="mtc-mesin-list" class="divide-y divide-slate-200 text-xs"></ul></div>
        </div>
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-users-gear text-teal-600"></i> Master Tarif Divisi (<span id="mtc-mp-count">0</span>)</h4>
            <button onclick="openMTCMpModal('add')" class="bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-bold px-2.5 py-1 rounded transition">+ Tambah</button>
          </div>
          <div class="max-h-80 overflow-y-auto custom-scrollbar"><ul id="mtc-mp-list" class="divide-y divide-slate-200 text-xs"></ul></div>
        </div>
      </div>
    </div>

    <!-- ADMINISTRATOR (khusus akun dengan akses admin penuh) -->
    <div id="tab-content-admin" class="hidden space-y-6 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
      <div class="border-b border-slate-100 pb-4">
        <h3 class="font-bold text-slate-800 text-lg flex items-center gap-2"><i class="fa-solid fa-user-shield text-rose-600"></i> Administrator</h3>
        <p class="text-xs text-slate-400">Kelola akun user dan role akses — khusus admin</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-user-check text-blue-600"></i> Master User & Divisi (<span id="master-user-count">0</span>)</h4>
            <button onclick="openMasterUserModal('add')" class="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-2.5 py-1 rounded transition">+ Tambah</button>
          </div>
          <div class="max-h-80 overflow-y-auto custom-scrollbar"><ul id="master-user-list" class="divide-y divide-slate-200 text-xs"></ul></div>
        </div>
        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
          <div class="flex items-center justify-between border-b border-slate-200 pb-2">
            <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-user-shield text-rose-600"></i> Role Management (<span id="master-role-count">0</span>)</h4>
            <button onclick="openRoleModal('add')" class="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold px-2.5 py-1 rounded transition">+ Tambah</button>
          </div>
          <p class="text-[10px] text-slate-400 -mt-2">Buat/ubah role di sini akan langsung muncul di pilihan role saat tambah/edit user — tanpa perlu ubah kode.</p>
          <div class="max-h-80 overflow-y-auto custom-scrollbar"><ul id="master-role-list" class="divide-y divide-slate-200 text-xs"></ul></div>
        </div>
      </div>

      <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
        <div class="border-b border-slate-200 pb-2">
          <h4 class="font-bold text-slate-700 text-sm flex items-center gap-2"><i class="fa-solid fa-file-import text-emerald-600"></i> Import Data dari Excel</h4>
          <p class="text-[10px] text-slate-400 mt-0.5">Upload data real dalam jumlah banyak sekaligus, per modul. Download template dulu, isi datanya, lalu upload kembali file .xlsx-nya. Urutan disarankan: Master Karyawan/Customer/Supplier/Buyer/Product dulu, baru Work Order, baru PR (karena WO & PR butuh data master yang sudah ada).</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block font-semibold text-slate-600 mb-1 text-xs">Pilih Modul Tujuan Import</label>
            <select id="import-type-select" onchange="updateImportTemplateLink()" class="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs font-bold">
              <option value="karyawan">Master Karyawan</option>
              <option value="customers">Master Customer</option>
              <option value="suppliers">Master Supplier</option>
              <option value="buyers">Master Buyer</option>
              <option value="products">Master Product</option>
              <option value="work_orders">Work Order (WO)</option>
              <option value="pr_items">Purchasing Request (PR)</option>
            </select>
          </div>
          <div class="flex items-end">
            <a id="import-download-template" href="api/download_template.php?type=karyawan" class="w-full text-center bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-lg transition flex items-center justify-center gap-2"><i class="fa-solid fa-download"></i> Download Template Excel</a>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <input type="file" id="import-file-input" accept=".xlsx" class="flex-1 text-xs bg-white border border-slate-300 rounded-lg p-2">
          <button onclick="handleImportUpload()" id="import-upload-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2 rounded-lg transition flex items-center justify-center gap-2 whitespace-nowrap"><i class="fa-solid fa-upload"></i> Upload & Import</button>
        </div>
        <div id="import-result-box" class="hidden text-xs rounded-lg p-3 border space-y-2"></div>
      </div>
    </div>
    <div id="tab-content-findash" class="hidden space-y-6">
      <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">EXECUTIVE FINANCIAL DASHBOARD</h2>
          <p class="text-xs text-slate-500">Ringkasan performa keuangan, arus kas, aging AR/AP, dan WO pipeline</p>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Bulan</label>
            <select id="findash-filter-month" onchange="renderFinanceDashboard()" class="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 font-medium">
              <option value="ALL">Semua Bulan</option>
              <option value="1">Januari</option><option value="2">Februari</option><option value="3">Maret</option><option value="4">April</option>
              <option value="5">Mei</option><option value="6">Juni</option><option value="7">Juli</option><option value="8">Agustus</option>
              <option value="9">September</option><option value="10">Oktober</option><option value="11">November</option><option value="12">Desember</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Tahun</label>
            <select id="findash-filter-year" onchange="renderFinanceDashboard()" class="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 font-medium">
              <option value="ALL">Semua Tahun</option><option value="2025">2025</option><option value="2026">2026</option><option value="2027">2027</option>
            </select>
          </div>
        </div>
      </div>

      <div id="findash-alerts-container" class="space-y-2"></div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div class="flex justify-between items-start"><span class="text-xs font-bold text-slate-500 uppercase">Posisi Saldo Kas</span><span class="p-2 bg-emerald-50 text-emerald-600 rounded-lg text-xs"><i class="fa-solid fa-wallet"></i></span></div>
          <div id="findash-saldo-kas" class="text-lg font-bold text-emerald-600 mt-2">Rp 0</div>
          <div class="text-[11px] text-slate-400 mt-0.5">Saldo kas berjalan saat ini</div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div class="flex justify-between items-start"><span class="text-xs font-bold text-slate-500 uppercase">Sisa Piutang (AR)</span><span class="p-2 bg-amber-50 text-amber-600 rounded-lg text-xs"><i class="fa-solid fa-hourglass-half"></i></span></div>
          <div id="findash-sisa-ar" class="text-lg font-bold text-amber-600 mt-2">Rp 0</div>
          <div id="findash-sub-ar" class="text-[11px] text-slate-400 mt-0.5">Total Penjualan: Rp 0</div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div class="flex justify-between items-start"><span class="text-xs font-bold text-slate-500 uppercase">Sisa Hutang (AP)</span><span class="p-2 bg-rose-50 text-rose-600 rounded-lg text-xs"><i class="fa-solid fa-credit-card"></i></span></div>
          <div id="findash-sisa-ap" class="text-lg font-bold text-rose-600 mt-2">Rp 0</div>
          <div id="findash-sub-ap" class="text-[11px] text-slate-400 mt-0.5">Total Pembelian: Rp 0</div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div class="flex justify-between items-start"><span class="text-xs font-bold text-slate-500 uppercase">Sisa Dana Talangan</span><span class="p-2 bg-purple-50 text-purple-600 rounded-lg text-xs"><i class="fa-solid fa-hand-holding-dollar"></i></span></div>
          <div id="findash-sisa-talangan" class="text-lg font-bold text-purple-600 mt-2">Rp 0</div>
          <div class="text-[11px] text-slate-400 mt-0.5">Pinjaman belum diganti</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="lg:col-span-2 bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 mb-5">Tren Saldo Kas & Debit / Kredit</h3>
          <div class="h-64 relative"><canvas id="chart-cashflow-trend"></canvas></div>
        </div>
        <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 mb-5">Status Pembayaran Hutang (AP)</h3>
            <div class="space-y-5">
              <div>
                <div class="flex justify-between items-center text-xs font-semibold mb-2"><span class="text-slate-600">Terbayar</span><span id="findash-ap-pct-terbayar" class="text-emerald-600 text-sm font-bold">0%</span></div>
                <div class="w-full bg-slate-100 rounded-full h-3 overflow-hidden"><div id="findash-ap-bar-terbayar" class="bg-emerald-500 h-3 rounded-full transition-all" style="width:0%"></div></div>
                <div id="findash-ap-val-terbayar" class="text-[11px] text-slate-500 mt-1.5 text-right">Rp 0</div>
              </div>
              <div>
                <div class="flex justify-between items-center text-xs font-semibold mb-2"><span class="text-slate-600">Sisa Hutang (Pending)</span><span id="findash-ap-pct-pending" class="text-rose-600 text-sm font-bold">0%</span></div>
                <div class="w-full bg-slate-100 rounded-full h-3 overflow-hidden"><div id="findash-ap-bar-pending" class="bg-rose-500 h-3 rounded-full transition-all" style="width:0%"></div></div>
                <div id="findash-ap-val-pending" class="text-[11px] text-slate-500 mt-1.5 text-right">Rp 0</div>
              </div>
            </div>
          </div>
          <div class="pt-4 border-t border-slate-100 mt-5 text-xs space-y-2 bg-slate-50 p-3.5 rounded-lg">
            <div class="flex justify-between items-center"><span class="text-slate-500">Total Tagihan</span><span id="findash-ap-stat-total" class="font-bold text-slate-800">Rp 0</span></div>
            <div class="flex justify-between items-center"><span class="text-slate-500">Status Utama</span><span id="findash-ap-stat-badge" class="font-bold text-amber-600 px-2 py-0.5 bg-amber-50 rounded-full text-[11px]">PENDING</span></div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 mb-5">Distribusi Aging Piutang (AR)</h3>
          <div class="h-60 relative"><canvas id="chart-ar-aging"></canvas></div>
        </div>
        <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
          <div>
            <h3 class="text-xs font-bold uppercase tracking-wider text-slate-700 mb-4">Status Work Order (WO) Pipeline</h3>
            <div class="h-44 relative flex items-center justify-center"><canvas id="chart-wo-pipeline"></canvas></div>
          </div>
          <div class="pt-4 border-t border-slate-100 mt-3 grid grid-cols-3 gap-2.5 text-[11px] text-center bg-slate-50 p-3 rounded-lg">
            <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-1"><span class="text-emerald-700 font-bold block">Lunas Invoiced</span><span id="findash-wo-val-lunas" class="font-bold text-slate-800 text-xs block">Rp 0</span></div>
            <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-1"><span class="text-amber-700 font-bold block">Pending Invoice</span><span id="findash-wo-val-pending" class="font-bold text-slate-800 text-xs block">Rp 0</span></div>
            <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-1"><span class="text-slate-600 font-bold block">Belum Terinvoice</span><span id="findash-wo-val-belum" class="font-bold text-slate-800 text-xs block">Rp 0</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== CASH FLOW (ARUS KAS) ==================== -->
    <div id="tab-content-cashflow" class="hidden space-y-4">
      <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Modul Cash Flow (Arus Kas)</h2>
          <p class="text-xs text-slate-500">Mutasi kas otomatis dari AR/AP & transaksi manual</p>
        </div>
        <button onclick="openCashflowModal('add')" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition shadow-sm">
          <i class="fa-solid fa-plus"></i><span>Tambah Transaksi Kas</span>
        </button>
      </div>

      <div class="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
        <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Bulan</label>
            <select id="filter-cf-month" onchange="renderCashflowTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
              <option value="ALL">Semua Bulan</option><option value="1">Januari</option><option value="2">Februari</option><option value="3">Maret</option><option value="4">April</option><option value="5">Mei</option><option value="6">Juni</option><option value="7">Juli</option><option value="8">Agustus</option><option value="9">September</option><option value="10">Oktober</option><option value="11">November</option><option value="12">Desember</option>
            </select>
          </div>
          <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Tahun</label>
            <select id="filter-cf-year" onchange="renderCashflowTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
              <option value="ALL">Semua Tahun</option><option value="2025">2025</option><option value="2026">2026</option><option value="2027">2027</option>
            </select>
          </div>
          <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Kode</label>
            <select id="filter-cf-kode" onchange="renderCashflowTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
              <option value="ALL">Semua Kode</option><option value="Piutang">Piutang</option><option value="Hutang">Hutang</option><option value="Inventaris">Inventaris</option><option value="Beban">Beban</option><option value="Pendapatan">Pendapatan</option><option value="Dana Talangan">Dana Talangan</option>
            </select>
          </div>
          <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Tipe</label>
            <select id="filter-cf-tp" onchange="renderCashflowTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
              <option value="ALL">Semua Tipe</option><option value="IN">IN (Masuk)</option><option value="OUT">OUT (Keluar)</option>
            </select>
          </div>
          <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Status</label>
            <select id="filter-cf-status" onchange="renderCashflowTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
              <option value="ALL">Semua Status</option><option value="TERBAYAR LUNAS">TERBAYAR LUNAS</option><option value="PENDING">PENDING</option><option value="PARTIAL">PARTIAL</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Cari</label>
            <input type="text" id="filter-cf-search" oninput="renderCashflowTable()" placeholder="Cari deskripsi, invoice, WO..." class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
          </div>
        </div>
        <div class="flex items-center justify-end pt-2 border-t border-slate-100 text-xs text-slate-500 font-medium">
          Total Record: <span id="cf-record-count" class="font-bold text-slate-800 ml-1">0</span>
        </div>
      </div>

      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-xs text-left border-collapse whitespace-nowrap">
            <thead class="bg-slate-900 text-white font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th class="py-3 px-3 text-center sticky left-0 z-20 bg-slate-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)]">Aksi</th>
                <th class="py-3 px-3">Tanggal</th><th class="py-3 px-3">Kode</th><th class="py-3 px-3">Deskripsi</th>
                <th class="py-3 px-3">Cust/Supp/PIC</th><th class="py-3 px-3">WO</th><th class="py-3 px-3">No PO</th>
                <th class="py-3 px-3 text-right">DPP & PPh23</th><th class="py-3 px-3 text-right">Debit (Masuk)</th>
                <th class="py-3 px-3 text-right">Kredit (Keluar)</th><th class="py-3 px-3 text-right">Saldo</th>
                <th class="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody id="cashflow-tbody" class="divide-y divide-slate-100 text-slate-700"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== ACCOUNT RECEIVABLE (AR) ==================== -->
    <div id="tab-content-ar" class="hidden space-y-4">
      <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Account Receivable (AR) — Piutang Customer</h2>
          <p class="text-xs text-slate-500">Invoice ke customer, status pembayaran, dan sisa piutang</p>
        </div>
        <button onclick="openARModal('add')" class="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition shadow-sm">
          <i class="fa-solid fa-plus"></i><span>Tambah Record AR</span>
        </button>
      </div>

      <div class="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Cari</label>
          <input type="text" id="filter-ar-search" oninput="renderARTable()" placeholder="No Invoice, Customer, PO..." class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
        </div>
        <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Customer</label>
          <select id="filter-ar-customer" onchange="renderARTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50"><option value="ALL">Semua Customer</option></select>
        </div>
        <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Status</label>
          <select id="filter-ar-status" onchange="renderARTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
            <option value="ALL">Semua Status</option><option value="TERBAYAR LUNAS">TERBAYAR LUNAS</option><option value="PENDING">PENDING</option><option value="PARTIAL">PARTIAL</option>
          </select>
        </div>
        <div class="flex items-end text-xs text-slate-500 font-medium pb-1.5">Total Record: <span id="ar-record-count" class="font-bold text-slate-800 ml-1">0</span></div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Penjualan</span><span id="ar-sum-penjualan" class="font-bold text-slate-800">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Piutang</span><span id="ar-sum-piutang" class="font-bold text-blue-600">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Terbayar</span><span id="ar-sum-terbayar" class="font-bold text-emerald-600">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Sisa Piutang</span><span id="ar-sum-sisa" class="font-bold text-amber-600">Rp 0</span></div>
      </div>

      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-xs text-left border-collapse whitespace-nowrap">
            <thead class="bg-amber-50 text-amber-900 font-bold uppercase tracking-wider text-[10px] border-b border-amber-200">
              <tr>
                <th class="py-3 px-3 text-center sticky left-0 z-20 bg-amber-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
                <th class="py-3 px-3">No Invoice</th><th class="py-3 px-3">Tgl Invoice</th><th class="py-3 px-3">Customer</th>
                <th class="py-3 px-3">No PO / WO</th><th class="py-3 px-3">Deskripsi</th><th class="py-3 px-3 text-right">Penjualan</th>
                <th class="py-3 px-3 text-right">PPN</th><th class="py-3 px-3 text-right">PPh23</th>
                <th class="py-3 px-3 text-center">TOP</th><th class="py-3 px-3">Due Date</th>
                <th class="py-3 px-3 text-right">Terbayar</th><th class="py-3 px-3 text-right">Sisa Piutang</th>
                <th class="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody id="ar-tbody" class="divide-y divide-slate-100 text-slate-700"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== ACCOUNT PAYABLE (AP) ==================== -->
    <div id="tab-content-ap" class="hidden space-y-4">
      <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Account Payable (AP) — Hutang ke Supplier</h2>
          <p class="text-xs text-slate-500">Invoice dari supplier, status pembayaran, dan sisa hutang</p>
        </div>
        <button onclick="openAPModal('add')" class="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition shadow-sm">
          <i class="fa-solid fa-plus"></i><span>Tambah Record AP</span>
        </button>
      </div>

      <div class="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Cari</label>
          <input type="text" id="filter-ap-search" oninput="renderAPTable()" placeholder="No Invoice, Supplier, PO..." class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
        </div>
        <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Supplier</label>
          <select id="filter-ap-supplier" onchange="renderAPTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50"><option value="ALL">Semua Supplier</option></select>
        </div>
        <div><label class="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Status</label>
          <select id="filter-ap-status" onchange="renderAPTable()" class="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-slate-50">
            <option value="ALL">Semua Status</option><option value="TERBAYAR LUNAS">TERBAYAR LUNAS</option><option value="PENDING">PENDING</option><option value="PARTIAL">PARTIAL</option>
          </select>
        </div>
        <div class="flex items-end text-xs text-slate-500 font-medium pb-1.5">Total Record: <span id="ap-record-count" class="font-bold text-slate-800 ml-1">0</span></div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Pembelian</span><span id="ap-sum-pembelian" class="font-bold text-slate-800">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Hutang</span><span id="ap-sum-hutang" class="font-bold text-blue-600">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Terbayar</span><span id="ap-sum-terbayar" class="font-bold text-emerald-600">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Sisa Hutang</span><span id="ap-sum-sisa" class="font-bold text-rose-600">Rp 0</span></div>
      </div>

      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-xs text-left border-collapse whitespace-nowrap">
            <thead class="bg-rose-50 text-rose-900 font-bold uppercase tracking-wider text-[10px] border-b border-rose-200">
              <tr>
                <th class="py-3 px-3 text-center sticky left-0 z-20 bg-rose-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
                <th class="py-3 px-3">No Invoice</th><th class="py-3 px-3">Tgl Invoice</th><th class="py-3 px-3">Supplier</th>
                <th class="py-3 px-3">No PO</th><th class="py-3 px-3">Deskripsi</th><th class="py-3 px-3 text-right">Pembelian</th>
                <th class="py-3 px-3 text-right">PPN</th><th class="py-3 px-3 text-right">PPh23</th>
                <th class="py-3 px-3 text-center">TOP</th><th class="py-3 px-3">Due Date</th>
                <th class="py-3 px-3 text-right">Terbayar</th><th class="py-3 px-3 text-right">Sisa Hutang</th>
                <th class="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody id="ap-tbody" class="divide-y divide-slate-100 text-slate-700"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ==================== DANA TALANGAN ==================== -->
    <div id="tab-content-talangan" class="hidden space-y-4">
      <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-bold text-slate-800">Dana Talangan</h2>
          <p class="text-xs text-slate-500">Pinjaman talangan operasional & pelunasan otomatis dari Cash Flow</p>
        </div>
        <button onclick="openTalanganModal('add')" class="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-2 transition shadow-sm">
          <i class="fa-solid fa-plus"></i><span>Tambah Dana Talangan</span>
        </button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Pinjaman</span><span id="talangan-sum-pinjaman" class="font-bold text-slate-800">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Total Sudah Diganti</span><span id="talangan-sum-terbayar" class="font-bold text-emerald-600">Rp 0</span></div>
        <div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm"><span class="text-[10px] font-bold text-slate-400 uppercase block">Sisa Belum Diganti</span><span id="talangan-sum-sisa" class="font-bold text-amber-600">Rp 0</span></div>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[11px] text-slate-600">
        <i class="fa-solid fa-circle-info text-blue-600 mr-1"></i>
        Pelunasan dihitung <b>otomatis</b> saat ada transaksi Cash Flow (manual) dengan kolom Invoice/Ref berisi <b>No. DT</b> yang sama, berstatus TERBAYAR LUNAS.
      </div>

      <div class="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm"><div id="tf-bar-talangan"></div></div>

      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-xs text-left border-collapse whitespace-nowrap">
            <thead class="bg-purple-50 text-purple-900 font-bold uppercase tracking-wider text-[10px] border-b border-purple-200">
              <tr>
                <th class="py-3 px-3 text-center sticky left-0 z-20 bg-purple-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.15)]">Aksi</th>
                <th class="py-3 px-3">No DT</th><th class="py-3 px-3">Tanggal</th><th class="py-3 px-3">PIC</th>
                <th class="py-3 px-3">Deskripsi</th><th class="py-3 px-3 text-right">Pinjaman</th>
                <th class="py-3 px-3 text-right">Pelunasan</th><th class="py-3 px-3 text-right">Sisa</th>
                <th class="py-3 px-3">Tgl Penggantian</th><th class="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody id="talangan-tbody" class="divide-y divide-slate-100 text-slate-700"></tbody>
          </table>
        </div>
      </div>
    </div>

  </main>

  <!-- MODAL: ADD / EDIT PR -->
  <div id="pr-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
        <div>
          <h3 id="modal-title" class="font-bold text-base">Form Purchasing Request (PR)</h3>
          <p class="text-[11px] text-slate-400">Pendaftaran PR Baru & Pengisian Data Lengkap</p>
        </div>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="pr-form" onsubmit="handleFormSubmit(event)" class="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-grow text-xs">
        <input type="hidden" id="form-id">

        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
          <h4 class="text-xs font-bold text-indigo-700 uppercase tracking-wider flex items-center gap-2 border-b border-slate-200 pb-1.5"><i class="fa-solid fa-calendar-days text-indigo-600"></i> 1. Referensi & Tanggal</h4>
          <div class="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Kategori (Sheet) *</label>
              <select id="form-sheet" required onchange="autoGeneratePRNumber()" class="w-full p-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                <option value="PROJECT">PROJECT (P-)</option>
                <option value="GENERAL">GENERAL (G-)</option>
                <option value="CONSUMABLE">CONSUMABLE / GUDANG (STR-)</option>
                <option value="MAINTENANCE">MAINTENANCE (M-)</option>
                <option value="INVENTARIS">INVENTARIS / ASET (A-)</option>
              </select>
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">No. PR *</label>
              <div class="relative">
                <input type="text" id="form-pr" placeholder="P-260001" required class="w-full p-2 bg-amber-50 border border-amber-300 font-extrabold text-indigo-900 rounded-lg focus:ring-2 focus:ring-indigo-500">
                <button type="button" onclick="autoGeneratePRNumber()" class="absolute right-1 top-1 text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded font-semibold"><i class="fa-solid fa-arrows-rotate"></i> Auto</button>
              </div>
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Tanggal PR *</label>
              <input type="date" id="form-tanggal" required class="w-full p-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">User / Peminta *</label>
              <select id="form-karyawan-select" required onchange="handleFormKaryawanChange()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"></select>
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Divisi User (Auto)</label>
              <input type="text" id="form-divisi" readonly class="w-full p-2 bg-slate-100 font-bold text-slate-700 border border-slate-300 rounded-lg">
            </div>
          </div>
        </div>

        <div class="bg-amber-50/70 p-4 rounded-xl border border-amber-200 space-y-3">
          <h4 class="text-xs font-bold text-amber-800 uppercase tracking-wider flex items-center gap-2 border-b border-amber-200/80 pb-1.5"><i class="fa-solid fa-user-check text-amber-600"></i> Approval Matrix & Penerimaan Purchasing</h4>
          <p class="text-[10px] text-amber-700/80 -mt-1">Referensi struktur organisasi untuk PR ini (bukan alur approval sistem — alur approval PR tetap lewat tombol Cek/Approve di tabel).</p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">Atasan Direct</label><select id="form-atasan-select" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"><option value="">-- Pilih --</option></select></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Manager Head</label><select id="form-manager-select" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"><option value="">-- Pilih --</option></select></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Buyer / Purchasing Intake</label><select id="form-buyer-header-select" onchange="handleHeaderBuyerChange()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"><option value="">-- Pilih Buyer --</option></select></div>
          </div>
        </div>

        <div class="bg-indigo-50/60 p-4 rounded-xl border border-indigo-100 space-y-3">
          <h4 class="text-xs font-bold text-indigo-800 uppercase tracking-wider flex items-center gap-2 border-b border-indigo-200/80 pb-1.5"><i class="fa-solid fa-diagram-project text-indigo-600"></i> 2. Work Order (WO) & Customer</h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block font-semibold text-slate-600 mb-1">No. WO Reference</label>
              <select id="form-wo-select" onchange="handleWOSelect()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
                <option value="">-- Tanpa WO --</option>
              </select>
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Nama Customer (Auto)</label>
              <input type="text" id="form-customer" placeholder="PT AMNT" readonly class="w-full p-2 bg-slate-100 border border-slate-300 rounded-lg">
            </div>
            <div>
              <label class="block font-semibold text-slate-600 mb-1">Nama Project (Auto)</label>
              <input type="text" id="form-project" placeholder="PR Jack Cyl Front CS" readonly class="w-full p-2 bg-slate-100 border border-slate-300 rounded-lg">
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between border-b border-slate-200 pb-1.5">
          <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><i class="fa-solid fa-cube text-indigo-600"></i> 3. Detail Barang, Harga & Logistik per Item</h4>
          <button type="button" id="pr-add-item-btn" onclick="addPRItemBlock()" class="text-[11px] bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"><i class="fa-solid fa-plus"></i> Tambah Item Barang</button>
        </div>
        <div id="pr-items-container" class="space-y-4"></div>

        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md">Simpan Data PR</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: AKSI APPROVAL PR (Cek Leader / Approve Manager) -->
  <div id="approval-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div id="approval-modal-header" class="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
        <h3 id="approval-modal-title" class="font-bold text-base">Cek PR</h3>
        <button onclick="closeApprovalModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <div class="p-6 space-y-4 text-xs">
        <input type="hidden" id="approval-pr-id">
        <input type="hidden" id="approval-stage">
        <div id="approval-pr-summary" class="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1"></div>
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Catatan (opsional)</label>
          <textarea id="approval-note" rows="2" placeholder="Catatan untuk keputusan ini..." class="w-full p-2 bg-white border border-slate-300 rounded-lg"></textarea>
        </div>
        <div class="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <button type="button" onclick="closeApprovalModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="button" onclick="submitApprovalDecision('reject')" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold shadow-md">Tolak</button>
          <button type="button" id="approval-approve-btn" onclick="submitApprovalDecision('approve')" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md">Setujui</button>
        </div>
      </div>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT WO -->
  <div id="wo-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
        <h3 id="wo-modal-title" class="font-bold text-base">Form Work Order (WO)</h3>
        <button onclick="closeWOModal()" class="text-slate-400 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="wo-form" onsubmit="handleWOSubmit(event)" class="p-6 space-y-4 overflow-y-auto custom-scrollbar text-xs">
        <input type="hidden" id="wo-form-id">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Kategori WO *</label>
            <select id="wo-form-category" required onchange="autoGenerateWONumber()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
              <option value="PROJECT">PROJECT</option><option value="MAINTENANCE">MAINTENANCE</option><option value="INVENTARIS">INVENTARIS / ASET</option>
            </select>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">No. WO (Unik) *</label>
            <div class="relative">
              <input type="text" id="wo-form-no" placeholder="WO-2026-001" required class="w-full p-2 bg-amber-50 border border-amber-300 font-extrabold text-slate-900 rounded-lg">
              <button type="button" onclick="autoGenerateWONumber()" class="absolute right-1 top-1 text-[10px] bg-amber-600 hover:bg-amber-700 text-white px-2 py-1 rounded font-semibold"><i class="fa-solid fa-arrows-rotate"></i> Auto</button>
            </div>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">Estimasi Kirim / Target Selesai</label><input type="date" id="wo-form-est-kirim" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Nama Project *</label><input type="text" id="wo-form-project" placeholder="PR Jack Cyl Front CS" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Nama Customer *</label><select id="wo-form-customer-select" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"></select></div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">No. PO (dari Customer)</label><input type="text" id="wo-form-po-no" placeholder="PO-CUST-88" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>

        <div class="bg-amber-50/70 p-4 rounded-xl border border-amber-200 space-y-3">
          <h4 class="font-bold text-amber-800 uppercase text-[10px] tracking-wider flex items-center gap-1.5"><i class="fa-solid fa-user-check text-amber-600"></i> Approval Matrix (Referensi)</h4>
          <p class="text-[10px] text-amber-700/80 -mt-1">Referensi struktur organisasi untuk WO ini (informasi saja, bukan alur approval sistem).</p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">User Peminta</label><select id="wo-form-requester-select" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"><option value="">-- Pilih --</option></select></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Atasan Direct</label><select id="wo-form-atasan-select" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"><option value="">-- Pilih --</option></select></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Manager Head</label><select id="wo-form-manager-select" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium"><option value="">-- Pilih --</option></select></div>
          </div>
        </div>

        <div class="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 space-y-3">
          <h4 class="font-bold text-emerald-800 uppercase text-[10px] tracking-wider flex items-center gap-1.5"><i class="fa-solid fa-sack-dollar text-emerald-600"></i> Perhitungan Komponen Finansial PO Project</h4>
          <div class="grid grid-cols-4 gap-2">
            <div><label class="block text-[11px] font-semibold text-slate-600 mb-1">Qty</label><input type="number" id="wo-form-qty" value="1" step="any" oninput="calcWOFinance()" class="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"></div>
            <div><label class="block text-[11px] font-semibold text-slate-600 mb-1">Satuan</label><input type="text" id="wo-form-satuan" value="Unit" class="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"></div>
            <div class="col-span-2"><label class="block text-[11px] font-semibold text-slate-600 mb-1">Harga Satuan (Rp)</label><input type="number" id="wo-form-harga-satuan" value="0" oninput="calcWOFinance()" class="w-full p-2 bg-white border border-slate-300 rounded-lg text-xs"></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">Diskon (Rp)</label><input type="number" id="wo-form-diskon" value="0" oninput="calcWOFinance()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Hitung PPN (11%)</label>
              <select id="wo-form-is-ppn" onchange="calcWOFinance()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"><option value="1">Ya (11%)</option><option value="0">Tidak (0%)</option></select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">PPh 23 (2% dari DPP)</label>
              <select id="wo-form-is-pph23" onchange="calcWOFinance()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"><option value="1">Ya (2%)</option><option value="0">Tidak (0%)</option></select>
            </div>
            <div><label class="block font-semibold text-slate-600 mb-1">PPh Lain (%)</label><input type="number" id="wo-form-pph-lain-pct" value="0" step="0.1" oninput="calcWOFinance()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          </div>
          <div class="bg-white p-3 rounded-lg space-y-1 text-xs text-slate-600 border border-slate-200">
            <div class="flex justify-between"><span>DPP (Sub Total - Diskon):</span><span id="wo-calc-dpp" class="font-semibold">Rp 0</span></div>
            <div class="flex justify-between"><span>PPN (11%):</span><span id="wo-calc-ppn" class="font-semibold text-blue-600">Rp 0</span></div>
            <div class="flex justify-between"><span>PPh 23 (2%):</span><span id="wo-calc-pph23" class="font-semibold text-indigo-600">Rp 0</span></div>
            <div class="flex justify-between"><span>PPh Lain-lain:</span><span id="wo-calc-pphlain" class="font-semibold text-purple-600">Rp 0</span></div>
            <div class="flex justify-between text-slate-800 font-bold border-t border-slate-200 pt-1"><span>TOTAL NILAI JUAL WO:</span><span id="wo-calc-total">Rp 0</span></div>
          </div>
        </div>

        <div class="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-slate-700 uppercase text-[10px] tracking-wider flex items-center gap-1.5"><i class="fa-solid fa-calculator text-amber-600"></i> Budgeting Produksi Perusahaan</h4>
            <button type="button" onclick="addWOBudgetItemBlock()" class="text-[11px] bg-amber-600 hover:bg-amber-700 text-white font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"><i class="fa-solid fa-plus"></i> Item Pekerjaan</button>
          </div>
          <p class="text-[10px] text-slate-400 -mt-2">Kalau diisi, Budget & Aktual Produksi di bawah dihitung otomatis dari total baris-baris ini. Kosongkan untuk isi manual (kompatibel dengan WO lama).</p>
          <div id="wo-budget-items-container" class="space-y-2"></div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
            <div><label class="block font-semibold text-slate-600 mb-1">Budget Produksi (Rp) <span id="wo-bprod-auto-hint" class="hidden font-normal text-amber-600">(auto dari Item Pekerjaan)</span></label><input type="number" id="wo-form-budget-prod" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Aktual Produksi (Rp) <span id="wo-aprod-auto-hint" class="hidden font-normal text-amber-600">(auto dari Item Pekerjaan)</span></label><input type="number" id="wo-form-aktual-prod" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">Budget Pembelian (Rp)</label><input type="number" id="wo-form-budget-pem" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Aktual Pembelian (DPP Auto dari PR)</label><input type="text" id="wo-form-aktual-pem" readonly class="w-full p-2 bg-indigo-50 font-bold text-indigo-900 border border-indigo-200 rounded-lg" title="Dihitung otomatis dari total DPP PR terkait"></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">Budget Lain-lain (Rp)</label><input type="number" id="wo-form-budget-lain" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Aktual Lain-lain (Manual Rp)</label><input type="number" id="wo-form-total-lain" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Status Tracking Pekerjaan *</label>
            <select id="wo-form-status" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
              <option value="ON PROGRESS">ON PROGRESS</option><option value="HOLD">HOLD</option><option value="CANCEL">CANCEL</option><option value="DELIVERY">DELIVERY</option><option value="FINISHED">FINISHED</option>
            </select>
          </div>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Status Budget Perusahaan</label>
            <div id="wo-form-status-budget" class="w-full p-2.5 rounded-lg font-bold text-center bg-slate-100 text-slate-500">-</div>
          </div>
        </div>

        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeWOModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 shadow-md">Simpan Data WO</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT SEAL CNC -->
  <div id="seal-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl overflow-hidden">
      <div class="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
        <h3 id="seal-modal-title" class="font-bold text-base">Form Produksi & Pesanan SEAL CNC</h3>
        <button onclick="closeSealModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="seal-form" onsubmit="handleSealSubmit(event)" class="p-6 space-y-4 overflow-y-auto custom-scrollbar max-h-[80vh] text-xs">
        <input type="hidden" id="seal-form-id">
        <div class="bg-amber-50 p-3.5 rounded-xl border border-amber-200 space-y-3">
          <h4 class="font-bold text-amber-900 uppercase text-[10px] tracking-wider">Data Work Order (WO)</h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label class="block font-semibold text-slate-700 mb-1">No. WO *</label><select id="seal-wo-select" required onchange="handleSealWOChange()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></select></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Nama Project (Auto)</label><input type="text" id="seal-project-input" readonly class="w-full p-2 bg-slate-100 border border-slate-300 rounded-lg font-semibold"></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Nama Customer (Auto)</label><input type="text" id="seal-customer-input" readonly class="w-full p-2 bg-slate-100 border border-slate-300 rounded-lg font-semibold"></div>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <h4 class="font-bold text-slate-700 uppercase text-[10px] tracking-wider">Data Product Seal CNC</h4>
          <button type="button" id="seal-add-item-btn" onclick="addSealItemBlock()" class="text-[11px] bg-amber-600 hover:bg-amber-700 text-white font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"><i class="fa-solid fa-plus"></i> Tambah Item Seal</button>
        </div>
        <div id="seal-items-container" class="space-y-3"></div>
        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeSealModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 shadow-md">Simpan Data Seal CNC</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT TRANSPORTASI -->
  <div id="transport-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl overflow-hidden">
      <div class="px-6 py-4 bg-blue-600 text-white flex items-center justify-between">
        <h3 id="transport-modal-title" class="font-bold text-base">Form Logistik & Transportasi</h3>
        <button onclick="closeTransportModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="transport-form" onsubmit="handleTransportSubmit(event)" class="p-6 space-y-4 overflow-y-auto custom-scrollbar max-h-[80vh] text-xs">
        <input type="hidden" id="trans-form-id">
        <div class="bg-blue-50 p-3.5 rounded-xl border border-blue-200 space-y-3">
          <h4 class="font-bold text-blue-900 uppercase text-[10px] tracking-wider">Data Work Order (WO)</h4>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label class="block font-semibold text-slate-700 mb-1">No. WO *</label><select id="transport-wo-select" required onchange="handleTransportWOChange()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></select></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Nama Project (Auto)</label><input type="text" id="transport-project-input" readonly class="w-full p-2 bg-slate-100 border border-slate-300 rounded-lg font-semibold"></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Nama Customer (Auto)</label><input type="text" id="transport-customer-input" readonly class="w-full p-2 bg-slate-100 border border-slate-300 rounded-lg font-semibold"></div>
          </div>
        </div>
        <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3">
          <h4 class="font-bold text-slate-700 uppercase text-[10px] tracking-wider">Data Transportasi & Logistik</h4>
          <div><label class="block font-semibold text-slate-600 mb-1">Deskripsi Armada/Jasa</label><input type="text" id="transport-deskripsi" placeholder="Sewa Truck Engkel Box" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">Destinasi Awal</label><input type="text" id="transport-asal" placeholder="Jakarta" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Destinasi Tujuan</label><input type="text" id="transport-tujuan" placeholder="Surabaya" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-600 mb-1">Qty *</label><input type="number" id="transport-qty" min="0.01" step="any" value="1" required oninput="calcTransportTotal()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
            <div><label class="block font-semibold text-slate-600 mb-1">Harga Satuan (Rp)</label><input type="number" id="transport-harga" min="0" value="0" oninput="calcTransportTotal()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          </div>
          <div><label class="block font-semibold text-slate-600 mb-1">Total (Rp)</label><input type="text" id="transport-total-display" readonly class="w-full p-2 bg-slate-900 text-emerald-400 border border-slate-800 rounded-lg font-extrabold"></div>
        </div>
        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeTransportModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md">Simpan Transportasi</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT MATERIAL (Stok Gudang) -->
  <div id="inventory-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-lg overflow-hidden">
      <div class="px-6 py-4 bg-emerald-600 text-white flex items-center justify-between">
        <h3 id="inventory-modal-title" class="font-bold text-base">Form Material Gudang</h3>
        <button onclick="closeInventoryItemModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="inventory-form" onsubmit="handleInventoryItemSubmit(event)" class="p-6 space-y-3 overflow-y-auto custom-scrollbar max-h-[80vh] text-xs">
        <input type="hidden" id="inv-form-id">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">SKU *</label><input type="text" id="inv-sku" required class="w-full p-2 bg-amber-50 font-mono font-black border border-amber-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Barcode</label><input type="text" id="inv-barcode" placeholder="Opsional" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">Nama Material *</label><input type="text" id="inv-nama" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Kategori</label><input type="text" id="inv-kategori" placeholder="Consumable / Sparepart" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Satuan</label><input type="text" id="inv-satuan" value="Pcs" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Harga Satuan (Rp)</label><input type="number" id="inv-harga" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Stok Minimum (Alert)</label><input type="number" id="inv-stok-min" min="0" step="any" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        </div>
        <div id="inv-stok-awal-wrapper"><label class="block font-semibold text-slate-700 mb-1">Stok Awal (opening balance, hanya saat tambah baru)</label><input type="number" id="inv-stok-awal" min="0" step="any" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Lokasi Rak</label><input type="text" id="inv-lokasi" placeholder="Rak A-01" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Status</label>
          <select id="inv-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option></select>
        </div>
        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeInventoryItemModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow-md">Simpan Material</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: CATAT PERGERAKAN STOK -->
  <div id="movement-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-lg overflow-hidden">
      <div class="px-6 py-4 bg-cyan-600 text-white flex items-center justify-between">
        <h3 class="font-bold text-base">Catat Pergerakan Stok</h3>
        <button onclick="closeMovementModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="movement-form" onsubmit="handleMovementSubmit(event)" class="p-6 space-y-3 overflow-y-auto custom-scrollbar max-h-[80vh] text-xs">
        <div><label class="block font-semibold text-slate-700 mb-1">Material *</label><select id="mv-item-select" required onchange="handleMovementItemChange()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></select></div>
        <p id="mv-stok-info" class="text-[11px] text-slate-500 -mt-2">Stok saat ini: -</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Tipe *</label>
            <select id="mv-tipe" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
              <option value="IN">IN (Masuk)</option>
              <option value="OUT">OUT (Keluar)</option>
              <option value="ADJUSTMENT">ADJUSTMENT (Koreksi Opname)</option>
            </select>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">Tanggal *</label><input type="date" id="mv-tanggal" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Qty * <span id="mv-qty-hint" class="font-normal text-slate-400"></span></label><input type="number" id="mv-qty" step="any" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Sumber</label>
            <select id="mv-sumber" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
              <option value="MANUAL">MANUAL</option>
              <option value="PEMBELIAN">PEMBELIAN (dari PR)</option>
              <option value="RETUR">RETUR</option>
              <option value="OPNAME">OPNAME</option>
            </select>
          </div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">No. WO (opsional)</label><select id="mv-wo-select" class="w-full p-2 bg-white border border-slate-300 rounded-lg"><option value="">-- Tanpa WO --</option></select></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Keterangan</label><input type="text" id="mv-keterangan" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeMovementModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-cyan-600 text-white rounded-xl font-bold hover:bg-cyan-700 shadow-md">Simpan Pergerakan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT PRODUKSI & BOM -->
  <div id="production-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl overflow-hidden">
      <div class="px-6 py-4 bg-teal-600 text-white flex items-center justify-between">
        <h3 id="production-modal-title" class="font-bold text-base">Form Produksi & BOM</h3>
        <button onclick="closeProductionModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="production-form" onsubmit="handleProductionSubmit(event)" class="p-6 space-y-4 overflow-y-auto custom-scrollbar max-h-[80vh] text-xs">
        <input type="hidden" id="prod-form-id">
        <div class="bg-teal-50 p-3.5 rounded-xl border border-teal-200 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-700 mb-1">No. Produksi (Auto/Editable)</label><input type="text" id="prod-po-number" placeholder="Otomatis kalau dikosongkan" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-mono font-bold"></div>
            <div><label class="block font-semibold text-slate-700 mb-1">No. WO (opsional)</label><select id="prod-wo-select" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="">-- Tanpa WO --</option></select></div>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">Nama Produk *</label><input type="text" id="prod-product" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label class="block font-semibold text-slate-700 mb-1">Qty Target *</label><input type="number" id="prod-qty-target" min="0.001" step="any" value="1" required onchange="recalcAllBomQty()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Tgl Mulai</label><input type="date" id="prod-tgl-mulai" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Tgl Target</label><input type="date" id="prod-tgl-target" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">Status</label>
            <select id="prod-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
              <option value="DRAFT">DRAFT</option><option value="ON PROGRESS">ON PROGRESS</option>
              <option value="HOLD">HOLD</option><option value="SELESAI">SELESAI</option><option value="CANCEL">CANCEL</option>
            </select>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <h4 class="font-bold text-slate-700 uppercase text-[10px] tracking-wider">Bill of Materials (BOM)</h4>
          <button type="button" onclick="addBomItemBlock()" class="text-[11px] bg-teal-600 hover:bg-teal-700 text-white font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"><i class="fa-solid fa-plus"></i> Tambah Material</button>
        </div>
        <div id="bom-items-container" class="space-y-3"></div>
        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeProductionModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 shadow-md">Simpan Produksi</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT CUSTOMER -->
  <div id="customer-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
      <div class="px-6 py-4 bg-blue-600 text-white flex items-center justify-between">
        <h3 id="customer-modal-title" class="font-bold text-base">Form Data Customer</h3>
        <button onclick="closeAddCustomerModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="customer-form" onsubmit="handleCustomerSubmit(event)" class="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-grow text-xs">
        <input type="hidden" id="cust-form-id">
        <div><label class="block font-semibold text-slate-700 mb-1">Nama Customer / Perusahaan *</label><input type="text" id="cust-nama" placeholder="PT AMNT" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Alamat Lengkap</label><textarea id="cust-alamat" rows="2" placeholder="Jl. Raya Industri No. 8..." class="w-full p-2 bg-white border border-slate-300 rounded-lg"></textarea></div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Kelurahan</label><input type="text" id="cust-kelurahan" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Kecamatan</label><input type="text" id="cust-kecamatan" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Kota / Kabupaten</label><input type="text" id="cust-kota" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Provinsi</label><input type="text" id="cust-provinsi" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Kode Pos</label><input type="text" id="cust-kodepos" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Negara</label><input type="text" id="cust-negara" value="Indonesia" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">PIC</label><input type="text" id="cust-pic" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Contact Person (Jabatan)</label><input type="text" id="cust-cp" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">No. Telepon / HP</label><input type="text" id="cust-telepon" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Nomor NPWP</label><input type="text" id="cust-npwp" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Status Customer</label><select id="cust-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option></select></div>
        </div>
        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeAddCustomerModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md">Simpan Customer</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT SUPPLIER -->
  <div id="supplier-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
      <div class="px-6 py-4 bg-purple-600 text-white flex items-center justify-between">
        <h3 id="supplier-modal-title" class="font-bold text-base">Form Data Supplier</h3>
        <button onclick="closeAddSupplierModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="supplier-form" onsubmit="handleSupplierSubmit(event)" class="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-grow text-xs">
        <input type="hidden" id="supp-form-id">
        <div><label class="block font-semibold text-slate-700 mb-1">Nama Supplier / Vendor *</label><input type="text" id="supp-nama" placeholder="MULTI PRIMA SEAL" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Alamat Lengkap</label><textarea id="supp-alamat" rows="2" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></textarea></div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Kelurahan</label><input type="text" id="supp-kelurahan" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Kecamatan</label><input type="text" id="supp-kecamatan" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Kota / Kabupaten</label><input type="text" id="supp-kota" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Provinsi</label><input type="text" id="supp-provinsi" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Kode Pos</label><input type="text" id="supp-kodepos" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Negara</label><input type="text" id="supp-negara" value="Indonesia" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">PIC</label><input type="text" id="supp-pic" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Contact Person (Jabatan)</label><input type="text" id="supp-cp" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">No. Telepon / HP</label><input type="text" id="supp-telepon" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Nomor NPWP</label><input type="text" id="supp-npwp" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Status Supplier</label><select id="supp-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option></select></div>
        </div>
        <div class="pt-3 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeAddSupplierModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 shadow-md">Simpan Supplier</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: MASTER DIRECTORY (Product / Buyer) -->
  <div id="master-add-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-indigo-600 text-white flex items-center justify-between">
        <h3 id="master-add-title" class="font-bold text-base">Tambah Master</h3>
        <button onclick="closeAddMasterModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="master-add-form" onsubmit="handleMasterAddSubmit(event)" class="p-6 space-y-4 text-xs">
        <input type="hidden" id="master-type">
        <input type="hidden" id="master-mode">
        <input type="hidden" id="master-old-id">
        <div><label class="block font-semibold text-slate-700 mb-1">Nama</label><input type="text" id="master-input-name" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeAddMasterModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md">Simpan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: MASTER KARYAWAN -->
  <div id="karyawan-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
        <h3 id="karyawan-modal-title" class="font-bold text-base">Tambah Karyawan</h3>
        <button onclick="closeKaryawanModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="karyawan-form" onsubmit="handleKaryawanSubmit(event)" class="p-6 space-y-3 text-xs">
        <input type="hidden" id="kar-form-id">
        <div><label class="block font-semibold text-slate-700 mb-1">Nama Karyawan *</label><input type="text" id="kar-nama" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Divisi</label><input type="text" id="kar-divisi" value="GENERAL" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Jabatan (opsional)</label><input type="text" id="kar-jabatan" placeholder="Staff / Leader / Manager" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">Status</label>
          <select id="kar-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option></select>
        </div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeKaryawanModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 shadow-md">Simpan Karyawan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: TERIMA BARANG (Incoming -> Receiving) -->
  <div id="receive-goods-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-lime-600 text-white flex items-center justify-between">
        <h3 class="font-bold text-base">Konfirmasi Terima Barang</h3>
        <button onclick="closeReceiveGoodsModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="receive-goods-form" onsubmit="handleReceiveGoodsSubmit(event)" class="p-6 space-y-3 text-xs">
        <input type="hidden" id="rg-form-id">
        <div id="rg-info-box" class="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Penerima Barang *</label><input type="text" id="rg-penerima" required placeholder="Nama penerima" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <p class="text-[10px] text-slate-400">Setelah dikonfirmasi, stok Gudang untuk barang ini otomatis bertambah dan PR ini pindah ke daftar Receiving Goods.</p>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeReceiveGoodsModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-lime-600 text-white rounded-xl font-bold hover:bg-lime-700 shadow-md">Konfirmasi Terima</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: MTC - MASTER MESIN -->
  <div id="mtc-mesin-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-indigo-600 text-white flex items-center justify-between">
        <h3 id="mtc-mesin-modal-title" class="font-bold text-base">Tambah Master Mesin</h3>
        <button onclick="closeMTCMesinModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="mtc-mesin-form" onsubmit="handleMTCMesinSubmit(event)" class="p-6 space-y-3 text-xs">
        <input type="hidden" id="mtcm-form-id">
        <div><label class="block font-semibold text-slate-700 mb-1">Kode Mesin *</label><input type="text" id="mtcm-kode" required placeholder="M01" class="w-full p-2 bg-amber-50 border border-amber-300 font-mono font-bold rounded-lg"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Nama Mesin *</label><input type="text" id="mtcm-nama" required placeholder="Bubut CNC Heavy Duty" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Tarif per Jam/Pemakaian (Rp)</label><input type="number" id="mtcm-harga" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Status</label><select id="mtcm-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option></select></div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeMTCMesinModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md">Simpan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: MTC - MASTER TARIF DIVISI -->
  <div id="mtc-mp-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-teal-600 text-white flex items-center justify-between">
        <h3 id="mtc-mp-modal-title" class="font-bold text-base">Tambah Tarif Divisi</h3>
        <button onclick="closeMTCMpModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="mtc-mp-form" onsubmit="handleMTCMpSubmit(event)" class="p-6 space-y-3 text-xs">
        <input type="hidden" id="mtcmp-form-id">
        <div><label class="block font-semibold text-slate-700 mb-1">Kode *</label><input type="text" id="mtcmp-kode" required placeholder="DIV-01" class="w-full p-2 bg-amber-50 border border-amber-300 font-mono font-bold rounded-lg"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Divisi *</label><select id="mtcmp-divisi" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></select></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Tarif per Jam Manpower (Rp)</label><input type="number" id="mtcmp-harga" min="0" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Status</label><select id="mtcmp-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option></select></div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeMTCMpModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 shadow-md">Simpan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: MTC - CATAT BIAYA DIVISI (record + multi-item) -->
  <div id="mtc-record-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
      <div class="px-6 py-4 bg-teal-600 text-white flex items-center justify-between">
        <h3 id="mtc-record-modal-title" class="font-bold text-base">Catat Biaya Divisi Produksi</h3>
        <button onclick="closeMTCRecordModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="mtc-record-form" onsubmit="handleMTCRecordSubmit(event)" class="p-6 space-y-4 overflow-y-auto custom-scrollbar text-xs">
        <input type="hidden" id="mtcr-form-id">
        <div class="bg-teal-50 p-3.5 rounded-xl border border-teal-200 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label class="block font-semibold text-slate-700 mb-1">Item Pekerjaan (dari WO) *</label><select id="mtcr-item-select" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></select></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Divisi *</label><select id="mtcr-divisi-select" required onchange="handleMTCDivisiSelectChange()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></select></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label class="block font-semibold text-slate-700 mb-1">PIC</label><input type="text" id="mtcr-pic" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-700 mb-1">No. Surat Jalan</label><input type="text" id="mtcr-suratjalan" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block font-semibold text-slate-700 mb-1">Status Workflow</label>
              <select id="mtcr-status-workflow" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
                <option value="NORMAL">NORMAL</option><option value="REWORK">REWORK</option><option value="CLAIM">CLAIM</option><option value="REJECT">REJECT</option>
              </select>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between">
          <h4 class="font-bold text-slate-700 uppercase text-[10px] tracking-wider">Rincian Pekerjaan & Biaya</h4>
          <button type="button" onclick="addMTCItemBlock()" class="text-[11px] bg-teal-600 hover:bg-teal-700 text-white font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"><i class="fa-solid fa-plus"></i> Tambah Baris</button>
        </div>
        <div id="mtc-items-container" class="space-y-3"></div>
        <div class="bg-slate-900 text-teal-300 p-3 rounded-lg flex justify-between items-center font-extrabold text-sm">
          <span>TOTAL BIAYA</span><span id="mtcr-grand-total">Rp 0</span>
        </div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeMTCRecordModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 shadow-md">Simpan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: TAMBAH USER (login account) -->
  <div id="master-user-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-blue-600 text-white flex items-center justify-between">
        <h3 id="master-user-title" class="font-bold text-base">Tambah User</h3>
        <button onclick="closeMasterUserModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="master-user-form" onsubmit="handleMasterUserSubmit(event)" class="p-6 space-y-3 text-xs">
        <input type="hidden" id="mu-form-id">
        <div><label class="block font-semibold text-slate-700 mb-1">Username (login) *</label><input type="text" id="mu-username" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Nama Lengkap *</label><input type="text" id="mu-fullname" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Divisi</label><input type="text" id="mu-divisi" placeholder="MAINTENANCE" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Role</label><select id="mu-role" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></select></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Status</label><select id="mu-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"><option value="AKTIF">AKTIF</option><option value="NON AKTIF">NON AKTIF</option></select></div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">Password <span id="mu-password-hint">*</span></label><input type="password" id="mu-password" placeholder="Kosongkan jika tidak diubah" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeMasterUserModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md">Simpan User</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: TAMBAH / EDIT ROLE -->
  <div id="role-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-sm overflow-hidden">
      <div class="px-6 py-4 bg-rose-600 text-white flex items-center justify-between">
        <h3 id="role-modal-title" class="font-bold text-base">Tambah Role</h3>
        <button onclick="closeRoleModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="role-form" onsubmit="handleRoleSubmit(event)" class="p-6 space-y-4 text-xs">
        <input type="hidden" id="role-form-id">
        <div>
          <label class="block font-semibold text-slate-700 mb-1">Nama Role *</label>
          <input type="text" id="role-label" placeholder="Contoh: Leader Gudang" required oninput="previewRoleKey()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold">
          <p id="role-key-preview" class="text-[10px] text-slate-400 mt-1"></p>
        </div>
        <div class="flex items-start gap-2 bg-rose-50 border border-rose-100 rounded-lg p-3">
          <input type="checkbox" id="role-is-admin" class="w-4 h-4 mt-0.5 text-rose-600 rounded border-slate-300">
          <label for="role-is-admin" class="text-xs text-rose-900 cursor-pointer">
            <span class="font-bold">Akses Admin Penuh</span><br>
            <span class="text-[10px] text-rose-700">Kalau dicentang, siapapun dengan role ini bisa hapus data master, hapus user, dan kelola role lain — setara akun Admin.</span>
          </label>
        </div>
        <p id="role-system-note" class="hidden text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Ini role bawaan sistem. Nama boleh diubah, tapi tidak bisa dihapus dan status Akses Admin Penuh-nya terkunci.</p>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeRoleModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 shadow-md">Simpan Role</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: TRANSAKSI CASH FLOW MANUAL -->
  <div id="cashflow-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-blue-600 text-white flex items-center justify-between">
        <h3 id="cashflow-modal-title" class="font-bold text-base">Tambah Transaksi Cash Flow</h3>
        <button onclick="closeCashflowModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="cashflow-form" onsubmit="handleCashflowSubmit(event)" class="p-6 space-y-3 text-xs">
        <input type="hidden" id="cf-form-id">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Tanggal *</label><input type="date" id="cf-tanggal" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Kode *</label>
            <select id="cf-kode" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium">
              <option value="Beban">Beban</option><option value="Pendapatan">Pendapatan</option><option value="Inventaris">Inventaris</option>
              <option value="Piutang">Piutang</option><option value="Hutang">Hutang</option><option value="Dana Talangan">Dana Talangan</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Tipe Mutasi *</label>
            <select id="cf-tp" required class="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold">
              <option value="IN">IN (Kas Masuk)</option><option value="OUT">OUT (Kas Keluar)</option>
            </select>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">Nominal (Rp) *</label><input type="number" id="cf-nominal" required min="1" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">Deskripsi *</label><input type="text" id="cf-deskripsi" required placeholder="Penjelasan transaksi" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Cust/Supp/PIC</label><input type="text" id="cf-pic" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">No Invoice / Ref / No DT</label><input type="text" id="cf-invoice" placeholder="Contoh: DT-2026-001" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">No WO</label><input type="text" id="cf-wo" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">No PO</label><input type="text" id="cf-po" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">PPh 23 (Rp)</label><input type="number" id="cf-pph23" value="0" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Status</label>
            <select id="cf-status" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-medium">
              <option value="TERBAYAR LUNAS">TERBAYAR LUNAS</option><option value="PENDING">PENDING</option>
            </select>
          </div>
        </div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeCashflowModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-md">Simpan Transaksi</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: RECORD AR -->
  <div id="ar-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden">
      <div class="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
        <h3 id="ar-modal-title" class="font-bold text-base">Tambah Record AR</h3>
        <button onclick="closeARModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="ar-form" onsubmit="handleARSubmit(event)" class="p-6 space-y-3 overflow-y-auto custom-scrollbar text-xs">
        <input type="hidden" id="ar-form-id">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">No Invoice *</label><input type="text" id="ar-invoice" required placeholder="INV/2026/001" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Customer *</label><select id="ar-customer-select" required onchange="populateARWODropdown()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></select></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Tgl Invoice *</label><input type="date" id="ar-tgl-invoice" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Tgl Kirim Invoice *</label><input type="date" id="ar-tgl-kirim" required onchange="calcARDueDate()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">No PO (dari WO Customer)</label><select id="ar-wo-select" onchange="autoFillARFromWO()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></select></div>
          <div><label class="block font-semibold text-slate-700 mb-1">TOP (Term of Payment)</label>
            <select id="ar-top" onchange="calcARDueDate()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold">
              <option value="30">30 DAYS</option><option value="14">14 DAYS</option><option value="7">7 DAYS</option><option value="0">0 DAYS</option><option value="45">45 DAYS</option><option value="60">60 DAYS</option><option value="90">90 DAYS</option>
            </select>
          </div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">Deskripsi Pekerjaan</label><input type="text" id="ar-deskripsi" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Penjualan (DPP) *</label><input type="number" id="ar-penjualan" required value="0" oninput="calcARSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">PPN (11%)</label>
            <select id="ar-is-ppn" onchange="calcARSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"><option value="1">Ya (11%)</option><option value="0">Tidak (0%)</option></select>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">PPN 030</label>
            <select id="ar-is-ppn030" onchange="calcARSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"><option value="0">Tidak (0%)</option><option value="1">Ya (11%)</option></select>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">PPh 23 (Rp)</label><input type="number" id="ar-pph23" value="0" oninput="calcARSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Biaya Lain (Rp)</label><input type="number" id="ar-biaya-lain" value="0" oninput="calcARSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Due Date (Auto)</label><input type="date" id="ar-due-date" readonly class="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-700"></div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">No Faktur Pajak</label><input type="text" id="ar-faktur-pajak" placeholder="010.000-26.00000001" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <span class="text-xs font-bold text-slate-700 block border-b border-slate-200 pb-1">Status Pembayaran Customer</span>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-[11px] font-semibold text-slate-600 mb-1">Jumlah Terbayar (Rp)</label><input type="number" id="ar-terbayar" value="0" oninput="calcARSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block text-[11px] font-semibold text-slate-600 mb-1">Tanggal Bayar</label><input type="date" id="ar-tgl-bayar" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          </div>
          <div class="flex justify-between items-center text-xs pt-1"><span>Sisa Piutang:</span><span id="ar-calc-sisa" class="font-bold text-amber-600">Rp 0</span></div>
        </div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeARModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-amber-600 text-white rounded-xl font-bold hover:bg-amber-700 shadow-md">Simpan Record AR</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: RECORD AP -->
  <div id="ap-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden">
      <div class="px-6 py-4 bg-rose-600 text-white flex items-center justify-between">
        <h3 id="ap-modal-title" class="font-bold text-base">Tambah Record AP</h3>
        <button onclick="closeAPModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="ap-form" onsubmit="handleAPSubmit(event)" class="p-6 space-y-3 overflow-y-auto custom-scrollbar text-xs">
        <input type="hidden" id="ap-form-id">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">No Invoice Supplier *</label><input type="text" id="ap-invoice" required placeholder="INV-SUPP-889" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Supplier *</label><select id="ap-supplier-select" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></select></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Tgl Invoice *</label><input type="date" id="ap-tgl-invoice" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Tgl Terima Invoice *</label><input type="date" id="ap-tgl-terima" required onchange="calcAPDueDate()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">No PO</label><input type="text" id="ap-po" placeholder="PO-SUPP-101" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">TOP (Term of Payment)</label>
            <select id="ap-top" onchange="calcAPDueDate()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-semibold">
              <option value="30">30 DAYS</option><option value="14">14 DAYS</option><option value="7">7 DAYS</option><option value="0">0 DAYS</option><option value="45">45 DAYS</option><option value="60">60 DAYS</option><option value="90">90 DAYS</option>
            </select>
          </div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">Deskripsi Tagihan</label><input type="text" id="ap-deskripsi" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Pembelian (DPP) *</label><input type="number" id="ap-pembelian" required value="0" oninput="calcAPSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">PPN (11%)</label>
            <select id="ap-is-ppn" onchange="calcAPSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"><option value="1">Ya (11%)</option><option value="0">Tidak (0%)</option></select>
          </div>
          <div><label class="block font-semibold text-slate-700 mb-1">PPh 23 (2%)</label>
            <select id="ap-is-pph23" onchange="calcAPSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"><option value="1">Ya (2%)</option><option value="0">Tidak (0%)</option></select>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">Biaya Lain (Rp)</label><input type="number" id="ap-biaya-lain" value="0" oninput="calcAPSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Due Date (Auto)</label><input type="date" id="ap-due-date" readonly class="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-700"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">No Faktur Pajak</label><input type="text" id="ap-faktur-pajak" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <span class="text-xs font-bold text-slate-700 block border-b border-slate-200 pb-1">Status Pembayaran ke Supplier</span>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-[11px] font-semibold text-slate-600 mb-1">Jumlah Terbayar (Rp)</label><input type="number" id="ap-terbayar" value="0" oninput="calcAPSisa()" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
            <div><label class="block text-[11px] font-semibold text-slate-600 mb-1">Tanggal Bayar</label><input type="date" id="ap-tgl-bayar" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          </div>
          <div class="flex justify-between items-center text-xs pt-1"><span>Sisa Hutang:</span><span id="ap-calc-sisa" class="font-bold text-rose-600">Rp 0</span></div>
        </div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeAPModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-rose-600 text-white rounded-xl font-bold hover:bg-rose-700 shadow-md">Simpan Record AP</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: DANA TALANGAN -->
  <div id="talangan-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl border border-slate-100 w-full max-w-md overflow-hidden">
      <div class="px-6 py-4 bg-purple-600 text-white flex items-center justify-between">
        <h3 id="talangan-modal-title" class="font-bold text-base">Tambah Dana Talangan</h3>
        <button onclick="closeTalanganModal()" class="text-white/80 hover:text-white p-1 rounded-lg"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="talangan-form" onsubmit="handleTalanganSubmit(event)" class="p-6 space-y-3 text-xs">
        <input type="hidden" id="talangan-form-id">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">No DT *</label><input type="text" id="talangan-no" required placeholder="DT-2026-001" class="w-full p-2 bg-white border border-slate-300 rounded-lg font-bold text-blue-600"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Tanggal *</label><input type="date" id="talangan-tanggal" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="block font-semibold text-slate-700 mb-1">PIC Pemberi Pinjaman *</label><input type="text" id="talangan-pic" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
          <div><label class="block font-semibold text-slate-700 mb-1">Nilai Pinjaman (Rp) *</label><input type="number" id="talangan-pinjaman" required min="1" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        </div>
        <div><label class="block font-semibold text-slate-700 mb-1">Deskripsi Keperluan *</label><input type="text" id="talangan-deskripsi" required class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div><label class="block font-semibold text-slate-700 mb-1">Tanggal Penggantian</label><input type="date" id="talangan-tgl-penggantian" class="w-full p-2 bg-white border border-slate-300 rounded-lg"></div>
        <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-slate-600">
          <i class="fa-solid fa-circle-info text-blue-600 mr-1"></i>Pelunasan dihitung otomatis dari Cash Flow yang kolom Invoice/Ref-nya sama dengan No DT ini.
        </div>
        <div class="pt-2 flex items-center justify-end space-x-2 border-t border-slate-100">
          <button type="button" onclick="closeTalanganModal()" class="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-semibold">Batal</button>
          <button type="submit" class="px-5 py-2 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 shadow-md">Simpan Talangan</button>
        </div>
      </form>
    </div>
  </div>

  <!-- TOAST NOTIFICATION -->
  <!-- MODAL KONFIRMASI (pengganti confirm() bawaan browser) -->
  <div id="confirm-modal" class="hidden fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
      <div class="p-6 text-center">
        <div id="confirm-modal-icon" class="mx-auto w-14 h-14 rounded-full bg-amber-100 text-amber-500 flex items-center justify-center text-2xl mb-4">
          <i class="fa-solid fa-triangle-exclamation"></i>
        </div>
        <h3 id="confirm-modal-title" class="text-base font-extrabold text-slate-800">Apakah anda yakin ingin menghapus item ini?</h3>
        <p id="confirm-modal-message" class="text-xs text-slate-500 mt-2 leading-relaxed"></p>
      </div>
      <div class="flex gap-2 px-6 pb-6">
        <button id="confirm-modal-no" type="button" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold py-2.5 rounded-xl transition">TIDAK</button>
        <button id="confirm-modal-yes" type="button" class="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold py-2.5 rounded-xl transition">YA</button>
      </div>
    </div>
  </div>

  <div id="toast" class="hidden fixed bottom-5 right-5 z-[100] px-4 py-3 rounded-xl shadow-lg text-xs font-bold text-white"></div>

  <!-- Current user & role info dipakai app.js (menggantikan currentUser palsu di versi lama) -->
  <script>
    window.CURRENT_USER = <?= json_encode($user, JSON_UNESCAPED_UNICODE) ?>;
  </script>
  <script src="assets/js/app.js"></script>
</body>
</html>
