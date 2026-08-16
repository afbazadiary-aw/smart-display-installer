// ============================================================================
// KONFIGURASI INSTALLER — diisi SEKALI oleh Anda (penjual), bukan oleh pembeli.
// ============================================================================
//
// LANGKAH 1: GOOGLE_CLIENT_ID
// ============================
// Didapat dari Google Cloud Console:
//   1. Buka https://console.cloud.google.com/apis/credentials
//   2. Buat project baru (bebas nama, mis. "Smart Display Installer")
//   3. "Configure Consent Screen" -> External -> isi nama app "Smart Display Installer"
//      + email dukungan Anda -> Publish app (supaya tidak dibatasi 100 test user)
//   4. "Create Credentials" -> "OAuth client ID" -> Application type: "Web application"
//   5. "Authorized JavaScript origins" -> isi domain tempat installer di-hosting
//      (mis. https://install.afbazada.shop atau https://xxxx.pages.dev)
//   6. Copy "Client ID" (bentuknya: xxxxx.apps.googleusercontent.com) ke bawah ini.
//
// PENTING: ini BUKAN client secret. Client ID untuk aplikasi web publik memang
// dipasang terbuka di frontend (public client, pakai OAuth implicit flow) —
// ini pola resmi Google, bukan kebocoran kredensial.
//
//
// LANGKAH 2: LICENSE_API_URL
// ============================
// URL ke file JSON yang berisi daftar akun Google berlisensi.
// Format file JSON:
//   {
//     "licenses": [
//       { "email": "andi@gmail.com", "licenseId": "SD-2026-0001", "productName": "Smart Display" },
//       { "email": "budi@gmail.com", "licenseId": "SD-2026-0002", "productName": "Smart Display" }
//     ]
//   }
//
// Anda bisa host file ini di:
//   - GitHub Gist (raw URL)
//   - Cloudflare Pages (file statis)
//   - GitHub repository (raw URL)
//   - Hosting statis lainnya
//
// Setiap kali ada pembelian baru, tambahkan email pembeli ke file ini,
// lalu upload ulang. Installer akan fetch file ini saat verifikasi lisensi.
// ============================================================================

