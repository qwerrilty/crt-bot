import type { MexcKline, Direction } from './types'

function fmt(n: number): string {
  if (n >= 1000)  return n.toFixed(2)
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(6)
  return n.toFixed(8)
}

const TOLERANCE = 0.002   // 0.2%

export interface PdResult {
  valid:   boolean
  reasons: string[]
}

/**
 * Validates that the C2 sweep wick is targeting a FRESH, unviolated PD array
 * or liquidity pool. Any level that has already been swept or filled is invalid.
 *
 * Checks (in order):
 *  1. Liquidity Pool     — prior swing highs/lows not yet swept
 *  2. Equal Highs/Lows   — double tops/bottoms not yet swept
 *  3. Fair Value Gap      — imbalance not yet filled
 *  4. Order Block         — OB not yet violated (price hasn't closed through it)
 *  5. Equilibrium         — 50% of prior swing
 */
export function validatePd(
  candles:    MexcKline[],
  direction:  Direction,
  sweepLevel: number,    // price the C2 wick swept to
): PdResult {
  const reasons: string[] = []

  // Prior candles excluding C1 and C2
  const prior = candles.slice(0, candles.length - 2)
  if (prior.length < 4) return { valid: false, reasons }

  // Candles between a potential level and C1 (used to check if level was violated)
  // We look back up to 20 candles for level detection
  const lookback = prior.slice(-20)

  // ── 1. LIQUIDITY POOLS (swing highs / lows not yet swept) ─────────────────
  if (direction === 'BEARISH') {
    // Find prior swing highs — price clusters where buy stops sit
    for (let i = 1; i < lookback.length - 1; i++) {
      const prev = lookback[i - 1]
      const curr = lookback[i]
      const next = lookback[i + 1]

      if (curr.high <= prev.high || curr.high <= next.high) continue  // not a swing high

      const level = curr.high

      // Check: was this high already swept by any candle AFTER it (before C1)?
      const afterCandles = lookback.slice(i + 1)
      const alreadySwept = afterCandles.some(c => c.high > level)
      if (alreadySwept) continue   // already taken out — invalid

      // Check: does our C2 sweep reach this level?
      if (sweepLevel >= level * (1 - TOLERANCE) && sweepLevel <= level * (1 + TOLERANCE * 4)) {
        reasons.push(`💧 Buy-side Liquidity (BSL) swept @ \`${fmt(level)}\``)
      }
    }
  } else {
    // Bullish CRT — find prior swing lows not yet swept
    for (let i = 1; i < lookback.length - 1; i++) {
      const prev = lookback[i - 1]
      const curr = lookback[i]
      const next = lookback[i + 1]

      if (curr.low >= prev.low || curr.low >= next.low) continue  // not a swing low

      const level = curr.low

      // Check: was this low already swept?
      const afterCandles = lookback.slice(i + 1)
      const alreadySwept = afterCandles.some(c => c.low < level)
      if (alreadySwept) continue   // already taken out — invalid

      if (sweepLevel <= level * (1 + TOLERANCE) && sweepLevel >= level * (1 - TOLERANCE * 4)) {
        reasons.push(`💧 Sell-side Liquidity (SSL) swept @ \`${fmt(level)}\``)
      }
    }
  }

  // ── 2. EQUAL HIGHS / EQUAL LOWS ───────────────────────────────────────────
  // Two or more candles with nearly identical highs/lows = strong liquidity pool
  const highs = lookback.map(c => c.high)
  const lows  = lookback.map(c => c.low)

  if (direction === 'BEARISH') {
    for (let i = 0; i < highs.length - 1; i++) {
      for (let j = i + 1; j < highs.length; j++) {
        if (Math.abs(highs[i] - highs[j]) / highs[i] > 0.001) continue  // not equal
        const eqLevel = (highs[i] + highs[j]) / 2

        // Was this equal high already swept?
        const afterI = lookback.slice(j + 1)
        const alreadySwept = afterI.some(c => c.high > eqLevel * (1 + 0.001))
        if (alreadySwept) continue

        if (sweepLevel >= eqLevel * (1 - TOLERANCE) && sweepLevel <= eqLevel * (1 + TOLERANCE * 4)) {
          reasons.push(`⚡ Equal Highs (BSL) swept @ \`${fmt(eqLevel)}\``)
        }
      }
    }
  } else {
    for (let i = 0; i < lows.length - 1; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        if (Math.abs(lows[i] - lows[j]) / lows[i] > 0.001) continue
        const eqLevel = (lows[i] + lows[j]) / 2

        const afterI = lookback.slice(j + 1)
        const alreadySwept = afterI.some(c => c.low < eqLevel * (1 - 0.001))
        if (alreadySwept) continue

        if (sweepLevel <= eqLevel * (1 + TOLERANCE) && sweepLevel >= eqLevel * (1 - TOLERANCE * 4)) {
          reasons.push(`⚡ Equal Lows (SSL) swept @ \`${fmt(eqLevel)}\``)
        }
      }
    }
  }

  // ── 3. FAIR VALUE GAP (FVG) — not yet filled ──────────────────────────────
  // FVG = 3-candle imbalance. Invalid if price has already traded through it.
  for (let i = 1; i < lookback.length - 1; i++) {
    const a = lookback[i - 1]
    const b = lookback[i]
    const c = lookback[i + 1]

    if (direction === 'BEARISH') {
      // Bearish FVG: candle[i-1].low > candle[i+1].high
      if (a.low <= c.high) continue
      const fvgTop = a.low
      const fvgBot = c.high

      // Check if FVG was already filled (any candle after traded through both sides)
      const after = lookback.slice(i + 2)
      const filled = after.some(x => x.high >= fvgTop)
      if (filled) continue   // FVG already filled — invalid

      if (sweepLevel >= fvgBot && sweepLevel <= fvgTop) {
        reasons.push(`📦 Bearish FVG (unfilled) tapped [\`${fmt(fvgBot)} – ${fmt(fvgTop)}\`]`)
      }
    } else {
      // Bullish FVG: candle[i-1].high < candle[i+1].low
      if (a.high >= c.low) continue
      const fvgBot = a.high
      const fvgTop = c.low

      const after = lookback.slice(i + 2)
      const filled = after.some(x => x.low <= fvgBot)
      if (filled) continue   // already filled — invalid

      if (sweepLevel >= fvgBot && sweepLevel <= fvgTop) {
        reasons.push(`📦 Bullish FVG (unfilled) tapped [\`${fmt(fvgBot)} – ${fmt(fvgTop)}\`]`)
      }
    }
  }

  // ── 4. ORDER BLOCK — not yet violated ─────────────────────────────────────
  // OB is invalid if price has already closed THROUGH it after it formed
  for (let i = lookback.length - 4; i >= Math.max(0, lookback.length - 12); i--) {
    const ob      = lookback[i]
    const obTop   = Math.max(ob.open, ob.close)
    const obBot   = Math.min(ob.open, ob.close)
    const after   = lookback.slice(i + 1)

    if (direction === 'BULLISH' && ob.close < ob.open) {
      // Bearish OB acting as support for bullish CRT
      // Violated if any candle after it closed BELOW obBot
      const violated = after.some(x => Math.min(x.open, x.close) < obBot)
      if (violated) continue

      if (sweepLevel >= obBot * (1 - TOLERANCE) && sweepLevel <= obTop * (1 + TOLERANCE)) {
        reasons.push(`🟦 Bearish OB (valid support) [\`${fmt(obBot)} – ${fmt(obTop)}\`]`)
        break
      }
    }

    if (direction === 'BEARISH' && ob.close > ob.open) {
      // Bullish OB acting as resistance for bearish CRT
      // Violated if any candle after it closed ABOVE obTop
      const violated = after.some(x => Math.max(x.open, x.close) > obTop)
      if (violated) continue

      if (sweepLevel >= obBot * (1 - TOLERANCE) && sweepLevel <= obTop * (1 + TOLERANCE)) {
        reasons.push(`🟥 Bullish OB (valid resistance) [\`${fmt(obBot)} – ${fmt(obTop)}\`]`)
        break
      }
    }
  }

  // ── 5. EQUILIBRIUM (50% of prior swing) ───────────────────────────────────
  // Always valid as a reference level
  const swingHigh = Math.max(...lookback.map(c => c.high))
  const swingLow  = Math.min(...lookback.map(c => c.low))
  const eq        = (swingHigh + swingLow) / 2

  if (Math.abs(sweepLevel - eq) / eq < TOLERANCE) {
    reasons.push(`⚖️ Equilibrium (50%) tapped @ \`${fmt(eq)}\``)
  }

  // Deduplicate reasons
  const unique = [...new Set(reasons)]

  return {
    valid:   unique.length > 0,
    reasons: unique,
  }
}


