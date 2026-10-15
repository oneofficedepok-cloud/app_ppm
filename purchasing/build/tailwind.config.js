// Build CSS Tailwind lokal (assets/vendor/tailwind.min.css). Jalankan dari folder aplikasi:
//   npx tailwindcss@3.4.17 -c build/tailwind.config.js -i build/tailwind.input.css -o assets/vendor/tailwind.min.css --minify
// Perlu dijalankan ulang hanya bila menambah class Tailwind BARU di index.php / login.php / assets/js.
module.exports = {
  content: ['./index.php', './login.php', './cek_instalasi.php', './assets/js/*.js'],
  safelist: [
    // Warna filter bar tabel dibentuk dinamis di app.js (focus:ring-${c}-500, text-${c}-700, hover:text-${c}-900).
    { pattern: /^(text)-(orange|lime|blue|amber|teal|cyan|sky|purple|indigo|emerald|rose|slate)-(700|900)$/, variants: ['hover'] },
    { pattern: /^(ring)-(orange|lime|blue|amber|teal|cyan|sky|purple|indigo|emerald|rose|slate)-500$/, variants: ['focus'] },
  ],
  theme: { extend: {} },
  plugins: [],
};
