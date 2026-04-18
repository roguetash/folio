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
  sendTarget: null,
  sendingTo: null,
  activeDevice: null,
  deviceBooks: new Set()
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
    const isActive = state.activeDevice === d.id;
    const cls = (d.connected ? ' connected' : '') + (isActive ? ' active' : '');
    const krTag = d.uses_koreader ? ' · KOReader' : '';
    const status = d.brand === 'xteink'
      ? (d.connected ? 'Reachable over WiFi' : 'Not reachable — enable WiFi Transfer')
      : (d.connected ? `Connected${krTag}` : 'Disconnected');
    const countBadge = isActive && state.deviceBooks.size > 0
      ? `<span class="device-book-count">${state.deviceBooks.size}</span>` : '';
    const viewBtn = isActive && d.connected
      ? `<button class="device-view-btn" data-view="${d.id}" title="View device library">↕</button>` : '';
    return `<div class="device-item${cls}" data-device="${d.id}">
      <div class="device-ind"></div>
      <div class="device-info">
        <div class="device-name">${d.name}${countBadge}</div>
        <div class="device-status">${isActive ? `Showing ${state.deviceBooks.size} book${state.deviceBooks.size !== 1 ? 's' : ''} on device` : status}</div>
      </div>
      ${viewBtn}
      <button class="device-cfg-btn" data-cfg="${d.id}" title="Configure">⚙</button>
    </div>`;
  }).join('') + `<button class="add-device-btn" id="add-device-btn">+ Add device</button>`;

  $('device-list').querySelectorAll('.device-item').forEach(el => {
    el.onclick = e => {
      if (e.target.dataset.cfg) return;
      toggleActiveDevice(parseInt(el.dataset.device));
    };
  });
  $('device-list').querySelectorAll('.device-cfg-btn').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); openDeviceConfig(parseInt(btn.dataset.cfg)); };
  });
  $('device-list').querySelectorAll('.device-view-btn').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); openDeviceLibraryModal(parseInt(btn.dataset.view)); };
  });
  const addBtn = $('add-device-btn');
  if (addBtn) addBtn.onclick = openAddDeviceModal;
}

