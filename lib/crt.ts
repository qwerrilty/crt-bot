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
  if (candles.length < 7) return null

  const c0 = candles[candles.length - 4]  // pre-C1 (for FVG check)
  const c1 = candles[candles.length - 3]  // displacement
  const c2 = candles[candles.length - 2]  // consolidation
  const c3 = candles[candles.length - 1]  // signal

  const c1Range = c1.high - c1.low
  const c1Mid   = (c1.high + c1.low) / 2

  // Guard: C1 must have meaningful range (>0.2% of price)
  if (c1Range < 0.002 * c1.close) return null

  // C2 must overlap C1 by >60%
  const overlap = Math.min(c2.high, c1.high) - Math.max(c2.low, c1.low)
  if (overlap / c1Range <= 0.6) return null

  // Prior swing reference — use 4 candles before C1 for a stronger swing
  const priorCandles = candles.slice(candles.length - 7, candles.length - 3)
  const priorLow     = Math.min(...priorCandles.map(c => c.low))
  const priorHigh    = Math.max(...priorCandles.map(c => c.high))

  // ── C1 body direction ───────────────────────────────────────────────────────
  const c1BodyHigh = Math.max(c1.open, c1.close)  // top of body
  const c1BodyLow  = Math.min(c1.open, c1.close)  // bottom of body

  // ── Bullish CRT rules ────────────────────────────────────────────────────────
  // C1: lower wick sweeps prior low, body closes ABOVE prior low (wick-only sweep)
  // C2: body must stay inside C1's full range (high to low) — wicks can go anywhere
  // C3: closes above C1 midpoint → reversal confirmed
  const bullishWickSweep  = c1.low < priorLow          // C1 wick pierced below prior low
  const bullishBodyInside = c1BodyLow > priorLow        // C1 body closed back above prior low
  const c2BodyInC1Bullish = Math.min(c2.open, c2.close) >= c1.low   // C2 body above C1 low
                         && Math.max(c2.open, c2.close) <= c1.high  // C2 body below C1 high
  const bullish = bullishWickSweep && bullishBodyInside && c2BodyInC1Bullish && c3.close > c1Mid

  // ── Bearish CRT rules ────────────────────────────────────────────────────────
  // C1: upper wick sweeps prior high, body closes BELOW prior high (wick-only sweep)
  // C2: body must stay inside C1's full range (high to low) — wicks can go anywhere
  // C3: closes below C1 midpoint → reversal confirmed
  const bearishWickSweep  = c1.high > priorHigh         // C1 wick pierced above prior high
  const bearishBodyInside = c1BodyHigh < priorHigh       // C1 body closed back below prior high
  const c2BodyInC1Bearish = Math.min(c2.open, c2.close) >= c1.low   // C2 body above C1 low
                         && Math.max(c2.open, c2.close) <= c1.high  // C2 body below C1 high
  const bearish = bearishWickSweep && bearishBodyInside && c2BodyInC1Bearish && c3.close < c1Mid

  if (!bullish && !bearish) return null

  const direction: Direction = bearish ? 'BEARISH' : 'BULLISH'

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

  // Sweep % = how far the WICK extended beyond the prior level
  const sweepPct = bullish
    ? Math.abs(c1.low - priorLow) / priorLow * 100      // wick below prior low
    : Math.abs(c1.high - priorHigh) / priorHigh * 100   // wick above prior high

  // Wick size % = wick portion vs total C1 range
  const wickPct = bullish
    ? Math.abs(c1BodyLow - c1.low) / c1Range * 100      // lower wick
    : Math.abs(c1.high - c1BodyHigh) / c1Range * 100    // upper wick

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
    wickPct,
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
  // How old is this setup? (candle age from now)
  const c1Time    = new Date(s.c1OpenTime).getTime()
  const nowTime   = Date.now()
  const ageHours  = Math.floor((nowTime - c1Time) / (1000 * 60 * 60))
  const ageLabel  = ageHours === 0
    ? '🆕 FRESH (just closed)'
    : ageHours <= 4
    ? `🕐 ${ageHours}h ago`
    : `🕰️ ${ageHours}h ago (historical)`

  const c1TimeStr = new Date(s.c1OpenTime).toUTCString().replace(' GMT', ' UTC')
  // Convert to PHT (UTC+8)
  const c1TimePHT = new Date(c1Time + 8 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 16) + ' PHT'

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
    `━━━ SETUP INFO ━━━`,
    `⏱️ C3 Closed: ${c1TimeStr}`,
    `🇵🇭 PHT Time: ${c1TimePHT}`,
    `${ageLabel}`,
    ``,
    `━━━ CANDLE DATA ━━━`,
    `📌 C1 High:    \`${fmt(s.c1High)}\``,
    `📌 C1 Low:     \`${fmt(s.c1Low)}\``,
    `📍 C1 Mid:     \`${fmt(s.c1Mid)}\``,
    `📏 C1 Range:   ${s.c1RangePct.toFixed(2)}%`,
    `💪 Body/Range: ${s.c1BodyPct.toFixed(0)}%`,
    `💧 Sweep:      ${s.sweepPct.toFixed(3)}%`,
    `🪶 Wick Size:  ${(s as any).wickPct?.toFixed(0) ?? '?'}% of C1`,
    `🗜️ C2 Inside:  ${s.c2OverlapPct.toFixed(0)}% of C1`,
    `🔚 C3 Close:   \`${fmt(s.c3Close)}\``,
    fvgLine.trimEnd(),
    ``,
    `━━━ MARKET ━━━`,
    `💲 Price:     \`${fmt(s.lastPrice)}\``,
    `${chgEmoji} 24h Chg:  ${s.priceChangePct >= 0 ? '+' : ''}${s.priceChangePct.toFixed(2)}%`,
    `📦 24h Vol:   ${vol}`,
  ].filter(l => l !== undefined).join('\n')
}