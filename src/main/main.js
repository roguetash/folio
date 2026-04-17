const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
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

async function importFilePaths(filePaths) {
  const booksDir = path.join(getDataDir(), 'books');
  const coversDir = path.join(getDataDir(), 'covers');
  let imported = 0;

  for (const srcPath of filePaths) {
    try {
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

      db.prepare(`
        INSERT INTO books (title, author, publisher, published_year, isbn, language, description, file_path, file_format, file_size, cover_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(title, author, publisher, publishedYear, isbn, language, description, destPath, ext, stats.size, coverPath);
      imported++;
    } catch (err) {
      console.error('Import failed for', srcPath, err);
    }
  }
  return { imported };
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
    UPDATE devices SET name=?, mount_path=?, books_folder=?, preferred_format=?, kindle_email=?
    WHERE id=?
  `).run(device.name, device.mount_path, device.books_folder, device.preferred_format, device.kindle_email, device.id);
  return { ok: true };
});

ipcMain.handle('devices:send', async (e, { bookIds, deviceId }) => {
  const device = db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId);
  if (!device) return { ok: false, error: 'Device not found' };

  const isXteink = device.brand === 'xteink';

  if (isXteink) {
    if (!device.mount_path) return { ok: false, error: 'No device address set. Configure it in device settings.' };
    if (!await xteinkReachable(device.mount_path)) return { ok: false, error: 'Xteink not reachable. Make sure WiFi Transfer is active on the device.' };
  } else {
    if (!device.mount_path || !fs.existsSync(device.mount_path)) {
      return { ok: false, error: 'Device not connected. Plug it in and try again.' };
    }
    const destFolder = path.join(device.mount_path, device.books_folder || '');
    if (!fs.existsSync(destFolder)) {
      try { fs.mkdirSync(destFolder, { recursive: true }); }
      catch (err) { return { ok: false, error: 'Could not access folder: ' + err.message }; }
    }
  }

  const results = [];
  const linkStmt = db.prepare('INSERT OR IGNORE INTO book_devices (book_id, device_id) VALUES (?, ?)');
  for (const bookId of bookIds) {
    const book = db.prepare('SELECT * FROM books WHERE id=?').get(bookId);
    if (!book) continue;
    let tempPath = null;
    try {
      let srcPath = book.file_path;
      if (device.brand === 'kindle' && book.file_format === 'EPUB') {
        tempPath = await convertEpubToMobi(srcPath);
        srcPath = tempPath;
      }
      if (isXteink) {
        await uploadToXteink(device.mount_path, device.books_folder || '/', srcPath);
      } else {
        const destFolder = path.join(device.mount_path, device.books_folder || '');
        fs.copyFileSync(srcPath, path.join(destFolder, path.basename(srcPath)));
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

function convertEpubToMobi(srcPath) {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(srcPath, path.extname(srcPath));
    const outPath = path.join(os.tmpdir(), `${Date.now()}_${baseName}.mobi`);
    execFile('ebook-convert', [srcPath, outPath], (err) => {
      if (err) return reject(new Error(`ebook-convert failed: ${err.message}`));
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

ipcMain.handle('book:reveal-file', (e, id) => {
  const book = db.prepare('SELECT file_path FROM books WHERE id=?').get(id);
  if (book && book.file_path && fs.existsSync(book.file_path)) {
    shell.showItemInFolder(book.file_path);
    return { ok: true };
  }
  return { ok: false };
});
