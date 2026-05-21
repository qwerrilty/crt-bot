import type { MexcKline, MexcTicker, CrtSetup, Direction } from './types'
import { validatePd, validatePoi } from './pd'

function fmt(n: number): string {
  if (n >= 1000)  return n.toFixed(2)
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(6)
  return n.toFixed(8)
}

const H4 = 4 * 60 * 60 * 1000

/**
 * STRICT CRT DETECTION
 * ====================
 * C1 = Range candle    — defines the high/low boundary
 * C2 = Sweep candle    — wick sweeps C1 H/L, body closes back inside C1
 * C3 = Entry candle    — trader's own model (bot does not analyze)
 *
 * STRICT RULES ADDED:
 *  1. C1 must be a STRONG range candle (range > 0.5% AND body > 30% of range)
 *  2. C2 sweep wick must be SIGNIFICANT (>= 25% of C2 range AND sweep >= 0.1%)
 *  3. C2 body must close in the OPPOSITE half of C1 (strong rejection)
 *     - Bearish CRT: C2 body must close in the LOWER half of C1
 *     - Bullish CRT: C2 body must close in the UPPER half of C1
 *  4. C2 must be a REJECTION candle — close strongly away from sweep
 *     - Bearish: C2 must close bearish (close < open) OR close below C1 mid
 *     - Bullish: C2 must close bullish (close > open) OR close above C1 mid
 *  5. Higher timeframe bias — C2 close must align with HTF structure
 *     - Bearish CRT: recent 10-candle trend must show lower highs (downtrend)
 *     - Bullish CRT: recent 10-candle trend must show higher lows (uptrend)
 *  6. Must sweep a valid PD array or liquidity pool (from pd.ts)
 */
