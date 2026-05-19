import type { MexcKline, MexcTicker, CrtSetup, Direction } from './types'
import { validatePd } from './pd'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1000)  return n.toFixed(2)
  if (n >= 1)     return n.toFixed(4)
  if (n >= 0.01)  return n.toFixed(6)
  return n.toFixed(8)
}

const H4 = 4 * 60 * 60 * 1000

// ── CRT Detection ─────────────────────────────────────────────────────────────
export function detectCrt(
  candles: MexcKline[],
  ticker: MexcTicker,
): CrtSetup | null {
  if (candles.length < 5) return null

  const c1 = candles[candles.length - 2]   // range candle
  const c2 = candles[candles.length - 1]   // sweep candle

  const c1Range    = c1.high - c1.low
  const c1Mid      = (c1.high + c1.low) / 2
  const c2BodyHigh = Math.max(c2.open, c2.close)
  const c2BodyLow  = Math.min(c2.open, c2.close)
  const c2Range    = c2.high - c2.low || 1

  // C1 must have meaningful range > 0.3%
  if (c1Range < 0.003 * c1.close) return null

  // C2 body must be fully inside C1 range
  if (c2BodyHigh >= c1.high || c2BodyLow <= c1.low) return null

  // Detect sweep direction
  const bearishSweep = c2.high > c1.high
  const bullishSweep = c2.low  < c1.low
  if (!bearishSweep && !bullishSweep) return null

  let direction: Direction
  if (bearishSweep && bullishSweep) {
    direction = (c2.high - c1.high) >= (c1.low - c2.low) ? 'BEARISH' : 'BULLISH'
  } else {
    direction = bearishSweep ? 'BEARISH' : 'BULLISH'
  }

  // Sweep % and wick %
  const sweepLevel = direction === 'BEARISH' ? c2.high : c2.low
  const sweepPct   = direction === 'BEARISH'
    ? (c2.high - c1.high) / c1.high * 100
    : (c1.low  - c2.low)  / c1.low  * 100
  const wickPct    = direction === 'BEARISH'
    ? (c2.high - c2BodyHigh) / c2Range * 100
    : (c2BodyLow - c2.low)   / c2Range * 100

  // Quality filters
  if (sweepPct < 0.05) return null
  if (wickPct  < 15)   return null

  // ── PD Array & Liquidity validation ──────────────────────────────────────
  const pd = validatePd(candles, direction, sweepLevel)
  if (!pd.valid) return null   // must sweep a meaningful level

  // C2 body overlap inside C1
  const overlapHigh      = Math.min(c2BodyHigh, c1.high)
  const overlapLow       = Math.max(c2BodyLow,  c1.low)
  const c2BodyOverlapPct = overlapHigh > overlapLow
    ? (overlapHigh - overlapLow) / c1Range * 100
    : 0

  // FVG between C2 body and C1 boundary
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
    pdReasons:       pd.reasons,   // what was swept
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

  const fvgLine = s.fvgHigh != null && s.fvgLow != null
    ? `⚡ FVG Zone:   \`${fmt(s.fvgLow)} – ${fmt(s.fvgHigh)}\``
    : null

  // PD Arrays / Liquidity confluence
  const pdLines = (s.pdReasons ?? []).map(r => `   • ${r}`)
  const pdBlock = pdLines.length > 0
    ? [``, `━━━ PD ARRAY / LIQUIDITY ━━━`, ...pdLines]
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
    `📅 C2 Close:  ${toUTC(s.c2CloseTime)}  •  ${toPHT(s.c2CloseTime)} ← *CRT confirmed*`,
    `${ageLabel}`,
    ``,
    `━━━ C1 RANGE CANDLE ━━━`,
    `📌 High:      \`${fmt(s.c1High)}\``,
    `📌 Low:       \`${fmt(s.c1Low)}\``,
    `📍 Mid:       \`${fmt(s.c1Mid)}\``,
    `📏 Range:     ${s.c1RangePct.toFixed(2)}%`,
    ``,
    `━━━ C2 SWEEP CANDLE ━━━`,
    `💧 Sweep:     ${s.sweepPct.toFixed(3)}% beyond C1`,
    `🪶 Wick:      ${s.wickPct.toFixed(0)}% of C2 range`,
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