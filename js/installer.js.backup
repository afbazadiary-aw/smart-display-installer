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

function showNoLicenseError(email) {
  const message = document.getElementById('no-license-message');
  message.innerHTML = `
    <p>Akun Google <strong>${email || '(tidak terdeteksi)'}</strong> 
       belum memiliki lisensi Smart Display.</p>
    <p>Silakan hubungi penjual untuk mendapatkan lisensi, 
       atau login dengan akun yang sudah memiliki lisensi.</p>
  `;
  showScreen('no-license-error');
}

// ============================================================================
// API HELPER — dengan auth header & retry otomatis
// ============================================================================

async function apiCall(url, options = {}, retried = false) {
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
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  
  if (res.status === 204) return {};
  return res.json();
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
  
  let data;
  try {
    const res = await fetch(INSTALLER_CONFIG.LICENSE_API_URL, {
      signal: controller.signal,
      cache: 'no-store'  // Selalu fetch terbaru
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      throw new Error(`Server lisensi mengembalikan status ${res.status}`);
    }
    
    data = await res.json();
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Waktu tunggu habis. Periksa koneksi internet Anda.');
    }
    throw new Error(`Tidak bisa menghubungi server lisensi: ${e.message}`);
  }
  
  const licenses = Array.isArray(data?.licenses) ? data.licenses : [];
  
  // Cari lisensi untuk email ini (case-insensitive)
  userLicense = licenses.find(lic => 
    lic.email && lic.email.toLowerCase() === userEmail.toLowerCase()
  );
  
  if (!userLicense) {
    showNoLicenseError(userEmail);
    return;
  }
  
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

async function ensureAppsScriptApiEnabled() {
  try {
    await apiCall(`${SCRIPT_API}/projects/000000000000000000000000000000000000000000`)
      .catch(e => { if (e.status !== 404) throw e; });
    return true;
  } catch (e) {
    const msg = (e.body?.error?.message || '').toLowerCase();
    if (
      e.status === 403 || 
      msg.includes('has not been used') || 
      msg.includes('disabled') || 
      msg.includes('permission')
    ) {
      return false;
    }
    throw e;
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
    validate: document.getElementById('step-validate')
  };
  
  try {
    // --- Step 1: Lisensi sudah diverifikasi sebelumnya ---
    setStep(steps.checkLicense, 'done', 
      `Lisensi ${userLicense.licenseId} valid untuk akun ini.`);
    
    // --- Step 2: Cek Apps Script API ---
    setStep(steps.checkApi, 'active', 'Memeriksa izin akun Google Anda...');
    const apiEnabled = await ensureAppsScriptApiEnabled();
    if (!apiEnabled) {
      setStep(steps.checkApi, 'error', 'Perlu 1 langkah aktivasi dari Google');
      showActivationPrompt();
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
    
    // --- Step 4: Buat project Apps Script baru ---
    setStep(steps.createProject, 'active', 'Membuat ruang aplikasi baru...');
    const projectTitle = `${INSTALLER_CONFIG.APP_TITLE} - ${new Date().toISOString().slice(0, 10)}`;
    const project = await apiCall(`${SCRIPT_API}/projects`, {
      method: 'POST',
      body: JSON.stringify({ title: projectTitle })
    });
    const scriptId = project.scriptId;
    setStep(steps.createProject, 'done', 'Ruang aplikasi dibuat.');
    
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
    
    const deployment = await apiCall(`${SCRIPT_API}/projects/${scriptId}/deployments`, {
      method: 'POST',
      body: JSON.stringify({
        versionNumber: version.versionNumber,
        manifestFileName: 'appsscript',
        description: `Instalasi otomatis - v${manifest.version}`
      })
    });
    
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
    
    // --- Simpan receipt ---
    const receipt = {
      scriptId,
      deploymentId: deployment.deploymentId,
      webAppUrl,
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
    
    // Tampilkan layar sukses
    showSuccessScreen(receipt, existingStorage.found);
    
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

function showSuccessScreen(receipt, usedExistingStorage) {
  showScreen('success-screen');
  
  // Tombol buka aplikasi
  const btnOpen = document.getElementById('btn-open-app');
  btnOpen.href = receipt.webAppUrl;
  btnOpen.target = '_blank';
  btnOpen.rel = 'noopener';
  
  // Info storage
  const storageInfo = document.getElementById('storage-info');
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