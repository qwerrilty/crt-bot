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