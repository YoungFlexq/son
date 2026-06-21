// Vault popup — minimal, fast, text-only refreshes.
import {
  getItems, setItem, removeItem, getSettings, setSettings,
} from '../lib/storage.js';
import { extractAssetIdFromLink, getAuthenticatedUser } from '../lib/roblox.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const els = {
  list: $('#list'),
  empty: $('#empty-state'),
  inputLink: $('#input-link'),
  inputTarget: $('#input-target'),
  btnAdd: $('#btn-add'),
  btnRefresh: $('#btn-refresh'),
  btnSettings: $('#btn-settings'),
  btnCloseSettings: $('#btn-close-settings'),
  status: $('#status-bar'),
  panel: $('#settings-panel'),
  setAutobuy: $('#set-autobuy'),
  setNotif: $('#set-notif'),
  pollSeg: $('#poll-seg'),
  sessionState: $('#session-state'),
  rowTpl: $('#row-template'),
};

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

let cachedItems = {};

function status(msg, isErr = false) {
  if (!msg) { els.status.classList.remove('show', 'err'); els.status.textContent = ''; return; }
  els.status.textContent = msg;
  els.status.classList.add('show');
  els.status.classList.toggle('err', !!isErr);
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function rowFor(assetId) {
  return $(`.row[data-id="${assetId}"]`);
}

function setBadge(badgeEl, kind) {
  badgeEl.classList.remove('hidden', 'legacy', 'warn');
  if (kind === 'collectible') {
    badgeEl.textContent = 'UGC LTD';
  } else if (kind === 'legacy') {
    badgeEl.textContent = 'LIMITED';
    badgeEl.classList.add('legacy');
  } else if (kind === 'non-limited') {
    badgeEl.textContent = 'NOT LIMITED';
    badgeEl.classList.add('warn');
  } else if (kind === 'unknown') {
    badgeEl.textContent = '…';
    badgeEl.classList.add('legacy');
  } else {
    badgeEl.classList.add('hidden');
  }
}

function renderItem(item) {
  let row = rowFor(item.assetId);
  if (!row) {
    const node = els.rowTpl.content.cloneNode(true);
    row = node.querySelector('.row');
    row.dataset.id = item.assetId;
    els.list.appendChild(row);

    row.querySelector('[data-field="del"]').addEventListener('click', async () => {
      await removeItem(item.assetId);
      row.remove();
      delete cachedItems[item.assetId];
      refreshEmpty();
    });

    const tInput = row.querySelector('[data-field="target"]');
    tInput.addEventListener('change', async () => {
      const v = parseInt(tInput.value, 10);
      const it = cachedItems[item.assetId];
      if (!it) return;
      it.targetPrice = Number.isFinite(v) && v > 0 ? v : null;
      await setItem(it);
      status(`Target updated for ${it.name || it.assetId}`);
      setTimeout(() => status(''), 1400);
    });
  }

  const s = item.lastSnapshot || {};
  row.querySelector('[data-field="name"]').textContent = item.name || s.name || `#${item.assetId}`;
  setBadge(row.querySelector('[data-field="kind"]'), item.kind || s.kind);
  row.querySelector('[data-field="rap"]').textContent = fmt(s.rap);
  row.querySelector('[data-field="value"]').textContent = fmt(s.value);
  row.querySelector('[data-field="lowest"]').textContent = fmt(s.lowestPrice);
  row.querySelector('[data-field="demand"]').textContent = s.demandLabel || '—';
  row.querySelector('[data-field="trend"]').textContent = s.trendLabel || '—';

  const tInput = row.querySelector('[data-field="target"]');
  if (document.activeElement !== tInput) {
    tInput.value = item.targetPrice ?? '';
  }

  const risk = s.risk || { display: 50, label: '—', reasons: [], direction: 'flat' };
  const riskLabelEl = row.querySelector('[data-field="riskLabel"]');
  riskLabelEl.textContent = risk.label;
  riskLabelEl.classList.remove('up', 'down');
  if (risk.direction === 'up') riskLabelEl.classList.add('up');
  if (risk.direction === 'down') riskLabelEl.classList.add('down');

  const markerEl = row.querySelector('[data-field="riskMarker"]');
  markerEl.style.left = `calc(${Math.max(0, Math.min(100, risk.display ?? 50))}% - 1px)`;
  markerEl.classList.remove('up', 'down');
  if (risk.direction === 'up') markerEl.classList.add('up');
  if (risk.direction === 'down') markerEl.classList.add('down');

  row.querySelector('[data-field="riskReasons"]').textContent =
    (risk.reasons || []).slice(0, 3).join(' · ') || '';

  row.querySelector('[data-field="ts"]').textContent = timeAgo(s.ts);
  const linkEl = row.querySelector('[data-field="link"]');
  linkEl.href = `https://www.roblox.com/catalog/${item.assetId}`;
}

function refreshEmpty() {
  const hasItems = Object.keys(cachedItems).length > 0;
  els.empty.style.display = hasItems ? 'none' : 'flex';
}

async function loadAll() {
  cachedItems = await getItems();
  $$('.row', els.list).forEach((r) => {
    if (!cachedItems[r.dataset.id]) r.remove();
  });
  Object.values(cachedItems).forEach(renderItem);
  refreshEmpty();
}

async function tickAll() {
  status('Refreshing…');
  els.btnRefresh.disabled = true;
  await chrome.runtime.sendMessage({ type: 'TICK_NOW' });
  cachedItems = await getItems();
  Object.values(cachedItems).forEach(renderItem);
  els.btnRefresh.disabled = false;
  status('');
}

async function refreshOne(assetId) {
  await chrome.runtime.sendMessage({ type: 'REFRESH_ITEM', assetId });
  cachedItems = await getItems();
  if (cachedItems[assetId]) renderItem(cachedItems[assetId]);
}

// --- Add item ---
els.btnAdd.addEventListener('click', async () => {
  const link = els.inputLink.value.trim();
  const target = parseInt(els.inputTarget.value, 10);
  const assetId = extractAssetIdFromLink(link);
  if (!assetId) { status('Invalid link or ID', true); return; }
  if (cachedItems[assetId]) { status('Already tracked', true); return; }

  const item = {
    assetId,
    name: `#${assetId}`,
    targetPrice: Number.isFinite(target) && target > 0 ? target : null,
    addedAt: Date.now(),
    lastSnapshot: null,
    kind: 'unknown',
  };
  await setItem(item);
  cachedItems[assetId] = item;
  renderItem(item);
  refreshEmpty();
  els.inputLink.value = '';
  els.inputTarget.value = '';
  status('Fetching data…');
  try {
    await refreshOne(assetId);
    status('');
  } catch (e) {
    status(`Error: ${e.message || e}`, true);
  }
});

els.inputTarget.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.btnAdd.click(); });
els.inputLink.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.btnAdd.click(); });