async function toggleActiveDevice(id) {
  if (state.activeDevice === id) {
    state.activeDevice = null;
    state.deviceBooks = new Set();
    renderSidebar(); renderBooks();
    return;
  }
  state.activeDevice = id;
  state.deviceBooks = new Set();
  renderSidebar();
  const r = await window.folio.devices.scanBooks(id);
  if (r.ok) state.deviceBooks = new Set(r.bookIds);
  renderSidebar(); renderBooks();
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
  const activeDeviceName = state.activeDevice
    ? (state.devices.find(d => d.id === state.activeDevice) || {}).name || ''
    : '';
  if (state.view === 'grid') {
    el.innerHTML = `<div class="grid">${list.map(b => {
      const onDevice = state.activeDevice && state.deviceBooks.has(b.id);
      return `
      <div class="book-card${state.selected === b.id ? ' selected' : ''}${state.multiSel.has(b.id) ? ' multi-sel' : ''}${onDevice ? ' on-device' : ''}" data-id="${b.id}">
        <div class="multi-check" data-check="${b.id}">✓</div>
        <span class="format-badge">${b.file_format || ''}</span>
        ${onDevice ? `<span class="device-badge" title="On ${escapeHtml(activeDeviceName)}">📖</span>` : ''}
        <div class="book-spine" style="${bookSpineStyle(b)}">
          <div style="position:absolute;inset:0;background:linear-gradient(160deg,rgba(0,0,0,.1) 0%,transparent 50%,rgba(0,0,0,.5) 100%)"></div>
          ${!b.cover_path ? `<div class="book-spine-title">${escapeHtml(b.title)}</div>` : ''}
        </div>
        <div class="book-info">
          <div class="book-title">${escapeHtml(b.title)}</div>
          <div class="book-author">${escapeHtml(b.author || 'Unknown author')}</div>
          <div class="book-meta">${statusBadge(b.status)}<span class="book-rating">${stars(b.rating)}</span></div>
        </div>
      </div>`;
    }).join('')}</div>`;
  } else {
    el.innerHTML = `<div class="list-view">${list.map(b => {
      const onDevice = state.activeDevice && state.deviceBooks.has(b.id);
      return `
      <div class="list-row${state.selected === b.id ? ' selected' : ''}${state.multiSel.has(b.id) ? ' multi-sel' : ''}${onDevice ? ' on-device' : ''}" data-id="${b.id}">
        <div class="list-check" data-check="${b.id}">✓</div>
        <div class="list-title">${escapeHtml(b.title)}</div>
        <div class="list-author">${escapeHtml(b.author || '—')}</div>
        <div class="list-series">${escapeHtml(b.series || '')}</div>
        <div class="list-format">${b.file_format || ''}</div>
        <div class="list-rating">${stars(b.rating)}</div>
        ${statusBadge(b.status)}
        ${onDevice ? `<span class="device-badge-list" title="On ${escapeHtml(activeDeviceName)}">on device</span>` : ''}
      </div>`;
    }).join('')}</div>`;
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
  let currentSendFolder = device.books_folder || '/';
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
      <div class="modal-section" id="folder-section">
        <div class="modal-section-label">Destination folder${device.uses_koreader ? ' · KOReader organizes books by folder' : ''}</div>
        <div id="folder-picker"><div class="folder-loading">Loading...</div></div>
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

  async function renderFolderPicker(browsePath) {
    currentSendFolder = browsePath || '/';
    const el = $('folder-picker');
    if (!el) return;
    el.innerHTML = `<div class="folder-loading">Loading...</div>`;
    const r = await window.folio.devices.listFolders(deviceId, browsePath);
    const folders = (r.ok ? r.folders : []);
    const parts = (browsePath || '/').replace(/^\/+/, '').split('/').filter(Boolean);
    const crumbs = [{ label: '/', path: '/' }];
    let acc = '';
    for (const p of parts) { acc += '/' + p; crumbs.push({ label: p, path: acc }); }
    el.innerHTML = `
      <div class="folder-crumb">
        ${crumbs.map((c, i) => `<span class="folder-crumb-seg${i === crumbs.length - 1 ? ' active' : ''}" data-ci="${i}">${escapeHtml(c.label)}</span>`).join('<span class="folder-crumb-sep">›</span>')}
      </div>
      <div class="folder-list">
        ${folders.length
          ? folders.map((f, i) => `<div class="folder-item" data-fi="${i}">${escapeHtml(f)}</div>`).join('')
          : `<div class="folder-empty">${r.ok ? 'No subfolders — books go here' : r.error || 'Could not load folders'}</div>`}
      </div>`;
    el.querySelectorAll('.folder-item').forEach(item => {
      item.onclick = () => {
        const f = folders[parseInt(item.dataset.fi)];
        renderFolderPicker(browsePath === '/' ? `/${f}` : `${browsePath}/${f}`);
      };
    });
    el.querySelectorAll('.folder-crumb-seg:not(.active)').forEach(seg => {
      seg.onclick = () => renderFolderPicker(crumbs[parseInt(seg.dataset.ci)].path);
    });
  }

  renderFolderPicker(currentSendFolder);

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
      const folderSection = $('folder-section');
      if (folderSection) folderSection.style.display = email ? 'none' : '';
    };
    selectOpt(false);
    optUsb.onclick = () => selectOpt(false);
    optEmail.onclick = () => selectOpt(true);
    startBtn.onclick = () => useEmail ? doEmailSend(deviceId) : doUsbSend(deviceId, currentSendFolder);
  } else {
    $('start-btn').onclick = () => doUsbSend(deviceId, currentSendFolder);
  }
}

