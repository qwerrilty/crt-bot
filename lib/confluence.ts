import type { MexcKline, Direction } from './types'

function fmt(n: number): string {
  if (n >= 1000)  return n.toFixed(2)
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(6)
  return n.toFixed(8)
}

const TOLERANCE = 0.003  // 0.3%

export interface ConfluenceResult {
  score:   number     // 0-10 confluence score
  reasons: string[]
  session: string
}

// ── Session Detection ─────────────────────────────────────────────────────────
function getSession(isoTime: string): string {
  const hour = new Date(isoTime).getUTCHours()
  if (hour >= 0  && hour < 7)  return '🌏 Asian Session'
  if (hour >= 7  && hour < 12) return '🇬🇧 London Session'
  if (hour >= 12 && hour < 17) return '🇺🇸 NY Session'
  if (hour >= 17 && hour < 21) return '🌐 NY Close'
  return '🌙 Off-Hours'
}

// ── RSI Calculation ───────────────────────────────────────────────────────────
function calcRsi(candles: MexcKline[], period = 14): number {
  if (candles.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close
    if (diff > 0) gains  += diff
    else          losses -= diff
  }
  const rs  = gains / (losses || 1)
  return 100 - (100 / (1 + rs))
}

// ── Market Structure ──────────────────────────────────────────────────────────
function getMarketStructure(candles: MexcKline[]): 'BULLISH' | 'BEARISH' | 'RANGING' {
  if (candles.length < 6) return 'RANGING'
  const recent = candles.slice(-6)
  const highs  = recent.map(c => c.high)
  const lows   = recent.map(c => c.low)

  const hhCount = highs.filter((h, i) => i > 0 && h > highs[i - 1]).length
  const llCount = lows.filter((l, i) => i > 0 && l < lows[i - 1]).length
  const hlCount = lows.filter((l, i) => i > 0 && l > lows[i - 1]).length
  const lhCount = highs.filter((h, i) => i > 0 && h < highs[i - 1]).length

  if (hhCount >= 2 && hlCount >= 2) return 'BULLISH'
  if (llCount >= 2 && lhCount >= 2) return 'BEARISH'
  return 'RANGING'
}

// ── Previous Day High/Low ─────────────────────────────────────────────────────
function getPdhl(candles: MexcKline[]): { pdh: number; pdl: number } | null {
  // Get candles from yesterday (roughly last 6 4H candles = 24 hours)
  const yesterday = candles.slice(-8, -2)
  if (yesterday.length < 4) return null
  return {
    pdh: Math.max(...yesterday.map(c => c.high)),
    pdl: Math.min(...yesterday.map(c => c.low)),
  }
}

// ── Main Confluence Check ─────────────────────────────────────────────────────
export function getConfluence(
  candles:    MexcKline[],
  direction:  Direction,
  sweepLevel: number,
  c2:         MexcKline,
  c2CloseTime: string,
): ConfluenceResult {
  const reasons: string[] = []
  let score = 0

  const prior = candles.slice(0, candles.length - 2)

  // ── 1. Market Structure Alignment ────────────────────────────────────────
  const ms = getMarketStructure(prior)
  if (ms === direction) {
    reasons.push(`📐 Market Structure: ${ms} (aligned ✅)`)
    score += 2
  } else if (ms === 'RANGING') {
    reasons.push(`📐 Market Structure: RANGING (neutral)`)
    score += 1
  } else {
    reasons.push(`📐 Market Structure: ${ms} (counter-trend ⚠️)`)
    // No score — counter-trend
  }

  // ── 2. Volume Confirmation ────────────────────────────────────────────────
  const avgVol = prior.slice(-10).reduce((s, c) => s + c.volume, 0) / 10
  const c2VolRatio = c2.volume / (avgVol || 1)
  if (c2VolRatio >= 1.5) {
    reasons.push(`📊 High Volume C2: ${c2VolRatio.toFixed(1)}x avg (institutional ✅)`)
    score += 2
  } else if (c2VolRatio >= 1.0) {
    reasons.push(`📊 Normal Volume C2: ${c2VolRatio.toFixed(1)}x avg`)
    score += 1
  } else {
    reasons.push(`📊 Low Volume C2: ${c2VolRatio.toFixed(1)}x avg (weak ⚠️)`)
  }

  // ── 3. RSI at Sweep Level ─────────────────────────────────────────────────
  const rsi = calcRsi(prior)
  if (direction === 'BEARISH' && rsi >= 65) {
    reasons.push(`📈 RSI Overbought: ${rsi.toFixed(0)} (bearish ✅)`)
    score += 2
  } else if (direction === 'BULLISH' && rsi <= 35) {
    reasons.push(`📉 RSI Oversold: ${rsi.toFixed(0)} (bullish ✅)`)
    score += 2
  } else if (direction === 'BEARISH' && rsi >= 55) {
    reasons.push(`📈 RSI Elevated: ${rsi.toFixed(0)}`)
    score += 1
  } else if (direction === 'BULLISH' && rsi <= 45) {
    reasons.push(`📉 RSI Depressed: ${rsi.toFixed(0)}`)
    score += 1
  } else {
    reasons.push(`〰️ RSI Neutral: ${rsi.toFixed(0)}`)
  }

  // ── 4. Previous Day High/Low ──────────────────────────────────────────────
  const pdhl = getPdhl(prior)
  if (pdhl) {
    if (direction === 'BEARISH' && Math.abs(sweepLevel - pdhl.pdh) / pdhl.pdh < TOLERANCE) {
      reasons.push(`📌 PDH Swept: \`${fmt(pdhl.pdh)}\` (strong level ✅)`)
      score += 2
    } else if (direction === 'BULLISH' && Math.abs(sweepLevel - pdhl.pdl) / pdhl.pdl < TOLERANCE) {
      reasons.push(`📌 PDL Swept: \`${fmt(pdhl.pdl)}\` (strong level ✅)`)
      score += 2
    }
  }

  // ── 5. Session Quality ────────────────────────────────────────────────────
  const session = getSession(c2CloseTime)
  if (session.includes('London') || session.includes('NY Session')) {
    score += 1  // High liquidity sessions
  }

  // ── 6. C1 Closes in Opposite Direction to C2 ─────────────────────────────
  // Bearish CRT: C1 should be bullish (sets up the sweep high)
  // Bullish CRT: C1 should be bearish (sets up the sweep low)
  const c1 = candles[candles.length - 2]
  const c1IsBullish = c1.close > c1.open
  if (direction === 'BEARISH' && c1IsBullish) {
    reasons.push(`🕯️ C1 Bullish → Bearish C2 sweep (classic ✅)`)
    score += 1
  } else if (direction === 'BULLISH' && !c1IsBullish) {
    reasons.push(`🕯️ C1 Bearish → Bullish C2 sweep (classic ✅)`)
    score += 1
  } else {
    reasons.push(`🕯️ C1 same direction as CRT (weaker setup ⚠️)`)
  }

  return {
    score:   Math.min(score, 10),
    reasons,
    session,
  }
}