// Unified item resolver — works for both legacy limiteds (Rolimons-tracked)
// and new UGC limiteds / Limited 2.0 collectibles (not in Rolimons).
//
// For every assetId we:
//   1. Try Rolimons (covers all legacy limiteds + many newer items it knows).
//   2. Always call catalog/items/details — this gives us the canonical Roblox
//      record including collectibleItemId for Limited 2.0 / UGC limiteds.
//   3. Pick the right reseller endpoint by item kind:
//        - legacy   → economy.roblox.com/v1/assets/{id}/resellers
//        - collect. → apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resellers
//
// Demand/Trend labels come from Rolimons when available, otherwise we fall
// back to derived values from the catalog snapshot.

import { fetchAllItems, parseRolimonRow } from './rolimons.js';
import { getCatalogItemDetails, getLowestResellerSnapshot } from './roblox.js';

// Cache catalog/items/details per asset (item kind doesn't change often).
const detailsCache = new Map(); // assetId -> { ts, data }
const DETAILS_TTL_MS = 5 * 60_000;

async function getDetailsCached(assetId) {
  const c = detailsCache.get(String(assetId));
  if (c && Date.now() - c.ts < DETAILS_TTL_MS) return c.data;
  const data = await getCatalogItemDetails(assetId);
  detailsCache.set(String(assetId), { ts: Date.now(), data });
  return data;
}

// Roblox numeric itemRestrictions can include: 'Collectible', 'LimitedUnique',
// 'Limited', 'Rthro', etc. A collectible (UGC limited / Limited 2.0) has
// 'Collectible' AND a `collectibleItemId`.
function classify(catalog) {
  if (!catalog) return { kind: 'unknown' };
  const restrictions = Array.isArray(catalog.itemRestrictions) ? catalog.itemRestrictions : [];
  const isCollectible =
    restrictions.includes('Collectible') || !!catalog.collectibleItemId;
  const isLegacyLimited =
    restrictions.includes('Limited') || restrictions.includes('LimitedUnique');

  if (isCollectible && catalog.collectibleItemId) {
    return {
      kind: 'collectible',
      collectibleItemId: catalog.collectibleItemId,
      collectibleProductId: catalog.collectibleProductId,
    };
  }
  if (isLegacyLimited) return { kind: 'legacy' };
  // Not a limited at all (regular catalog item) — we still report whatever
  // data we have but mark it so the UI can show a notice.
  return { kind: 'non-limited' };
}

// Heuristic demand label from catalog data when Rolimons is silent.
// Roblox doesn't expose Rolimons-style demand, so we leave it as 'Unknown'.
function emptyLabels() {
  return { demandLabel: 'Unknown', trendLabel: 'Unknown' };
}

export async function resolveItem(assetId) {
  let rolimonRow = null;
  try {
    const dump = await fetchAllItems();
    rolimonRow = parseRolimonRow(dump[String(assetId)]);
  } catch (_) {}

  let catalog = null;
  try {
    catalog = await getDetailsCached(assetId);
  } catch (_) {}

  const cls = classify(catalog);

  // Choose reseller source.
  let lowest = { lowestPrice: null, resellersListed: 0, kind: cls.kind };
  if (cls.kind === 'collectible') {
    lowest = await getLowestResellerSnapshot(cls.collectibleItemId, 'collectible');
    // Fallback to catalog.lowestPrice if no resellers (item still primary-sale).
    if (lowest.lowestPrice == null && catalog?.lowestPrice != null) {
      lowest.lowestPrice = catalog.lowestPrice;
    }
  } else {
    lowest = await getLowestResellerSnapshot(assetId, 'legacy');
  }

  // Build a unified item view.
  const labels = emptyLabels();
  const view = {
    assetId: String(assetId),
    kind: cls.kind, // 'legacy' | 'collectible' | 'non-limited' | 'unknown'
    collectibleItemId: cls.collectibleItemId || null,
    collectibleProductId: cls.collectibleProductId || null,
    productId: catalog?.productId || null,
    name: rolimonRow?.name || catalog?.name || null,
    rap: rolimonRow?.rap ?? null,
    value: rolimonRow?.value ?? null,
    demand: rolimonRow?.demand ?? null,
    demandLabel: rolimonRow?.demandLabel || labels.demandLabel,
    trend: rolimonRow?.trend ?? null,
    trendLabel: rolimonRow?.trendLabel || labels.trendLabel,
    projected: rolimonRow?.projected ?? 0,
    hyped: rolimonRow?.hyped ?? 0,
    rare: rolimonRow?.rare ?? 0,
    catalogPrice: catalog?.price ?? null,
    catalogLowestPrice: catalog?.lowestPrice ?? null,
    unitsAvailable: catalog?.unitsAvailableForConsumption ?? null,
    totalQuantity: catalog?.totalQuantity ?? null,
    lowest,
    rolimonsTracked: !!rolimonRow,
  };
  return view;
}

export { classify };
