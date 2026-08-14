// ============================================================================
// Smart Display Installer — Final Version
// 
// Fitur utama:
//   ✓ Verifikasi lisensi per akun Google (bukan per device)
//   ✓ Reinstall otomatis (cari storage lama sebelum buat baru)
//   ✓ Device-agnostic (bisa dari HP, tablet, laptop, PC)
//   ✓ Tanpa updater, tanpa launcher, tanpa maintenance
// ============================================================================

const SCRIPT_API = INSTALLER_CONFIG.SCRIPT_API;
const DRIVE_API = INSTALLER_CONFIG.DRIVE_API;

// State global sesi instalasi
let accessToken = null;
let manifestCache = null;
let userEmail = null;
let userLicense = null;

// ============================================================================
// UI HELPERS
// ============================================================================

function setStep(stepEl, state, message) {
  if (!stepEl) return;
  stepEl.dataset.state = state;
  const msgEl = stepEl.querySelector('.step-msg');
  if (msgEl && message) msgEl.textContent = message;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
}

function showLoading(show) {
  document.getElementById('loading-overlay').hidden = !show;
}

function showError(title, message, helpUrl) {
  document.getElementById('fatal-error-title').textContent = title;
  document.getElementById('fatal-error-message').innerHTML = `<p>${message}</p>`;
  
  const helpDiv = document.getElementById('fatal-error-help');
  const helpLink = document.getElementById('fatal-error-link');
  if (helpUrl) {
    helpLink.href = helpUrl;
    helpDiv.hidden = false;
  } else {
    helpDiv.hidden = true;
  }
  
  showScreen('fatal-error');
}

// alasan diteruskan apa adanya dari worker supaya pembeli tahu MANA masalahnya -
// belum punya lisensi, lisensi dinonaktifkan, atau masa berlakunya habis. Ketiganya
// butuh tindakan berbeda dari penjual, jadi menyamakan pesannya hanya menambah
// bolak-balik yang tidak perlu.
function showNoLicenseError(email, alasan) {
  const message = document.getElementById('no-license-message');
  message.innerHTML = `
    <p>${alasan ? alasan : 'Akun Google ini belum memiliki lisensi Smart Display.'}</p>
    <p style="font-size:13px">Akun: <strong>${email || '(tidak terdeteksi)'}</strong></p>
    <p>Silakan hubungi penjual, atau login dengan akun yang sudah memiliki lisensi.</p>
  `;
  showScreen('no-license-error');
}

// ============================================================================
// API HELPER — dengan auth header & retry otomatis
// ============================================================================

async function apiCall(url, options = {}, retried = false) {
  const method = options.method || 'GET';
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  // Rate limit: retry sekali setelah delay
  if (res.status === 429 && !retried) {
    await new Promise(r => setTimeout(r, INSTALLER_CONFIG.RETRY_DELAY));
    return apiCall(url, options, true);
  }

  if (!res.ok) {
    // Badan respons dibaca sebagai TEKS dulu, baru dicoba diurai jadi JSON. Sebelumnya langsung
    // res.json().catch(() => ({})) - kalau Google membalas HTML/teks biasa (mis. halaman error
    // gateway), badan aslinya hilang total dan yang tersisa cuma "HTTP 500" tanpa petunjuk apa pun.
    const raw = await res.text().catch(() => '');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = {}; }
    const gErr = body && body.error;

    // Diagnostik LENGKAP ke console - inilah yang hilang saat error "Request contains an invalid
    // argument." pertama kali muncul: tanpa status/reason/URL, mustahil tahu panggilan MANA yang
    // sebenarnya gagal. Sengaja console.error (bukan tampil ke pembeli) supaya tetap bisa
    // didiagnosis lewat DevTools tanpa membocorkan detail teknis di layar pembeli.
    console.error(
      '[Installer] Panggilan API gagal\n' +
      'Request     : ' + method + ' ' + url + '\n' +
      'HTTP Status : ' + res.status + ' ' + res.statusText + '\n' +
      'Reason      : ' + ((gErr && gErr.status) || '(tidak ada)') + '\n' +
      'Message     : ' + ((gErr && gErr.message) || '(tidak ada)') + '\n' +
      'Details     : ' + (gErr && gErr.details ? JSON.stringify(gErr.details) : '(tidak ada)') + '\n' +
      'Raw body    : ' + (raw ? raw.slice(0, 2000) : '(kosong)')
    );

    const err = new Error((gErr && gErr.message) || `HTTP ${res.status}`);
    err.status = res.status;
    err.reason = (gErr && gErr.status) || '';
    err.body = body;
    err.raw = raw;
    err.url = url;
    err.method = method;
    throw err;
  }

  if (res.status === 204) return {};
  return res.json();
}

