// Roblox API client (cookie-based via host_permissions)
// All requests run from the extension origin but Chrome attaches user's .ROBLOSECURITY
// cookie automatically because of host_permissions + credentials: 'include'.

// Cached CSRF token. Roblox rotates it; on 403 with x-csrf-token header we refresh.
let csrfToken = null;

async function refreshCsrf() {
  try {
    const res = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      credentials: 'include',
    });
    const t = res.headers.get('x-csrf-token');
    if (t) csrfToken = t;
  } catch (_) {}
  return csrfToken;
}

async function robloxFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (csrfToken) headers.set('X-CSRF-TOKEN', csrfToken);

  let res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (res.status === 403) {
    const t = res.headers.get('x-csrf-token');
    if (t) {
      csrfToken = t;
      headers.set('X-CSRF-TOKEN', csrfToken);
      res = await fetch(url, { ...options, headers, credentials: 'include' });
    }
  }
  return res;
}

export function extractAssetIdFromLink(link) {
  if (!link) return null;
  const s = String(link).trim();
  if (/^\d+$/.test(s)) return s;
  // catalog/123456/Name or /catalog/123456 or library/123456
  const m = s.match(/(?:catalog|library|item)\/(\d+)/i);
  if (m) return m[1];
  const m2 = s.match(/[?&]id=(\d+)/i);
  if (m2) return m2[1];
  const m3 = s.match(/(\d{4,})/);
  return m3 ? m3[1] : null;
}

// Legacy collectibles details endpoint
export async function getAssetDetails(assetId) {
  const res = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`details ${res.status}`);
  return res.json();
}

// New catalog details endpoint — returns collectibleItemId / collectibleProductId / lowestPrice
// for UGC limiteds (Limited 2.0).
// POST https://catalog.roblox.com/v1/catalog/items/details
// body: { items: [{ itemType: 'Asset', id: <assetId> }] }
export async function getCatalogItemDetails(assetId) {
  const body = JSON.stringify({ items: [{ itemType: 'Asset', id: Number(assetId) }] });
  const res = await robloxFetch('https://catalog.roblox.com/v1/catalog/items/details', {
    method: 'POST',
    body,
  });
  if (!res.ok) throw new Error(`catalog details ${res.status}`);
  const data = await res.json();
  const row = (data?.data || [])[0];
  return row || null;
}

export async function getResellers(assetId, limit = 10) {
  const res = await fetch(
    `https://economy.roblox.com/v1/assets/${assetId}/resellers?cursor=&limit=${limit}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`resellers ${res.status}`);
  return res.json();
}

// New collectible (Limited 2.0) reseller list
// GET https://apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resellers?limit=10
export async function getCollectibleResellers(collectibleItemId, limit = 10) {
  const res = await fetch(
    `https://apis.roblox.com/marketplace-sales/v1/item/${collectibleItemId}/resellers?limit=${limit}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`collectible resellers ${res.status}`);
  return res.json();
}

// Resale data for new collectibles (lowestResalePrice, originalPrice, etc.)
export async function getCollectibleResaleData(collectibleItemId) {
  const res = await fetch(
    `https://apis.roblox.com/marketplace-sales/v1/item/${collectibleItemId}/resale-data`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`collectible resale-data ${res.status}`);
  return res.json();
}

export async function getAuthenticatedUser() {
  const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
    credentials: 'include',
  });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return res.json();
}

// Legacy purchase: economy.roblox.com
// reseller: { userAssetId, seller: { id }, price }
export async function purchaseLegacy(productId, reseller) {
  if (!csrfToken) await refreshCsrf();
  const body = JSON.stringify({
    expectedCurrency: 1,
    expectedPrice: reseller.price,
    expectedSellerId: reseller.seller?.id ?? reseller.sellerId,
    userAssetId: reseller.userAssetId,
  });
  const res = await robloxFetch(
    `https://economy.roblox.com/v1/purchases/products/${productId}`,
    { method: 'POST', body },
  );
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok && data.purchased !== false, status: res.status, data };
}

// New collectible (UGC Limited / Limited 2.0) purchase
// POST https://apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/purchase-item
export async function purchaseCollectible({
  collectibleItemId,
  collectibleProductId,
  reseller,
  buyerUserId,
}) {
  if (!csrfToken) await refreshCsrf();
  const idempotencyKey = `vault-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const body = JSON.stringify({
    collectibleItemId,
    collectibleProductId: reseller.collectibleProductId || collectibleProductId,
    expectedCurrency: 1,
    expectedPrice: reseller.price,
    expectedPurchaserId: String(buyerUserId),
    expectedPurchaserType: 'User',
    expectedSellerId: String(reseller.seller?.sellerId ?? reseller.sellerId ?? reseller.seller?.id),
    expectedSellerType: reseller.seller?.sellerType || 'User',
    idempotencyKey,
  });
  const res = await robloxFetch(
    `https://apis.roblox.com/marketplace-sales/v1/item/${collectibleItemId}/purchase-item`,
    { method: 'POST', body },
  );
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok && data.purchased !== false, status: res.status, data };
}

// Unified lowest reseller snapshot — works for legacy + collectible items.
// `kind`: 'legacy' | 'collectible'
// For collectibles, pass collectibleItemId in `id`.
export async function getLowestResellerSnapshot(id, kind = 'legacy') {
  try {
    if (kind === 'collectible') {
      const data = await getCollectibleResellers(id, 10);
      const list = data?.data || [];
      if (!list.length) return { lowestPrice: null, resellersListed: 0, kind };
      let lowest = list[0];
      for (const r of list) if (r.price < lowest.price) lowest = r;
      return { lowestPrice: lowest.price, resellersListed: list.length, lowest, kind };
    }
    const data = await getResellers(id, 10);
    const list = data?.data || [];
    if (!list.length) return { lowestPrice: null, resellersListed: 0, kind };
    let lowest = list[0];
    for (const r of list) if (r.price < lowest.price) lowest = r;
    return { lowestPrice: lowest.price, resellersListed: list.length, lowest, kind };
  } catch (e) {
    return { lowestPrice: null, resellersListed: 0, kind, error: String(e) };
  }
}
