import type { MexcKline, MexcTicker, CrtSetup, Direction } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1000)  return n.toFixed(2)
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(6)
  return n.toFixed(8)
}

// ─── CRT Detection ────────────────────────────────────────────────────────────
/**
 * Candle Range Theory — correct candle labeling:
 *
 *  C1  CONSOLIDATION : The range candle — defines the boundary (high & low)
 *  C2  DISPLACEMENT  : Wick sweeps C1's high or low, body closes back INSIDE C1's range
 *                      → CRT is CONFIRMED when C2 closes
 *  C3  ENTRY CANDLE  : Trader's own model — bot does NOT analyze this
 *
 *  Bearish CRT: C2 upper wick sweeps above C1 high, body closes back below C1 high
 *  Bullish CRT: C2 lower wick sweeps below C1 low,  body closes back above C1 low
 */
export function detectCrt(
  candles: MexcKline[],
  ticker: MexcTicker,
): CrtSetup | null {
  if (candles.length < 4) return null

  const c1 = candles[candles.length - 2]  // consolidation (range candle)
  const c2 = candles[candles.length - 1]  // displacement  (sweep candle) ← CRT confirmed here

  const c1Range = c1.high - c1.low
  const c1Mid   = (c1.high + c1.low) / 2

  // C1 must have meaningful range (>0.2% of price)
  if (c1Range < 0.002 * c1.close) return null

  // C2 body boundaries
  const c2BodyHigh = Math.max(c2.open, c2.close)
  const c2BodyLow  = Math.min(c2.open, c2.close)

  // ── Bearish CRT ───────────────────────────────────────────────────────────
  // C2 upper WICK sweeps above C1 high
  // C2 BODY must close fully inside C1 range:
  //   - body high below C1 high (didn't accept above)
  //   - body low above C1 low   (didn't break down either)
  const bearishWickSweep  = c2.high > c1.high           // wick pierced above C1 high
  const bearishBodyInside = c2BodyHigh < c1.high         // body closed below C1 high
                         && c2BodyLow  > c1.low          // body stayed above C1 low
  const bearish = bearishWickSweep && bearishBodyInside

  // ── Bullish CRT ───────────────────────────────────────────────────────────
  // C2 lower WICK sweeps below C1 low
  // C2 BODY must close fully inside C1 range:
  //   - body low above C1 low   (didn't accept below)
  //   - body high below C1 high (didn't break out either)
  const bullishWickSweep  = c2.low < c1.low              // wick pierced below C1 low
  const bullishBodyInside = c2BodyLow  > c1.low           // body closed above C1 low
                         && c2BodyHigh < c1.high          // body stayed below C1 high
  const bullish = bullishWickSweep && bullishBodyInside

  if (!bullish && !bearish) return null

  // If both somehow trigger, pick the one with bigger sweep
  let direction: Direction
  if (bullish && bearish) {
    const upSweep   = c2.high - c1.high
    const downSweep = c1.low  - c2.low
    direction = upSweep > downSweep ? 'BEARISH' : 'BULLISH'
  } else {
    direction = bearish ? 'BEARISH' : 'BULLISH'
  }

  // Sweep size — how far the wick went beyond C1
  const sweepPct = direction === 'BEARISH'
    ? (c2.high - c1.high) / c1.high * 100
    : (c1.low  - c2.low)  / c1.low  * 100

  // Wick size as % of C2 range
  const c2Range  = c2.high - c2.low
  const wickPct  = direction === 'BEARISH'
    ? (c2.high - c2BodyHigh) / (c2Range || 1) * 100   // upper wick
    : (c2BodyLow - c2.low)   / (c2Range || 1) * 100   // lower wick

  // C2 body overlap inside C1 range
  const overlapHigh = Math.min(c2BodyHigh, c1.high)
  const overlapLow  = Math.max(c2BodyLow,  c1.low)
  const c2BodyOverlapPct = overlapHigh > overlapLow
    ? (overlapHigh - overlapLow) / c1Range * 100
    : 0

  // FVG: gap between C1 and C2 wicks (imbalance zone)
  let fvgHigh: number | null = null
  let fvgLow:  number | null = null
  if (direction === 'BEARISH' && c2BodyHigh < c1.high) {
    fvgLow  = c2BodyHigh
    fvgHigh = c1.high
  } else if (direction === 'BULLISH' && c2BodyLow > c1.low) {
    fvgHigh = c2BodyLow
    fvgLow  = c1.low
  }

  // 4H candle = 4 * 60 * 60 * 1000 ms
  const H4 = 14_400_000

  return {
    symbol:          ticker.symbol,
    direction,
    // C1 — consolidation/range candle
    c1OpenTime:      new Date(c1.openTime).toISOString(),
    c1CloseTime:     new Date(c1.openTime + H4).toISOString(),
    c1High:          c1.high,
    c1Low:           c1.low,
    c1Mid,
    c1RangePct:      c1Range / c1.close * 100,
    c1BodyPct:       Math.abs(c1.close - c1.open) / c1Range * 100,
    // C2 — displacement/sweep candle (CRT confirmed on close)
    c2OpenTime:      new Date(c2.openTime).toISOString(),
    c2CloseTime:     new Date(c2.openTime + H4).toISOString(),  // ← CRT confirmed here
    c2BodyHigh,
    c2BodyLow,
    sweepPct,
    wickPct,
    c2BodyOverlapPct,
    c3Close:         c2.close,   // kept for DB compat — this is C2 close price
    fvgHigh,
    fvgLow,
    lastPrice:       parseFloat(ticker.lastPrice),
    priceChangePct:  parseFloat(ticker.priceChangePercent),
    volume24h:       parseFloat(ticker.quoteVolume),
    detectedAt:      new Date().toISOString(),
  }
}