export function detectCrt(
  candles: MexcKline[],
  ticker:  MexcTicker,
): CrtSetup | null {
  if (candles.length < 6) return null

  const c1 = candles[candles.length - 2]
  const c2 = candles[candles.length - 1]

  const c1Range    = c1.high - c1.low
  const c1Mid      = (c1.high + c1.low) / 2
  const c2BodyHigh = Math.max(c2.open, c2.close)
  const c2BodyLow  = Math.min(c2.open, c2.close)
  const c2Range    = (c2.high - c2.low) || 1

  // ── Rule 1: C1 must be a STRONG range candle ───────────────────────────────
  // Range > 0.5% of price (not a doji or micro candle)
  if (c1Range < 0.005 * c1.close) return null
  // C1 body must be at least 30% of its range (not a spinning top)
  const c1BodyPct = Math.abs(c1.close - c1.open) / c1Range
  if (c1BodyPct < 0.30) return null

  // ── Rule 2: C2 body must be FULLY inside C1 range ─────────────────────────
  if (c2BodyHigh >= c1.high || c2BodyLow <= c1.low) return null

  // ── Detect sweep direction ─────────────────────────────────────────────────
  const bearishSweep = c2.high > c1.high
  const bullishSweep = c2.low  < c1.low
  if (!bearishSweep && !bullishSweep) return null

  let direction: Direction
  if (bearishSweep && bullishSweep) {
    direction = (c2.high - c1.high) >= (c1.low - c2.low) ? 'BEARISH' : 'BULLISH'
  } else {
    direction = bearishSweep ? 'BEARISH' : 'BULLISH'
  }

  const sweepLevel = direction === 'BEARISH' ? c2.high : c2.low
  const sweepPct   = direction === 'BEARISH'
    ? (c2.high - c1.high) / c1.high * 100
    : (c1.low  - c2.low)  / c1.low  * 100
  const wickPct    = direction === 'BEARISH'
    ? (c2.high - c2BodyHigh) / c2Range * 100
    : (c2BodyLow - c2.low)   / c2Range * 100

  // ── Rule 3: Sweep must be SIGNIFICANT ─────────────────────────────────────
  // Wick must be at least 25% of C2 range (visible rejection)
  if (wickPct  < 25)   return null
  // Wick must go at least 0.1% beyond C1 (meaningful grab)
  if (sweepPct < 0.10) return null

  // ── Rule 4: C2 body must close in OPPOSITE half of C1 (strong rejection) ──
  // Bearish CRT: swept above, so body must close in LOWER half of C1
  if (direction === 'BEARISH') {
    const c2BodyMid = (c2BodyHigh + c2BodyLow) / 2
    if (c2BodyMid >= c1Mid) return null   // body too high — weak rejection
  }
  // Bullish CRT: swept below, so body must close in UPPER half of C1
  if (direction === 'BULLISH') {
    const c2BodyMid = (c2BodyHigh + c2BodyLow) / 2
    if (c2BodyMid <= c1Mid) return null   // body too low — weak rejection
  }

  // ── Rule 5: C2 must be a REJECTION candle ─────────────────────────────────
  // Bearish CRT: C2 should close bearish (confirms rejection of the high)
  if (direction === 'BEARISH' && c2.close > c2.open) return null
  // Bullish CRT: C2 should close bullish (confirms rejection of the low)
  if (direction === 'BULLISH' && c2.close < c2.open) return null

  // ── Rule 6: HTF BIAS — check last 10 candles for trend alignment ──────────
  const htf = candles.slice(-12, -2)   // 10 candles before C1
  if (htf.length >= 6) {
    const firstHalf  = htf.slice(0, Math.floor(htf.length / 2))
    const secondHalf = htf.slice(Math.floor(htf.length / 2))

    const firstHighAvg  = firstHalf.reduce((s, c) => s + c.high, 0) / firstHalf.length
    const secondHighAvg = secondHalf.reduce((s, c) => s + c.high, 0) / secondHalf.length
    const firstLowAvg   = firstHalf.reduce((s, c) => s + c.low, 0) / firstHalf.length
    const secondLowAvg  = secondHalf.reduce((s, c) => s + c.low, 0) / secondHalf.length

    if (direction === 'BEARISH') {
      // For bearish CRT, we want a downtrend or distribution (lower highs)
      if (secondHighAvg > firstHighAvg * 1.002) return null  // still making higher highs — skip
    }
    if (direction === 'BULLISH') {
      // For bullish CRT, we want an uptrend or accumulation (higher lows)
      if (secondLowAvg < firstLowAvg * 0.998) return null   // still making lower lows — skip
    }
  }

  // ── Rule 7: PD Array / Liquidity validation ───────────────────────────────
  const pd = validatePd(candles, direction, sweepLevel)
  if (!pd.valid) return null

  // ── Rule 8: POI (Point of Interest) validation ─────────────────────────────
  // Must ALSO be at or near a valid POI (breaker, mitigation, rejection, propulsion, premium/discount)
  const poi = validatePoi(candles, direction, sweepLevel)
  if (!poi.valid) return null

  // ── Compute remaining metrics ──────────────────────────────────────────────
  const overlapHigh      = Math.min(c2BodyHigh, c1.high)
  const overlapLow       = Math.max(c2BodyLow,  c1.low)
  const c2BodyOverlapPct = overlapHigh > overlapLow
    ? (overlapHigh - overlapLow) / c1Range * 100
    : 0

  let fvgHigh: number | null = null
  let fvgLow:  number | null = null
  if (direction === 'BEARISH') { fvgLow = c2BodyHigh; fvgHigh = c1.high }
  else                         { fvgHigh = c2BodyLow;  fvgLow  = c1.low  }

  return {
    symbol:    ticker.symbol,
    direction,
    c1OpenTime:      new Date(c1.openTime).toISOString(),
    c1CloseTime:     new Date(c1.openTime + H4).toISOString(),
    c1High:          c1.high,
    c1Low:           c1.low,
    c1Mid,
    c1RangePct:      c1Range / c1.close * 100,
    c2OpenTime:      new Date(c2.openTime).toISOString(),
    c2CloseTime:     new Date(c2.openTime + H4).toISOString(),
    c2BodyHigh,
    c2BodyLow,
    sweepPct,
    wickPct,
    c2BodyOverlapPct,
    fvgHigh,
    fvgLow,
    pdReasons:       [...pd.reasons, ...poi.reasons],
    lastPrice:       parseFloat(ticker.lastPrice),
    priceChangePct:  parseFloat(ticker.priceChangePercent),
    volume24h:       parseFloat(ticker.quoteVolume),
    detectedAt:      new Date().toISOString(),
  }
}

