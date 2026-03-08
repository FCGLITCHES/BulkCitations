const STORAGE_KEYS = {
  BATCH: 'captureBatch',
  DEDUPE: 'dedupeOnCapture',
  SPLITTER_VERSION: 'splitterVersion',
  SEND_LOG: 'captureSendLog',
};
const SEND_LOG_MAX = 10;
const SPLITTER_VERSION = 'boundary-scoring-v1';
const SITE_URL = 'http://localhost:5000';
const SITE_URL_PATTERNS = [
  'http://localhost:5000/*',
  'http://127.0.0.1:5000/*',
  'https://bulkcitations*/*',
];
const MAX_CHUNKS = 80;
const MIN_CHUNK_LENGTH = 18;
const MIN_CHUNK_SCORE = 1;

function normalizeForDedupe(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True if string looks like a full citation (has year and minimal length). */
function looksLikeCitation(s) {
  const t = (s || '').trim();
  return t.length >= 15 && /\b(19|20)\d{2}\b/.test(t);
}

/** Score a candidate chunk: positive signals (year, author-like, length), negative (too short, no shape). */
function chunkScore(chunk) {
  const t = (chunk || '').trim();
  if (t.length < MIN_CHUNK_LENGTH) return -1;
  let score = 0;
  if (/\b(19|20)\d{2}\b/.test(t)) score += 2;
  if (/[A-Z][a-z]+,\s*[A-Z.]|\b[A-Z][a-z]+\s+[A-Z][a-z.]+\s+[A-Z]\.|^[A-Z]\.\s*[A-Z][a-z]+/.test(t)) score += 1;
  if (t.length >= 40) score += 1;
  if (t.length < 25 && !/\b(19|20)\d{2}\b/.test(t)) score -= 2;
  return score;
}

/**
 * Light segmentation only: extension splits into candidate refs; site parser does final pass.
 * 3-stage pipeline: normalize -> candidate boundaries (voting) -> score chunks and split only when both sides pass.
 */
function splitIntoReferences(text) {
  if (!(text && typeof text === 'string')) return [];

  // Stage A: Normalize
  let normalized = text.replace(/\r\n|\r/g, '\n').trim();
  normalized = normalized.replace(/[ \t]+/g, ' ').replace(/\n /g, '\n').replace(/ \n/g, '\n');
  if (!normalized) return [];

  // Stage B: Collect candidate boundaries (index after which we could split) with strength
  const boundaries = [{ index: 0, strength: 0 }];
  const len = normalized.length;

  for (let i = 0; i < len; i++) {
    const rest = normalized.slice(i);
    if (rest.match(/^\n\s*\n/)) {
      const match = rest.match(/^\n\s*\n+/);
      const skip = match ? match[0].length : 2;
      boundaries.push({ index: i + skip, strength: 2 });
      i += skip - 1;
      continue;
    }
    if (rest.match(/^\d+[.)]\s|\d+\)\s|\[\d+\]\s/)) {
      boundaries.push({ index: i, strength: 2 });
      continue;
    }
    if (i > 10 && rest.match(/^[A-Z][a-z]+,\s*[A-Z.]|^[A-Z][a-z]+\s+[A-Z][a-z.]+\s+|^[A-Z]\.\s*[A-Z][a-z]+/)) {
      const prevChar = normalized[i - 1];
      if (prevChar === '.' || prevChar === '\n') boundaries.push({ index: i, strength: 1 });
      continue;
    }
    if (rest.match(/^\n\s*.{15,200}\b(19|20)\d{2}\b/) && normalized[i - 1] === '\n') {
      boundaries.push({ index: i, strength: 1 });
    }
  }
  boundaries.push({ index: len, strength: 0 });

  // Dedupe boundaries by index, keep max strength
  const byIndex = new Map();
  for (const b of boundaries) {
    const s = byIndex.get(b.index);
    if (s === undefined || b.strength > s) byIndex.set(b.index, b.strength);
  }
  const sorted = Array.from(byIndex.entries()).sort((a, b) => a[0] - b[0]);

  // Stage C: Build chunks between consecutive boundaries; only split when both chunks score >= threshold
  const chunks = [];
  let start = 0;
  for (let k = 0; k < sorted.length; k++) {
    const [end, strength] = sorted[k];
    if (end <= start) continue;
    const chunk = normalized.slice(start, end).trim();
    if (!chunk) {
      start = end;
      continue;
    }
    if (chunks.length >= MAX_CHUNKS) {
      chunks.push(normalized.slice(start).trim());
      break;
    }
    if (chunks.length === 0) {
      chunks.push(chunk);
      start = end;
      continue;
    }
    const nextChunk = normalized.slice(end, sorted[k + 1] ? sorted[k + 1][0] : len).trim();
    const scoreCur = chunkScore(chunk);
    const scoreNext = chunkScore(nextChunk);
    const splitOk = strength >= 1 && scoreCur >= MIN_CHUNK_SCORE && scoreNext >= MIN_CHUNK_SCORE;
    if (splitOk) {
      chunks.push(chunk);
      start = end;
    }
  }
  if (start < len) {
    const tail = normalized.slice(start).trim();
    if (tail && (chunks.length === 0 || chunkScore(tail) >= MIN_CHUNK_SCORE)) chunks.push(tail);
  }

  if (chunks.length === 0) return [normalized];
  return chunks;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'add-to-bulkcitations',
    title: 'Add to CitationConverter',
    contexts: ['selection'],
  });
  chrome.storage.local.get([STORAGE_KEYS.BATCH, STORAGE_KEYS.DEDUPE], (data) => {
    if (!Array.isArray(data[STORAGE_KEYS.BATCH])) {
      chrome.storage.local.set({ [STORAGE_KEYS.BATCH]: [] });
    }
    if (data[STORAGE_KEYS.DEDUPE] === undefined) {
      chrome.storage.local.set({ [STORAGE_KEYS.DEDUPE]: false });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'add-to-bulkcitations') return;
  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  const refs = splitIntoReferences(selectedText);
  if (refs.length === 0) return;

  chrome.storage.local.get([STORAGE_KEYS.BATCH, STORAGE_KEYS.DEDUPE], (data) => {
    let batch = Array.isArray(data[STORAGE_KEYS.BATCH]) ? data[STORAGE_KEYS.BATCH] : [];
    const dedupe = data[STORAGE_KEYS.DEDUPE] === true;

    for (const ref of refs) {
      const trimmed = ref.trim();
      if (!trimmed) continue;
      if (dedupe) {
        const normalized = normalizeForDedupe(trimmed);
        if (batch.some((item) => normalizeForDedupe(item) === normalized)) continue;
      }
      batch.push(trimmed);
    }
    chrome.storage.local.set({ [STORAGE_KEYS.BATCH]: batch });
  });
});