// ─── Scan ALL past windows ────────────────────────────────────────────────────

export function detectAllCrt(
  candles: MexcKline[],
  ticker: MexcTicker,
): CrtSetup[] {
  const results: CrtSetup[] = []
  for (let i = 2; i <= candles.length; i++) {
    const window = candles.slice(0, i)
    const setup  = detectCrt(window, ticker)
    if (setup) results.push(setup)
  }
  // Newest first, deduplicate by c2OpenTime+direction
  const seen = new Set<string>()
  return results
    .reverse()
    .filter(s => {
      const key = `${s.c2OpenTime}_${s.direction}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// ─── Alert message ────────────────────────────────────────────────────────────

export function buildAlertMessage(s: CrtSetup): string {
  const arrow    = s.direction === 'BULLISH' ? '🟢 BULLISH' : '🔴 BEARISH'
  const chgEmoji = s.priceChangePct >= 0 ? '📈' : '📉'
  const vol      = s.volume24h >= 1_000_000
    ? `$${(s.volume24h / 1_000_000).toFixed(2)}M`
    : `$${(s.volume24h / 1_000).toFixed(1)}K`

  // PHT = UTC+8
  const toPHT = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000)
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' PHT'
  }
  const toUTC = (iso: string) =>
    new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

  // Age of setup based on C2 close (when CRT was confirmed)
  const c2CloseTime = (s as any).c2CloseTime ?? s.c1OpenTime
  const ageMs       = Date.now() - new Date(c2CloseTime).getTime()
  const ageHours    = Math.floor(ageMs / (1000 * 60 * 60))
  const ageMins     = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60))
  const ageLabel    = ageHours === 0
    ? `🆕 FRESH — confirmed ${ageMins}min ago`
    : ageHours <= 4
    ? `🕐 Confirmed ${ageHours}h ${ageMins}m ago`
    : `🕰️ Historical — ${ageHours}h ago`

  const fvgLine = s.fvgHigh != null && s.fvgLow != null
    ? `⚡ FVG Zone:   \`${fmt(s.fvgLow)} – ${fmt(s.fvgHigh)}\``
    : null

  const tvLink = `https://www.tradingview.com/chart/?symbol=MEXC:${s.symbol}&interval=240`

  return [
    `🕯️ *CRT — ${s.symbol}*`,
    `${arrow}  ·  4H  ·  MEXC Futures`,
    `📊 [Open on TradingView](${tvLink})`,
    ``,
    `━━━ SETUP TIMING ━━━`,
    `📅 C1 (Range):  ${toUTC((s as any).c1OpenTime)} → ${toUTC((s as any).c1CloseTime ?? '')}`,
    `📅 C2 (Sweep):  ${toUTC(c2CloseTime)} ← *CRT confirmed*`,
    `🇵🇭 PHT:        ${toPHT(c2CloseTime)}`,
    `${ageLabel}`,
    ``,
    `━━━ C1 RANGE CANDLE ━━━`,
    `📌 High:       \`${fmt(s.c1High)}\``,
    `📌 Low:        \`${fmt(s.c1Low)}\``,
    `📍 Mid:        \`${fmt(s.c1Mid)}\``,
    `📏 Range:      ${s.c1RangePct.toFixed(2)}%`,
    ``,
    `━━━ C2 SWEEP CANDLE ━━━`,
    `💧 Sweep:      ${s.sweepPct.toFixed(3)}% beyond C1`,
    `🪶 Wick:       ${s.wickPct.toFixed(0)}% of C2 range`,
    `🗜️ Body in C1: ${s.c2BodyOverlapPct.toFixed(0)}%`,
    fvgLine,
    ``,
    `━━━ MARKET ━━━`,
    `💲 Price:      \`${fmt(s.lastPrice)}\``,
    `${chgEmoji} 24h Chg:   ${s.priceChangePct >= 0 ? '+' : ''}${s.priceChangePct.toFixed(2)}%`,
    `📦 24h Vol:    ${vol}`,
  ].filter(l => l != null).join('\n')
}