// Vault background service worker
// - Polls tracked items (both legacy Roblox limiteds and new UGC/Limited 2.0)
// - Computes risk
// - Triggers auto-buy when lowestPrice <= targetPrice (legacy + collectible)
// - Sends notifications

import {
  getItems, setItem, getSettings, appendSnapshot, getSnapshots, appendLog,
} from '../lib/storage.js';
import { resolveItem } from '../lib/items.js';
import {
  getAssetDetails, purchaseLegacy, purchaseCollectible, getAuthenticatedUser,
} from '../lib/roblox.js';
import { computeRisk } from '../lib/risk.js';

const ALARM = 'vault.tick';

async function rescheduleAlarm() {
  const { pollIntervalSec } = await getSettings();
  const periodInMinutes = Math.max(0.5, pollIntervalSec / 60);
  chrome.alarms.create(ALARM, { periodInMinutes });
}

chrome.runtime.onInstalled.addListener(async () => { await rescheduleAlarm(); });
chrome.runtime.onStartup.addListener(async () => { await rescheduleAlarm(); });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM) await tick();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'TICK_NOW') {
        await tick();
        sendResponse({ ok: true });
      } else if (msg.type === 'RESCHEDULE') {
        await rescheduleAlarm();
        sendResponse({ ok: true });
      } else if (msg.type === 'REFRESH_ITEM' && msg.assetId) {
        const snap = await refreshSingleItem(String(msg.assetId));
        sendResponse({ ok: true, snap });
      } else {
        sendResponse({ ok: false, error: 'unknown' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

async function notify(title, message) {
  const { notificationsEnabled } = await getSettings();
  if (!notificationsEnabled) return;
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
      priority: 2,
    });
  } catch (_) {}
}

async function refreshSingleItem(assetId) {
  const items = await getItems();
  const item = items[assetId];
  if (!item) return null;

  let view;
  try {
    view = await resolveItem(assetId);
  } catch (e) {
    await appendLog({ level: 'error', assetId, message: `resolve: ${e.message}` });
    view = null;
  }

  const snapshots = await getSnapshots(assetId);
  const rolimon = view ? {
    name: view.name,
    rap: view.rap,
    value: view.value,
    demand: view.demand,
    demandLabel: view.demandLabel,
    trend: view.trend,
    trendLabel: view.trendLabel,
    projected: view.projected,
    hyped: view.hyped,
    rare: view.rare,
  } : null;

  const risk = computeRisk({
    rolimon,
    snapshots,
    lowest: view?.lowest || { lowestPrice: null },
  });

  const snap = {
    ts: Date.now(),
    kind: view?.kind || 'unknown',
    rap: view?.rap ?? null,
    value: view?.value ?? null,
    demand: view?.demand ?? null,
    demandLabel: view?.demandLabel ?? null,
    trend: view?.trend ?? null,
    trendLabel: view?.trendLabel ?? null,
    name: view?.name ?? item.name ?? null,
    lowestPrice: view?.lowest?.lowestPrice ?? null,
    resellersListed: view?.lowest?.resellersListed ?? 0,
    collectibleItemId: view?.collectibleItemId || null,
    collectibleProductId: view?.collectibleProductId || null,
    unitsAvailable: view?.unitsAvailable ?? null,
    catalogPrice: view?.catalogPrice ?? null,
    rolimonsTracked: !!view?.rolimonsTracked,
    risk,
  };

  await appendSnapshot(assetId, snap);

  item.lastSnapshot = snap;
  if (snap.name) item.name = snap.name;
  // Persist kind so the UI can hint about new vs old limiteds.
  item.kind = snap.kind;
  await setItem(item);

  // Auto-buy check (works for legacy + collectible)
  if (
    item.targetPrice &&
    snap.lowestPrice != null &&
    snap.lowestPrice <= item.targetPrice &&
    view?.lowest?.lowest
  ) {
    await tryAutoBuy(item, view);
  }

  return snap;
}

async function tryAutoBuy(item, view) {
  const settings = await getSettings();
  const lowest = view.lowest;
  if (!settings.autoBuyEnabled) {
    await notify(
      `Target hit: ${item.name || item.assetId}`,
      `Lowest ${lowest.lowestPrice} R$ ≤ target ${item.targetPrice} R$. Auto-buy is OFF.`,
    );
    await appendLog({
      level: 'info', assetId: item.assetId,
      message: `target hit (auto-buy off) @ ${lowest.lowestPrice}`,
    });
    return;
  }

  // Cooldown key — uses userAssetId (legacy) or sellerId+price (collectible)
  const uniq = lowest.lowest?.userAssetId
    ?? `${lowest.lowest?.seller?.sellerId ?? lowest.lowest?.sellerId}-${lowest.lowest?.price}`;
  const nowKey = `buy.${item.assetId}.${uniq}`;
  const cooldown = (await chrome.storage.local.get(nowKey))[nowKey];
  if (cooldown && Date.now() - cooldown < 60_000) return;
  await chrome.storage.local.set({ [nowKey]: Date.now() });

  try {
    let result;
    if (view.kind === 'collectible' && view.collectibleItemId) {
      const me = await getAuthenticatedUser();
      if (!me?.id) throw new Error('not logged in to Roblox');
      result = await purchaseCollectible({
        collectibleItemId: view.collectibleItemId,
        collectibleProductId: view.collectibleProductId,
        reseller: lowest.lowest,
        buyerUserId: me.id,
      });
    } else {
      const details = await getAssetDetails(item.assetId);
      const productId = details?.ProductId;
      if (!productId) throw new Error('no productId');
      result = await purchaseLegacy(productId, lowest.lowest);
    }

    if (result.ok) {
      await notify(
        `BOUGHT: ${item.name || item.assetId}`,
        `Purchased for ${lowest.lowestPrice} R$ (target ${item.targetPrice}).`,
      );
      await appendLog({
        level: 'success', assetId: item.assetId,
        message: `bought @ ${lowest.lowestPrice} (${view.kind})`,
      });
    } else {
      await notify(
        `Buy failed: ${item.name || item.assetId}`,
        `Status ${result.status}. Will retry next tick.`,
      );
      await appendLog({
        level: 'error', assetId: item.assetId,
        message: `buy failed ${result.status} ${JSON.stringify(result.data).slice(0, 120)}`,
      });
    }
  } catch (e) {
    await appendLog({ level: 'error', assetId: item.assetId, message: `buy error: ${e.message}` });
  }
}

async function tick() {
  const items = await getItems();
  const ids = Object.keys(items);
  if (!ids.length) return;

  const concurrency = 3;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try { await refreshSingleItem(id); }
        catch (e) { await appendLog({ level: 'error', assetId: id, message: e.message }); }
      }
    }),
  );
}
