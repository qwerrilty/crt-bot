import type { MexcTicker, MexcKline } from './types'

// MEXC Futures (perpetual swap) REST API
// TradingView symbol format: MEXC:BTCUSDT.P
const FUTURES_BASE = 'https://contract.mexc.com/api/v1'

async function get<T>(path: string, params?: Record<string, string>): Promise<{ success: boolean; code: number; data: T }> {
  let url = `${FUTURES_BASE}${path}`
  if (params) {
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    url += '?' + qs
  }
  const res = await (globalThis.fetch as typeof fetch)(url)
  if (!res.ok) throw new Error(`MEXC Futures ${path} -> ${res.status}`)
  return res.json()
}

// ── Tickers ───────────────────────────────────────────────────────────────────

interface FuturesTicker {
  symbol:       string
  lastPrice:    number
  riseFallRate: number  // 24h change as decimal e.g. -0.0138 = -1.38%
  amount24:     number  // 24h volume in USDT
}

export async function getAllUsdtTickers(): Promise<MexcTicker[]> {
  const json = await get<FuturesTicker[]>('/contract/ticker')
  if (!json.success || !Array.isArray(json.data)) return []

  return json.data
    .filter(t => t.symbol.endsWith('_USDT'))
    .map(t => ({
      symbol:             t.symbol.replace('_USDT', 'USDT') + '.P',  // BTC_USDT → BTCUSDT.P
      lastPrice:          String(t.lastPrice),
      priceChangePercent: String((t.riseFallRate * 100).toFixed(2)),  // -0.0138 → "-1.38"
      quoteVolume:        String(t.amount24),
    }))
}

// ── Klines ────────────────────────────────────────────────────────────────────

// MEXC futures kline response uses columnar format (separate arrays per field)
interface FuturesKlineData {
  time:   number[]
  open:   number[]
  close:  number[]
  high:   number[]
  low:    number[]
  vol:    number[]
  amount: number[]
}

export async function get4hKlines(symbol: string, limit = 50): Promise<MexcKline[]> {
  // Convert BTCUSDT.P → BTC_USDT for the futures API
  const futuresSymbol = symbol
    .replace('.P', '')
    .replace('USDT', '_USDT')   // BTCUSDT → BTC_USDT

  const json = await get<FuturesKlineData>('/contract/kline/' + futuresSymbol, {
    interval: 'Hour4',
    limit:    String(limit),
  })

  if (!json.success || !json.data?.time?.length) return []

  const d = json.data
  const candles: MexcKline[] = d.time.map((t, i) => ({
    openTime:    t * 1000,   // API returns Unix seconds → convert to ms
    open:        d.open[i],
    high:        d.high[i],
    low:         d.low[i],
    close:       d.close[i],
    volume:      d.vol[i],
    quoteVolume: d.amount[i],
  }))

  // Sort ascending, drop still-forming last candle
  return candles.sort((a, b) => a.openTime - b.openTime).slice(0, -1)
}