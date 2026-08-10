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
    'https://www.googleapis.com/auth/userinfo.email'        // tampilkan akun yang sedang login
  ].join(' '),
  
  // Nama produk — dipakai sebagai judul project Apps Script baru
  // dan sebagai kata kunci pencarian saat reinstall.
  APP_TITLE: 'Smart Display - By Afbazada',
  
  // Versi produk yang dijual. HANYA untuk identifikasi — TIDAK untuk update otomatis.
  PRODUCT_VERSION: '1.0.0',
  
  // URL manifest.json (paket instalasi source code Smart Display).
  MANIFEST_URL: './manifest.json',
  
  // URL ke file JSON yang berisi daftar lisensi.
  LICENSE_API_URL: 'https://raw.githubusercontent.com/afbazadiary-aw/smart-display-licenses/main/licenses.json',
  
  // Timeout (ms) untuk fetch license file
  LICENSE_FETCH_TIMEOUT: 10000,
  
  // API Endpoints
  SCRIPT_API: 'https://script.googleapis.com/v1',
  DRIVE_API: 'https://www.googleapis.com/drive/v3',
  
  // Timing
  WARMUP_DELAY: 3000,       // Tunggu Apps Script cold start (ms)
  RETRY_DELAY: 2000,        // Retry saat kena rate limit (ms)
  MAX_RETRIES: 3,
};