function startTransferUI(count, deviceName) {
  const modal = $('modal');
  if (!modal) return;
  const closeBtn = modal.querySelector('#modal-close');
  if (closeBtn) closeBtn.style.pointerEvents = 'none';
  const body = modal.querySelector('.modal-body');
  const foot = modal.querySelector('.modal-foot');
  const needsConvert = Array.from(state.multiSel).some(id => {
    const b = state.books.find(x => x.id === id);
    const d = state.devices.find(x => x.id === state.sendTarget);
    return d && d.brand === 'kindle' && b && !new Set(['MOBI','AZW3']).has(b.file_format);
  });
  if (body) body.innerHTML = `
    <div class="transfer-in-progress">
      <div class="tip-bar-wrap"><div class="tip-bar"></div></div>
      <div class="tip-label">Sending ${count} book${count !== 1 ? 's' : ''} to ${escapeHtml(deviceName)}</div>
      <div class="tip-sub">${needsConvert ? 'Converting format — this may take a minute...' : 'Copying files to device...'}</div>
    </div>`;
  if (foot) foot.innerHTML = '';
}

async function doUsbSend(deviceId, folderOverride) {
  const device = state.devices.find(d => d.id === deviceId);
  state.sendTarget = deviceId;
  startTransferUI(state.multiSel.size, device.name);
  const result = await window.folio.devices.send(Array.from(state.multiSel), deviceId, folderOverride);
  handleSendResult(result, device.name);
}

async function doEmailSend(deviceId) {
  const device = state.devices.find(d => d.id === deviceId);
  state.sendTarget = deviceId;
  startTransferUI(state.multiSel.size, device.name);
  const result = await window.folio.kindle.sendEmail(Array.from(state.multiSel), deviceId);
  handleSendResult(result, device.name);
}

function handleSendResult(result, deviceName) {
  closeModal();
  state.multiSel.clear();
  state.sendTarget = null;

  if (!result.ok) {
    showToast('error', result.error || 'Transfer failed');
    loadAll();
    return;
  }

  const results = result.results || [];
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);

  if (succeeded > 0) {
    showToast('success', `${succeeded} book${succeeded !== 1 ? 's' : ''} sent to ${escapeHtml(deviceName)}`);
  }
  failed.forEach(f => {
    const book = state.books.find(b => b.id === f.id);
    showToast('error', `${escapeHtml(book ? book.title : 'Book')}: ${escapeHtml(f.error || 'Unknown error')}`);
  });
  if (succeeded === 0 && failed.length === 0) {
    showToast('info', 'Nothing was transferred.');
  }

  loadAll();
}

