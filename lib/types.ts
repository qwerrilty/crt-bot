// ─── MEXC ────────────────────────────────────────────────────────────────────

export interface MexcTicker {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string   // 24h volume in USDT
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
  // C1 — displacement candle
  c1OpenTime: string     // ISO
  c1High: number
  c1Low: number
  c1Mid: number
  c1RangePct: number     // range as % of price
  c1BodyPct: number      // body as % of c1 range
  sweepPct: number       // how far below/above prior swing was swept
  // C2 — consolidation
  c2OverlapPct: number   // % of C1 range covered by C2
  // C3 — signal
  c3Close: number
  // Optional FVG on C1
  fvgHigh: number | null
  fvgLow: number | null
  // Market snapshot at detection time
  lastPrice: number
  priceChangePct: number
  volume24h: number
  detectedAt: string     // ISO
}

// ─── Supabase rows ────────────────────────────────────────────────────────────

export interface CrtSetupRow extends CrtSetup {
  id: string
  alerted: boolean
  created_at: string
}

export interface AlertSettingsRow {
  id: string
  chat_id: string           // Telegram chat_id (PK from user's perspective)
  min_mc_volume: number     // 24h vol proxy for MC filter (default 10000)
  watchlist: string[]       // [] = all coins, else specific symbols
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