// ── POI (Point of Interest) Validation ───────────────────────────────────────
/**
 * POIs are key price levels where institutional activity previously occurred.
 * For a CRT to be high quality, the sweep should happen AT or NEAR a POI.
 *
 * POI Types:
 *  1. Breaker Block    — failed OB (price broke through it), now S/R flip
 *  2. Mitigation Block — origin of a prior impulse move
 *  3. Rejection Block  — wick-heavy candle acting as S/R
 *  4. Propulsion Block — consolidation before a strong momentum move
 *  5. Premium/Discount — sweep happening in premium (bearish) or discount (bullish) zone
 */

export interface PoiResult {
  valid:   boolean
  reasons: string[]
}

export function validatePoi(
  candles:    MexcKline[],
  direction:  Direction,
  sweepLevel: number,
): PoiResult {
  const reasons: string[] = []
  const prior = candles.slice(0, candles.length - 2)
  if (prior.length < 5) return { valid: false, reasons }

  const lookback  = prior.slice(-20)
  const TOLERANCE = 0.003   // 0.3%

  // ── 1. BREAKER BLOCK ──────────────────────────────────────────────────────
  // A breaker is a prior OB that price has already broken through.
  // It now acts as S/R flip — strong POI for CRT sweeps.
  for (let i = 0; i < lookback.length - 2; i++) {
    const ob      = lookback[i]
    const obTop   = Math.max(ob.open, ob.close)
    const obBot   = Math.min(ob.open, ob.close)
    const after   = lookback.slice(i + 1)

    if (direction === 'BEARISH' && ob.close > ob.open) {
      // Bullish OB that price already broke below (now bearish breaker)
      const broke = after.some(x => Math.min(x.open, x.close) < obBot)
      if (!broke) continue
      // Sweep is back up into this breaker zone
      if (sweepLevel >= obBot * (1 - TOLERANCE) && sweepLevel <= obTop * (1 + TOLERANCE)) {
        reasons.push(`🔶 Bearish Breaker Block [\`${fmt(obBot)} – ${fmt(obTop)}\`]`)
        break
      }
    }

    if (direction === 'BULLISH' && ob.close < ob.open) {
      // Bearish OB that price already broke above (now bullish breaker)
      const broke = after.some(x => Math.max(x.open, x.close) > obTop)
      if (!broke) continue
      // Sweep is back down into this breaker zone
      if (sweepLevel >= obBot * (1 - TOLERANCE) && sweepLevel <= obTop * (1 + TOLERANCE)) {
        reasons.push(`🔷 Bullish Breaker Block [\`${fmt(obBot)} – ${fmt(obTop)}\`]`)
        break
      }
    }
  }

  // ── 2. MITIGATION BLOCK ───────────────────────────────────────────────────
  // The origin candle of a prior strong impulse move.
  // Price returning to mitigate this area = high probability reversal.
  for (let i = 0; i < lookback.length - 3; i++) {
    const candle   = lookback[i]
    const next     = lookback[i + 1]
    const candleBody = Math.abs(candle.close - candle.open)
    const candleRange = candle.high - candle.low

    // Must be a strong impulse candle (body > 60% of range)
    if (candleBody / (candleRange || 1) < 0.60) continue

    const top = Math.max(candle.open, candle.close)
    const bot = Math.min(candle.open, candle.close)

    if (direction === 'BEARISH' && candle.close > candle.open) {
      // Strong bullish impulse — price returning to mitigate it (bearish)
      const afterCandles = lookback.slice(i + 1)
      const mitigated    = afterCandles.some(x => x.low <= top)
      if (!mitigated) continue   // not yet mitigated
      if (sweepLevel >= bot * (1 - TOLERANCE) && sweepLevel <= top * (1 + TOLERANCE)) {
        reasons.push(`🟧 Bearish Mitigation Block [\`${fmt(bot)} – ${fmt(top)}\`]`)
        break
      }
    }

    if (direction === 'BULLISH' && candle.close < candle.open) {
      // Strong bearish impulse — price returning to mitigate it (bullish)
      const afterCandles = lookback.slice(i + 1)
      const mitigated    = afterCandles.some(x => x.high >= bot)
      if (!mitigated) continue
      if (sweepLevel >= bot * (1 - TOLERANCE) && sweepLevel <= top * (1 + TOLERANCE)) {
        reasons.push(`🟦 Bullish Mitigation Block [\`${fmt(bot)} – ${fmt(top)}\`]`)
        break
      }
    }
  }

  // ── 3. REJECTION BLOCK ────────────────────────────────────────────────────
  // A candle with a very large wick rejection — acts as S/R on return.
  for (let i = lookback.length - 2; i >= Math.max(0, lookback.length - 10); i--) {
    const candle     = lookback[i]
    const candleRange = candle.high - candle.low || 1
    const upperWick  = candle.high - Math.max(candle.open, candle.close)
    const lowerWick  = Math.min(candle.open, candle.close) - candle.low
    const upperWickPct = upperWick / candleRange
    const lowerWickPct = lowerWick / candleRange

    if (direction === 'BEARISH' && upperWickPct > 0.50) {
      // Strong upper wick rejection — resistance level
      const rejLevel = candle.high
      if (sweepLevel >= rejLevel * (1 - TOLERANCE) && sweepLevel <= rejLevel * (1 + TOLERANCE)) {
        reasons.push(`🔴 Rejection Block (upper wick) @ \`${fmt(rejLevel)}\``)
        break
      }
    }

    if (direction === 'BULLISH' && lowerWickPct > 0.50) {
      // Strong lower wick rejection — support level
      const rejLevel = candle.low
      if (sweepLevel >= rejLevel * (1 - TOLERANCE) && sweepLevel <= rejLevel * (1 + TOLERANCE)) {
        reasons.push(`🟢 Rejection Block (lower wick) @ \`${fmt(rejLevel)}\``)
        break
      }
    }
  }

  // ── 4. PROPULSION BLOCK ───────────────────────────────────────────────────
  // Tight consolidation (low range candles) before a strong move.
  // Price returning to this zone = high probability continuation/reversal.
  for (let i = 1; i < lookback.length - 2; i++) {
    const candle     = lookback[i]
    const prev       = lookback[i - 1]
    const candleRange = candle.high - candle.low
    const avgRange   = lookback.reduce((s, c) => s + (c.high - c.low), 0) / lookback.length

    // Propulsion block = candle range < 40% of average (tight consolidation)
    if (candleRange > avgRange * 0.40) continue

    const top = candle.high
    const bot = candle.low

    if (sweepLevel >= bot * (1 - TOLERANCE) && sweepLevel <= top * (1 + TOLERANCE)) {
      if (direction === 'BEARISH') {
        reasons.push(`⚙️ Propulsion Block (resistance) [\`${fmt(bot)} – ${fmt(top)}\`]`)
      } else {
        reasons.push(`⚙️ Propulsion Block (support) [\`${fmt(bot)} – ${fmt(top)}\`]`)
      }
      break
    }
  }

  // ── 5. PREMIUM / DISCOUNT ZONE ────────────────────────────────────────────
  // Bearish CRT should sweep in PREMIUM zone (above EQ of larger swing)
  // Bullish CRT should sweep in DISCOUNT zone (below EQ of larger swing)
  const swingHigh = Math.max(...lookback.map(c => c.high))
  const swingLow  = Math.min(...lookback.map(c => c.low))
  const eq        = (swingHigh + swingLow) / 2

  if (direction === 'BEARISH' && sweepLevel > eq) {
    const premiumPct = ((sweepLevel - eq) / (swingHigh - eq) * 100).toFixed(0)
    reasons.push(`💎 Premium Zone (${premiumPct}% into premium)`)
  }
  if (direction === 'BULLISH' && sweepLevel < eq) {
    const discountPct = ((eq - sweepLevel) / (eq - swingLow) * 100).toFixed(0)
    reasons.push(`💎 Discount Zone (${discountPct}% into discount)`)
  }

  const unique = [...new Set(reasons)]
  return { valid: unique.length > 0, reasons: unique }
}