const INSTALLER_CONFIG = {
  
  // OAuth Client ID dari Google Cloud Console
  GOOGLE_CLIENT_ID: '345147535207-lve4rsctlmq0nbtui8ol4e2vhm8b2d1f.apps.googleusercontent.com',
  
  // Scope minimum yang dibutuhkan installer. Jangan tambah scope lain —
  // makin sedikit scope, makin sedikit pembeli ragu saat layar izin Google muncul.
  OAUTH_SCOPES: [
    'https://www.googleapis.com/auth/script.projects',      // buat & isi project Apps Script
    'https://www.googleapis.com/auth/script.deployments',   // deploy sebagai Web App
    'https://www.googleapis.com/auth/drive.file',           // hanya file yang dibuat installer ini
    // PERMINTAAN ("kalau akun sudah pernah menginstal, jangan buat file baru"): folder data
    // aplikasi yang TERSEMBUNYI & terikat pada AKUN Google, bukan pada browser. Di sinilah catatan
    // instalasi disimpan, sehingga instalasi ulang dari perangkat/browser mana pun tetap mengenali
    // pemasangan sebelumnya. localStorage TIDAK cukup - ia hilang begitu ganti browser atau
    // membersihkan data, dan justru itulah yang membuat pemasangan kedua jadi kembar.
    // Scope ini TIDAK sensitif (tidak menambah beban verifikasi Google) dan tidak memberi akses
    // apa pun ke berkas pribadi pengguna - hanya ke folder milik aplikasi ini sendiri.
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/userinfo.email'        // tampilkan akun yang sedang login
  ].join(' '),
  
  // Nama produk — dipakai sebagai judul project Apps Script baru
  // dan sebagai kata kunci pencarian saat reinstall.
  APP_TITLE: 'Smart Display - By Afbazada',
  
  // Versi produk yang dijual. HANYA untuk identifikasi — TIDAK untuk update otomatis.
  PRODUCT_VERSION: '1.0.0',
  
  // Paket instalasi (source code Smart Display) - TIDAK LAGI berkas statis di repo.
  //
  // KENAPA PINDAH: manifest.json adalah SELURUH source code aplikasi. Selama ia
  // duduk di repo installer yang publik, siapa pun bisa mengunduhnya tanpa
  // membeli, tanpa lisensi, tanpa menyentuh installer sama sekali - verifikasi
  // lisensi yang sudah dibangun ada di installer, bukan di paketnya.
  // Sekarang paket disajikan Worker dari R2, dan hanya keluar untuk akun dengan
  // lisensi AKTIF & belum kedaluwarsa (lihat apiPaket di cloudflare-worker).
  MANIFEST_URL: 'https://api.smartdisplay.afbazada.shop/api/paket',

  // Versi paket - SENGAJA tanpa lisensi. Installer perlu tahu "pemasangan saya
  // sudah terbaru?" sebelum memutuskan mengunduh 11MB, dan angka versi saja tidak
  // membocorkan apa pun.
  VERSI_URL: 'https://api.smartdisplay.afbazada.shop/api/versi',
  
  // URL ke file JSON yang berisi daftar lisensi.
  LICENSE_API_URL: 'https://raw.githubusercontent.com/afbazadiary-aw/smart-display-licenses/main/licenses.json',
  
  // Timeout (ms) untuk fetch license file
  LICENSE_FETCH_TIMEOUT: 10000,
  
  // API Endpoints
  SCRIPT_API: 'https://script.googleapis.com/v1',
  DRIVE_API: 'https://www.googleapis.com/drive/v3',

  // Worker pembungkus domain (cloudflare-worker/ di repo SmartDisplayApp).
  // Melayani pendaftaran alamat, ganti nama, dan unggah logo/background.
  //
  // SENGAJA "api.smartdisplay…", BUKAN "smartdisplay…" tanpa awalan: hostname
  // tanpa awalan itu masih Custom Domain milik worker LAMA (small-poetry-76f7)
  // yang melayani aplikasi pembuat, jadi /api/* di sana tidak akan pernah sampai
  // ke worker multi-penyewa. Subdomain "api" tercakup route wildcard yang sama
  // dan namanya sudah dilarang untuk diklaim pembeli.
  ALAMAT_API: 'https://api.smartdisplay.afbazada.shop/api',
  DOMAIN_INDUK: 'smartdisplay.afbazada.shop',

  // Installer subdomain (alamat.html) HANYA perlu tahu SIAPA yang login - ia
  // tidak menyentuh Apps Script maupun Drive sama sekali. Karena itu izinnya
  // dibuat terpisah & seminimal mungkin: layar izin yang pendek jauh lebih
  // menenangkan pembeli yang cuma ingin mengganti logo.
  OAUTH_SCOPES_ALAMAT: [
    'https://www.googleapis.com/auth/userinfo.email'
  ].join(' '),

  // Batas ukuran gambar - HARUS sama dengan BATAS_LOGO/BATAS_BG di worker.
  // Gambar dikecilkan di browser sebelum dikirim; batas ini jaring pengaman
  // terakhir supaya penolakan terjadi di sini (pesannya jelas) alih-alih
  // sebagai HTTP 413 dari worker.
  // Dinaikkan bersamaan dengan sisi logo 512 -> 1024 px (lihat kecilkanGambar di
  // alamat.js): logo 1024 px sebagai PNG bertransparansi biasanya 100-300 KB, tapi logo
  // berdetail tinggi bisa lebih. Batas 1,5 MB memberi ruang untuk itu tanpa membiarkan
  // berkas raksasa masuk. Harus SAMA dengan BATAS_LOGO di Worker.
  MAKS_LOGO_KB: 3072,
  MAKS_BG_KB: 3072,
  
  // Timing
  WARMUP_DELAY: 3000,       // Tunggu Apps Script cold start (ms)
  RETRY_DELAY: 2000,        // Retry saat kena rate limit (ms)
  MAX_RETRIES: 3,
};