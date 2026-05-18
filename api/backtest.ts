/**
 * GET /api/backtest?symbol=BTCUSDT.P&limit=50
 * Scans all past CRT setups for a symbol. No Telegram alerts sent.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { get4hKlines } from '../lib/mexc'
import { detectAllCrt } from '../lib/crt'
import type { MexcTicker } from '../lib/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const symbol = String(req.query.symbol ?? 'BTCUSDT.P')
    const limit  = Math.min(parseInt(String(req.query.limit ?? '50')), 100)

    const candles = await get4hKlines(symbol, limit + 1)
    if (candles.length < 3) {
      return res.status(400).json({ error: `Not enough candles for ${symbol}` })
    }

    const lastCandle = candles[candles.length - 1]
    const ticker: MexcTicker = {
      symbol,
      lastPrice:          String(lastCandle.close),
      priceChangePercent: '0',
      quoteVolume:        String(lastCandle.quoteVolume),
    }

    const setups = detectAllCrt(candles, ticker)

    const toPHT = (iso: string) => {
      const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000)
      return d.toISOString().replace('T', ' ').slice(0, 16) + ' PHT'
    }

    const formatted = setups.map(s => ({
      direction:       s.direction,
      // C1 — range candle
      c1Open_UTC:      s.c1OpenTime.replace('T', ' ').slice(0, 16) + ' UTC',
      c1Open_PHT:      toPHT(s.c1OpenTime),
      c1Close_UTC:     s.c1CloseTime.replace('T', ' ').slice(0, 16) + ' UTC',
      c1High:          s.c1High,
      c1Low:           s.c1Low,
      c1Mid:           s.c1Mid,
      c1RangePct:      s.c1RangePct.toFixed(2) + '%',
      // C2 — sweep candle (CRT confirmed on close)
      c2Open_UTC:      s.c2OpenTime.replace('T', ' ').slice(0, 16) + ' UTC',
      c2Close_UTC:     s.c2CloseTime.replace('T', ' ').slice(0, 16) + ' UTC',
      c2Close_PHT:     toPHT(s.c2CloseTime),   // ← CRT confirmed at this PHT time
      c2BodyHigh:      s.c2BodyHigh,
      c2BodyLow:       s.c2BodyLow,
      sweepPct:        s.sweepPct.toFixed(3) + '%',
      wickPct:         s.wickPct.toFixed(0) + '%',
      c2BodyInC1:      s.c2BodyOverlapPct.toFixed(0) + '%',
      fvg:             s.fvgHigh ? `${s.fvgLow} – ${s.fvgHigh}` : null,
      tradingView:     `https://www.tradingview.com/chart/?symbol=MEXC:${symbol}&interval=240`,
    }))

    return res.status(200).json({
      symbol,
      candlesScanned: candles.length,
      setupsFound:    setups.length,
      setups:         formatted,
    })

  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}