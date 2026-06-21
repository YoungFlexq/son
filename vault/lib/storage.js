// chrome.storage.local wrapper for Vault
// Schema:
//   items: { [assetId]: { assetId, name, targetPrice, addedAt, lastSnapshot } }
//   snapshots: { [assetId]: [{ ts, rap, value, demand, lowestPrice, salesVolume }] }
//   settings: { pollIntervalSec, autoBuyEnabled, notificationsEnabled }
//   logs: [{ ts, level, assetId, message }]

const KEYS = {
  ITEMS: 'vault.items',
  SNAPSHOTS: 'vault.snapshots',
  SETTINGS: 'vault.settings',
  LOGS: 'vault.logs',
};

const DEFAULT_SETTINGS = {
  pollIntervalSec: 30,
  autoBuyEnabled: false,
  notificationsEnabled: true,
};

export async function getItems() {
  const data = await chrome.storage.local.get(KEYS.ITEMS);
  return data[KEYS.ITEMS] || {};
}

export async function setItem(item) {
  const items = await getItems();
  items[item.assetId] = item;
  await chrome.storage.local.set({ [KEYS.ITEMS]: items });
}

export async function removeItem(assetId) {
  const items = await getItems();
  delete items[assetId];
  await chrome.storage.local.set({ [KEYS.ITEMS]: items });

  const snaps = await getAllSnapshots();
  delete snaps[assetId];
  await chrome.storage.local.set({ [KEYS.SNAPSHOTS]: snaps });
}

export async function getAllSnapshots() {
  const data = await chrome.storage.local.get(KEYS.SNAPSHOTS);
  return data[KEYS.SNAPSHOTS] || {};
}

export async function getSnapshots(assetId) {
  const all = await getAllSnapshots();
  return all[assetId] || [];
}

export async function appendSnapshot(assetId, snapshot) {
  const all = await getAllSnapshots();
  const list = all[assetId] || [];
  list.push(snapshot);
  // Keep last 96 snapshots (~48 min at 30s)
  if (list.length > 96) list.splice(0, list.length - 96);
  all[assetId] = list;
  await chrome.storage.local.set({ [KEYS.SNAPSHOTS]: all });
}

export async function getSettings() {
  const data = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data[KEYS.SETTINGS] || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [KEYS.SETTINGS]: next });
  return next;
}

export async function appendLog(entry) {
  const data = await chrome.storage.local.get(KEYS.LOGS);
  const logs = data[KEYS.LOGS] || [];
  logs.unshift({ ts: Date.now(), ...entry });
  if (logs.length > 100) logs.length = 100;
  await chrome.storage.local.set({ [KEYS.LOGS]: logs });
}

export async function getLogs() {
  const data = await chrome.storage.local.get(KEYS.LOGS);
  return data[KEYS.LOGS] || [];
}
