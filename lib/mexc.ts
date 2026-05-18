import type { MexcTicker, MexcKline } from './types'

// MEXC Futures (perpetual swap) REST API
// TradingView symbol format: MEXC:BTCUSDT.P
const FUTURES_BASE = 'https://contract.mexc.com/api/v1'

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  let url = `${FUTURES_BASE}${path}`
  if (params) {
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    url += '?' + qs
  }
  const res = await (globalThis.fetch as typeof fetch)(url)
  if (!res.ok) throw new Error(`MEXC Futures ${path} → ${res.status}`)
  const json = await res.json() as { success: boolean; data: T }
  if (!json.success) throw new Error(`MEXC Futures API error on ${path}`)
  return json.data
}

// ─── Tickers ──────────────────────────────────────────────────────────────────

interface FuturesTicker {
  symbol:            string   // e.g. "BTC_USDT"
  lastPrice:         number
  riseFallRate:      number   // 24h change %
  volume24:          number   // 24h volume in contracts
  amount24:          number   // 24h volume in USDT
  holdVol:           number   // open interest
}

export async function getAllUsdtTickers(): Promise<MexcTicker[]> {
  const data = await get<FuturesTicker[]>('/contract/ticker')

  return data
    .filter(t => t.symbol.endsWith('_USDT'))
    .map(t => ({
      // Normalize to same MexcTicker shape the rest of the bot expects
      // Convert BTC_USDT → BTCUSDT for consistency, tag with .P for TradingView
      symbol:             t.symbol.replace('_', '') + '.P',  // BTCUSDT.P
      lastPrice:          String(t.lastPrice),
      priceChangePercent: String(t.riseFallRate),
      quoteVolume:        String(t.amount24),               // 24h USDT volume
    }))
}

// ─── Klines ───────────────────────────────────────────────────────────────────

interface FuturesKline {
  // MEXC futures kline array: [time, open, close, high, low, vol, amount]
  time:   number
  open:   number
  close:  number
  high:   number
  low:    number
  vol:    number    // contract volume
  amount: number    // USDT volume
}

export async function get4hKlines(symbol: string, limit = 50): Promise<MexcKline[]> {
  // Convert BTCUSDT.P → BTC_USDT for the futures API
  const futuresSymbol = symbol
    .replace('.P', '')           // remove TradingView suffix
    .replace(/([A-Z]+)(USDT)$/, '$1_$2')  // BTCUSDT → BTC_USDT

  const raw = await get<FuturesKline[]>('/contract/kline/' + futuresSymbol, {
    interval: 'Hour4',   // MEXC futures interval: Min1,Min5,Min15,Min30,Min60,Hour4,Hour8,Day1,Week1,Month1
    limit:    String(limit),
  })

  if (!Array.isArray(raw) || raw.length < 6) return []

  const candles: MexcKline[] = raw.map(r => ({
    openTime:    r.time * 1000,   // futures API returns seconds, convert to ms
    open:        r.open,
    high:        r.high,
    low:         r.low,
    close:       r.close,
    volume:      r.vol,
    quoteVolume: r.amount,
  }))

  // Sort ascending, drop the still-forming last candle
  return candles.sort((a, b) => a.openTime - b.openTime).slice(0, -1)
}