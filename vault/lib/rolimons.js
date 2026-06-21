// Rolimons public API client
// Endpoint: https://api.rolimons.com/items/v1/itemdetails
// Response: { item_count, items: { "<assetId>": [name, acronym, rap, value, default_value, demand, trend, projected, hyped, rare] } }
// demand: -1=terrible, 0=none, 1=low, 2=normal, 3=high, 4=amazing
// trend:  -1=lowering, 0=unstable, 1=stable, 2=raising, 3=fluctuating
// projected: 1 if projected
// hyped: 1 if hyped
// rare:  1 if rare

const FIELDS = ['name', 'acronym', 'rap', 'value', 'default_value', 'demand', 'trend', 'projected', 'hyped', 'rare'];

const DEMAND_LABEL = {
  '-1': 'Terrible',
  '0': 'None',
  '1': 'Low',
  '2': 'Normal',
  '3': 'High',
  '4': 'Amazing',
};

const TREND_LABEL = {
  '-1': 'Lowering',
  '0': 'Unstable',
  '1': 'Stable',
  '2': 'Raising',
  '3': 'Fluctuating',
};

let cache = { ts: 0, items: null };
const TTL_MS = 25_000; // refresh rolimons dump every ~25s

export async function fetchAllItems() {
  const now = Date.now();
  if (cache.items && now - cache.ts < TTL_MS) return cache.items;

  const res = await fetch('https://api.rolimons.com/items/v1/itemdetails', {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Rolimons fetch failed: ${res.status}`);
  const json = await res.json();
  cache = { ts: now, items: json.items || {} };
  return cache.items;
}

export function parseRolimonRow(row) {
  if (!row) return null;
  const obj = {};
  FIELDS.forEach((k, i) => (obj[k] = row[i]));
  obj.demandLabel = DEMAND_LABEL[String(obj.demand)] || 'Unknown';
  obj.trendLabel = TREND_LABEL[String(obj.trend)] || 'Unknown';
  // Rolimons "value" -1 means no community value set → fall back to RAP
  if (obj.value === -1 || obj.value == null) obj.value = obj.rap;
  return obj;
}

export async function getItemDetail(assetId) {
  const items = await fetchAllItems();
  const row = items[String(assetId)];
  return parseRolimonRow(row);
}