// Apps Script API membalas 403 dengan pesan khas ini kalau pengguna belum mengaktifkan
// Apps Script API di setelan akunnya. Dipakai untuk membedakan "perlu aktivasi" dari
// kegagalan izin lain (mis. scope tidak diberikan), yang penanganannya berbeda.
function isAppsScriptApiDisabled(err) {
  if (!err || err.status !== 403) return false;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('has not enabled') ||
         msg.includes('apps script api') ||
         msg.includes('user has not enabled');
}

// ============================================================================
// 1. LOGIN GOOGLE
// ============================================================================

function initLogin() {
  // Tunggu Google Identity Services siap
  const waitForGSI = setInterval(() => {
    if (window.google?.accounts?.oauth2) {
      clearInterval(waitForGSI);
      
      const client = google.accounts.oauth2.initTokenClient({
        client_id: INSTALLER_CONFIG.GOOGLE_CLIENT_ID,
        scope: INSTALLER_CONFIG.OAUTH_SCOPES,
        callback: async (resp) => {
          if (resp.error) {
            showError(
              'Login dibatalkan atau gagal',
              `Silakan coba klik "Install Smart Display" lagi. 
               Pastikan Anda mengizinkan semua akses yang diminta. 
               Detail: ${resp.error}`
            );
            return;
          }
          
          accessToken = resp.access_token;
          await afterLogin();
        },
        // PERBAIKAN (dilaporkan: "instalasi kedua tidak pernah selesai dari halaman waiting for
        // authorization"): SEBELUMNYA token client sama sekali tidak punya error_callback.
        // callback di atas HANYA dipanggil kalau token berhasil terbit - kalau jendela izin
        // ditutup pembeli, diblokir pemblokir popup, atau gagal dibuka, TIDAK ADA satu pun kode
        // yang berjalan: overlay memuat tetap menyala dan halaman diam selamanya. Sekarang setiap
        // kegagalan itu punya pesan & jalan keluarnya sendiri.
        error_callback: (err) => {
          showLoading(false);
          const tipe = (err && err.type) || '';
          if (tipe === 'popup_closed') {
            showError(
              'Jendela izin Google tertutup',
              'Proses berhenti karena jendela izin Google ditutup sebelum selesai.<br><br>' +
              'Klik "Coba Lagi", lalu selesaikan sampai layar izin hilang dengan sendirinya.'
            );
          } else if (tipe === 'popup_failed_to_open') {
            showError(
              'Jendela izin Google tidak bisa dibuka',
              'Browser Anda memblokir jendela izin Google.<br><br>' +
              'Izinkan popup untuk halaman ini (ikon di ujung kanan kolom alamat), lalu klik "Coba Lagi".'
            );
          } else {
            showError('Proses izin Google terhenti', 'Detail: ' + (tipe || 'tidak diketahui') +
              '<br><br>Klik "Coba Lagi" untuk mengulang.');
          }
        }
      });

      document.getElementById('btn-install').addEventListener('click', () => {
        client.requestAccessToken();
      });
    }
  }, 100);
  
  // Timeout setelah 15 detik
  setTimeout(() => {
    clearInterval(waitForGSI);
    if (!window.google?.accounts?.oauth2) {
      showError(
        'Google Sign-In tidak dapat dimuat',
        'Periksa koneksi internet Anda dan pastikan tidak ada pemblokir iklan yang memblokir domain Google.'
      );
    }
  }, 15000);
}

// ============================================================================
// 2. SETELAH LOGIN: dapatkan email → verifikasi lisensi → lanjut
// ============================================================================

async function afterLogin() {
  showLoading(true);
  
  // Ambil email pengguna
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error('Gagal membaca info akun');
    const data = await res.json();
    userEmail = data.email;
  } catch (e) {
    showLoading(false);
    showError('Gagal mendapatkan informasi akun', e.message);
    return;
  }
  
  // Verifikasi lisensi
  try {
    await verifyLicense();
  } catch (e) {
    showError('Gagal memverifikasi lisensi', e.message);
  } finally {
    showLoading(false);
  }
}

// ============================================================================
// 3. VERIFIKASI LISENSI
// ============================================================================

