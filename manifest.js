#!/usr/bin/env node
// ============================================================================
// generate-manifest.js
// ----------------------------------------------------------------------------
// Generator: membaca source SmartDisplayApp lalu menghasilkan manifest.json
// yang siap didorong ke Apps Script API (projects.content.update) oleh installer.
//
// KAPAN DIJALANKAN?
//   Hanya oleh Anda (penjual), di komputer Anda, setiap kali Anda mengubah
//   source code master Smart Display (mis. menambah fitur, fix bug).
//
// CARA PAKAI:
//   node scripts/generate-manifest.js [SRC_DIR] [OUT_FILE] [VERSION]
//
//   Contoh:
//     node scripts/generate-manifest.js ./SmartDisplayApp ./site/manifest.json 1.0.0
//
// ARGUMEN:
//   SRC_DIR   - folder berisi source code master (default: ./SmartDisplayApp)
//   OUT_FILE  - lokasi output manifest.json (default: ./site/manifest.json)
//   VERSION   - label versi produk (default: tanggal hari ini YYYY-MM-DD)
//
// OUTPUT:
//   manifest.json berisi array file dalam format Apps Script API:
//   {
//     "version": "1.0.0",
//     "generatedAt": "2026-08-10T08:30:00.000Z",
//     "fileCount": 37,
//     "files": [
//       { "name": "appsscript", "type": "JSON", "source": "..." },
//       { "name": "Code",       "type": "SERVER_JS", "source": "..." },
//       { "name": "Index",      "type": "HTML", "source": "..." },
//       ...
//     ]
//   }
//
// CATATAN PENTING:
//   - File ini TIDAK dijalankan oleh pembeli
//   - File ini TIDAK memerlukan koneksi internet
//   - File ini TIDAK menyentuh Google API apapun
//   - Pembeli baru akan otomatis mendapatkan versi manifest.json terbaru
//     saat mereka menjalankan installer (karena installer fetch file ini
//     dari hosting saat instalasi)
// ============================================================================

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// ARGUMEN
// ---------------------------------------------------------------------------
const SRC_DIR = process.argv[2] || './SmartDisplayApp';
const OUT_FILE = process.argv[3] || './site/manifest.json';
const VERSION = process.argv[4] || new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// KONSTANTA — file & folder yang harus diabaikan
// ---------------------------------------------------------------------------

// File dengan nama persis ini akan dilewati
const EXCLUDE_EXACT = new Set([
  '.clasp.json',
  '.clasp.json.old-project-backup',
  '.claspignore',
  '.gitignore',
  '.DS_Store',
  'Thumbs.db',
  'package.json',
  'package-lock.json',
  'node_modules',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
]);

// Folder dengan prefix ini akan dilewati (rekursif)
const EXCLUDE_DIR_PREFIXES = [
  '.git',
  '.wrangler',
  '.claude',
  '.vscode',
  '.idea',
  'node_modules',
  'Image',
  'live-studio',
  'cloudflare-worker',
  // PERBAIKAN: 'docs' SEBELUMNYA tidak ada di daftar ini, padahal .claspignore milik source
  // Smart Display sudah mengecualikannya. Akibatnya docs/voice-recorder/index.html dan video.html
  // ikut masuk manifest sebagai berkas Apps Script bernama "index" dan "video". Keduanya halaman
  // statis GitHub Pages yang memakai document/window di top level - kalau ikut terdorong, Apps
  // Script mengevaluasinya sebagai kode server tanpa DOM. Lebih buruk lagi, "index" bertabrakan
  // dengan "Index" (shell utama aplikasi). Daftar ini HARUS tetap sejalan dengan .claspignore.
  'docs',
  '__tests__',
  'test',
  'tests',
];

// Ekstensi file yang dipetakan ke Apps Script type
const EXT_TO_TYPE = {
  '.js': 'SERVER_JS',
  '.gs': 'SERVER_JS',
  '.html': 'HTML',
};

// ---------------------------------------------------------------------------
// HELPER — cek apakah path harus dilewati
// ---------------------------------------------------------------------------

