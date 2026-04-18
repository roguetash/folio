const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const EPub = require('epub2').EPub;

let db;
let mainWindow;

function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'library');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const booksDir = path.join(dir, 'books');
  if (!fs.existsSync(booksDir)) fs.mkdirSync(booksDir, { recursive: true });
  const coversDir = path.join(dir, 'covers');
  if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
  return dir;
}

function initDatabase() {
  const dbPath = path.join(getDataDir(), 'folio.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      series TEXT,
      series_index REAL,
      publisher TEXT,
      published_year INTEGER,
      isbn TEXT,
      language TEXT,
      description TEXT,
      file_path TEXT NOT NULL,
      file_format TEXT,
      file_size INTEGER,
      file_hash TEXT,
      cover_path TEXT,
      status TEXT DEFAULT 'tbr',
      rating INTEGER DEFAULT 0,
      progress INTEGER DEFAULT 0,
      date_added TEXT DEFAULT CURRENT_TIMESTAMP,
      date_finished TEXT
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS book_tags (
      book_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (book_id, tag_id),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      mount_path TEXT,
      books_folder TEXT,
      preferred_format TEXT,
      kindle_email TEXT
    );

    CREATE TABLE IF NOT EXISTS book_devices (
      book_id INTEGER,
      device_id INTEGER,
      date_sent TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (book_id, device_id)
    );
  `);

  try { db.exec('ALTER TABLE books ADD COLUMN progress INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE devices ADD COLUMN uses_koreader INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE books ADD COLUMN file_hash TEXT'); } catch {}

  const deviceCount = db.prepare('SELECT COUNT(*) as n FROM devices').get().n;
  if (deviceCount === 0) {
    const insert = db.prepare(`
      INSERT INTO devices (name, brand, mount_path, books_folder, preferred_format)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run('Kobo Libra 2', 'kobo', '/Volumes/KOBOeReader', '', 'KEPUB');
    insert.run('Kindle Paperwhite', 'kindle', '', '', 'MOBI');
    insert.run('Xteink X4', 'xteink', '', '', 'EPUB');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1714',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('books:list', () => {
  const rows = db.prepare('SELECT * FROM books ORDER BY date_added DESC').all();
  const tagStmt = db.prepare(`
    SELECT t.name FROM tags t
    JOIN book_tags bt ON bt.tag_id = t.id
    WHERE bt.book_id = ?
  `);
  const deviceStmt = db.prepare(`
    SELECT d.id, d.name, d.brand FROM devices d
    JOIN book_devices bd ON bd.device_id = d.id
    WHERE bd.book_id = ?
  `);
  return rows.map(b => ({
    ...b,
    tags: tagStmt.all(b.id).map(t => t.name),
    devices: deviceStmt.all(b.id)
  }));
});

ipcMain.handle('books:update', (e, book) => {
  db.prepare(`
    UPDATE books SET
      title=?, author=?, series=?, series_index=?,
      publisher=?, published_year=?, isbn=?,
      status=?, rating=?, progress=?
    WHERE id=?
  `).run(
    book.title, book.author, book.series, book.series_index,
    book.publisher, book.published_year, book.isbn,
    book.status, book.rating, book.progress || 0, book.id
  );
  db.prepare('DELETE FROM book_tags WHERE book_id=?').run(book.id);
  if (book.tags && book.tags.length) {
    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTag = db.prepare('SELECT id FROM tags WHERE name=?');
    const linkTag = db.prepare('INSERT INTO book_tags (book_id, tag_id) VALUES (?, ?)');
    for (const tag of book.tags) {
      insertTag.run(tag);
      const { id: tagId } = getTag.get(tag);
      linkTag.run(book.id, tagId);
    }
  }
  return { ok: true };
});

ipcMain.handle('books:delete', (e, id) => {
  const book = db.prepare('SELECT file_path, cover_path FROM books WHERE id=?').get(id);
  if (book) {
    try { if (book.file_path && fs.existsSync(book.file_path)) fs.unlinkSync(book.file_path); } catch {}
    try { if (book.cover_path && fs.existsSync(book.cover_path)) fs.unlinkSync(book.cover_path); } catch {}
  }
  db.prepare('DELETE FROM books WHERE id=?').run(id);
  return { ok: true };
});

