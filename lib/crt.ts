import type { MexcKline, MexcTicker, CrtSetup, Direction } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1000)  return n.toFixed(2)
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(6)
  return n.toFixed(8)
}

// ─── Core detector ───────────────────────────────────────────────────────────

/**
 * Candle Range Theory — 3-candle pattern
 *
 *  C1  Displacement : sweeps a prior swing H or L (liquidity grab)
 *  C2  Consolidation: inside or mostly inside C1 (>60% overlap)
 *  C3  Signal       : closes beyond C1 midpoint → confirms direction
 *
 *  Bullish : C1 sweeps prior LOW  → C3 closes ABOVE C1 mid
 *  Bearish : C1 sweeps prior HIGH → C3 closes BELOW C1 mid
 */
export function detectCrt(
  candles: MexcKline[],
  ticker: MexcTicker,
): CrtSetup | null {
  if (candles.length < 5) return null

  const c0 = candles[candles.length - 4]  // pre-C1 (for FVG check)
  const c1 = candles[candles.length - 3]  // displacement
  const c2 = candles[candles.length - 2]  // consolidation
  const c3 = candles[candles.length - 1]  // signal

  const c1Range = c1.high - c1.low
  const c1Mid   = (c1.high + c1.low) / 2

  // Guard: C1 must have meaningful range (>0.1% of price)
  if (c1Range < 0.001 * c1.close) return null

  // C2 must overlap C1 by >60%
  const overlap = Math.min(c2.high, c1.high) - Math.max(c2.low, c1.low)
  if (overlap / c1Range <= 0.6) return null

  // Prior swing reference (2 candles before C1)
  const priorCandles = candles.slice(candles.length - 5, candles.length - 3)
  const priorLow     = Math.min(...priorCandles.map(c => c.low))
  const priorHigh    = Math.max(...priorCandles.map(c => c.high))

  const bullish = c1.low < priorLow  && c3.close > c1Mid
  const bearish = c1.high > priorHigh && c3.close < c1Mid

  if (!bullish && !bearish) return null

  const direction: Direction = bullish ? 'BULLISH' : 'BEARISH'

  // FVG: 3-candle imbalance around C1
  let fvgHigh: number | null = null
  let fvgLow:  number | null = null

  if (bullish && c0.high < c3.low) {
    fvgLow  = c0.high
    fvgHigh = c3.low
  } else if (bearish && c0.low > c3.high) {
    fvgHigh = c0.low
    fvgLow  = c3.high
  }

  const sweepPct = bullish
    ? Math.abs(c1.low - priorLow) / priorLow * 100
    : Math.abs(c1.high - priorHigh) / priorHigh * 100

  return {
    symbol:          ticker.symbol,
    direction,
    c1OpenTime:      new Date(c1.openTime).toISOString(),
    c1High:          c1.high,
    c1Low:           c1.low,
    c1Mid,
    c1RangePct:      c1Range / c1.close * 100,
    c1BodyPct:       Math.abs(c1.close - c1.open) / c1Range * 100,
    sweepPct,
    c2OverlapPct:    overlap / c1Range * 100,
    c3Close:         c3.close,
    fvgHigh,
    fvgLow,
    lastPrice:       parseFloat(ticker.lastPrice),
    priceChangePct:  parseFloat(ticker.priceChangePercent),
    volume24h:       parseFloat(ticker.quoteVolume),
    detectedAt:      new Date().toISOString(),
  }
}


// ─── Scan ALL past windows (for backtest/testing) ─────────────────────────────

/**
 * Scans every 3-candle window in the dataset (not just the last one).
 * Returns all CRT setups found, newest first.
 */
export function detectAllCrt(
  candles: MexcKline[],
  ticker: MexcTicker,
): CrtSetup[] {
  const results: CrtSetup[] = []
  // Need at least 5 candles per window (2 prior + c1 + c2 + c3)
  for (let i = 4; i < candles.length; i++) {
    const window = candles.slice(0, i + 1)
    const setup  = detectCrt(window, ticker)
    if (setup) results.push(setup)
  }
  // Newest first, deduplicate by c1OpenTime+direction
  const seen = new Set<string>()
  return results
    .reverse()
    .filter(s => {
      const key = `${s.c1OpenTime}_${s.direction}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// ─── Alert message builder ───────────────────────────────────────────────────

export function buildAlertMessage(s: CrtSetup): string {
  const arrow   = s.direction === 'BULLISH' ? '🟢 BULLISH' : '🔴 BEARISH'
  const chgEmoji = s.priceChangePct >= 0 ? '📈' : '📉'
  const vol      = s.volume24h >= 1_000_000
    ? `$${(s.volume24h / 1_000_000).toFixed(2)}M`
    : `$${(s.volume24h / 1_000).toFixed(1)}K`
  const ts       = new Date(s.c1OpenTime).toUTCString().replace(' GMT', ' UTC')
  const fvgLine  = s.fvgHigh != null && s.fvgLow != null
    ? `⚡ FVG on C1:   \`${fmt(s.fvgLow)} – ${fmt(s.fvgHigh)}\`\n`
    : ''
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

  const tvLink = `https://www.tradingview.com/chart/?symbol=MEXC:${s.symbol}&interval=240`

  return [
    `🕯️ *CRT — ${s.symbol}* (Futures)`,
    `${arrow}  ·  4H  ·  ${now}`,
    `📊 [Open on TradingView](${tvLink})`,
    ``,
    `━━━ CANDLE DATA ━━━`,
    `📌 C1 High:    \`${fmt(s.c1High)}\``,
    `📌 C1 Low:     \`${fmt(s.c1Low)}\``,
    `📍 C1 Mid:     \`${fmt(s.c1Mid)}\``,
    `📏 C1 Range:   ${s.c1RangePct.toFixed(2)}%`,
    `💪 Body/Range: ${s.c1BodyPct.toFixed(0)}%`,
    `💧 Sweep:      ${s.sweepPct.toFixed(3)}%`,
    `🗜️ C2 Inside:  ${s.c2OverlapPct.toFixed(0)}% of C1`,
    `🔚 C3 Close:   \`${fmt(s.c3Close)}\``,
    fvgLine.trimEnd(),
    ``,
    `━━━ MARKET ━━━`,
    `💲 Price:     \`${fmt(s.lastPrice)}\``,
    `${chgEmoji} 24h Chg:  ${s.priceChangePct >= 0 ? '+' : ''}${s.priceChangePct.toFixed(2)}%`,
    `📦 24h Vol:   ${vol}`,
    `⏱️ C1 Candle: ${ts}`,
  ].filter(l => l !== undefined).join('\n')
}