function showToast(type, message) {
  const stack = $('toast-stack');
  if (!stack) return;
  const duration = type === 'error' ? 8000 : 4500;
  const icons = { success: '✓', error: '✕', info: '↗' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type] || '·'}</span><span class="toast-msg">${escapeHtml(message)}</span><button class="toast-close">✕</button>`;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const dismiss = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 320); };
  t.querySelector('.toast-close').onclick = dismiss;
  setTimeout(dismiss, duration);
}

async function openDeviceLibraryModal(deviceId) {
  const device = state.devices.find(d => d.id === deviceId);
  if (!device) return;
  const modal = $('modal');

  const renderModal = async () => {
    modal.innerHTML = `
      <div class="modal-head">
        <div>
          <div class="modal-title">Device library · ${escapeHtml(device.name)}</div>
          <div class="modal-sub" id="dl-sub">Scanning device…</div>
        </div>
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <div class="modal-body" id="dl-body" style="padding:0">
        <div class="folder-loading" style="padding:24px">Scanning…</div>
      </div>
      <div class="modal-foot" id="dl-foot" style="display:none"></div>`;
    $('overlay').classList.add('show');
    $('modal-close').onclick = closeModal;

    const r = await window.folio.devices.listBooks(deviceId);
    if (!r.ok) {
      $('dl-sub').textContent = r.error || 'Could not scan device';
      $('dl-body').innerHTML = `<div class="folder-empty" style="padding:24px">${escapeHtml(r.error || 'Unknown error')}</div>`;
      return;
    }

    const books = r.books;
    $('dl-sub').textContent = `${books.length} book${books.length !== 1 ? 's' : ''} on device`;

    let filter = 'all';
    let selected = new Set();

    const render = () => {
      const visible = books.filter(b => {
        if (filter === 'matched') return !!b.localBookId;
        if (filter === 'unmatched') return !b.localBookId;
        return true;
      });

      $('dl-body').innerHTML = `
        <div class="dl-toolbar">
          <div class="dl-filters">
            <button class="dl-filter-btn${filter === 'all' ? ' active' : ''}" data-f="all">All (${books.length})</button>
            <button class="dl-filter-btn${filter === 'matched' ? ' active' : ''}" data-f="matched">In library (${books.filter(b => b.localBookId).length})</button>
            <button class="dl-filter-btn${filter === 'unmatched' ? ' active' : ''}" data-f="unmatched">Not in library (${books.filter(b => !b.localBookId).length})</button>
          </div>
          <div class="dl-sel-actions">
            <button class="dl-sel-btn" id="dl-sel-all">Select all</button>
            <button class="dl-sel-btn" id="dl-sel-none">Deselect</button>
          </div>
        </div>
        <div class="dl-list">
          ${visible.map((b, i) => {
            const isSelected = selected.has(b.devicePath);
            const title = b.localBook ? escapeHtml(b.localBook.title) : escapeHtml(b.filename);
            const author = b.localBook ? escapeHtml(b.localBook.author || '') : '';
            const folder = b.folder !== '/' ? `<span class="dl-folder">${escapeHtml(b.folder)}</span>` : '';
            const matchBadge = b.localBookId
              ? `<span class="dl-badge dl-badge-in">in library</span>`
              : `<span class="dl-badge dl-badge-out">not in library</span>`;
            const importBtn = !b.localBookId
              ? `<button class="dl-action-btn dl-import" data-path="${escapeHtml(b.devicePath)}" title="Import to Folio library">↓ Library</button>` : '';
            const exportBtn = `<button class="dl-action-btn dl-export" data-path="${escapeHtml(b.devicePath)}" title="Export to folder">↑ Export</button>`;
            const removeBtn = `<button class="dl-action-btn dl-remove" data-path="${escapeHtml(b.devicePath)}" title="Remove from device">🗑</button>`;
            return `<div class="dl-row${isSelected ? ' selected' : ''}" data-path="${escapeHtml(b.devicePath)}">
              <div class="dl-check${isSelected ? ' checked' : ''}" data-chk="${escapeHtml(b.devicePath)}">✓</div>
              <div class="dl-info">
                <div class="dl-title">${title}${folder}</div>
                ${author ? `<div class="dl-author">${author}</div>` : ''}
              </div>
              ${matchBadge}
              <div class="dl-actions">${importBtn}${exportBtn}${removeBtn}</div>
            </div>`;
          }).join('')}
          ${visible.length === 0 ? `<div class="folder-empty" style="padding:20px">No books match this filter</div>` : ''}
        </div>`;

      const foot = $('dl-foot');
      if (selected.size > 0) {
        foot.style.display = 'flex';
        const canImport = [...selected].some(p => {
          const b = books.find(x => x.devicePath === p);
          return b && !b.localBookId;
        });
        foot.innerHTML = `
          <span style="font-size:12px;color:var(--text2);margin-right:auto">${selected.size} selected</span>
          ${canImport ? `<button class="btn-ghost" id="dl-bulk-import">↓ Import to library</button>` : ''}
          <button class="btn-ghost" id="dl-bulk-export">↑ Export to folder</button>
          <button class="danger-btn" id="dl-bulk-remove" style="width:auto;margin:0">Remove from device</button>`;

        if (canImport) {
          $('dl-bulk-import').onclick = async () => {
            const paths = [...selected].filter(p => books.find(x => x.devicePath === p && !x.localBookId));
            let imported = 0;
            for (const p of paths) {
              const r = await window.folio.devices.importFromDevice(p);
              if (r && r.imported) imported += r.imported;
            }
            selected.clear();
            showToast('success', `Imported ${imported} book${imported !== 1 ? 's' : ''}`);
            await loadAll();
            await renderModal();
          };
        }
        $('dl-bulk-export').onclick = async () => {
          const paths = [...selected];
          const r = await window.folio.devices.exportBooks(paths);
          if (r.canceled) return;
          if (r.ok) showToast('success', `Exported ${r.exported} book${r.exported !== 1 ? 's' : ''} to ${r.destDir.split('/').pop()}`);
          else showToast('error', 'Export failed');
        };
        $('dl-bulk-remove').onclick = async () => {
          if (!confirm(`Remove ${selected.size} book${selected.size !== 1 ? 's' : ''} from device? This cannot be undone.`)) return;
          let removed = 0;
          for (const p of [...selected]) {
            const r = await window.folio.devices.removeBook(deviceId, p);
            if (r.ok) removed++;
          }
          selected.clear();
          showToast('success', `Removed ${removed} book${removed !== 1 ? 's' : ''} from device`);
          if (state.activeDevice === deviceId) {
            const scan = await window.folio.devices.scanBooks(deviceId);
            if (scan.ok) state.deviceBooks = new Set(scan.bookIds);
          }
          await loadAll();
          await renderModal();
        };
      } else {
        foot.style.display = 'none';
      }

      $('dl-body').querySelectorAll('.dl-filter-btn').forEach(btn => {
        btn.onclick = () => { filter = btn.dataset.f; render(); };
      });
      $('dl-sel-all') && ($('dl-sel-all').onclick = () => {
        visible.forEach(b => selected.add(b.devicePath));
        render();
      });
      $('dl-sel-none') && ($('dl-sel-none').onclick = () => { selected.clear(); render(); });

      $('dl-body').querySelectorAll('.dl-check').forEach(el => {
        el.onclick = e => {
          e.stopPropagation();
          const p = el.dataset.chk;
          if (selected.has(p)) selected.delete(p); else selected.add(p);
          render();
        };
      });
      $('dl-body').querySelectorAll('.dl-import').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          btn.textContent = 'Importing…';
          btn.disabled = true;
          const r = await window.folio.devices.importFromDevice(btn.dataset.path);
          if (r && r.imported) {
            showToast('success', 'Imported to library');
            await loadAll();
            await renderModal();
          } else {
            btn.textContent = '↓ Import';
            btn.disabled = false;
          }
        };
      });
      $('dl-body').querySelectorAll('.dl-export').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          btn.textContent = '…'; btn.disabled = true;
          const r = await window.folio.devices.exportBooks([btn.dataset.path]);
          btn.textContent = '↑ Export'; btn.disabled = false;
          if (!r.canceled) {
            if (r.ok && r.exported) showToast('success', `Saved to ${r.destDir.split('/').pop()}`);
            else if (r.errors && r.errors.length) showToast('error', r.errors[0].error);
          }
        };
      });
      $('dl-body').querySelectorAll('.dl-remove').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          if (!confirm(`Remove "${escapeHtml(btn.closest('.dl-row').querySelector('.dl-title').textContent)}" from device?`)) return;
          btn.textContent = '…';
          btn.disabled = true;
          const r = await window.folio.devices.removeBook(deviceId, btn.dataset.path);
          if (r.ok) {
            showToast('success', 'Removed from device');
            if (state.activeDevice === deviceId) {
              const scan = await window.folio.devices.scanBooks(deviceId);
              if (scan.ok) { state.deviceBooks = new Set(scan.bookIds); renderSidebar(); renderBooks(); }
            }
            await loadAll();
            await renderModal();
          } else {
            showToast('error', r.error || 'Failed to remove');
            btn.textContent = '🗑'; btn.disabled = false;
          }
        };
      });
    };

    render();
  };

  renderModal();
}

function openAddDeviceModal() {
  const modal = $('modal');
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">Add device</div>
        <div class="modal-sub">Connect a new reader to your library</div>
      </div>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-section">
        <div class="modal-section-label">Device type</div>
        <div class="device-type-row">
          <button class="device-type-btn active" data-brand="kobo">Kobo</button>
          <button class="device-type-btn" data-brand="kindle">Kindle</button>
          <button class="device-type-btn" data-brand="xteink">Xteink</button>
          <button class="device-type-btn" data-brand="other">Other</button>
        </div>
      </div>
      <div class="modal-section">
        <div class="modal-section-label">Device name</div>
        <input class="field-inp" id="nd-name" value="My Kobo" placeholder="e.g. Kobo Libra 2">
      </div>
      <div class="modal-section" id="nd-mount-section">
        <div class="modal-section-label" id="nd-mount-label">Mount path (usually /Volumes/KOBOeReader)</div>
        <input class="field-inp" id="nd-mount" value="/Volumes/KOBOeReader" placeholder="/Volumes/YourDevice">
      </div>
      <div class="modal-section">
        <div class="modal-section-label">Books folder on device (leave blank for root)</div>
        <input class="field-inp" id="nd-folder" value="" placeholder="documents, books, etc.">
      </div>
      <div class="modal-section">
        <div class="modal-section-label">Preferred format</div>
        <input class="field-inp" id="nd-format" value="KEPUB" placeholder="EPUB, KEPUB, MOBI…">
      </div>
      <div class="modal-section" id="nd-email-section" style="display:none">
        <div class="modal-section-label">Send-to-Kindle email</div>
        <input class="field-inp" id="nd-email" placeholder="name_xxxxx@kindle.com">
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="add-device-save">Add device</button>
    </div>`;
  $('overlay').classList.add('show');
  $('modal-close').onclick = closeModal;
  $('modal-cancel').onclick = closeModal;

  const BRAND_DEFAULTS = {
    kobo:   { name: 'My Kobo',   mount: '/Volumes/KOBOeReader', format: 'KEPUB', mountLabel: 'Mount path (usually /Volumes/KOBOeReader)' },
    kindle: { name: 'My Kindle', mount: '/Volumes/Kindle',      format: 'MOBI',  mountLabel: 'Mount path (usually /Volumes/Kindle)' },
    xteink: { name: 'Xteink X4', mount: '',                     format: 'EPUB',  mountLabel: 'Device address (IP or hostname)' },
    other:  { name: 'My Reader', mount: '/Volumes/EReader',     format: 'EPUB',  mountLabel: 'Mount path' }
  };

  let selectedBrand = 'kobo';
  modal.querySelectorAll('.device-type-btn').forEach(btn => {
    btn.onclick = () => {
      modal.querySelectorAll('.device-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedBrand = btn.dataset.brand;
      const def = BRAND_DEFAULTS[selectedBrand];
      $('nd-name').value = def.name;
      $('nd-mount').value = def.mount;
      $('nd-format').value = def.format;
      $('nd-mount-label').textContent = def.mountLabel;
      $('nd-email-section').style.display = selectedBrand === 'kindle' ? '' : 'none';
    };
  });

  $('add-device-save').onclick = async () => {
    const name = $('nd-name').value.trim();
    if (!name) { $('nd-name').focus(); return; }
    await window.folio.devices.add({
      name,
      brand: selectedBrand,
      mount_path: $('nd-mount').value.trim(),
      books_folder: $('nd-folder').value.trim(),
      preferred_format: $('nd-format').value.trim() || 'EPUB',
      kindle_email: selectedBrand === 'kindle' ? $('nd-email').value.trim() : ''
    });
    closeModal();
    await loadAll();
  };
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
      ${!isXteink ? `
      <div class="modal-section" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="d-koreader" ${d.uses_koreader ? 'checked' : ''}>
        <label for="d-koreader" style="font-size:12px;color:var(--text2);cursor:pointer">This device runs KOReader</label>
      </div>
      ${d.uses_koreader && d.connected ? `
      <div style="padding:10px 12px;background:rgba(93,202,165,.06);border:1px solid rgba(93,202,165,.2);border-radius:6px;font-size:12px;color:var(--text2);line-height:1.5">
        KOReader stores reading progress in <code>.sdr</code> folders next to each book.
        After reading on device, sync to update Folio's progress bars.
      </div>
      <button class="secondary-btn" id="sync-koreader-btn" style="margin-top:4px">Sync reading progress</button>` : ''}` : ''}
    </div>
    <div class="modal-foot">
      <button class="danger-btn" id="remove-device" style="width:auto;margin-top:0;margin-right:auto">Remove device</button>
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
      kindle_email: d.brand === 'kindle' ? $('d-email').value : d.kindle_email,
      uses_koreader: $('d-koreader') ? $('d-koreader').checked : d.uses_koreader
    };
    await window.folio.devices.update(updated);
    closeModal();
    await loadAll();
  };
  $('remove-device').onclick = async () => {
    if (!confirm(`Remove "${d.name}" from Folio? This won't affect files on the device.`)) return;
    await window.folio.devices.delete(d.id);
    if (state.activeDevice === d.id) { state.activeDevice = null; state.deviceBooks = new Set(); }
    closeModal();
    await loadAll();
  };
  const syncBtn = $('sync-koreader-btn');
  if (syncBtn) {
    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';
      const r = await window.folio.devices.syncKoreader(d.id);
      if (r.ok) {
        syncBtn.textContent = `Synced ${r.updated} book${r.updated !== 1 ? 's' : ''}`;
        setTimeout(() => { syncBtn.textContent = 'Sync reading progress'; syncBtn.disabled = false; }, 2000);
        await loadAll();
      } else {
        syncBtn.textContent = r.error;
        setTimeout(() => { syncBtn.textContent = 'Sync reading progress'; syncBtn.disabled = false; }, 2500);
      }
    };
  }
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
      <div style="padding:10px 12px;background:rgba(255,105,180,.06);border:1px solid rgba(255,105,180,.15);border-radius:8px;font-size:12px;color:var(--text2);line-height:1.5">
        The sender address must be on your Kindle's approved email list at amazon.com/myk.
        For Gmail, use an App Password — not your account password.
      </div>
      <div class="modal-section" style="border-top:1px solid var(--ink3);padding-top:18px;margin-top:4px">
        <div class="modal-section-label">Library</div>
        <button class="secondary-btn" id="find-dupes-btn" style="width:100%;text-align:left;padding:9px 12px;border-radius:10px">Find &amp; remove duplicates</button>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="save-settings">Save</button>
    </div>`;
  $('overlay').classList.add('show');
  $('modal-close').onclick = closeModal;
  $('modal-cancel').onclick = closeModal;
  $('find-dupes-btn').onclick = () => { closeModal(); openDuplicatesModal(); };
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

async function openDuplicatesModal() {
  const modal = $('modal');
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">Find duplicates</div>
        <div class="modal-sub">Scanning your library...</div>
      </div>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="modal-body"><div class="folder-loading">Scanning...</div></div>`;
  $('overlay').classList.add('show');
  $('modal-close').onclick = closeModal;

  const groups = await window.folio.books.findDuplicates();
  renderDuplicatesModal(groups);
}