function isExcluded(filePath) {
  const name = path.basename(filePath);
  if (EXCLUDE_EXACT.has(name)) return true;

  const parts = filePath.split(path.sep);
  for (const part of parts) {
    if (EXCLUDE_DIR_PREFIXES.some(p => part === p || part.startsWith(p + '.'))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// REKURSIF — kumpulkan seluruh file source dari SRC_DIR
// ---------------------------------------------------------------------------

function collectFiles(dir, rootDir) {
  const results = [];
  let entries;

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw new Error(`Tidak bisa membaca folder: ${dir}\n${e.message}`);
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (isExcluded(relativePath)) continue;

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, rootDir));
    } else if (entry.isFile()) {
      results.push({ fullPath, relativePath, name: entry.name });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// KONVERSI — ubah file menjadi format Apps Script API
// ---------------------------------------------------------------------------

function toAppsScriptFile(file) {
  const ext = path.extname(file.name).toLowerCase();
  let type;

  // appsscript.json adalah manifest Apps Script — HARUS ada
  if (file.name === 'appsscript.json') {
    type = 'JSON';
  } else {
    type = EXT_TO_TYPE[ext];
    if (!type) return null; // lewati file non-source (.md, .txt, gambar, dsb.)
  }

  let source;
  try {
    source = fs.readFileSync(file.fullPath, 'utf8');
  } catch (e) {
    throw new Error(`Tidak bisa membaca file: ${file.fullPath}\n${e.message}`);
  }

  // Apps Script API menggunakan nama file TANPA ekstensi sebagai identifier.
  // Khusus appsscript.json → nama harus "appsscript" (tanpa .json).
  const name = file.name === 'appsscript.json'
    ? 'appsscript'
    : path.basename(file.name, path.extname(file.name));

  return {
    name,
    type,
    source,
  };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

function main() {
  console.log('═'.repeat(60));
  console.log(' Smart Display — Manifest Generator');
  console.log('═'.repeat(60));
  console.log(`Source folder : ${path.resolve(SRC_DIR)}`);
  console.log(`Output file   : ${path.resolve(OUT_FILE)}`);
  console.log(`Version       : ${VERSION}`);
  console.log('─'.repeat(60));

  // 1. Validasi source folder
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`\n❌ ERROR: Folder source tidak ditemukan: ${SRC_DIR}`);
    console.error('Pastikan path-nya benar. Contoh:');
    console.error('  node scripts/generate-manifest.js ./SmartDisplayApp ./site/manifest.json 1.0.0');
    process.exit(1);
  }

  if (!fs.statSync(SRC_DIR).isDirectory()) {
    console.error(`\n❌ ERROR: ${SRC_DIR} bukan folder`);
    process.exit(1);
  }

  // 2. Kumpulkan file
  const allFiles = collectFiles(SRC_DIR, SRC_DIR);
  console.log(`Ditemukan ${allFiles.length} file di folder source`);

  // 3. Konversi ke format Apps Script
  const files = allFiles
    .map(toAppsScriptFile)
    .filter(f => f !== null);

  if (files.length === 0) {
    console.error('\n❌ ERROR: Tidak ada file source yang valid (.js, .gs, .html, appsscript.json)');
    process.exit(1);
  }

  // 4. Validasi appsscript.json (WAJIB ada tepat 1)
  const appsscriptFiles = files.filter(f => f.name === 'appsscript' && f.type === 'JSON');
  if (appsscriptFiles.length === 0) {
    console.error('\n❌ ERROR: appsscript.json tidak ditemukan di folder source.');
    console.error('File ini wajib ada — berisi konfigurasi Apps Script project.');
    process.exit(1);
  }
  if (appsscriptFiles.length > 1) {
    console.error(`\n❌ ERROR: Ditemukan ${appsscriptFiles.length} appsscript.json. Harus hanya ada 1.`);
    process.exit(1);
  }

  // 5. Urutkan: appsscript.json selalu di posisi pertama untuk keterbacaan
  files.sort((a, b) => {
    if (a.type === 'JSON' && a.name === 'appsscript') return -1;
    if (b.type === 'JSON' && b.name === 'appsscript') return 1;
    // Urutan berikutnya: SERVER_JS dulu, baru HTML
    if (a.type !== b.type) {
      if (a.type === 'SERVER_JS') return -1;
      if (b.type === 'SERVER_JS') return 1;
    }
    return a.name.localeCompare(b.name);
  });

  // 6. Hitung ukuran
  const totalSize = files.reduce((sum, f) => sum + Buffer.byteLength(f.source, 'utf8'), 0);
  const jsCount = files.filter(f => f.type === 'SERVER_JS').length;
  const htmlCount = files.filter(f => f.type === 'HTML').length;

  // 7. Buat objek manifest
  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    totalSizeBytes: totalSize,
    files,
  };

  // 8. Tulis ke file output
  try {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2));

    // Berkas versi RINGAN, ditulis berdampingan dengan manifest.
    // Gunanya: installer perlu tahu "apakah pemasangan saya sudah versi terbaru?"
    // SEBELUM memutuskan menyalin ulang. Kalau jawabannya dicari di manifest.json,
    // pembeli harus mengunduh 11MB hanya untuk menemukan bahwa tidak ada yang
    // berubah - persis pemborosan yang ingin dihindari. Berkas ini hanya ratusan byte.
    const versiFile = path.join(path.dirname(OUT_FILE), 'versi.json');
    fs.writeFileSync(versiFile, JSON.stringify({
      version: VERSION,
      generatedAt: manifest.generatedAt,
      fileCount: files.length,
      totalSizeBytes: totalSize
    }, null, 2));
  } catch (e) {
    console.error(`\n❌ ERROR: Gagal menulis ke ${OUT_FILE}`);
    console.error(e.message);
    process.exit(1);
  }

  // 9. Laporan
  console.log('─'.repeat(60));
  console.log(`✅ Manifest berhasil dibuat!`);
  console.log('─'.repeat(60));
  console.log(`Total file        : ${files.length}`);
  console.log(`  ├─ SERVER_JS    : ${jsCount}`);
  console.log(`  ├─ HTML         : ${htmlCount}`);
  console.log(`  └─ JSON         : 1 (appsscript)`);
  console.log(`Ukuran total      : ${(totalSize / 1024).toFixed(1)} KB`);
  console.log(`Output            : ${path.resolve(OUT_FILE)}`);
  console.log(`Ukuran file       : ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
  console.log('═'.repeat(60));
  console.log('');
  console.log('📌 Langkah selanjutnya:');
  console.log('   Upload file ini ke hosting (Cloudflare Pages, Netlify, dsb.)');
  console.log('   agar pembeli baru otomatis mendapatkan versi ini.');
  console.log('');
}

main();