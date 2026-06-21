# Vault — Roblox Limiteds Tracker

A refined dark-themed Chrome extension (Manifest V3) that tracks RAP, value, demand and predicts price risk for **every** Roblox limited item — both classic limiteds and new **UGC Limiteds (Limited 2.0)** — and auto-buys the moment any item drops to your target price.

## Features

- **Universal coverage** — works on every limited:
  - **Classic limiteds** via Rolimons bulk feed + economy.roblox.com resellers.
  - **UGC Limiteds / Limited 2.0** (e.g. _Oozing Oscar_, ID `20011925`) via Roblox's catalog details + marketplace-sales endpoints. These items are **not** in Rolimons.
  - Each row shows a kind badge: `UGC LTD`, `LIMITED`, or `NOT LIMITED`.
- **Text-only, instant refreshes** — no image fetches, ~30 KB per poll.
- **Auto-buy** — when the lowest reseller ≤ your target, Vault sends a `POST /v1/purchases/products/{productId}` instantly using your Roblox session cookie.
- **Risk meter** — heuristic predictor combining demand, trend, value/RAP gap, sales velocity, projected/hyped/rare flags, and your recent snapshot history into a signed score (down ←→ up).
- **Local-only** — everything stored in `chrome.storage.local`. No server, no signup.

## Install (unpacked)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `/app/extension` folder.
5. Pin **Vault** to your toolbar.

## Usage

1. Click the Vault icon.
2. Paste any Roblox catalog link (e.g. `https://www.roblox.com/catalog/1029025`) or just the asset ID.
3. Enter your **target price** in Robux → click **Track**.
4. Open **≡ Settings** → toggle **Auto-buy ON** to enable instant purchases.

Vault polls every 30s by default (configurable: 15s / 30s / 60s / 2m). When a target hits with auto-buy enabled, the purchase executes within ~1 polling cycle. A 60-second per-`userAssetId` cooldown prevents duplicate buys.

## Data sources

- `https://api.rolimons.com/items/v1/itemdetails` — bulk dump of every classic limited (name, RAP, value, demand, trend, projected/hyped/rare flags). Cached 25 s.
- `https://catalog.roblox.com/v1/catalog/items/details` — canonical item record incl. `collectibleItemId` for UGC limiteds.
- `https://economy.roblox.com/v1/assets/{id}/resellers` — live lowest reseller for **classic** limiteds.
- `https://apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/resellers` — live lowest reseller for **UGC** limiteds.
- `https://economy.roblox.com/v2/assets/{id}/details` — product ID (classic purchase).
- `https://apis.roblox.com/marketplace-sales/v1/item/{collectibleItemId}/purchase-item` — UGC limited purchase.
- `https://users.roblox.com/v1/users/authenticated` — session status check.

## Risk score

Signed −100..+100 (negative = down, positive = up). Inputs and weights:

| Signal | Weight |
|---|---|
| Demand (Terrible…Amazing) | −25..+28 |
| Trend (Lowering…Raising) | −22..+22 |
| Value/RAP gap | −15..+20 |
| Projected / Hyped / Rare | −18 / +10 / +6 |
| Lowest vs Value discount | −12..+15 |
| Recent price velocity (last 6 snapshots) | −18..+18 |

Displayed as a marker on a 0..100 bar (50 = neutral). Reasons are shown under the bar.

## Security note

Auto-buy uses your active Roblox login cookie via Chrome's permission system. Vault never sends your cookies anywhere; all requests originate from the extension to `*.roblox.com` only. Disable auto-buy at any time from settings.

## File layout

```
extension/
├── manifest.json           # MV3
├── icons/                  # 16/32/48/128 PNG (black/white)
├── popup/
│   ├── index.html
│   ├── popup.css
│   └── popup.js            # UI logic
├── background/
│   └── service-worker.js   # polling, risk eval, auto-buy
└── lib/
    ├── storage.js          # chrome.storage wrapper
    ├── rolimons.js         # Rolimons bulk API
    ├── roblox.js           # Roblox economy/auth API
    └── risk.js             # heuristic risk model
```
