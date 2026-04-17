const COLORS = ['#4a3a6b','#6b3a3a','#3a526b','#6b5a3a','#3a6b52','#5a3a6b','#6b4a3a','#3a3a6b'];
const SHELVES = [
  { name: 'Fantasy', color: '#6b5b9e' },
  { name: 'Literary', color: '#9e5b5b' },
  { name: 'Sci-fi', color: '#5b7e9e' },
  { name: 'Mystery', color: '#9e7d5b' },
  { name: 'Nonfiction', color: '#5b9e7a' }
];

const state = {
  books: [],
  devices: [],
  filter: 'all',
  shelf: null,
  view: 'grid',
  selected: null,
  editData: {},
  multiSel: new Set(),
  sendTarget: null
};

function colorForBook(b) {
  if (b.cover_path) return null;
  return COLORS[b.id % COLORS.length];
}

function $(id) { return document.getElementById(id); }

async function loadAll() {
  state.books = await window.folio.books.list();
  state.devices = await window.folio.devices.list();
  renderSidebar();
  renderReadingWidget();
  renderBooks();
  renderDetail();
}

function renderReadingWidget() {
  const widget = $('reading-widget');
  const reading = state.books.filter(b => b.status === 'reading');
  if (!reading.length) {
    widget.innerHTML = '';
    widget.hidden = true;
    return;
  }
  widget.hidden = false;
  widget.innerHTML = `
    <div class="rw-label">Currently reading</div>
    <div class="rw-cards">${reading.map(b => `
      <div class="rw-card${state.selected === b.id ? ' selected' : ''}" data-id="${b.id}">
        <div class="rw-cover" style="${bookSpineStyle(b)}"></div>
        <div class="rw-info">
          <div class="rw-title">${escapeHtml(b.title)}</div>
          <div class="rw-author">${escapeHtml(b.author || 'Unknown author')}</div>
          <div class="rw-bar-wrap"><div class="rw-bar" style="width:${b.progress || 0}%"></div></div>
          <div class="rw-pct">${b.progress || 0}%</div>
        </div>
      </div>`).join('')}
    </div>`;
  widget.querySelectorAll('.rw-card').forEach(el => {
    el.onclick = () => selectBook(parseInt(el.dataset.id));
  });
}

function renderSidebar() {
  const filters = [
    { id: 'all', label: 'All books', color: null },
    { id: 'reading', label: 'Reading', color: '#85b7eb' },
    { id: 'read', label: 'Finished', color: '#5dcaa5' },
    { id: 'tbr', label: 'To be read', color: '#7a6e65' },
    { id: 'dnf', label: 'Abandoned', color: '#d07a5a' }
  ];
  $('filter-items').innerHTML = filters.map(f => {
    const count = f.id === 'all' ? state.books.length : state.books.filter(b => b.status === f.id).length;
    const active = state.filter === f.id && !state.shelf ? ' active' : '';
    return `<div class="nav-item${active}" data-filter="${f.id}">
      <div class="nav-dot" style="color:${f.color || 'currentColor'}"></div>
      ${f.label}<span class="nav-count">${count}</span>
    </div>`;
  }).join('');
  $('filter-items').querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => setFilter(el.dataset.filter);
  });

  $('shelf-items').innerHTML = SHELVES.map(s => {
    const active = state.shelf === s.name ? ' active' : '';
    return `<div class="shelf-item${active}" data-shelf="${s.name}">
      <div class="shelf-dot" style="background:${s.color}"></div>${s.name}
    </div>`;
  }).join('');
  $('shelf-items').querySelectorAll('.shelf-item').forEach(el => {
    el.onclick = () => setShelf(el.dataset.shelf);
  });

  $('device-list').innerHTML = state.devices.map(d => {
    const cls = d.connected ? ' connected' : '';
    const status = d.brand === 'xteink'
      ? (d.connected ? 'Reachable over WiFi' : 'Not reachable — enable WiFi Transfer')
      : (d.connected ? 'Connected' : 'Disconnected');
    return `<div class="device-item${cls}" data-device="${d.id}">
      <div class="device-ind"></div>
      <div class="device-info">
        <div class="device-name">${d.name}</div>
        <div class="device-status">${status}</div>
      </div>
    </div>`;
  }).join('');
  $('device-list').querySelectorAll('.device-item').forEach(el => {
    el.onclick = () => openDeviceConfig(parseInt(el.dataset.device));
  });
}