function injectBatchIntoTab(tabId, batch, callback) {
  chrome.scripting.executeScript(
    {
      target: { tabId },
      func: (payload) => {
        localStorage.setItem('bulkcitations_capture_batch', JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent('bulkcitations-capture-batch'));
      },
      args: [batch],
    },
    () => {
      if (chrome.runtime.lastError) {
        callback(false);
        return;
      }
      chrome.storage.local.get([STORAGE_KEYS.SEND_LOG], (d) => {
        const log = d[STORAGE_KEYS.SEND_LOG] || [];
        log.unshift({
          ts: Date.now(),
          version: SPLITTER_VERSION,
          chunkCount: batch.length,
        });
        if (log.length > SEND_LOG_MAX) log.length = SEND_LOG_MAX;
        chrome.storage.local.set({
          [STORAGE_KEYS.BATCH]: [],
          [STORAGE_KEYS.SPLITTER_VERSION]: SPLITTER_VERSION,
          [STORAGE_KEYS.SEND_LOG]: log,
        });
        callback(true);
      });
    }
  );
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'openAndInject' || !Array.isArray(msg.batch)) {
    sendResponse({ ok: false });
    return;
  }
  const batch = msg.batch;
  chrome.tabs.query({ url: SITE_URL_PATTERNS }, (tabs) => {
    const existing = tabs && tabs.length > 0 ? tabs[0] : null;
    if (existing && existing.id) {
      chrome.tabs.update(existing.id, { active: true });
      chrome.windows.update(existing.windowId, { focused: true });
      if (existing.status === 'complete') {
        injectBatchIntoTab(existing.id, batch, (ok) => sendResponse({ ok }));
      } else {
        const listener = (tabId, changeInfo) => {
          if (tabId !== existing.id || changeInfo.status !== 'complete') return;
          chrome.tabs.onUpdated.removeListener(listener);
          injectBatchIntoTab(existing.id, batch, (ok) => sendResponse({ ok }));
        };
        chrome.tabs.onUpdated.addListener(listener);
      }
    } else {
      chrome.tabs.create({ url: SITE_URL + '/#converter' }, (tab) => {
        if (chrome.runtime.lastError || !tab?.id) {
          sendResponse({ ok: false });
          return;
        }
        const listener = (tabId, changeInfo) => {
          if (tabId !== tab.id || changeInfo.status !== 'complete') return;
          chrome.tabs.onUpdated.removeListener(listener);
          injectBatchIntoTab(tab.id, batch, (ok) => sendResponse({ ok }));
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    }
  });
  return true;
});

