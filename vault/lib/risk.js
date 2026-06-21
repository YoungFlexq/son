// Heuristic Risk predictor (price direction: up / down / flat)
// Inputs: rolimons row + recent snapshot history + roblox lowest price
// Output: { direction: 'up'|'down'|'flat', score: 0..100, label, reasons[] }
//
// Score = signed -100..+100 (positive = up). We bucket to direction by thresholds.

export function computeRisk({ rolimon, snapshots, lowest }) {
  const reasons = [];
  let score = 0;

  if (!rolimon) {
    return { direction: 'flat', score: 50, label: 'Unknown', reasons: ['No Rolimons data'] };
  }

  // 1. Demand signal (-1..4)
  const demandPts = { '-1': -25, '0': -10, '1': -3, '2': 5, '3': 18, '4': 28 };
  const dp = demandPts[String(rolimon.demand)] ?? 0;
  if (dp) {
    score += dp;
    reasons.push(`Demand: ${rolimon.demandLabel} (${dp >= 0 ? '+' : ''}${dp})`);
  }

  // 2. Trend signal
  const trendPts = { '-1': -22, '0': -6, '1': 2, '2': 22, '3': -4 };
  const tp = trendPts[String(rolimon.trend)] ?? 0;
  if (tp) {
    score += tp;
    reasons.push(`Trend: ${rolimon.trendLabel} (${tp >= 0 ? '+' : ''}${tp})`);
  }

  // 3. Value vs RAP gap — if value >> RAP, room for RAP to grow
  if (rolimon.value && rolimon.rap) {
    const gap = (rolimon.value - rolimon.rap) / rolimon.rap;
    const gapPts = Math.max(-15, Math.min(20, Math.round(gap * 40)));
    if (Math.abs(gapPts) >= 2) {
      score += gapPts;
      reasons.push(`Value/RAP gap ${(gap * 100).toFixed(1)}% (${gapPts >= 0 ? '+' : ''}${gapPts})`);
    }
  }

  // 4. Projected / Hyped / Rare flags
  if (rolimon.projected === 1) { score -= 18; reasons.push('Projected (-18)'); }
  if (rolimon.hyped === 1)     { score += 10; reasons.push('Hyped (+10)'); }
  if (rolimon.rare === 1)      { score += 6;  reasons.push('Rare (+6)'); }

  // 5. Sales velocity from snapshots: rising lowestPrice → up
  if (snapshots && snapshots.length >= 3) {
    const recent = snapshots.slice(-6);
    const prices = recent.map(s => s.lowestPrice).filter(p => p != null);
    if (prices.length >= 3) {
      const first = prices[0];
      const last = prices[prices.length - 1];
      const delta = (last - first) / first;
      const velPts = Math.max(-18, Math.min(18, Math.round(delta * 60)));
      if (Math.abs(velPts) >= 2) {
        score += velPts;
        reasons.push(`Recent price velocity ${(delta * 100).toFixed(1)}% (${velPts >= 0 ? '+' : ''}${velPts})`);
      }
    }
  }

  // 6. Lowest vs Value — if lowest < value strongly, buy-pressure → up
  if (lowest?.lowestPrice && rolimon.value) {
    const discount = (rolimon.value - lowest.lowestPrice) / rolimon.value;
    if (discount > 0.15) {
      const pts = Math.min(15, Math.round(discount * 30));
      score += pts;
      reasons.push(`Listed ${(discount * 100).toFixed(0)}% below value (+${pts})`);
    } else if (discount < -0.15) {
      const pts = Math.max(-12, Math.round(discount * 25));
      score += pts;
      reasons.push(`Listed above value (${pts})`);
    }
  }

  // Clamp
  score = Math.max(-100, Math.min(100, score));

  let direction = 'flat';
  let label = 'Flat';
  if (score >= 18) { direction = 'up'; label = score >= 45 ? 'Strong Up' : 'Up'; }
  else if (score <= -18) { direction = 'down'; label = score <= -45 ? 'Strong Down' : 'Down'; }

  // Normalize to 0..100 for UI bar (50 = neutral)
  const display = Math.round(50 + score / 2);

  return { direction, score, display, label, reasons };
}