async function verifyLicense() {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(), 
    INSTALLER_CONFIG.LICENSE_FETCH_TIMEOUT
  );
  
  // PERUBAHAN PENTING: sebelumnya installer mengunduh licenses.json dari GitHub
  // raw lalu mencari email pembeli di dalamnya. Berkas itu PUBLIK - artinya
  // seluruh Gmail pembeli bisa dibaca siapa saja di internet, dan setiap pembeli
  // ikut menerima daftar pembeli lain hanya untuk memeriksa dirinya sendiri.
  //
  // Sekarang pertanyaannya dibalik: installer mengirim token Google-nya dan
  // bertanya "apakah SAYA punya lisensi?". Worker yang memeriksa ke KV dan hanya
  // mengembalikan lisensi milik penanya. Ini juga menutup celah lain - pemeriksaan
  // di browser tidak pernah jadi kontrol keamanan (siapa pun bisa melewatinya);
  // yang mengikat adalah pemeriksaan worker, dan kini keduanya satu mekanisme.
  let data;
  try {
    const res = await fetch(`${INSTALLER_CONFIG.ALAMAT_API}/lisensi-saya`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);

    const teks = await res.text();
    try { data = teks ? JSON.parse(teks) : {}; } catch (e) { data = {}; }

    if (!res.ok) {
      // 403 = pertanyaannya terjawab dengan jelas: tidak punya lisensi, lisensi
      // dinonaktifkan, atau masa berlakunya habis. Pesannya datang dari worker
      // supaya alasannya tepat, bukan tebakan.
      if (res.status === 403) {
        showNoLicenseError(userEmail, data.error);
        return;
      }
      throw new Error(data.error || `Server lisensi mengembalikan status ${res.status}`);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Waktu tunggu habis. Periksa koneksi internet Anda.');
    }
    throw new Error(`Tidak bisa menghubungi server lisensi: ${e.message}`);
  }

  userLicense = { email: data.email, licenseId: data.licenseId, productName: data.productName };
  
  // Lisensi valid → tampilkan info user & mulai instalasi
  showScreen('install-screen');
  const userInfo = document.getElementById('user-info');
  userInfo.querySelector('.user-email').textContent = `👤 ${userEmail}`;
  userInfo.hidden = false;
  
  runInstall();
}

// ============================================================================
// 4. DETEKSI APPS SCRIPT API
// ============================================================================

// AKAR MASALAH "Request contains an invalid argument." (dibuktikan dengan memanggil API langsung):
//
//   GET https://script.googleapis.com/v1/projects/000000000000000000000000000000000000000000
//   -> HTTP 400 INVALID_ARGUMENT "Request contains an invalid argument."
//
// Versi lama fungsi ini menembak script ID palsu (42 nol) dan MENGANGGAP satu-satunya kegagalan
// yang mungkin adalah 404. Padahal 42 nol bukan resource name yang sah, jadi Google menolaknya di
// tahap validasi argumen (400) - JAUH sebelum sampai ke pertanyaan "project ini ada atau tidak".
// Karena 400 !== 404, error dilempar ulang; heuristik di bawahnya juga tidak cocok (bukan 403, dan
// pesannya tidak memuat 'permission'/'disabled'/'has not been used'), sehingga error lolos keluar
// dan menghentikan instalasi. Instalasi TIDAK PERNAH sampai ke projects.create - dan projects.create
// sendiri terbukti baik-baik saja (POST /v1/projects dengan body {"title":"..."} -> HTTP 200).
//
// Selain itu pemeriksaan lama memang TIDAK SAHIH secara konsep: berhasil GET project mana pun tidak
// membuktikan projects.create bisa dilakukan. Satu-satunya bukti bahwa create bisa dilakukan adalah
// MELAKUKAN create - jadi deteksi "API belum aktif" dipindah ke penanganan error create yang
// sesungguhnya (lihat runInstall + isAppsScriptApiDisabled).
//
// Yang tersisa di sini adalah pemeriksaan yang benar-benar sahih & murah: memastikan token yang
// baru diperoleh SUNGGUH memuat scope yang dibutuhkan. Ini kegagalan nyata yang bisa terjadi -
// pengguna boleh mencabut centang izin di layar consent Google, dan token tetap terbit tanpa scope
// itu. Tanpa pemeriksaan ini, gejalanya baru muncul jauh di belakang sebagai 403 yang membingungkan.
async function verifyGrantedScopes() {
  const wajib = [
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/script.deployments',
    // WAJIB, bukan opsional: tanpa izin ini installer tidak bisa membaca catatan instalasi
    // per-akun, sehingga tidak tahu pembeli sudah pernah memasang - lalu membuat project KEDUA,
    // persis masalah yang baru saja diperbaiki. Pembeli yang dulu menyetujui daftar izin LAMA
    // bisa saja menerima token tanpa izin ini; lebih baik mereka diminta menyetujui ulang
    // secara jelas daripada diam-diam mendapat aplikasi kembar.
    'https://www.googleapis.com/auth/drive.appdata'
  ];
  let granted = [];
  try {
    const res = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken)
    );
    if (res.ok) {
      const info = await res.json();
      granted = String(info.scope || '').split(/\s+/).filter(Boolean);
    }
  } catch (e) {
    // tokeninfo tidak wajib berhasil - kalau tidak bisa dihubungi, jangan menghalangi instalasi.
    // Kegagalan scope tetap akan tertangkap saat projects.create dijalankan.
    console.warn('[Installer] tokeninfo tidak dapat dihubungi:', e.message);
    return { ok: true, missing: [] };
  }
  if (granted.length === 0) return { ok: true, missing: [] };
  const missing = wajib.filter(s => !granted.includes(s));
  return { ok: missing.length === 0, missing };
}

