const STORAGE_KEYS = { BATCH: 'captureBatch', DEDUPE: 'dedupeOnCapture' };

function normalizeForDedupe(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function setStatus(msg, isError) {
  const el = document.getElementById('status-msg');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('visible', !!msg);
  el.classList.toggle('error', !!isError);
  if (msg) setTimeout(() => { el.textContent = ''; el.classList.remove('visible', 'error'); }, 2000);
}

function renderCount(batch) {
  const n = Array.isArray(batch) ? batch.length : 0;
  const el = document.getElementById('count');
  if (el) el.textContent = n === 1 ? '1 reference collected' : n + ' references collected';
}

function renderList(batch, dedupe) {
  const listEl = document.getElementById('capture-list');
  if (!listEl) return;
  const items = Array.isArray(batch) ? batch : [];
  if (items.length === 0) {
    listEl.innerHTML = '';
    return;
  }
  const seen = new Set();
  const duplicates = new Set();
  if (dedupe) {
    items.forEach((text, i) => {
      const n = normalizeForDedupe(text);
      if (seen.has(n)) duplicates.add(i);
      else seen.add(n);
    });
  }
  listEl.innerHTML = items
    .map((text, i) => {
      const safe = escapeHtml(text.trim() || '(empty)');
      const dupClass = duplicates.has(i) ? ' duplicate' : '';
      return `<div class="capture-item${dupClass}" data-index="${i}">
        <span class="num">${i + 1}.</span>
        <span class="item-preview">${safe}</span>
        <span class="item-full">${safe}</span>
        <div class="item-actions">
          <button type="button" class="item-copy" data-action="copy" data-index="${i}" data-tooltip="Copy this reference">Copy</button>
          <button type="button" class="item-remove" data-action="remove" data-index="${i}" data-tooltip="Remove from batch">Remove</button>
        </div>
      </div>`;
    })
    .join('');
}

function load() {
  chrome.storage.local.get([STORAGE_KEYS.BATCH, STORAGE_KEYS.DEDUPE], (data) => {
    const batch = data[STORAGE_KEYS.BATCH];
    const dedupe = data[STORAGE_KEYS.DEDUPE];
    renderCount(batch);
    renderList(batch, dedupe === true);
    const dedupeEl = document.getElementById('dedupe');
    if (dedupeEl) dedupeEl.checked = dedupe === true;
  });
}

document.getElementById('dedupe').addEventListener('change', (e) => {
  chrome.storage.local.set({ [STORAGE_KEYS.DEDUPE]: e.target.checked });
  chrome.storage.local.get([STORAGE_KEYS.BATCH], (data) => {
    renderList(data[STORAGE_KEYS.BATCH], e.target.checked);
  });
});

document.getElementById('capture-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action][data-index]');
  if (!btn) {
    const item = e.target.closest('.capture-item');
    if (item) item.classList.toggle('expanded');
    return;
  }
  const action = btn.getAttribute('data-action');
  const index = parseInt(btn.getAttribute('data-index'), 10);
  const data = await chrome.storage.local.get([STORAGE_KEYS.BATCH]);
  let batch = Array.isArray(data[STORAGE_KEYS.BATCH]) ? data[STORAGE_KEYS.BATCH] : [];
  if (index < 0 || index >= batch.length) return;
  if (action === 'copy') {
    const text = (batch[index] || '').trim();
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied', false);
    } catch {
      setStatus('Copy failed', true);
    }
  } else if (action === 'remove') {
    batch = batch.slice(0, index).concat(batch.slice(index + 1));
    await chrome.storage.local.set({ [STORAGE_KEYS.BATCH]: batch });
    renderCount(batch);
    renderList(batch, document.getElementById('dedupe').checked);
  }
});

document.getElementById('open').addEventListener('click', () => {
  chrome.storage.local.get([STORAGE_KEYS.BATCH], (data) => {
    const batch = Array.isArray(data[STORAGE_KEYS.BATCH]) ? data[STORAGE_KEYS.BATCH] : [];
    if (batch.length === 0) return;
    const btn = document.getElementById('open');
    const origOpen = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending…';
    chrome.runtime.sendMessage({ type: 'openAndInject', batch }, (res) => {
      btn.disabled = false;
      btn.textContent = res && res.ok ? 'Sent' : 'Failed to send';
      if (res && res.ok) {
        renderCount([]);
        renderList([], false);
      }
      setTimeout(() => { btn.textContent = origOpen; }, 2000);
      if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
    });
  });
});

document.getElementById('copy').addEventListener('click', async () => {
  const data = await chrome.storage.local.get([STORAGE_KEYS.BATCH]);
  const batch = Array.isArray(data[STORAGE_KEYS.BATCH]) ? data[STORAGE_KEYS.BATCH] : [];
  if (batch.length === 0) return;
  const btn = document.getElementById('copy');
  const origCopy = btn.textContent;
  btn.disabled = true;
  try {
    const text = batch.map((s) => (s || '').trim()).filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => {
    btn.textContent = origCopy;
    btn.disabled = false;
  }, 1500);
});

document.getElementById('clear').addEventListener('click', () => {
  chrome.storage.local.set({ [STORAGE_KEYS.BATCH]: [] }, () => {
    renderCount([]);
    renderList([]);
  });
});

const tooltipEl = document.getElementById('tooltip');
document.body.addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-tooltip]');
  if (!target || !tooltipEl) return;
  tooltipEl.textContent = target.getAttribute('data-tooltip') || '';
  tooltipEl.classList.add('visible');
  tooltipEl.setAttribute('aria-hidden', 'false');
});
document.body.addEventListener('mouseout', (e) => {
  if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tooltip]')) return;
  if (!tooltipEl) return;
  tooltipEl.classList.remove('visible');
  tooltipEl.setAttribute('aria-hidden', 'true');
});

load();
