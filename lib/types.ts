// ─── MEXC ────────────────────────────────────────────────────────────────────

export interface MexcTicker {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string
}

export interface MexcKline {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  quoteVolume: number
}

// ─── CRT ─────────────────────────────────────────────────────────────────────

export type Direction = 'BULLISH' | 'BEARISH'

export interface CrtSetup {
  symbol: string
  direction: Direction

  // C1 — Consolidation / Range candle (defines the boundary)
  c1OpenTime:    string    // ISO
  c1CloseTime:   string    // ISO
  c1High:        number
  c1Low:         number
  c1Mid:         number
  c1RangePct:    number    // range as % of price
  c1BodyPct:     number    // body as % of C1 range

  // C2 — Displacement / Sweep candle (CRT confirmed on C2 close)
  c2OpenTime:        string   // ISO
  c2CloseTime:       string   // ISO  ← CRT confirmed at this time
  c2BodyHigh:        number
  c2BodyLow:         number
  sweepPct:          number   // how far wick went beyond C1 high/low
  wickPct:           number   // sweep wick as % of C2 range
  c2BodyOverlapPct:  number   // how much of C2 body is inside C1 range

  // C3 = trader's own entry model — bot does not analyze
  c3Close:       number    // kept for DB compat (= C2 close price)

  // Optional FVG (gap between C2 body and C1 boundary)
  fvgHigh: number | null
  fvgLow:  number | null

  // Market snapshot
  lastPrice:      number
  priceChangePct: number
  volume24h:      number
  detectedAt:     string
}

// ─── Supabase rows ────────────────────────────────────────────────────────────

export interface CrtSetupRow extends CrtSetup {
  id: string
  alerted: boolean
  created_at: string
}

export interface AlertSettingsRow {
  id: string
  chat_id: string
  min_mc_volume: number
  watchlist: string[]
  notify_bullish: boolean
  notify_bearish: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface ScanLogRow {
  id: string
  started_at: string
  finished_at: string | null
  symbols_scanned: number
  setups_found: number
  alerts_sent: number
  error: string | null
}