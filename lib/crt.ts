import type { MexcKline, MexcTicker, CrtSetup, Direction } from './types'
import { validatePd, validatePoi } from './pd'
import { getConfluence } from './confluence'

function fmt(n: number): string {
  if (n >= 1000)  return n.toFixed(2)
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(6)
  return n.toFixed(8)
}

const H4 = 4 * 60 * 60 * 1000

/**
 * CRT Detection — Core Rules:
 *
 *  C1 = Range candle    — defines the high/low boundary (wick to wick)
 *  C2 = Sweep candle    — wick sweeps C1's wick high or low
 *                         body closes back INSIDE C1's full range (wick to wick)
 *  C3 = Entry candle    — trader's own model
 *
 * Filters:
 *  1. C1 range > 0.3% (no micro candles)
 *  2. C2 wick sweeps beyond C1 wick high/low
 *  3. C2 body closes fully inside C1 range (wick to wick)
 *  4. Sweep wick >= 20% of C2 range (visible on chart)
 *  5. Sweep >= 0.05% beyond C1 (meaningful grab)
 *  6. Must hit a valid PD array OR POI
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

  // Rule 1: C1 must have meaningful range > 0.3%
  if (c1Range < 0.003 * c1.close) return null

  // Rule 2: C2 body must be fully inside C1 range (wick to wick)
  if (c2BodyHigh >= c1.high || c2BodyLow <= c1.low) return null

  // Rule 3: Detect wick sweep
  const bearishSweep = c2.high > c1.high   // C2 wick above C1 wick high
  const bullishSweep = c2.low  < c1.low    // C2 wick below C1 wick low
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

  // Rule 4: Sweep wick must be visible (>= 20% of C2 range)
  if (wickPct  < 20)   return null

  // Rule 5: Sweep must go meaningfully beyond C1 (>= 0.05%)
  if (sweepPct < 0.05) return null

  // Rule 6: Must hit valid PD array OR POI
  const pd  = validatePd(candles, direction, sweepLevel)
  const poi = validatePoi(candles, direction, sweepLevel)
  if (!pd.valid && !poi.valid) return null

  // Rule 7: Confluence score must be >= 3 out of 10
  const conf = getConfluence(candles, direction, sweepLevel, c2, new Date(c2.openTime + H4).toISOString())
  if (conf.score < 3) return null

  // HTF bias (info only — not a hard filter)
  const htf = candles.slice(-12, -2)
  let htfBias = 'RANGING'
  if (htf.length >= 6) {
    const firstHalf  = htf.slice(0, Math.floor(htf.length / 2))
    const secondHalf = htf.slice(Math.floor(htf.length / 2))
    const firstHighAvg  = firstHalf.reduce((s, c) => s + c.high, 0) / firstHalf.length
    const secondHighAvg = secondHalf.reduce((s, c) => s + c.high, 0) / secondHalf.length
    const firstLowAvg   = firstHalf.reduce((s, c) => s + c.low, 0) / firstHalf.length
    const secondLowAvg  = secondHalf.reduce((s, c) => s + c.low, 0) / secondHalf.length
    if (secondHighAvg < firstHighAvg && secondLowAvg < firstLowAvg) htfBias = 'BEARISH'
    else if (secondHighAvg > firstHighAvg && secondLowAvg > firstLowAvg) htfBias = 'BULLISH'
  }

  // C2 rejection info (not a hard filter)
  const c2Rejected = direction === 'BEARISH' ? c2.close < c2.open : c2.close > c2.open

  // C2 body overlap inside C1
  const overlapHigh      = Math.min(c2BodyHigh, c1.high)
  const overlapLow       = Math.max(c2BodyLow,  c1.low)
  const c2BodyOverlapPct = overlapHigh > overlapLow
    ? (overlapHigh - overlapLow) / c1Range * 100
    : 0

  // FVG between C2 body and C1 wick boundary
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
    pdReasons:   [...pd.reasons, ...poi.reasons],
    confReasons: conf.reasons,
    confScore:   conf.score,
    session:     conf.session,
    htfBias,
    c2Rejected,
    lastPrice:       parseFloat(ticker.lastPrice),
    priceChangePct:  parseFloat(ticker.priceChangePercent),
    volume24h:       parseFloat(ticker.quoteVolume),
    detectedAt:      new Date().toISOString(),
  }
}

// ── Scan all past windows ─────────────────────────────────────────────────────
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

  const fvgLine  = s.fvgHigh != null && s.fvgLow != null
    ? `⚡ FVG Zone:   \`${fmt(s.fvgLow)} – ${fmt(s.fvgHigh)}\``
    : null

  const htfEmoji = s.htfBias === 'BULLISH' ? '🟢' : s.htfBias === 'BEARISH' ? '🔴' : '🟡'
  const rejEmoji = s.c2Rejected ? '✅' : '⚠️'

  // Confluence score bar
  const scoreFilled = Math.round((s.confScore ?? 0))
  const scoreBar    = '🟩'.repeat(scoreFilled) + '⬜'.repeat(10 - scoreFilled)
  const scoreLabel  = scoreFilled >= 7 ? 'HIGH' : scoreFilled >= 4 ? 'MEDIUM' : 'LOW'

  const pdLines   = (s.pdReasons ?? []).map(r => `   • ${r}`)
  const confLines = (s.confReasons ?? []).map(r => `   • ${r}`)
  const pdBlock   = [...pdLines, ...confLines].length > 0
    ? [``, `━━━ CONFLUENCE ━━━`, `🎯 Score: ${scoreBar} ${scoreFilled}/10 (${scoreLabel})`, ...[...pdLines, ...confLines]]
    : []

  const tvLink = `https://www.tradingview.com/chart/?symbol=MEXC:${s.symbol}&interval=240`

  return [
    `🕯️ *CRT — ${s.symbol}*`,
    `${arrow}  ·  4H  ·  MEXC Futures`,
    `${s.session ?? ''}  ·  Score: ${s.confScore ?? 0}/10`,
    `📊 [Open on TradingView](${tvLink})`,
    ``,
    `━━━ TIMING ━━━`,
    `📅 C1 Open:   ${toUTC(s.c1OpenTime)}  •  ${toPHT(s.c1OpenTime)}`,
    `📅 C1 Close:  ${toUTC(s.c1CloseTime)}  •  ${toPHT(s.c1CloseTime)}`,
    `📅 C2 Close:  ${toUTC(s.c2CloseTime)}  •  ${toPHT(s.c2CloseTime)} ← *confirmed*`,
    ageLabel,
    ``,
    `━━━ C1 RANGE ━━━`,
    `📌 High:      \`${fmt(s.c1High)}\`  (wick)`,
    `📌 Low:       \`${fmt(s.c1Low)}\`  (wick)`,
    `📍 Mid:       \`${fmt(s.c1Mid)}\``,
    `📏 Range:     ${s.c1RangePct.toFixed(2)}%`,
    ``,
    `━━━ C2 SWEEP ━━━`,
    `💧 Swept:     ${s.direction === 'BEARISH' ? 'above C1 wick high' : 'below C1 wick low'}`,
    `💧 Sweep:     ${s.sweepPct.toFixed(3)}% beyond C1`,
    `🪶 Wick:      ${s.wickPct.toFixed(0)}% of C2 range`,
    `🗜️ Body in C1: ${s.c2BodyOverlapPct.toFixed(0)}%`,
    fvgLine,
    `📊 HTF Bias:  ${htfEmoji} ${s.htfBias}`,
    `🕯️ C2 Close:  ${rejEmoji} ${s.c2Rejected ? 'Confirmed rejection' : 'Weak (caution)'}`,
    ...pdBlock,
    ``,
    `━━━ MARKET ━━━`,
    `💲 Price:     \`${fmt(s.lastPrice)}\``,
    `${chgEmoji} 24h Chg:  ${s.priceChangePct >= 0 ? '+' : ''}${s.priceChangePct.toFixed(2)}%`,
    `📦 24h Vol:   ${vol}`,
  ].filter(l => l != null).join('\n')
}