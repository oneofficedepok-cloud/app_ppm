<?php
require_once __DIR__ . '/includes/auth.php';

// Jika sudah login, langsung lempar ke dashboard.
if (current_user()) {
    header('Location: index.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="id" class="h-full bg-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - <?= esc_html(APP_NAME) ?></title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="h-full flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700 px-4">

  <div class="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
    <div class="px-6 py-6 bg-slate-900 text-white text-center">
      <div class="w-14 h-14 mx-auto rounded-xl bg-indigo-600 flex items-center justify-center text-2xl mb-3">
        <i class="fa-solid fa-boxes-packing"></i>
      </div>
      <h1 class="font-extrabold text-lg tracking-tight">PANCA PUTRA MADANI</h1>
      <p class="text-[11px] text-slate-400 mt-1">Sistem Purchasing, WO &amp; Keuangan</p>
    </div>

    <form id="login-form" class="p-6 space-y-4 text-xs">
      <div id="login-alert" class="hidden text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 text-[11px] font-semibold"></div>

      <div>
        <label class="block font-semibold text-slate-700 mb-1">Username</label>
        <input type="text" id="username" required autofocus
               class="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:ring-2 focus:ring-indigo-500">
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-1">Password</label>
        <input type="password" id="password" required
               class="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold focus:ring-2 focus:ring-indigo-500">
      </div>

      <button type="submit" id="login-btn"
              class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-md transition">
        Login
      </button>

      <p class="text-center text-[10px] text-slate-400 pt-2">
        Default: <b>admin</b> / <b>admin123</b> &mdash; segera ganti setelah login pertama.
      </p>
    </form>
  </div>

  <script>
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      const alertBox = document.getElementById('login-alert');
      alertBox.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Memproses...';

      try {
        const res = await fetch('api/auth.php?action=login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value.trim(),
            password: document.getElementById('password').value,
          }),
        });
        const json = await res.json();

        if (json.success) {
          window.location.href = 'index.php';
        } else {
          alertBox.textContent = json.message || 'Login gagal.';
          alertBox.classList.remove('hidden');
        }
      } catch (err) {
        alertBox.textContent = 'Tidak bisa terhubung ke server.';
        alertBox.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Login';
      }
    });
  </script>
</body>
</html>