// ============================================================================
// 4b. CATATAN INSTALASI PER-AKUN (folder data aplikasi tersembunyi di Drive)
// ----------------------------------------------------------------------------
// PERMINTAAN ("kalau akun sudah pernah menginstal dan file aplikasinya masih ada di Drive,
// jangan membuat file baru"). Sebelumnya satu-satunya jejak instalasi adalah localStorage -
// terikat pada BROWSER, bukan akun. Begitu pembeli menutup browser sebelum selesai, berpindah
// perangkat, atau membersihkan data, installer kehilangan ingatan dan membuat project Apps Script
// KEDUA. Itulah sebabnya muncul dua berkas Smart Display di Drive.
//
// Catatan instalasi sekarang disimpan di appDataFolder: folder tersembunyi milik aplikasi ini
// sendiri yang mengikuti AKUN Google. Tidak terlihat di Drive pengguna, tidak bisa dibaca aplikasi
// lain, dan tidak ikut hilang saat data browser dibersihkan.
// ============================================================================

const RECEIPT_FILENAME = 'smartdisplay-install.json';

// Mengembalikan { fileId, data } atau null. TIDAK PERNAH melempar - kegagalan membaca catatan
// tidak boleh menggagalkan instalasi; paling buruk installer cuma "lupa" seperti perilaku lama.
async function bacaCatatanInstalasi() {
  try {
    const q = encodeURIComponent(`name='${RECEIPT_FILENAME}'`);
    const list = await apiCall(
      `${DRIVE_API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name)&pageSize=5`
    );
    const f = list.files && list.files[0];
    if (!f) return null;
    const res = await fetch(`${DRIVE_API}/files/${f.id}?alt=media`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    return { fileId: f.id, data: await res.json() };
  } catch (e) {
    console.warn('[Installer] Catatan instalasi tidak terbaca:', e.message);
    return null;
  }
}

// Menulis/memperbarui catatan. Metadata dan isi sengaja dikirim terpisah (create lalu PATCH media)
// alih-alih multipart - jauh lebih sederhana dan tidak rawan salah boundary di browser.
async function tulisCatatanInstalasi(receipt, fileIdLama) {
  try {
    let fileId = fileIdLama;
    if (!fileId) {
      const dibuat = await apiCall(`${DRIVE_API}/files`, {
        method: 'POST',
        body: JSON.stringify({ name: RECEIPT_FILENAME, parents: ['appDataFolder'] })
      });
      fileId = dibuat.id;
    }
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(receipt)
      }
    );
    return fileId;
  } catch (e) {
    // Instalasi tetap dianggap berhasil - catatan ini hanya untuk instalasi BERIKUTNYA.
    console.warn('[Installer] Catatan instalasi gagal disimpan:', e.message);
    return null;
  }
}

// Apakah project Apps Script dari catatan itu MASIH ADA? Catatan saja tidak cukup - pembeli bisa
// saja sudah menghapus projectnya, dan memaksa memakai ID yang sudah lenyap akan menggagalkan
// instalasi ulang yang seharusnya sah.
async function projectMasihAda(scriptId) {
  if (!scriptId) return false;
  try {
    const p = await apiCall(`${SCRIPT_API}/projects/${scriptId}`);
    return !!(p && p.scriptId);
  } catch (e) {
    return false;
  }
}

// ============================================================================
// 5. CARI STORAGE LAMA (Spreadsheet & Folder)
// ============================================================================

async function findExistingStorage() {
  const storage = {
    spreadsheet: null,
    folder: null,
    found: false
  };
  
  try {
    // Cari Spreadsheet dengan nama mengandung APP_TITLE
    const spreadsheetQuery = 
      `mimeType='application/vnd.google-apps.spreadsheet' and ` +
      `name contains '${INSTALLER_CONFIG.APP_TITLE.replace(/'/g, "\\'")}'`;
    
    const spreadsheetResult = await apiCall(
      `${DRIVE_API}/files?q=${encodeURIComponent(spreadsheetQuery)}` +
      `&fields=files(id,name,createdTime)&pageSize=10`
    );
    
    if (spreadsheetResult.files && spreadsheetResult.files.length > 0) {
      storage.spreadsheet = spreadsheetResult.files.sort(
        (a, b) => new Date(b.createdTime) - new Date(a.createdTime)
      )[0];
      storage.found = true;
    }
    
    // Cari Folder dengan nama mengandung APP_TITLE
    const folderQuery = 
      `mimeType='application/vnd.google-apps.folder' and ` +
      `name contains '${INSTALLER_CONFIG.APP_TITLE.replace(/'/g, "\\'")}'`;
    
    const folderResult = await apiCall(
      `${DRIVE_API}/files?q=${encodeURIComponent(folderQuery)}` +
      `&fields=files(id,name,createdTime)&pageSize=10`
    );
    
    if (folderResult.files && folderResult.files.length > 0) {
      storage.folder = folderResult.files.sort(
        (a, b) => new Date(b.createdTime) - new Date(a.createdTime)
      )[0];
      storage.found = true;
    }
    
  } catch (e) {
    // Gagal mencari bukan fatal — lanjutkan dengan buat baru
    console.warn('Gagal mencari storage lama:', e.message);
  }
  
  return storage;
}

