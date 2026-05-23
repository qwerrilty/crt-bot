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

export type Direction = 'BULLISH' | 'BEARISH'

export interface CrtSetup {
  symbol:    string
  direction: Direction

  // C1 — Range candle (defines the boundary)
  c1OpenTime:  string   // ISO UTC
  c1CloseTime: string   // ISO UTC
  c1High:      number
  c1Low:       number
  c1Mid:       number
  c1RangePct:  number

  // C2 — Sweep candle (CRT confirmed on C2 close)
  c2OpenTime:      string   // ISO UTC
  c2CloseTime:     string   // ISO UTC  ← CRT confirmed here
  c2BodyHigh:      number
  c2BodyLow:       number
  sweepPct:        number   // how far wick went beyond C1 H/L
  wickPct:         number   // sweep wick as % of C2 range
  c2BodyOverlapPct: number  // how much C2 body is inside C1 range

  // PD Arrays & Liquidity confirmation
  pdReasons:   string[]   // PD arrays and POI confluence
  confReasons: string[]   // additional confluences
  confScore:   number    // 0-10 confluence score
  session:     string    // trading session
  htfBias:     string    // BULLISH / BEARISH / RANGING
  c2Rejected:  boolean   // C2 closed in rejection direction

  // FVG zone (optional)
  fvgHigh: number | null
  fvgLow:  number | null

  // Market snapshot
  lastPrice:      number
  priceChangePct: number
  volume24h:      number
  detectedAt:     string
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