// --- Refresh ---
els.btnRefresh.addEventListener('click', tickAll);

// --- Settings ---
els.btnSettings.addEventListener('click', () => {
  els.panel.classList.toggle('hidden');
});
els.btnCloseSettings.addEventListener('click', () => {
  els.panel.classList.add('hidden');
});

async function paintSettings() {
  const s = await getSettings();
  els.setAutobuy.checked = !!s.autoBuyEnabled;
  els.setNotif.checked = !!s.notificationsEnabled;
  $$('button', els.pollSeg).forEach((b) => {
    b.classList.toggle('on', parseInt(b.dataset.v, 10) === s.pollIntervalSec);
  });
}

els.setAutobuy.addEventListener('change', async () => {
  await setSettings({ autoBuyEnabled: els.setAutobuy.checked });
});
els.setNotif.addEventListener('change', async () => {
  await setSettings({ notificationsEnabled: els.setNotif.checked });
});
$$('button', els.pollSeg).forEach((b) =>
  b.addEventListener('click', async () => {
    const v = parseInt(b.dataset.v, 10);
    await setSettings({ pollIntervalSec: v });
    await chrome.runtime.sendMessage({ type: 'RESCHEDULE' });
    paintSettings();
  }),
);

async function paintSession() {
  els.sessionState.classList.remove('ok', 'bad');
  els.sessionState.textContent = 'checking…';
  try {
    const user = await getAuthenticatedUser();
    if (user && user.name) {
      els.sessionState.textContent = `@${user.name}`;
      els.sessionState.classList.add('ok');
    } else {
      els.sessionState.textContent = 'not logged in';
      els.sessionState.classList.add('bad');
    }
  } catch {
    els.sessionState.textContent = 'not logged in';
    els.sessionState.classList.add('bad');
  }
}

// --- Init ---
(async function init() {
  await loadAll();
  await paintSettings();
  paintSession();
  setInterval(() => {
    Object.values(cachedItems).forEach((it) => {
      const row = rowFor(it.assetId);
      if (!row) return;
      row.querySelector('[data-field="ts"]').textContent = timeAgo(it.lastSnapshot?.ts);
    });
  }, 15_000);
})();

// React to background updates by reloading the store when popup is visible
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes['vault.items']) {
    cachedItems = changes['vault.items'].newValue || {};
    Object.values(cachedItems).forEach(renderItem);
    refreshEmpty();
  }
});
