// ============================================================================
// INSTALLER SUBDOMAIN — ganti alamat, logo, dan gambar latar
// ----------------------------------------------------------------------------
// Terpisah dari installer aplikasi (index.html/installer.js) dan sengaja jauh
// lebih ringan: halaman ini TIDAK menyentuh Apps Script maupun Drive sama
// sekali. Semua kerjanya lewat worker pembungkus, yang memverifikasi identitas
// dari token Google + daftar lisensi (lihat cloudflare-worker/src/index.js).
//
// Aturan yang ditegakkan worker, bukan halaman ini - halaman ini hanya
// memantulkannya ke layar supaya pembeli tidak menabrak dinding tanpa penjelasan:
//   - nama alamat hanya bisa diganti SATU KALI
//   - nama yang sudah dipakai / dicadangkan tidak bisa diambil
//   - logo & latar bebas diganti berkali-kali
// ============================================================================

const API = INSTALLER_CONFIG.ALAMAT_API;

let token = null;
let statusSekarang = null;

// ---------------------------------------------------------------- UI kecil
function tampilkan(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function pesan(id, teks, jenis) {
  const el = document.getElementById(id);
  el.textContent = teks;
  el.className = 'pesan ' + (jenis || 'ok');
}
function gagalTotal(judul, teks) {
  document.getElementById('judul-gagal').textContent = judul;
  document.getElementById('pesan-gagal').textContent = teks;
  tampilkan('layar-gagal');
}

// ---------------------------------------------------------------- panggilan API
async function panggil(path, opsi = {}) {
  const res = await fetch(API + path, {
    ...opsi,
    headers: { 'Authorization': 'Bearer ' + token, ...(opsi.headers || {}) }
  });
  const teks = await res.text();
  let data = {};
  try { data = teks ? JSON.parse(teks) : {}; } catch (e) { data = {}; }
  if (!res.ok) {
    // Diagnostik lengkap ke console - pesan ke pembeli tetap ringkas.
    console.error('[Alamat] ' + (opsi.method || 'GET') + ' ' + path +
      ' -> HTTP ' + res.status + ' | ' + (data.error || teks.slice(0, 300)));
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- login
function siapkanLogin() {
  const tunggu = setInterval(() => {
    if (!(window.google && google.accounts && google.accounts.oauth2)) return;
    clearInterval(tunggu);

    const klien = google.accounts.oauth2.initTokenClient({
      client_id: INSTALLER_CONFIG.GOOGLE_CLIENT_ID,
      // Hanya email. Halaman ini tidak butuh izin Apps Script/Drive apa pun,
      // dan layar izin yang pendek jauh lebih menenangkan pembeli.
      scope: INSTALLER_CONFIG.OAUTH_SCOPES_ALAMAT,
      callback: async (resp) => {
        if (resp.error) { gagalTotal('Login gagal', 'Detail: ' + resp.error); return; }
        token = resp.access_token;
        await muatStatus();
      },
      // Tanpa ini, jendela izin yang ditutup/diblokir tidak memicu apa pun dan
      // halaman diam selamanya - persis kegagalan yang pernah terjadi di
      // installer aplikasi.
      error_callback: (err) => {
        const t = (err && err.type) || '';
        if (t === 'popup_closed') gagalTotal('Jendela izin ditutup', 'Proses berhenti karena jendela izin Google ditutup sebelum selesai.');
        else if (t === 'popup_failed_to_open') gagalTotal('Jendela izin diblokir', 'Browser memblokir jendela izin Google. Izinkan popup untuk halaman ini, lalu coba lagi.');
        else gagalTotal('Proses izin terhenti', 'Detail: ' + (t || 'tidak diketahui'));
      }
    });

    document.getElementById('btn-masuk').addEventListener('click', () => klien.requestAccessToken());
  }, 100);

  setTimeout(() => {
    clearInterval(tunggu);
    if (!(window.google && google.accounts && google.accounts.oauth2)) {
      gagalTotal('Google Sign-In tidak dapat dimuat', 'Periksa koneksi internet Anda dan pastikan tidak ada pemblokir yang memblokir domain Google.');
    }
  }, 15000);
}

// ---------------------------------------------------------------- status awal
async function muatStatus() {
  let s;
  try {
    s = await panggil('/status');
  } catch (e) {
    gagalTotal('Gagal membaca data alamat', e.message);
    return;
  }

  if (!s.terdaftar) {
    document.getElementById('pesan-belum').textContent =
      'Akun ini belum punya alamat Smart Display. Pasang aplikasinya dulu lewat installer, alamatnya dibuat otomatis di akhir pemasangan.';
    tampilkan('layar-belum');
    return;
  }

  statusSekarang = s;
  document.getElementById('alamat-teks').textContent = s.alamat;
  const tautan = document.getElementById('tautan-buka');
  tautan.href = 'https://' + s.alamat;
  document.getElementById('sufiks-domain').textContent = '.' + INSTALLER_CONFIG.DOMAIN_INDUK;

  // Pratinjau diambil dari alamat pembeli sendiri, jadi yang terlihat memang
  // gambar yang sedang berlaku - bukan tebakan.
  document.getElementById('pratinjau-logo').src = 'https://' + s.alamat + '/icon.png?t=' + Date.now();
  document.getElementById('pratinjau-bg').src = 'https://' + s.alamat + '/bg.png?t=' + Date.now();

  // Diisi DI SINI, bukan saat halaman dimuat: statusSekarang baru ada setelah login selesai.
  const inpNamaApp = document.getElementById('input-nama-app');
  if (inpNamaApp) inpNamaApp.value = (s.namaApp && s.namaApp !== 'Smart Display') ? s.namaApp : '';

  if (s.sudahGantiNama) {
    document.getElementById('kartu-nama').classList.add('terkunci');
    document.getElementById('ket-nama').innerHTML =
      'Nama alamat sudah pernah diganti, jadi tidak bisa diubah lagi. ' +
      '<span class="catatan-kunci">Ini disengaja: setiap penggantian meninggalkan alamat lama yang harus tetap hidup selamanya agar aplikasi yang sudah terpasang di HP tidak putus.</span>';
    document.getElementById('input-nama').disabled = true;
  }

  tampilkan('layar-kelola');
}

// ---------------------------------------------------------------- cek nama
let timerCek = null;
function pasangCekNama() {
  const input = document.getElementById('input-nama');
  const stat = document.getElementById('status-nama');
  const tombol = document.getElementById('btn-ganti-nama');

  input.addEventListener('input', () => {
    const nama = input.value.trim().toLowerCase();
    input.value = nama;
    tombol.disabled = true;
    clearTimeout(timerCek);

    if (!nama) { stat.className = 'status-nama netral'; stat.textContent = ''; return; }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(nama)) {
      stat.className = 'status-nama tidak';
      stat.textContent = 'Hanya huruf kecil, angka, dan tanda hubung (3–32 karakter).';
      return;
    }

    stat.className = 'status-nama netral';
    stat.textContent = 'Memeriksa…';
    // Ditunda sebentar supaya tidak memanggil worker di setiap ketukan tombol.
    timerCek = setTimeout(async () => {
      try {
        const r = await fetch(API + '/cek-nama?nama=' + encodeURIComponent(nama));
        const d = await r.json();
        if (input.value.trim().toLowerCase() !== nama) return; // user sudah mengetik lagi
        if (d.tersedia) {
          stat.className = 'status-nama ok';
          stat.textContent = nama + '.' + INSTALLER_CONFIG.DOMAIN_INDUK + ' tersedia.';
          tombol.disabled = false;
        } else {
          stat.className = 'status-nama tidak';
          stat.textContent = d.alasan === 'dicadangkan'
            ? 'Nama itu dicadangkan sistem. Pilih nama lain.'
            : 'Nama itu sudah dipakai. Pilih nama lain.';
        }
      } catch (e) {
        stat.className = 'status-nama netral';
        stat.textContent = 'Tidak bisa memeriksa sekarang.';
      }
    }, 400);
  });

  tombol.addEventListener('click', async () => {
    const nama = input.value.trim().toLowerCase();
    if (!nama) return;
    // Konfirmasi eksplisit: ini tindakan yang TIDAK BISA diulang.
    if (!confirm('Ganti alamat menjadi:\n\n' + nama + '.' + INSTALLER_CONFIG.DOMAIN_INDUK +
                 '\n\nNama hanya bisa diganti SATU KALI dan tidak bisa dibatalkan.')) return;
    tombol.disabled = true;
    try {
      const d = await panggil('/ganti-nama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: nama })
      });
      pesan('pesan-nama', 'Alamat baru Anda: ' + d.alamat + '. Alamat lama (' + d.alamatLama + ') tetap bisa dibuka.', 'ok');
      setTimeout(() => location.reload(), 2500);
    } catch (e) {
      pesan('pesan-nama', e.message, 'salah');
      tombol.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- gambar
/**
 * Mengecilkan gambar di browser SEBELUM dikirim. Foto dari kamera HP biasanya
 * 3-8 MB - jauh di atas batas worker, dan mengirimnya utuh hanya membuang kuota
 * pembeli lalu ditolak. Logo dipaksa persegi 512x512 (ukuran ikon PWA terbesar
 * yang dipakai manifest); latar dibatasi lebar 1920 dan dikirim sebagai JPEG
 * karena fotografis - PNG untuk foto justru membengkak berkali-kali lipat.
 */
function kecilkanGambar(file, jenis) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const kanvas = document.createElement('canvas');
      const ctx = kanvas.getContext('2d');

      if (jenis === 'logo') {
        /* PERBAIKAN (dilaporkan: "logo pecah, karena tampil besar saat membuka aplikasi di
           laptop"). Dihitung, bukan dikira: layar pembuka menampilkan logo pada 85vmin -
           di laptop 1080p itu sekitar 918 piksel, dan pada layar berkerapatan ganda sekitar
           1836 piksel. Logo yang dikecilkan ke 512 px karena itu DIPERBESAR 1,8 sampai 3,6
           kali saat ditampilkan - itulah yang terlihat pecah, bukan mutu kompresinya.
           1024 px menutup kasus laptop 1080p sepenuhnya dan menyisakan sedikit ruang untuk
           layar yang lebih rapat, tanpa membuat berkasnya membengkak berlebihan. */
        const sisi = 1024;
        /* TIDAK PERNAH memperbesar. Kalau logo asalnya lebih kecil dari 1024, membesarkannya
           di kanvas tidak menambah satu pun detail - hanya menambah ukuran berkas sambil
           membuatnya tampak kabur. Sisi kanvas mengikuti gambar aslinya dalam kasus itu. */
        const skalaAsli = Math.min(sisi / img.width, sisi / img.height);
        const skala = Math.min(1, skalaAsli);
        const sisiKanvas = skalaAsli >= 1 ? Math.max(img.width, img.height) : sisi;
        kanvas.width = kanvas.height = sisiKanvas;
        // Penghalusan mutu tinggi - bawaannya 'low' pada sebagian peramban, dan itu
        // meninggalkan tepi bergerigi pada logo bergaris tipis.
        ctx.imageSmoothingEnabled = true;
        try { ctx.imageSmoothingQuality = 'high'; } catch (e) {}
        // "contain" + latar transparan: logo tidak boleh terpotong.
        const w = img.width * skala, h = img.height * skala;
        ctx.drawImage(img, (sisiKanvas - w) / 2, (sisiKanvas - h) / 2, w, h);
        kanvas.toBlob(b => b ? resolve(b) : reject(new Error('Gagal memproses gambar.')), 'image/png');
      } else {
        const maksLebar = 1920;
        const skala = Math.min(1, maksLebar / img.width);
        kanvas.width = Math.round(img.width * skala);
        kanvas.height = Math.round(img.height * skala);
        ctx.drawImage(img, 0, 0, kanvas.width, kanvas.height);
        kanvas.toBlob(b => b ? resolve(b) : reject(new Error('Gagal memproses gambar.')), 'image/jpeg', 0.82);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Berkas itu bukan gambar yang bisa dibaca.')); };
    img.src = url;
  });
}

/**
 * Salinan logo KHUSUS untuk ikon terpasang di HP.
 *
 * Android memakai ikon "maskable" apa adanya lalu memotongnya mengikuti bentuk peluncur
 * (lingkaran atau kotak membulat). Aturannya: isi ikon harus berada di dalam zona aman,
 * yaitu lingkaran seluas 80% kanvas. Logo yang digambar penuh sampai tepi - seperti yang
 * dikirim sebelumnya - membuat lingkaran logo persis menyentuh sisi kotak putihnya. Di
 * laptop tidak terjadi karena desktop memakai ikon biasa tanpa pemotongan bentuk.
 *
 * 72% dipilih, bukan 80% mepet: pada 80% logo tepat menyinggung batas zona aman dan
 * hasilnya masih terasa sesak. 72% menyisakan jarak yang benar-benar terlihat.
 *
 * Latarnya diisi PUTIH, bukan dibiarkan transparan - bagian transparan pada ikon maskable
 * diisi sendiri oleh peluncur dengan warna yang tidak bisa kita tentukan, jadi hasilnya
 * berbeda-beda antar HP.
 */
function buatIkonBerjarak(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const sisi = 512, isi = Math.round(sisi * 0.72);
      const kanvas = document.createElement('canvas');
      kanvas.width = kanvas.height = sisi;
      const ctx = kanvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, sisi, sisi);
      const skala = Math.min(isi / img.width, isi / img.height);
      const w = img.width * skala, h = img.height * skala;
      ctx.drawImage(img, (sisi - w) / 2, (sisi - h) / 2, w, h);
      kanvas.toBlob(b => b ? resolve(b) : reject(new Error('Gagal memproses gambar.')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Berkas itu bukan gambar yang bisa dibaca.')); };
    img.src = url;
  });
}

async function unggahGambar(file, jenis) {
  const idPesan = jenis === 'logo' ? 'pesan-logo' : 'pesan-bg';
  const idPratinjau = jenis === 'logo' ? 'pratinjau-logo' : 'pratinjau-bg';
  const batasKB = jenis === 'logo' ? INSTALLER_CONFIG.MAKS_LOGO_KB : INSTALLER_CONFIG.MAKS_BG_KB;

  pesan(idPesan, 'Memproses gambar…', 'ok');
  let blob;
  try { blob = await kecilkanGambar(file, jenis); }
  catch (e) { pesan(idPesan, e.message, 'salah'); return; }

  if (blob.size > batasKB * 1024) {
    pesan(idPesan, 'Gambar masih terlalu besar setelah dikecilkan (' +
      Math.round(blob.size / 1024) + ' KB, maksimal ' + batasKB + ' KB). Coba gambar lain.', 'salah');
    return;
  }

  pesan(idPesan, 'Mengunggah…', 'ok');
  try {
    await panggil('/gambar?jenis=' + (jenis === 'logo' ? 'logo' : 'bg'), {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob
    });
    // Pratinjau disegarkan dengan penanda waktu supaya yang terlihat benar-benar
    // gambar baru, bukan salinan lama dari cache browser.
    document.getElementById(idPratinjau).src =
      'https://' + statusSekarang.alamat + (jenis === 'logo' ? '/icon.png?t=' : '/bg.png?t=') + Date.now();
    // Versi berjarak-tepi dikirim menyusul, dan kegagalannya SENGAJA tidak membatalkan apa pun:
    // logo utamanya sudah tersimpan, dan tanpa berkas ini manifest cukup tidak menyebut ikon
    // maskable - Chrome lalu menambahkan jarak tepinya sendiri. Menurun, tidak rusak.
    if (jenis === 'logo') {
      try {
        const blobMask = await buatIkonBerjarak(file);
        await panggil('/gambar?jenis=maskable', { method: 'POST', headers: { 'Content-Type': blobMask.type }, body: blobMask });
      } catch (e) { /* diabaikan dengan sengaja - lihat catatan di atas */ }
    }
    pesan(idPesan, 'Tersimpan. Aplikasi yang sudah terpasang mungkin perlu dibuka ulang agar ikonnya ikut berganti.', 'ok');
  } catch (e) {
    pesan(idPesan, e.message, 'salah');
  }
}

// ---------------------------------------------------------------- init
window.addEventListener('DOMContentLoaded', () => {
  siapkanLogin();
  pasangCekNama();
  // Nama aplikasi: kosong berarti kembali ke Smart Display, ditentukan server.
  document.getElementById('btn-nama-app').addEventListener('click', async () => {
    const btn = document.getElementById('btn-nama-app');
    btn.disabled = true;
    pesan('pesan-nama-app', 'Menyimpan…', 'ok');
    try {
      const r = await panggil('/nama-app', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nama: document.getElementById('input-nama-app').value })
      });
      document.getElementById('input-nama-app').value = (r && r.namaApp) || 'Smart Display';
      pesan('pesan-nama-app', 'Tersimpan sebagai "' + ((r && r.namaApp) || 'Smart Display') +
        '". Aplikasi yang sudah terpasang perlu dipasang ulang agar namanya ikut berganti.', 'ok');
    } catch (e) { pesan('pesan-nama-app', e.message, 'salah'); }
    btn.disabled = false;
  });
  document.getElementById('berkas-logo').addEventListener('change', e => {
    if (e.target.files[0]) unggahGambar(e.target.files[0], 'logo');
    e.target.value = '';
  });
  document.getElementById('berkas-bg').addEventListener('change', e => {
    if (e.target.files[0]) unggahGambar(e.target.files[0], 'bg');
    e.target.value = '';
  });
});