// ── Scan all past windows (backtest) ─────────────────────────────────────────
export function detectAllCrt(candles: MexcKline[], ticker: MexcTicker): CrtSetup[] {
  const results: CrtSetup[] = []
  for (let i = 2; i <= candles.length; i++) {
    const setup = detectCrt(candles.slice(0, i), ticker)
    if (setup) results.push(setup)
  }
  const seen = new Set<string>()
  return results.reverse().filter(s => {
    const key = `${s.c2OpenTime}_${s.direction}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Alert message ─────────────────────────────────────────────────────────────
export function buildAlertMessage(s: CrtSetup): string {
  const arrow    = s.direction === 'BULLISH' ? '🟢 BULLISH' : '🔴 BEARISH'
  const chgEmoji = s.priceChangePct >= 0 ? '📈' : '📉'
  const vol      = s.volume24h >= 1_000_000
    ? `$${(s.volume24h / 1_000_000).toFixed(2)}M`
    : `$${(s.volume24h / 1_000).toFixed(1)}K`

  const toPHT = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' PHT'
  }
  const toUTC = (iso: string) => iso.slice(0, 16).replace('T', ' ') + ' UTC'

  const ageMs    = Date.now() - new Date(s.c2CloseTime).getTime()
  const ageHours = Math.floor(ageMs / (1000 * 60 * 60))
  const ageMins  = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60))
  const ageLabel = ageHours === 0
    ? `🆕 FRESH — confirmed ${ageMins}min ago`
    : `🕐 Confirmed ${ageHours}h ${ageMins}m ago`

  const fvgLine = s.fvgHigh != null && s.fvgLow != null
    ? `⚡ FVG Zone:   \`${fmt(s.fvgLow)} – ${fmt(s.fvgHigh)}\``
    : null

  const pdLines = (s.pdReasons ?? []).map(r => `   • ${r}`)
  const pdBlock = pdLines.length > 0
    ? [``, `━━━ CONFLUENCE ━━━`, ...pdLines]
    : []

  const tvLink = `https://www.tradingview.com/chart/?symbol=MEXC:${s.symbol}&interval=240`

  return [
    `🕯️ *CRT — ${s.symbol}*`,
    `${arrow}  ·  4H  ·  MEXC Futures`,
    `📊 [Open on TradingView](${tvLink})`,
    ``,
    `━━━ TIMING ━━━`,
    `📅 C1 Open:   ${toUTC(s.c1OpenTime)}  •  ${toPHT(s.c1OpenTime)}`,
    `📅 C1 Close:  ${toUTC(s.c1CloseTime)}  •  ${toPHT(s.c1CloseTime)}`,
    `📅 C2 Close:  ${toUTC(s.c2CloseTime)}  •  ${toPHT(s.c2CloseTime)} ← *confirmed*`,
    ageLabel,
    ``,
    `━━━ C1 RANGE ━━━`,
    `📌 High:      \`${fmt(s.c1High)}\``,
    `📌 Low:       \`${fmt(s.c1Low)}\``,
    `📍 Mid:       \`${fmt(s.c1Mid)}\``,
    `📏 Range:     ${s.c1RangePct.toFixed(2)}%`,
    ``,
    `━━━ C2 SWEEP ━━━`,
    `💧 Sweep:     ${s.sweepPct.toFixed(3)}% beyond C1`,
    `🪶 Wick:      ${s.wickPct.toFixed(0)}% of C2`,
    `🗜️ Body in C1: ${s.c2BodyOverlapPct.toFixed(0)}%`,
    fvgLine,
    ...pdBlock,
    ``,
    `━━━ MARKET ━━━`,
    `💲 Price:     \`${fmt(s.lastPrice)}\``,
    `${chgEmoji} 24h Chg:  ${s.priceChangePct >= 0 ? '+' : ''}${s.priceChangePct.toFixed(2)}%`,
    `📦 24h Vol:   ${vol}`,
  ].filter(l => l != null).join('\n')
}