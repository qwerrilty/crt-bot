import type { MexcTicker, MexcKline } from './types'

const BASE = 'https://api.mexc.com/api/v3'

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`MEXC ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

// ─── Tickers ─────────────────────────────────────────────────────────────────

export async function getAllUsdtTickers(): Promise<MexcTicker[]> {
  const data = await get<MexcTicker[]>('/ticker/24hr')
  return data.filter(t => t.symbol.endsWith('USDT'))
}

// ─── Klines ──────────────────────────────────────────────────────────────────

type RawKline = [
  number,  // 0 open time
  string,  // 1 open
  string,  // 2 high
  string,  // 3 low
  string,  // 4 close
  string,  // 5 volume
  number,  // 6 close time
  string,  // 7 quote volume
  number,  // 8 trades
  string,  // 9 taker buy base
  string,  // 10 taker buy quote
  string   // 11 ignore
]

export async function get4hKlines(symbol: string, limit = 50): Promise<MexcKline[]> {
  const raw = await get<RawKline[]>('/klines', {
    symbol,
    interval: '4h',
    limit: String(limit),
  })

  const candles: MexcKline[] = raw.map(r => ({
    openTime:    r[0],
    open:        parseFloat(r[1]),
    high:        parseFloat(r[2]),
    low:         parseFloat(r[3]),
    close:       parseFloat(r[4]),
    volume:      parseFloat(r[5]),
    quoteVolume: parseFloat(r[7]),
  }))

  // Sort ascending, drop the still-forming last candle
  return candles.sort((a, b) => a.openTime - b.openTime).slice(0, -1)
}