function setFilter(f) {
  state.filter = f; state.shelf = null; state.selected = null;
  renderSidebar(); renderBooks(); renderDetail();
}

function setShelf(s) {
  state.shelf = state.shelf === s ? null : s;
  state.filter = 'all'; state.selected = null;
  renderSidebar(); renderBooks(); renderDetail();
}

function setView(v) {
  state.view = v;
  $('btn-grid').classList.toggle('active', v === 'grid');
  $('btn-list').classList.toggle('active', v === 'list');
  renderBooks();
}

function getFiltered() {
  const q = $('search').value.toLowerCase();
  const sort = $('sort-sel').value;
  let list = state.books.filter(b => {
    if (state.shelf && !(b.tags || []).includes(state.shelf)) return false;
    if (!state.shelf && state.filter !== 'all' && b.status !== state.filter) return false;
    if (q) {
      const hay = `${b.title} ${b.author || ''} ${b.series || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  list.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'author') return (a.author || '').localeCompare(b.author || '');
    if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
    if (sort === 'date_added') return (b.date_added || '').localeCompare(a.date_added || '');
    return 0;
  });
  return list;
}

function statusBadge(s) {
  const m = { read: ['Read','status-read'], reading: ['Reading','status-reading'], tbr: ['TBR','status-tbr'], dnf: ['DNF','status-dnf'] };
  const [label, cls] = m[s] || m.tbr;
  return `<span class="book-status ${cls}">${label}</span>`;
}

function stars(n) { return n > 0 ? '★'.repeat(n) : ''; }

function bookSpineStyle(b) {
  if (b.cover_path) {
    const safe = `file://${b.cover_path.replace(/\\/g, '/')}`;
    return `background-image:url('${safe}')`;
  }
  return `background:${colorForBook(b)}`;
}

function renderBooks() {
  const list = getFiltered();
  const el = $('book-list');
  if (state.books.length === 0) {
    el.innerHTML = `<div class="empty-lib">
      <div class="empty-lib-title">Your library awaits</div>
      <div class="empty-lib-text">Import your first ebooks to get started. Folio reads EPUB, MOBI, AZW3, and PDF.</div>
      <button class="add-btn" onclick="document.getElementById('import-btn').click()">+ Import books</button>
    </div>`;
    updateStats([]);
    return;
  }
  if (state.view === 'grid') {
    el.innerHTML = `<div class="grid">${list.map(b => `
      <div class="book-card${state.selected === b.id ? ' selected' : ''}${state.multiSel.has(b.id) ? ' multi-sel' : ''}" data-id="${b.id}">
        <div class="multi-check" data-check="${b.id}">✓</div>
        <span class="format-badge">${b.file_format || ''}</span>
        <div class="book-spine" style="${bookSpineStyle(b)}">
          <div style="position:absolute;inset:0;background:linear-gradient(160deg,rgba(0,0,0,.1) 0%,transparent 50%,rgba(0,0,0,.5) 100%)"></div>
          ${!b.cover_path ? `<div class="book-spine-title">${escapeHtml(b.title)}</div>` : ''}
        </div>
        <div class="book-info">
          <div class="book-title">${escapeHtml(b.title)}</div>
          <div class="book-author">${escapeHtml(b.author || 'Unknown author')}</div>
          <div class="book-meta">${statusBadge(b.status)}<span class="book-rating">${stars(b.rating)}</span></div>
        </div>
      </div>`).join('')}</div>`;
  } else {
    el.innerHTML = `<div class="list-view">${list.map(b => `
      <div class="list-row${state.selected === b.id ? ' selected' : ''}${state.multiSel.has(b.id) ? ' multi-sel' : ''}" data-id="${b.id}">
        <div class="list-check" data-check="${b.id}">✓</div>
        <div class="list-title">${escapeHtml(b.title)}</div>
        <div class="list-author">${escapeHtml(b.author || '—')}</div>
        <div class="list-series">${escapeHtml(b.series || '')}</div>
        <div class="list-format">${b.file_format || ''}</div>
        <div class="list-rating">${stars(b.rating)}</div>
        ${statusBadge(b.status)}
      </div>`).join('')}</div>`;
  }
  el.querySelectorAll('[data-id]').forEach(row => {
    row.onclick = e => {
      if (e.target.dataset.check) {
        toggleMultiSel(parseInt(e.target.dataset.check));
      } else {
        selectBook(parseInt(row.dataset.id));
      }
    };
  });
  updateStats(list);
  updateSelBar();
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function toggleMultiSel(id) {
  if (state.multiSel.has(id)) state.multiSel.delete(id);
  else state.multiSel.add(id);
  renderBooks();
}

function updateSelBar() {
  const bar = $('sel-bar');
  const btn = $('send-btn');
  if (state.multiSel.size > 0) {
    bar.classList.add('show');
    $('sel-count').textContent = `${state.multiSel.size} selected`;
    btn.disabled = false;
  } else {
    bar.classList.remove('show');
    btn.disabled = true;
  }
}

function updateStats(list) {
  const read = list.filter(b => b.status === 'read').length;
  const rated = list.filter(b => b.rating > 0);
  const avg = rated.length ? (rated.reduce((a, b) => a + b.rating, 0) / rated.length).toFixed(1) : '—';
  $('stats-bar').innerHTML = `
    <div class="stat"><span>${list.length}</span> books shown</div>
    <div class="stat"><span>${read}</span> finished</div>
    <div class="stat">avg rating <span>${avg}</span></div>`;
}

function selectBook(id) {
  state.selected = id;
  const b = state.books.find(x => x.id === id);
  state.editData = { ...b, tags: [...(b.tags || [])] };
  renderReadingWidget(); renderBooks(); renderDetail();
}

function renderDetail() {
  const panel = $('detail-panel');
  if (!state.selected) {
    panel.innerHTML = `<div class="empty-detail"><div class="empty-detail-text">Select a book to view and edit its details, or tick the checkboxes to send several to a device.</div></div>`;
    return;
  }
  const b = state.editData;
  panel.innerHTML = `
    <div class="detail-header">
      <div class="detail-spine" style="${bookSpineStyle(b)}">
        <div style="position:absolute;inset:0;background:linear-gradient(160deg,rgba(0,0,0,.1) 0%,transparent 50%,rgba(0,0,0,.5) 100%)"></div>
      </div>
      <div class="detail-title">${escapeHtml(b.title)}</div>
      <div class="detail-author">${escapeHtml(b.author || 'Unknown author')}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px">
        <span style="background:var(--ink3);padding:2px 7px;border-radius:3px">${b.file_format || ''}</span>
        ${b.devices && b.devices.length ? ` · On ${b.devices.map(d=>d.name).join(', ')}` : ''}
      </div>
    </div>
    <div class="detail-body">
      <div class="field-label">Title</div>
      <input class="field-inp" id="f-title" value="${escapeHtml(b.title)}">
      <div class="field-label">Author</div>
      <input class="field-inp" id="f-author" value="${escapeHtml(b.author || '')}">
      <div class="field-label">Series</div>
      <input class="field-inp" id="f-series" value="${escapeHtml(b.series || '')}" placeholder="Series name">
      <div class="field-label">Series number</div>
      <input class="field-inp" id="f-series-idx" type="number" step="0.1" value="${b.series_index || ''}" placeholder="1, 2, 2.5...">
      <div class="field-label">Publisher</div>
      <input class="field-inp" id="f-publisher" value="${escapeHtml(b.publisher || '')}">
      <div class="field-label">Year</div>
      <input class="field-inp" id="f-year" type="number" value="${b.published_year || ''}">
      <div class="field-label">ISBN</div>
      <input class="field-inp" id="f-isbn" value="${escapeHtml(b.isbn || '')}">
      <div class="field-label">Tags / Genres</div>
      <div class="tag-row" id="tag-row">
        ${(b.tags || []).map((g, i) => `<span class="tag" data-tag-i="${i}">${escapeHtml(g)} ×</span>`).join('')}
        <button class="tag-add" id="tag-add-btn">+ add</button>
      </div>
      <div class="field-label">Reading status</div>
      <div class="status-row">
        ${['read','reading','tbr','dnf'].map(s => `<button class="status-btn${b.status === s ? ' active-' + s : ''}" data-status="${s}">${({read:'Read',reading:'Reading',tbr:'TBR',dnf:'DNF'}[s])}</button>`).join('')}
      </div>
      <div class="field-label">Progress</div>
      <div class="progress-row">
        <input type="range" class="prog-slider" id="f-progress" min="0" max="100" value="${b.progress || 0}">
        <span class="prog-pct" id="prog-pct">${b.progress || 0}%</span>
      </div>
      <div class="field-label">Rating</div>
      <div class="stars" id="stars-row">
        ${[1,2,3,4,5].map(n => `<span class="star${b.rating >= n ? ' lit' : ''}" data-rate="${n}">★</span>`).join('')}
      </div>
      <button class="save-btn" id="save-btn">Save changes</button>
      <button class="secondary-btn" id="send-single-btn">Send to device</button>
      <button class="secondary-btn" id="open-file-btn">Open file in reader</button>
      <button class="secondary-btn" id="open-koreader-btn">Open in KOReader</button>
      <button class="secondary-btn" id="reveal-file-btn">Show in Finder</button>
      <button class="danger-btn" id="delete-btn">Remove from library</button>
    </div>`;

  $('f-title').oninput = e => { state.editData.title = e.target.value; };
  $('f-author').oninput = e => { state.editData.author = e.target.value; };
  $('f-series').oninput = e => { state.editData.series = e.target.value; };
  $('f-series-idx').oninput = e => { state.editData.series_index = parseFloat(e.target.value) || null; };
  $('f-publisher').oninput = e => { state.editData.publisher = e.target.value; };
  $('f-year').oninput = e => { state.editData.published_year = parseInt(e.target.value) || null; };
  $('f-isbn').oninput = e => { state.editData.isbn = e.target.value; };
  $('f-progress').oninput = e => {
    state.editData.progress = parseInt(e.target.value);
    $('prog-pct').textContent = e.target.value + '%';
  };

  panel.querySelectorAll('[data-tag-i]').forEach(el => {
    el.onclick = () => {
      state.editData.tags.splice(parseInt(el.dataset.tagI), 1);
      renderDetail();
    };
  });
  $('tag-add-btn').onclick = () => {
    const t = prompt('Add a tag or genre:');
    if (t && t.trim()) {
      state.editData.tags.push(t.trim());
      renderDetail();
    }
  };
  panel.querySelectorAll('[data-status]').forEach(el => {
    el.onclick = () => { state.editData.status = el.dataset.status; renderDetail(); };
  });
  panel.querySelectorAll('[data-rate]').forEach(el => {
    el.onclick = () => {
      const n = parseInt(el.dataset.rate);
      state.editData.rating = state.editData.rating === n ? 0 : n;
      renderDetail();
    };
  });
  $('save-btn').onclick = saveBook;
  $('send-single-btn').onclick = () => {
    state.multiSel.clear();
    state.multiSel.add(state.selected);
    updateSelBar();
    openSendModal();
  };
  $('open-file-btn').onclick = () => window.folio.books.openFile(state.selected);
  $('open-koreader-btn').onclick = async () => {
    const r = await window.folio.books.openInKoreader(state.selected);
    if (!r.ok) alert(r.error);
  };
  $('reveal-file-btn').onclick = () => window.folio.books.revealFile(state.selected);
  $('delete-btn').onclick = async () => {
    if (!confirm(`Remove "${state.editData.title}" from your library? The file will also be deleted.`)) return;
    await window.folio.books.delete(state.selected);
    state.selected = null;
    await loadAll();
  };
}

async function saveBook() {
  await window.folio.books.update(state.editData);
  const btn = $('save-btn');
  btn.textContent = 'Saved';
  btn.style.background = 'rgba(15,110,86,.3)';
  btn.style.color = '#5dcaa5';
  btn.style.borderColor = 'rgba(15,110,86,.4)';
  setTimeout(() => {
    btn.textContent = 'Save changes';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }, 1500);
  await loadAll();
}

function openSendModal() {
  const selBooks = Array.from(state.multiSel).map(id => state.books.find(b => b.id === id)).filter(Boolean);
  const modal = $('modal');
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">Send to device</div>
        <div class="modal-sub">${selBooks.length} book${selBooks.length > 1 ? 's' : ''} selected</div>
      </div>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-section-label">Choose device</div>
        ${state.devices.map(d => {
          const disabled = !d.connected ? ' disabled' : '';
          const status = d.connected ? 'Connected · ready to receive' : 'Not connected. Plug in to send.';
          return `<div class="device-choice${disabled}" data-device-id="${d.id}" ${!d.connected ? 'title="Not connected"' : ''}>
            <div class="device-icon ${d.brand}"></div>
            <div class="device-choice-info">
              <div class="device-choice-name">${d.name}</div>
              <div class="device-choice-meta">${status} · prefers ${d.preferred_format}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
    </div>`;
  $('overlay').classList.add('show');
  $('modal-close').onclick = closeModal;
  $('modal-cancel').onclick = closeModal;
  modal.querySelectorAll('[data-device-id]').forEach(el => {
    if (!el.classList.contains('disabled')) {
      el.onclick = () => showTransferPreview(parseInt(el.dataset.deviceId));
    }
  });
}

function showTransferPreview(deviceId) {
  const device = state.devices.find(d => d.id === deviceId);
  const selBooks = Array.from(state.multiSel).map(id => state.books.find(b => b.id === id)).filter(Boolean);
  const modal = $('modal');
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">Send to ${device.name}</div>
        <div class="modal-sub">${selBooks.length} book${selBooks.length > 1 ? 's' : ''} · review before sending</div>
      </div>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-section-label">Books</div>
        ${selBooks.map(b => {
          const KINDLE_NATIVE = new Set(['MOBI', 'AZW3']);
          const targetFmt = (device.preferred_format || 'MOBI').toUpperCase();
          const needsConvert = device.brand === 'kindle' && !KINDLE_NATIVE.has(b.file_format);
          const badge = needsConvert
            ? `<span class="preview-status preview-convert">${b.file_format} → ${targetFmt}</span>`
            : `<span class="preview-status preview-ready">Ready</span>`;
          return `<div class="book-preview">
            <div class="preview-info">
              <div class="preview-title">${escapeHtml(b.title)}</div>
              <div class="preview-meta">${escapeHtml(b.author || '')} · ${b.file_format || ''}</div>
            </div>
            ${badge}
          </div>`;
        }).join('')}
      </div>
      ${device.brand === 'kindle' && device.kindle_email
      ? `<div class="transfer-options">
          <div class="transfer-opt" id="opt-usb">
            <div class="transfer-opt-title">Copy via USB</div>
            <div class="transfer-opt-meta">Device must be connected · EPUBs converted to MOBI</div>
          </div>
          <div class="transfer-opt" id="opt-email">
            <div class="transfer-opt-title">Send via email</div>
            <div class="transfer-opt-meta">To ${escapeHtml(device.kindle_email)}</div>
          </div>
        </div>`
      : ''}
    </div>
    <div class="modal-foot">
      <button class="btn-ghost" id="back-btn">Back</button>
      ${device.brand === 'kindle' && device.kindle_email
        ? `<button class="btn-primary" id="start-btn">Copy via USB</button>`
        : `<button class="btn-primary" id="start-btn">Start transfer</button>`}
    </div>`;
  $('modal-close').onclick = closeModal;
  $('back-btn').onclick = openSendModal;

  if (device.brand === 'kindle' && device.kindle_email) {
    const optUsb = $('opt-usb');
    const optEmail = $('opt-email');
    let useEmail = false;
    const startBtn = $('start-btn');
    const selectOpt = (email) => {
      useEmail = email;
      optUsb.classList.toggle('active', !email);
      optEmail.classList.toggle('active', email);
      startBtn.textContent = email ? 'Send via email' : 'Copy via USB';
    };
    selectOpt(false);
    optUsb.onclick = () => selectOpt(false);
    optEmail.onclick = () => selectOpt(true);
    startBtn.onclick = () => useEmail ? doEmailSend(deviceId) : doUsbSend(deviceId);
  } else {
    $('start-btn').onclick = () => doUsbSend(deviceId);
  }
}

async function doUsbSend(deviceId) {
  const btn = $('start-btn');
  btn.disabled = true; btn.textContent = 'Sending...';
  const result = await window.folio.devices.send(Array.from(state.multiSel), deviceId);
  handleSendResult(result, btn, 'Copy via USB');
}

async function doEmailSend(deviceId) {
  const btn = $('start-btn');
  btn.disabled = true; btn.textContent = 'Sending...';
  const result = await window.folio.kindle.sendEmail(Array.from(state.multiSel), deviceId);
  handleSendResult(result, btn, 'Send via email');
}

function handleSendResult(result, btn, originalLabel) {
  if (!result.ok) {
    $('modal').querySelector('.modal-body').insertAdjacentHTML('afterbegin', `<div class="err-banner">${result.error}</div>`);
    btn.disabled = false; btn.textContent = originalLabel;
    return;
  }
  btn.textContent = 'Done';
  btn.style.background = 'rgba(15,110,86,.3)';
  btn.style.color = '#5dcaa5';
  btn.style.borderColor = 'rgba(15,110,86,.4)';
  setTimeout(() => { closeModal(); state.multiSel.clear(); loadAll(); }, 1200);
}

function openDeviceConfig(id) {
  const d = state.devices.find(x => x.id === id);
  const isXteink = d.brand === 'xteink';
  const modal = $('modal');
  const subLine = isXteink
    ? (d.connected ? 'Reachable at ' + d.mount_path : d.mount_path ? 'Not reachable — enable WiFi Transfer on device' : 'No address configured')
    : (d.connected ? 'Connected at ' + d.mount_path : 'Not currently connected');
  const mountLabel = d.brand === 'kobo' ? 'Mount path (usually /Volumes/KOBOeReader)'
    : d.brand === 'kindle' ? 'Mount path (usually /Volumes/Kindle)'
    : isXteink ? 'Device address (IP or hostname)'
    : 'Mount path';
  const mountPlaceholder = isXteink ? 'crosspoint.local or 172.20.10.2' : '/Volumes/YourDevice';
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">${d.name}</div>
        <div class="modal-sub">${subLine}</div>
      </div>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-section-label">Device name</div>
        <input class="field-inp" id="d-name" value="${escapeHtml(d.name)}">
      </div>
      <div class="modal-section">
        <div class="modal-section-label">${mountLabel}</div>
        <input class="field-inp" id="d-mount" value="${escapeHtml(d.mount_path || '')}" placeholder="${mountPlaceholder}">
      </div>
      ${isXteink ? `
      <div class="modal-section">
        <div class="modal-section-label">Upload folder on device (leave blank for root)</div>
        <input class="field-inp" id="d-folder" value="${escapeHtml(d.books_folder || '')}" placeholder="/Books">
      </div>
      <div style="padding:10px 12px;background:rgba(201,150,42,.08);border:1px solid rgba(201,150,42,.25);border-radius:6px;font-size:12px;color:var(--text2);line-height:1.5">
        Folio sends books directly over WiFi using the CrossPoint transfer server.
        Enable WiFi Transfer on the device before sending.
      </div>` : `
      <div class="modal-section">
        <div class="modal-section-label">Books folder on device (leave blank for root)</div>
        <input class="field-inp" id="d-folder" value="${escapeHtml(d.books_folder || '')}" placeholder="documents, books, etc.">
      </div>`}
      <div class="modal-section">
        <div class="modal-section-label">Preferred format</div>
        <input class="field-inp" id="d-format" value="${escapeHtml(d.preferred_format || '')}">
      </div>
      ${d.brand === 'kindle' ? `
      <div class="modal-section">
        <div class="modal-section-label">Send-to-Kindle email</div>
        <input class="field-inp" id="d-email" value="${escapeHtml(d.kindle_email || '')}" placeholder="name_xxxxx@kindle.com">
      </div>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="save-device">Save</button>
    </div>`;
  $('overlay').classList.add('show');
  $('modal-close').onclick = closeModal;
  $('modal-cancel').onclick = closeModal;
  $('save-device').onclick = async () => {
    const updated = {
      id: d.id,
      name: $('d-name').value,
      mount_path: $('d-mount').value,
      books_folder: $('d-folder').value,
      preferred_format: $('d-format').value,
      kindle_email: d.brand === 'kindle' ? $('d-email').value : d.kindle_email
    };
    await window.folio.devices.update(updated);
    closeModal();
    await loadAll();
  };
}

async function openSettingsModal() {
  const settings = await window.folio.settings.get();
  const smtp = settings.smtp || {};
  const modal = $('modal');
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">Settings</div>
        <div class="modal-sub">SMTP credentials for Send-to-Kindle email</div>
      </div>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-section-label">SMTP host</div>
        <input class="field-inp" id="s-host" value="${escapeHtml(smtp.host || '')}" placeholder="smtp.gmail.com">
      </div>
      <div class="modal-section">
        <div class="modal-section-label">Port</div>
        <input class="field-inp" id="s-port" type="number" value="${smtp.port || 587}" placeholder="587">
      </div>
      <div class="modal-section" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="s-secure" ${smtp.secure ? 'checked' : ''}>
        <label for="s-secure" style="font-size:12px;color:var(--text2);cursor:pointer">Use TLS (port 465)</label>
      </div>
      <div class="modal-section">
        <div class="modal-section-label">Username (your email address)</div>
        <input class="field-inp" id="s-user" type="email" value="${escapeHtml(smtp.user || '')}" placeholder="you@gmail.com">
      </div>
      <div class="modal-section">
        <div class="modal-section-label">Password / app password</div>
        <input class="field-inp" id="s-pass" type="password" value="${escapeHtml(smtp.password || '')}" placeholder="••••••••••••••••">
      </div>
      <div style="padding:10px 12px;background:rgba(201,150,42,.08);border:1px solid rgba(201,150,42,.25);border-radius:6px;font-size:12px;color:var(--text2);line-height:1.5">
        The sender address must be on your Kindle's approved email list at amazon.com/myk.
        For Gmail, use an App Password — not your account password.
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="save-settings">Save</button>
    </div>`;
  $('overlay').classList.add('show');
  $('modal-close').onclick = closeModal;
  $('modal-cancel').onclick = closeModal;
  $('save-settings').onclick = async () => {
    const data = {
      smtp: {
        host: $('s-host').value.trim(),
        port: parseInt($('s-port').value) || 587,
        secure: $('s-secure').checked,
        user: $('s-user').value.trim(),
        password: $('s-pass').value
      }
    };
    await window.folio.settings.set(data);
    closeModal();
  };
}

function closeModal() {
  $('overlay').classList.remove('show');
}

$('import-btn').onclick = async () => {
  const btn = $('import-btn');
  const original = btn.textContent;
  btn.textContent = 'Importing...';
  btn.disabled = true;
  const result = await window.folio.books.import();
  btn.textContent = original;
  btn.disabled = false;
  if (result.imported > 0) await loadAll();
};

$('settings-btn').onclick = openSettingsModal;
$('search').oninput = renderBooks;
$('sort-sel').onchange = renderBooks;
$('btn-grid').onclick = () => setView('grid');
$('btn-list').onclick = () => setView('list');
$('send-btn').onclick = openSendModal;
$('clear-sel').onclick = () => { state.multiSel.clear(); renderBooks(); };

const EBOOK_EXTS = new Set(['epub', 'mobi', 'azw3', 'pdf']);
let dragDepth = 0;

document.addEventListener('dragenter', e => {
  if ([...e.dataTransfer.items].some(i => i.kind === 'file')) {
    if (++dragDepth === 1) $('drop-overlay').classList.add('show');
  }
});

document.addEventListener('dragleave', () => {
  if (--dragDepth === 0) $('drop-overlay').classList.remove('show');
});

document.addEventListener('dragover', e => e.preventDefault());

document.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').classList.remove('show');
  const paths = [...e.dataTransfer.files]
    .map(f => f.path)
    .filter(p => p && EBOOK_EXTS.has(p.split('.').pop().toLowerCase()));
  if (!paths.length) return;
  const result = await window.folio.books.importPaths(paths);
  if (result.imported > 0) await loadAll();
});

setInterval(async () => {
  const before = JSON.stringify(state.devices.map(d => [d.id, d.connected]));
  state.devices = await window.folio.devices.list();
  const after = JSON.stringify(state.devices.map(d => [d.id, d.connected]));
  if (before !== after) renderSidebar();
}, 5000);

loadAll();