ipcMain.handle('books:find-duplicates', () => {
  const books = db.prepare('SELECT * FROM books ORDER BY title, author, date_added').all();

  // Group by exact file hash
  const byHash = {};
  for (const b of books) {
    if (!b.file_hash) continue;
    if (!byHash[b.file_hash]) byHash[b.file_hash] = [];
    byHash[b.file_hash].push(b);
  }

  // Group by normalised title + author
  const byTitleAuthor = {};
  for (const b of books) {
    const key = `${(b.title || '').toLowerCase().trim()}|${(b.author || '').toLowerCase().trim()}`;
    if (!byTitleAuthor[key]) byTitleAuthor[key] = [];
    byTitleAuthor[key].push(b);
  }

  const groups = [];
  const usedIds = new Set();

  for (const group of Object.values(byHash)) {
    if (group.length < 2) continue;
    groups.push({ type: 'exact', books: group });
    group.forEach(b => usedIds.add(b.id));
  }
  for (const group of Object.values(byTitleAuthor)) {
    if (group.length < 2) continue;
    const fresh = group.filter(b => !usedIds.has(b.id));
    if (fresh.length >= 2) groups.push({ type: 'title_author', books: fresh });
  }

  return groups;
});

async function importFilePaths(filePaths) {
  const booksDir = path.join(getDataDir(), 'books');
  const coversDir = path.join(getDataDir(), 'covers');
  let imported = 0;
  const skipped = [];

  for (const srcPath of filePaths) {
    try {
      // Exact duplicate check via file hash
      let fileHash = null;
      try {
        fileHash = crypto.createHash('sha256').update(fs.readFileSync(srcPath)).digest('hex');
      } catch {}
      if (fileHash) {
        const exact = db.prepare('SELECT title FROM books WHERE file_hash=?').get(fileHash);
        if (exact) { skipped.push({ file: path.basename(srcPath), reason: 'exact', match: exact.title }); continue; }
      }

      const ext = path.extname(srcPath).slice(1).toUpperCase();
      const destName = `${Date.now()}_${path.basename(srcPath)}`;
      const destPath = path.join(booksDir, destName);
      fs.copyFileSync(srcPath, destPath);
      const stats = fs.statSync(destPath);

      let title = path.basename(srcPath, path.extname(srcPath));
      let author = '';
      let publisher = '';
      let publishedYear = null;
      let isbn = '';
      let description = '';
      let language = '';
      let coverPath = null;

      if (ext === 'EPUB') {
        try {
          const metadata = await extractEpubMetadata(destPath, coversDir);
          if (metadata.title) title = metadata.title;
          if (metadata.author) author = metadata.author;
          if (metadata.publisher) publisher = metadata.publisher;
          if (metadata.publishedYear) publishedYear = metadata.publishedYear;
          if (metadata.isbn) isbn = metadata.isbn;
          if (metadata.description) description = metadata.description;
          if (metadata.language) language = metadata.language;
          if (metadata.coverPath) coverPath = metadata.coverPath;
        } catch (err) {
          console.error('EPUB parse failed:', err.message);
        }
      }

      if (!coverPath) {
        try {
          coverPath = await fetchOpenLibraryCover(isbn, title, coversDir);
        } catch (err) {
          console.error('Open Library cover fetch failed:', err.message);
        }
      }

      // Title + author duplicate check (warn level — different editions still import)
      if (title && author) {
        const titleDupe = db.prepare(
          'SELECT id FROM books WHERE LOWER(TRIM(title))=? AND LOWER(TRIM(COALESCE(author,"")))=?'
        ).get(title.toLowerCase().trim(), author.toLowerCase().trim());
        if (titleDupe) { skipped.push({ file: path.basename(srcPath), reason: 'title_author', match: title }); continue; }
      }

      db.prepare(`
        INSERT INTO books (title, author, publisher, published_year, isbn, language, description, file_path, file_format, file_size, file_hash, cover_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(title, author, publisher, publishedYear, isbn, language, description, destPath, ext, stats.size, fileHash, coverPath);
      imported++;
    } catch (err) {
      console.error('Import failed for', srcPath, err);
    }
  }
  return { imported, skipped };
}

ipcMain.handle('books:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Ebooks', extensions: ['epub', 'mobi', 'azw3', 'pdf'] }]
  });
  if (result.canceled || !result.filePaths.length) return { imported: 0 };
  return importFilePaths(result.filePaths);
});

ipcMain.handle('books:import-paths', (e, filePaths) => importFilePaths(filePaths));

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchOpenLibraryCover(isbn, title, coversDir) {
  if (isbn) {
    try {
      const { body, contentType } = await fetchUrl(
        `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`
      );
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const coverPath = path.join(coversDir, `${Date.now()}_cover.${ext}`);
      fs.writeFileSync(coverPath, body);
      return coverPath;
    } catch {}
  }
  if (title) {
    try {
      const { body } = await fetchUrl(
        `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1`
      );
      const data = JSON.parse(body.toString());
      const coverId = data.docs && data.docs[0] && data.docs[0].cover_i;
      if (coverId) {
        const { body: imgBody, contentType } = await fetchUrl(
          `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`
        );
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        const coverPath = path.join(coversDir, `${Date.now()}_cover.${ext}`);
        fs.writeFileSync(coverPath, imgBody);
        return coverPath;
      }
    } catch {}
  }
  return null;
}

function extractEpubMetadata(filePath, coversDir) {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);
    epub.on('error', reject);
    epub.on('end', () => {
      const m = epub.metadata;
      const result = {
        title: m.title,
        author: m.creator,
        publisher: m.publisher,
        publishedYear: m.date ? parseInt(String(m.date).slice(0, 4), 10) : null,
        isbn: m.ISBN || '',
        description: m.description || '',
        language: m.language || ''
      };
      if (epub.metadata.cover && epub.manifest[epub.metadata.cover]) {
        const coverId = epub.metadata.cover;
        epub.getImage(coverId, (err, data, mimeType) => {
          if (!err && data) {
            const ext = mimeType ? mimeType.split('/')[1] : 'jpg';
            const coverPath = path.join(coversDir, `${Date.now()}_cover.${ext}`);
            fs.writeFileSync(coverPath, data);
            result.coverPath = coverPath;
          }
          resolve(result);
        });
      } else {
        resolve(result);
      }
    });
    epub.parse();
  });
}

function normalizeXteinkHost(raw) {
  return raw.replace(/^https?:\/\//, '').split('/')[0];
}

function xteinkReachable(host) {
  return new Promise(resolve => {
    const req = http.get({ hostname: normalizeXteinkHost(host), port: 80, path: '/api/status', timeout: 1500 }, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function uploadToXteink(host, remotePath, localFilePath) {
  return new Promise((resolve, reject) => {
    const filename = path.basename(localFilePath);
    const fileData = fs.readFileSync(localFilePath);
    const boundary = `----FolioBoundary${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileData, footer]);

    const req = http.request({
      hostname: normalizeXteinkHost(host), port: 80,
      path: `/upload?path=${encodeURIComponent(remotePath || '/')}`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error(`Upload failed: ${res.statusCode} ${data}`)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

ipcMain.handle('devices:list', async () => {
  const devices = db.prepare('SELECT * FROM devices').all();
  return Promise.all(devices.map(async d => ({
    ...d,
    connected: d.brand === 'xteink'
      ? (!!d.mount_path && await xteinkReachable(d.mount_path))
      : !!(d.mount_path && fs.existsSync(d.mount_path))
  })));
});

ipcMain.handle('devices:update', (e, device) => {
  db.prepare(`
    UPDATE devices SET name=?, mount_path=?, books_folder=?, preferred_format=?, kindle_email=?, uses_koreader=?
    WHERE id=?
  `).run(device.name, device.mount_path, device.books_folder, device.preferred_format, device.kindle_email, device.uses_koreader ? 1 : 0, device.id);
  return { ok: true };
});

ipcMain.handle('devices:delete', (e, id) => {
  db.prepare('DELETE FROM book_devices WHERE device_id=?').run(id);
  db.prepare('DELETE FROM devices WHERE id=?').run(id);
  return { ok: true };
});

ipcMain.handle('devices:add', (e, device) => {
  const result = db.prepare(`
    INSERT INTO devices (name, brand, mount_path, books_folder, preferred_format, kindle_email, uses_koreader)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(device.name, device.brand, device.mount_path || '', device.books_folder || '', device.preferred_format || 'EPUB', device.kindle_email || '');
  return { ok: true, id: result.lastInsertRowid };
});

ipcMain.handle('devices:list-books', (e, deviceId) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, books: [] };
  if (device.brand === 'xteink') return { ok: false, error: 'Wireless scan not supported', books: [] };
  if (!device.mount_path || !fs.existsSync(device.mount_path)) {
    return { ok: false, error: 'Device not connected', books: [] };
  }

  const relFolder = (device.books_folder || '').replace(/^\/+/, '');
  const scanRoot = relFolder ? path.join(device.mount_path, relFolder) : device.mount_path;
  const BOOK_EXTS = new Set(['epub', 'mobi', 'azw3', 'kepub', 'pdf']);
  const results = [];

  const scanDir = (dirPath, rel, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.sdr')) continue;
      if (entry.isDirectory()) {
        scanDir(path.join(dirPath, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (!BOOK_EXTS.has(ext)) continue;
      const fullPath = path.join(dirPath, entry.name);
      let size = 0;
      try { size = fs.statSync(fullPath).size; } catch {}
      const localBook = db.prepare(
        'SELECT id, title, author, cover_path, status, rating FROM books WHERE file_path LIKE ?'
      ).get(`%${entry.name}`);
      results.push({
        devicePath: fullPath,
        filename: entry.name,
        folder: rel || '/',
        size,
        localBookId: localBook ? localBook.id : null,
        localBook: localBook || null
      });
    }
  };

  scanDir(scanRoot, '', 0);
  return { ok: true, books: results };
});

ipcMain.handle('devices:remove-book', (e, { deviceId, devicePath }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found' };
  if (!devicePath.startsWith(device.mount_path)) return { ok: false, error: 'Path outside device mount' };
  try {
    fs.unlinkSync(devicePath);
    const sdrDir = devicePath + '.sdr';
    if (fs.existsSync(sdrDir)) fs.rmSync(sdrDir, { recursive: true, force: true });
    const filename = path.basename(devicePath);
    const localBook = db.prepare("SELECT id FROM books WHERE file_path LIKE ?").get(`%${filename}`);
    if (localBook) db.prepare('DELETE FROM book_devices WHERE book_id=? AND device_id=?').run(localBook.id, deviceId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('devices:import-from-device', async (e, devicePath) => {
  const result = await importFilePaths([devicePath]);
  return result;
});

ipcMain.handle('devices:export-books', async (e, devicePaths) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose export destination',
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  const destDir = filePaths[0];
  let exported = 0;
  const errors = [];
  for (const srcPath of devicePaths) {
    const destPath = path.join(destDir, path.basename(srcPath));
    try {
      fs.copyFileSync(srcPath, destPath);
      exported++;
    } catch (err) {
      errors.push({ file: path.basename(srcPath), error: err.message });
    }
  }
  return { ok: true, exported, errors, destDir };
});

ipcMain.handle('devices:create-folder', (e, { deviceId, parentPath, name }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found' };
  const newPath = path.join(parentPath, name.trim());
  if (!newPath.startsWith(device.mount_path)) return { ok: false, error: 'Path outside device mount' };
  try {
    fs.mkdirSync(newPath, { recursive: true });
    return { ok: true, path: newPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('devices:rename-folder', (e, { deviceId, folderPath, newName }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found' };
  if (!folderPath.startsWith(device.mount_path)) return { ok: false, error: 'Path outside device mount' };
  const newPath = path.join(path.dirname(folderPath), newName.trim());
  try {
    fs.renameSync(folderPath, newPath);
    return { ok: true, newPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('devices:delete-folder', (e, { deviceId, folderPath }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found' };
  if (!folderPath.startsWith(device.mount_path)) return { ok: false, error: 'Path outside device mount' };
  if (folderPath === device.mount_path) return { ok: false, error: 'Cannot delete root mount' };
  try {
    fs.rmSync(folderPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('devices:move-books', (e, { deviceId, devicePaths, destFolder }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found' };
  if (!destFolder.startsWith(device.mount_path)) return { ok: false, error: 'Destination outside device mount' };
  try { fs.mkdirSync(destFolder, { recursive: true }); } catch {}
  const results = [];
  for (const srcPath of devicePaths) {
    if (!srcPath.startsWith(device.mount_path)) { results.push({ ok: false, error: 'Path outside mount' }); continue; }
    const destPath = path.join(destFolder, path.basename(srcPath));
    try {
      if (srcPath === destPath) { results.push({ ok: true }); continue; }
      fs.renameSync(srcPath, destPath);
      // Move .sdr alongside if it exists
      const sdrSrc = srcPath + '.sdr', sdrDest = destPath + '.sdr';
      if (fs.existsSync(sdrSrc)) try { fs.renameSync(sdrSrc, sdrDest); } catch {}
      results.push({ ok: true, destPath });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }
  return { ok: true, results };
});

ipcMain.handle('devices:list-all-folders', (e, deviceId) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device || !device.mount_path || !fs.existsSync(device.mount_path)) return { ok: false, folders: [] };
  const relFolder = (device.books_folder || '').replace(/^\/+/, '');
  const scanRoot = relFolder ? path.join(device.mount_path, relFolder) : device.mount_path;
  const BOOK_EXTS = new Set(['epub', 'mobi', 'azw3', 'kepub', 'pdf']);

  const walk = (dirPath, depth) => {
    if (depth > 4) return [];
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return []; }
    const bookCount = entries.filter(e => !e.isDirectory() && BOOK_EXTS.has(path.extname(e.name).slice(1).toLowerCase())).length;
    const children = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.endsWith('.sdr'))
      .flatMap(e => walk(path.join(dirPath, e.name), depth + 1));
    return [{ path: dirPath, name: path.basename(dirPath), bookCount, children }];
  };

  const tree = walk(scanRoot, 0);
  return { ok: true, folders: tree, root: scanRoot };
});

ipcMain.handle('devices:scan-books', (e, deviceId) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, bookIds: [] };

  const sent = db.prepare('SELECT book_id FROM book_devices WHERE device_id=?').all(deviceId);
  const bookIds = new Set(sent.map(r => r.book_id));

  if (device.brand !== 'xteink' && device.mount_path && fs.existsSync(device.mount_path)) {
    const relFolder = (device.books_folder || '').replace(/^\/+/, '');
    const scanRoot = relFolder ? path.join(device.mount_path, relFolder) : device.mount_path;
    const BOOK_EXTS = new Set(['epub', 'mobi', 'azw3', 'kepub', 'pdf']);
    const scanDir = (dirPath, depth) => {
      if (depth > 3) return;
      let entries;
      try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory()) { scanDir(path.join(dirPath, entry.name), depth + 1); continue; }
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (!BOOK_EXTS.has(ext)) continue;
        const match = db.prepare("SELECT id FROM books WHERE file_path LIKE ?").get(`%${entry.name}`);
        if (match) bookIds.add(match.id);
      }
    };
    scanDir(scanRoot, 0);
  }

  return { ok: true, bookIds: [...bookIds] };
});

function listXteinkFolders(host, folderPath) {
  return new Promise(resolve => {
    const req = http.get({
      hostname: normalizeXteinkHost(host), port: 80,
      path: `/api/files?path=${encodeURIComponent(folderPath || '/')}`,
      timeout: 3000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let folders = [];
          if (Array.isArray(json)) {
            folders = json.filter(i => i.type === 'directory' || i.isDir || i.dir === true)
                          .map(i => i.name || i.filename).filter(Boolean);
          } else if (json.dirs && Array.isArray(json.dirs)) {
            folders = json.dirs;
          } else if (json.files && Array.isArray(json.files)) {
            folders = json.files.filter(f => f.type === 'dir' || f.isDirectory).map(f => f.name).filter(Boolean);
          }
          resolve(folders);
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

ipcMain.handle('devices:list-folders', async (e, { deviceId, subpath }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found', folders: [] };

  if (device.brand === 'xteink') {
    if (!device.mount_path) return { ok: true, folders: [] };
    const folders = await listXteinkFolders(device.mount_path, subpath || '/');
    return { ok: true, folders };
  }

  if (!device.mount_path || !fs.existsSync(device.mount_path)) {
    return { ok: false, error: 'Device not connected', folders: [] };
  }
  const relPath = (subpath || '').replace(/^\/+/, '');
  const scanPath = relPath ? path.join(device.mount_path, relPath) : device.mount_path;
  try {
    const entries = fs.readdirSync(scanPath, { withFileTypes: true });
    const folders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
    return { ok: true, folders };
  } catch (err) {
    return { ok: false, error: err.message, folders: [] };
  }
});

ipcMain.handle('devices:sync-koreader', async (e, deviceId) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device || !device.mount_path || !fs.existsSync(device.mount_path)) {
    return { ok: false, error: 'Device not connected.' };
  }
  const folder = path.join(device.mount_path, device.books_folder || '');
  let entries;
  try { entries = fs.readdirSync(folder); } catch {
    return { ok: false, error: 'Cannot read device folder.' };
  }

  const sdrDirs = entries.filter(e => e.endsWith('.sdr'));
  let updated = 0;
  for (const sdr of sdrDirs) {
    const bookFilename = sdr.slice(0, -4);
    const ext = path.extname(bookFilename).slice(1).toLowerCase();
    const luaPath = path.join(folder, sdr, `metadata.${ext}.lua`);
    if (!fs.existsSync(luaPath)) continue;
    try {
      const lua = fs.readFileSync(luaPath, 'utf8');
      const m = lua.match(/\["percent_finished"\]\s*=\s*([\d.]+)/);
      if (!m) continue;
      const progress = Math.round(parseFloat(m[1]) * 100);
      const book = db.prepare("SELECT id FROM books WHERE file_path LIKE ?").get(`%${bookFilename}`);
      if (!book) continue;
      db.prepare('UPDATE books SET progress=? WHERE id=?').run(progress, book.id);
      updated++;
    } catch {}
  }
  return { ok: true, updated };
});

ipcMain.handle('devices:send', async (e, { bookIds, deviceId, folderOverride }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found' };

  const isXteink = device.brand === 'xteink';
  const effectiveFolder = folderOverride !== undefined ? folderOverride : (device.books_folder || '/');

  if (isXteink) {
    if (!device.mount_path) return { ok: false, error: 'No device address set. Configure it in device settings.' };
    if (!await xteinkReachable(device.mount_path)) return { ok: false, error: 'Xteink not reachable. Make sure WiFi Transfer is active on the device.' };
  } else {
    if (!device.mount_path || !fs.existsSync(device.mount_path)) {
      return { ok: false, error: 'Device not connected. Plug it in and try again.' };
    }
    const relFolder = (effectiveFolder || '').replace(/^\/+/, '');
    const destFolderPath = relFolder ? path.join(device.mount_path, relFolder) : device.mount_path;
    if (!fs.existsSync(destFolderPath)) {
      try { fs.mkdirSync(destFolderPath, { recursive: true }); }
      catch (err) { return { ok: false, error: 'Could not access folder: ' + err.message }; }
    }
  }

  const relFolder = (effectiveFolder || '').replace(/^\/+/, '');
  const destFolderPath = isXteink ? null : (relFolder ? path.join(device.mount_path, relFolder) : device.mount_path);

  const results = [];
  const linkStmt = db.prepare('INSERT OR IGNORE INTO book_devices (book_id, device_id) VALUES (?, ?)');
  for (const bookId of bookIds) {
    const book = db.prepare('SELECT * FROM books WHERE id=?').get(bookId);
    if (!book) continue;
    let tempPath = null;
    try {
      let srcPath = book.file_path;
      const KINDLE_NATIVE = new Set(['MOBI', 'AZW3']);
      if (device.brand === 'kindle' && !KINDLE_NATIVE.has(book.file_format)) {
        const targetFormat = (device.preferred_format || 'MOBI').toUpperCase();
        tempPath = await convertToFormat(srcPath, targetFormat);
        srcPath = tempPath;
      }
      if (isXteink) {
        await uploadToXteink(device.mount_path, effectiveFolder || '/', srcPath);
      } else {
        fs.copyFileSync(srcPath, path.join(destFolderPath, path.basename(srcPath)));
      }
      linkStmt.run(bookId, deviceId);
      results.push({ id: bookId, ok: true });
    } catch (err) {
      results.push({ id: bookId, ok: false, error: err.message });
    } finally {
      if (tempPath) try { fs.unlinkSync(tempPath); } catch {}
    }
  }
  return { ok: true, results };
});

function convertToFormat(srcPath, targetFormat) {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(srcPath, path.extname(srcPath));
    const ext = targetFormat.toLowerCase();
    const outPath = path.join(os.tmpdir(), `${Date.now()}_${baseName}.${ext}`);
    execFile('ebook-convert', [srcPath, outPath], (err) => {
      if (err) {
        const msg = err.code === 'ENOENT'
          ? 'Calibre not found — install Calibre to convert formats (calibre-ebook.com)'
          : `Conversion to ${targetFormat} failed: ${err.message.split('\n')[0]}`;
        return reject(new Error(msg));
      }
      resolve(outPath);
    });
  });
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getSettings() {
  try { return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8')); } catch { return {}; }
}

function saveSettings(data) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2));
}

ipcMain.handle('settings:get', () => getSettings());

ipcMain.handle('settings:set', (e, data) => {
  saveSettings(data);
  return { ok: true };
});

ipcMain.handle('kindle:send-email', async (e, { bookIds, deviceId }) => {
  const settings = getSettings();
  const smtp = settings.smtp || {};
  if (!smtp.user || !smtp.password) {
    return { ok: false, error: 'SMTP credentials not configured. Open Settings to add them.' };
  }

  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device || !device.kindle_email) {
    return { ok: false, error: 'No Send-to-Kindle email set for this device.' };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host || 'smtp.gmail.com',
    port: smtp.port || 587,
    secure: smtp.secure || false,
    auth: { user: smtp.user, pass: smtp.password }
  });

  const results = [];
  const linkStmt = db.prepare('INSERT OR IGNORE INTO book_devices (book_id, device_id) VALUES (?, ?)');
  for (const bookId of bookIds) {
    const book = db.prepare('SELECT * FROM books WHERE id=?').get(bookId);
    if (!book) continue;
    try {
      await transporter.sendMail({
        from: smtp.user,
        to: device.kindle_email,
        subject: book.title || 'Ebook',
        text: 'Sent via Folio',
        attachments: [{ filename: path.basename(book.file_path), path: book.file_path }]
      });
      linkStmt.run(bookId, deviceId);
      results.push({ id: bookId, ok: true });
    } catch (err) {
      results.push({ id: bookId, ok: false, error: err.message });
    }
  }
  return { ok: true, results };
});

ipcMain.handle('book:open-file', (e, id) => {
  const book = db.prepare('SELECT file_path FROM books WHERE id=?').get(id);
  if (book && book.file_path && fs.existsSync(book.file_path)) {
    shell.openPath(book.file_path);
    return { ok: true };
  }
  return { ok: false, error: 'File missing' };
});

ipcMain.handle('book:open-in-koreader', (e, id) => {
  const KOREADER_PATH = '/Applications/KOReader.app';
  if (!fs.existsSync(KOREADER_PATH)) {
    return { ok: false, error: 'KOReader is not installed. Download it from koreader.rocks.' };
  }
  const book = db.prepare('SELECT file_path FROM books WHERE id=?').get(id);
  if (!book || !book.file_path || !fs.existsSync(book.file_path)) {
    return { ok: false, error: 'File missing' };
  }
  execFile('open', ['-a', KOREADER_PATH, book.file_path], err => {
    if (err) console.error('KOReader launch failed:', err.message);
  });
  return { ok: true };
});

ipcMain.handle('book:reveal-file', (e, id) => {
  const book = db.prepare('SELECT file_path FROM books WHERE id=?').get(id);
  if (book && book.file_path && fs.existsSync(book.file_path)) {
    shell.showItemInFolder(book.file_path);
    return { ok: true };
  }
  return { ok: false };
});