// ============================================================================
// 6. LOAD MANIFEST (cached)
// ============================================================================

async function loadManifest() {
  if (manifestCache) return manifestCache;
  const res = await fetch(INSTALLER_CONFIG.MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('Gagal memuat paket instalasi (manifest.json). Periksa koneksi internet Anda.');
  }
  manifestCache = await res.json();
  return manifestCache;
}

// ============================================================================
// 7. ALUR INSTALASI UTAMA
// ============================================================================

async function runInstall() {
  const steps = {
    checkLicense: document.getElementById('step-check-license'),
    checkApi: document.getElementById('step-check-api'),
    findStorage: document.getElementById('step-find-storage'),
    createProject: document.getElementById('step-create-project'),
    pushCode: document.getElementById('step-push-code'),
    deploy: document.getElementById('step-deploy'),
    validate: document.getElementById('step-validate'),
    alamat: document.getElementById('step-alamat')
  };
  
  try {
    // --- Step 1: Lisensi sudah diverifikasi sebelumnya ---
    setStep(steps.checkLicense, 'done', 
      `Lisensi ${userLicense.licenseId} valid untuk akun ini.`);
    
    // --- Step 2: Pastikan izin yang diminta benar-benar diberikan ---
    // CATATAN: langkah ini TIDAK lagi mengklaim "API aktif" - itu tidak bisa dibuktikan tanpa
    // benar-benar membuat project. Yang dibuktikan di sini hanya scope token. Status aktif/tidaknya
    // Apps Script API ditentukan saat projects.create di Step 4.
    setStep(steps.checkApi, 'active', 'Memeriksa izin akun Google Anda...');
    const scopeCheck = await verifyGrantedScopes();
    if (!scopeCheck.ok) {
      setStep(steps.checkApi, 'error', 'Ada izin yang belum dicentang');
      showError(
        'Izin belum lengkap',
        `Instalasi membutuhkan izin yang belum diberikan:<br><br>
         <code>${scopeCheck.missing.join('<br>')}</code><br><br>
         Klik "Coba Lagi", lalu pastikan SEMUA kotak izin tercentang di layar Google.`
      );
      return;
    }
    setStep(steps.checkApi, 'done', 'Izin akun sudah sesuai.');
    
    // --- Step 3: Cari storage lama ---
    setStep(steps.findStorage, 'active', 'Mencari data aplikasi lama...');
    const existingStorage = await findExistingStorage();
    
    if (existingStorage.found) {
      const parts = [];
      if (existingStorage.spreadsheet) parts.push('spreadsheet');
      if (existingStorage.folder) parts.push('folder');
      setStep(steps.findStorage, 'done', 
        `Data lama ditemukan (${parts.join(' & ')}). Akan digunakan kembali.`);
    } else {
      setStep(steps.findStorage, 'done', 
        'Tidak ada data lama. Database baru akan dibuat.');
    }
    
    // --- Step 4: Pakai ulang ruang aplikasi lama, atau buat baru kalau memang belum ada ---
    // PERMINTAAN ("kalau akun sudah pernah menginstal, jangan buat file baru"): catatan instalasi
    // per-akun dibaca DULU. Kalau project Apps Script-nya masih ada, ia dipakai ulang apa adanya -
    // tidak ada project kedua, tidak ada berkas kembar di Drive. Isinya tetap ditimpa versi
    // terbaru di Step 5, jadi instalasi ulang tetap berfungsi sebagai "perbarui".
    setStep(steps.createProject, 'active', 'Memeriksa pemasangan sebelumnya...');
    const catatanLama = await bacaCatatanInstalasi();
    let scriptId = null;
    let deploymentIdLama = null;
    let memakaiUlang = false;

    if (catatanLama && catatanLama.data && await projectMasihAda(catatanLama.data.scriptId)) {
      scriptId = catatanLama.data.scriptId;
      deploymentIdLama = catatanLama.data.deploymentId || null;
      memakaiUlang = true;

      // PERMINTAAN ("kalau file aplikasinya sudah ada, langsung bawa ke halaman aplikasi,
      // jangan menyalin ulang"): kalau versi yang TERPASANG sama dengan versi yang tersedia,
      // tidak ada satu byte pun yang perlu dikirim. Menyalin ulang 11MB untuk menghasilkan isi
      // yang identik hanya membuang kuota & waktu pembeli, dan membuat mereka mengira
      // pemasangannya bermasalah.
      //
      // Versinya diambil dari berkas RINGAN versi.json - bukan dari manifest.json - supaya
      // pemeriksaan ini sendiri tidak ikut mengunduh 11MB yang justru ingin dihindari.
      const sudahTerpasang = catatanLama.data.manifestVersion;
      const alamatSiap = catatanLama.data.alamatDomain || catatanLama.data.webAppUrl;
      if (sudahTerpasang && alamatSiap) {
        let versiTersedia = null;
        try {
          const rv = await fetch(INSTALLER_CONFIG.VERSI_URL, { cache: 'no-store' });
          if (rv.ok) versiTersedia = (await rv.json()).version;
        } catch (e) {
          console.warn('[Installer] versi.json tidak terbaca, lanjut memperbarui:', e.message);
        }
        if (versiTersedia && String(versiTersedia) === String(sudahTerpasang)) {
          setStep(steps.createProject, 'done', 'Aplikasi Anda sudah terpasang & sudah versi terbaru.');
          ['pushCode', 'deploy', 'validate', 'alamat'].forEach(function (k) {
            setStep(steps[k], 'done', 'Dilewati - tidak ada yang perlu diperbarui.');
          });
          showSuccessScreen(catatanLama.data, false, true);
          return;
        }
      }
      setStep(steps.createProject, 'done', 'Pemasangan sebelumnya ditemukan - akan diperbarui, bukan dibuat ulang.');
    } else {
      // Body {"title": "..."} sudah TERBUKTI benar (diuji langsung ke API: HTTP 200). parentId
      // sengaja TIDAK dikirim - project standalone memang yang diinginkan.
      setStep(steps.createProject, 'active', 'Membuat ruang aplikasi baru...');
      const projectTitle = `${INSTALLER_CONFIG.APP_TITLE} - ${new Date().toISOString().slice(0, 10)}`;
      let project;
      try {
        project = await apiCall(`${SCRIPT_API}/projects`, {
          method: 'POST',
          body: JSON.stringify({ title: projectTitle })
        });
      } catch (e) {
        // INILAH tempat yang sahih untuk mendeteksi "Apps Script API belum diaktifkan": kalau
        // create ditolak dengan 403 khas Google, pengguna memang perlu mengaktifkannya sekali.
        if (isAppsScriptApiDisabled(e)) {
          setStep(steps.createProject, 'error', 'Perlu 1 langkah aktivasi dari Google');
          showActivationPrompt();
          return;
        }
        throw e;
      }
      scriptId = project.scriptId;
      if (!scriptId) throw new Error('Project dibuat tapi scriptId tidak diterima dari Google.');
      setStep(steps.createProject, 'done', 'Ruang aplikasi dibuat.');
      // Catatan ditulis SEKARANG, bukan nanti setelah semuanya selesai. Kalau pembeli menutup
      // browser di tengah jalan - persis kejadian yang dilaporkan - project ini sudah terlanjur
      // ada di Drive mereka, jadi ia HARUS sudah tercatat. Tanpa ini, percobaan berikutnya membuat
      // project kedua lagi dan masalahnya terulang.
      await tulisCatatanInstalasi(
        { scriptId: scriptId, installedAt: new Date().toISOString(), status: 'belum-selesai' },
        catatanLama ? catatanLama.fileId : null
      );
    }
    
    // --- Step 5: Dorong seluruh source code ---
    setStep(steps.pushCode, 'active', 'Menyalin seluruh fitur Smart Display...');
    const manifest = await loadManifest();
    
    await apiCall(`${SCRIPT_API}/projects/${scriptId}/content`, {
      method: 'PUT',
      body: JSON.stringify({ files: manifest.files })
    });
    
    setStep(steps.pushCode, 'done', 
      `${manifest.files.length} berkas berhasil disalin (versi ${manifest.version}).`);
    
    // --- Step 6: Buat versi + deploy ---
    setStep(steps.deploy, 'active', 'Menerbitkan aplikasi Anda...');
    const version = await apiCall(`${SCRIPT_API}/projects/${scriptId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ description: `Instalasi - v${manifest.version}` })
    });
    
    // PERMINTAAN (jangan menumpuk): kalau pemasangan lama punya deployment, deployment ITULAH yang
    // diperbarui (PUT), bukan dibuat lagi. Selain mencegah tumpukan deployment, ini menjaga URL Web
    // App pembeli TETAP SAMA - kalau URL berubah setiap kali instalasi ulang, semua tautan & pintasan
    // yang sudah mereka simpan akan mati. Kalau PUT gagal (mis. deployment sudah dihapus manual),
    // barulah dibuat yang baru sebagai jalan mundur.
    const badanDeploy = {
      versionNumber: version.versionNumber,
      manifestFileName: 'appsscript',
      description: `Instalasi otomatis - v${manifest.version}`
    };
    let deployment = null;
    if (deploymentIdLama) {
      try {
        deployment = await apiCall(`${SCRIPT_API}/projects/${scriptId}/deployments/${deploymentIdLama}`, {
          method: 'PUT',
          body: JSON.stringify({ deploymentConfig: badanDeploy })
        });
      } catch (e) {
        console.warn('[Installer] Deployment lama tidak bisa diperbarui, membuat baru:', e.message);
        deployment = null;
      }
    }
    if (!deployment) {
      deployment = await apiCall(`${SCRIPT_API}/projects/${scriptId}/deployments`, {
        method: 'POST',
        body: JSON.stringify(badanDeploy)
      });
    }
    
    const webAppEntry = deployment.entryPoints?.find(
      e => e.entryPointType === 'WEB_APP'
    );
    const webAppUrl = webAppEntry?.webApp?.url;
    
    if (!webAppUrl) {
      throw new Error('Deployment berhasil tapi URL Web App tidak ditemukan.');
    }
    
    setStep(steps.deploy, 'done', 'Aplikasi berhasil diterbitkan.');
    
    // --- Step 7: Validasi ---
    setStep(steps.validate, 'active', 'Memeriksa aplikasi berjalan dengan baik...');
    await new Promise(r => setTimeout(r, INSTALLER_CONFIG.WARMUP_DELAY));
    
    let liveOk = false;
    try {
      await fetch(webAppUrl, { mode: 'no-cors' });
      liveOk = true;
    } catch (e) { liveOk = false; }
    
    setStep(steps.validate, liveOk ? 'done' : 'error',
      liveOk 
        ? 'Aplikasi aktif dan siap dipakai.' 
        : 'Tidak bisa verifikasi otomatis - coba buka manual.');
    
    // --- Step 8: Bungkus dengan alamat domain sendiri ---
    // Aplikasi Apps Script yang dibuka langsung selalu menampilkan bar biru
    // "Laporkan penyalahgunaan" dari Google. Dibungkus di domain sendiri, bar itu
    // tidak ikut tampil, dan pembeli mendapat alamat yang bisa dipasang sebagai
    // aplikasi (PWA) dengan logo sendiri.
    //
    // SELURUH langkah ini dibungkus try/catch dan TIDAK PERNAH melempar keluar.
    // Pada titik ini aplikasi sudah benar-benar terpasang & berjalan; kegagalan
    // membungkus alamat tidak boleh berubah jadi "Instalasi berhenti di tengah
    // jalan" yang membuat pembeli mengira semuanya gagal dan memasang ulang.
    setStep(steps.alamat, 'active', 'Menyiapkan alamat aplikasi...');
    let alamatDomain = null;
    try {
      const res = await fetch(`${INSTALLER_CONFIG.ALAMAT_API}/daftar`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ execUrl: webAppUrl })
      });
      const teks = await res.text();
      let data = {};
      try { data = teks ? JSON.parse(teks) : {}; } catch (e) { data = {}; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      alamatDomain = data.alamat || null;
      setStep(steps.alamat, 'done', alamatDomain
        ? (data.sudahAda ? 'Alamat Anda: ' + alamatDomain : 'Alamat dibuat: ' + alamatDomain)
        : 'Alamat disiapkan.');
    } catch (e) {
      console.error('[Installer] Pembungkusan alamat gagal:', e.message);
      // Ditandai 'done', BUKAN 'error' - tidak ada yang rusak di sisi pembeli.
      // Aplikasinya berfungsi penuh; hanya alamat pendeknya yang belum ada, dan
      // itu bisa diselesaikan kapan saja lewat halaman Alamat & Tampilan.
      setStep(steps.alamat, 'done', 'Dilewati - aplikasi tetap bisa dipakai lewat alamat Google.');
    }

    // --- Simpan receipt ---
    const receipt = {
      scriptId,
      deploymentId: deployment.deploymentId,
      webAppUrl,
      // Alamat pendek di domain sendiri (null kalau pembungkusan dilewati/gagal).
      // Ikut disimpan supaya bukti instalasi yang diunduh pembeli memuat alamat
      // yang benar-benar mereka pakai sehari-hari, bukan cuma URL Google.
      alamatDomain,
      userEmail,
      licenseId: userLicense.licenseId,
      productName: userLicense.productName,
      productVersion: INSTALLER_CONFIG.PRODUCT_VERSION,
      manifestVersion: manifest.version,
      existingStorage: existingStorage.found ? {
        spreadsheetId: existingStorage.spreadsheet?.id,
        spreadsheetName: existingStorage.spreadsheet?.name,
        folderId: existingStorage.folder?.id,
        folderName: existingStorage.folder?.name
      } : null,
      installedAt: new Date().toISOString()
    };
    
    localStorage.setItem('smartdisplay_receipt', JSON.stringify(receipt));
    // Catatan per-akun disempurnakan sekarang setelah semuanya benar-benar selesai (sebelumnya
    // baru berisi scriptId dengan status 'belum-selesai'). Inilah yang dibaca instalasi berikutnya.
    await tulisCatatanInstalasi(
      Object.assign({}, receipt, { status: 'selesai' }),
      catatanLama ? catatanLama.fileId : null
    );
    
    // Tampilkan layar sukses
    showSuccessScreen(receipt, existingStorage.found, memakaiUlang);
    
  } catch (err) {
    console.error('Installation error:', err);
    const activeStep = Object.values(steps).find(s => s.dataset.state === 'active');
    if (activeStep) setStep(activeStep, 'error', 'Terjadi kendala pada langkah ini.');
    
    showError(
      'Instalasi berhenti di tengah jalan',
      `Detail: ${err.message}<br><br>
       Anda bisa klik "Coba Lagi" - setiap percobaan membuat project baru yang bersih, 
       jadi aman dicoba berkali-kali.`,
      err.status === 403 
        ? 'https://script.google.com/home/usersettings' 
        : null
    );
  }
}

// ============================================================================
// 8. PROMPT AKTIVASI APPS SCRIPT API
// ============================================================================

function showActivationPrompt() {
  showScreen('activation-prompt');
  
  document.getElementById('btn-open-activation').onclick = () => {
    window.open('https://script.google.com/home/usersettings', '_blank');
  };
  
  document.getElementById('btn-activation-done').onclick = () => {
    showScreen('install-screen');
    runInstall();
  };
}

// ============================================================================
// 9. LAYAR SUKSES
// ============================================================================

function showSuccessScreen(receipt, usedExistingStorage, memakaiUlangProject) {
  showScreen('success-screen');
  
  // Tombol buka aplikasi. Kalau alamat pendek berhasil dibuat, ITULAH yang
  // dibuka - bukan URL Apps Script. Alasannya bukan sekadar rapi: alamat Google
  // selalu menampilkan bar "Laporkan penyalahgunaan", dan alamat inilah yang
  // nanti dipasang pembeli sebagai aplikasi di layar HP-nya.
  const btnOpen = document.getElementById('btn-open-app');
  btnOpen.href = receipt.alamatDomain ? ('https://' + receipt.alamatDomain) : receipt.webAppUrl;
  btnOpen.target = '_blank';
  btnOpen.rel = 'noopener';

  // Alamat + pintu masuk ke halaman Alamat & Tampilan.
  const infoAlamat = document.getElementById('info-alamat');
  if (infoAlamat) {
    if (receipt.alamatDomain) {
      infoAlamat.innerHTML =
        '<p style="margin:0 0 6px">Alamat aplikasi Anda</p>' +
        '<code style="font-size:14px;font-weight:700;word-break:break-all">' + receipt.alamatDomain + '</code>' +
        '<p style="margin:10px 0 0;font-size:13px;font-weight:400;color:var(--text-secondary)">' +
        'Anda bisa mengganti nama alamat ini <strong>satu kali</strong>, serta mengganti logo dan gambar latar kapan saja, di ' +
        '<a href="./alamat.html">Alamat &amp; Tampilan</a>.</p>';
    } else {
      infoAlamat.innerHTML =
        '<p style="margin:0 0 6px">Alamat pendek belum dibuat</p>' +
        '<p style="margin:0;font-size:13px;font-weight:400;color:var(--text-secondary)">' +
        'Aplikasi Anda tetap berfungsi penuh lewat alamat Google di tombol atas. ' +
        'Untuk mendapatkan alamat pendek beserta logo sendiri, buka ' +
        '<a href="./alamat.html">Alamat &amp; Tampilan</a> kapan saja.</p>';
    }
    infoAlamat.hidden = false;
  }
  
  // Info storage
  const storageInfo = document.getElementById('storage-info');
  // PERMINTAAN ("buka installer di perangkat berbeda dengan akun yang sama jangan sampai membuat
  // URL Apps Script yang berbeda"): kalau pemasangan lama dipakai ulang, katakan terus terang -
  // pembeli perlu yakin bahwa alamat aplikasi & datanya tidak berpindah, bukan menebak sendiri.
  if (memakaiUlangProject) {
    storageInfo.innerHTML = `
      <p>✅ Pemasangan Anda sebelumnya diperbarui ke versi terbaru.</p>
      <p style="margin-top:8px;font-size:13px;font-weight:400;color:var(--text-secondary)">
        Alamat aplikasi tetap sama seperti sebelumnya, dan tidak ada aplikasi kedua yang dibuat.
      </p>
    `;
    storageInfo.hidden = false;
    document.getElementById('receipt-download').onclick = () => {
      const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `smartdisplay-receipt-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    };
    return;
  }
  if (usedExistingStorage) {
    storageInfo.innerHTML = `
      <p>✅ Menggunakan database yang sudah ada.</p>
      <p style="margin-top:8px;font-size:13px;font-weight:400;color:var(--text-secondary)">
        Data Anda tidak terpengaruh oleh instalasi ini.
      </p>
    `;
  } else {
    storageInfo.innerHTML = `
      <p>✅ Database baru telah dibuat untuk aplikasi Anda.</p>
    `;
  }
  storageInfo.hidden = false;
  
  // Download receipt
  document.getElementById('receipt-download').onclick = () => {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { 
      type: 'application/json' 
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smartdisplay-receipt-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };
}

// ============================================================================
// INIT
// ============================================================================

window.addEventListener('DOMContentLoaded', initLogin);