function renderDuplicatesModal(groups) {
  const modal = $('modal');
  if (!groups.length) {
    modal.innerHTML = `
      <div class="modal-head">
        <div>
          <div class="modal-title">Find duplicates</div>
          <div class="modal-sub">No duplicates found</div>
        </div>
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <div style="text-align:center;padding:32px 20px;color:var(--mint);font-size:14px;font-weight:600">
          ✓ Your library is clean
        </div>
      </div>
      <div class="modal-foot"><button class="btn-ghost" id="modal-cancel">Close</button></div>`;
    $('modal-close').onclick = closeModal;
    $('modal-cancel').onclick = closeModal;
    return;
  }

  const typeLabel = { exact: 'Exact file copy', title_author: 'Same title & author' };
  modal.innerHTML = `
    <div class="modal-head">
      <div>
        <div class="modal-title">Find duplicates</div>
        <div class="modal-sub">${groups.length} group${groups.length !== 1 ? 's' : ''} found</div>
      </div>
      <button class="modal-close" id="modal-close">✕</button>
    </div>
    <div class="modal-body">
      ${groups.map((g, gi) => `
        <div class="dupe-group" data-gi="${gi}">
          <div class="dupe-group-label">${typeLabel[g.type] || g.type}</div>
          ${g.books.map(b => `
            <div class="dupe-item" data-book-id="${b.id}">
              <div class="dupe-cover" style="${bookSpineStyle(b)}"></div>
              <div class="dupe-info">
                <div class="dupe-title-sm">${escapeHtml(b.title)}</div>
                <div class="dupe-meta-sm">${b.file_format || ''} · ${b.file_size ? Math.round(b.file_size / 1024) + ' KB' : '?'} · Added ${(b.date_added || '').slice(0, 10)}</div>
              </div>
              <button class="dupe-remove-btn" data-book-id="${b.id}">Remove</button>
            </div>`).join('')}
        </div>`).join('')}
    </div>
    <div class="modal-foot">
      <button class="btn-ghost" id="modal-cancel">Done</button>
    </div>`;

  $('modal-close').onclick = closeModal;
  $('modal-cancel').onclick = closeModal;

  modal.querySelectorAll('.dupe-remove-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.bookId);
      btn.disabled = true; btn.textContent = 'Removing...';
      await window.folio.books.delete(id);
      await loadAll();

      // Remove this item from the modal; if group has 1 left, remove group too
      const item = btn.closest('.dupe-item');
      const group = btn.closest('.dupe-group');
      item.remove();
      if (group.querySelectorAll('.dupe-item').length < 2) group.remove();

      // Update subtitle count
      const remaining = modal.querySelectorAll('.dupe-group').length;
      const sub = modal.querySelector('.modal-sub');
      if (sub) sub.textContent = remaining ? `${remaining} group${remaining !== 1 ? 's' : ''} found` : 'All resolved';
      if (!remaining) {
        modal.querySelector('.modal-body').innerHTML = `
          <div style="text-align:center;padding:32px 20px;color:var(--mint);font-size:14px;font-weight:600">✓ All duplicates resolved</div>`;
      }
    };
  });
}

function importResultToast(result) {
  const parts = [];
  if (result.imported > 0) parts.push(`${result.imported} book${result.imported !== 1 ? 's' : ''} imported`);
  if (result.skipped && result.skipped.length > 0) parts.push(`${result.skipped.length} skipped — already in library`);
  if (parts.length) showToast(result.imported > 0 ? 'success' : 'info', parts.join(' · '));
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
  importResultToast(result);
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
  importResultToast(result);
});

setInterval(async () => {
  const before = JSON.stringify(state.devices.map(d => [d.id, d.connected]));
  state.devices = await window.folio.devices.list();
  const after = JSON.stringify(state.devices.map(d => [d.id, d.connected]));
  if (before !== after) renderSidebar();
}, 5000);

loadAll();
