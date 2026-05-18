/**
 * GET /api/backtest?symbol=BTCUSDT.P&limit=20
 *
 * Scans ALL past 3-candle windows in the last N candles for a given symbol.
 * Returns every CRT setup found — no Telegram alerts sent.
 * Use this to verify the scanner is working correctly.
 *
 * Query params:
 *   symbol  — futures symbol e.g. BTCUSDT.P (default: BTCUSDT.P)
 *   limit   — how many candles to look back, max 100 (default: 50)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { get4hKlines, getAllUsdtTickers } from '../lib/mexc'
import { detectAllCrt, buildAlertMessage } from '../lib/crt'
import type { MexcTicker } from '../lib/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const symbol = String(req.query.symbol ?? 'BTCUSDT.P')
    const limit  = Math.min(parseInt(String(req.query.limit ?? '50')), 100)

    // Fetch candles
    const candles = await get4hKlines(symbol, limit + 1)
    if (candles.length < 5) {
      return res.status(400).json({ error: `Not enough candles for ${symbol}` })
    }

    // Build a minimal ticker (we don't need live price for backtest)
    const lastCandle = candles[candles.length - 1]
    const ticker: MexcTicker = {
      symbol,
      lastPrice:          String(lastCandle.close),
      priceChangePercent: '0',
      quoteVolume:        String(lastCandle.quoteVolume),
    }

    // Detect all past CRT setups
    const setups = detectAllCrt(candles, ticker)

    // Format response
    const formatted = setups.map(s => ({
      direction:   s.direction,
      c1OpenTime:  s.c1OpenTime,
      c1High:      s.c1High,
      c1Low:       s.c1Low,
      c1Mid:       s.c1Mid,
      c1RangePct:  s.c1RangePct.toFixed(2) + '%',
      c1BodyPct:   s.c1BodyPct.toFixed(0) + '%',
      sweepPct:    s.sweepPct.toFixed(3) + '%',
      c2OverlapPct: s.c2OverlapPct.toFixed(0) + '%',
      c3Close:     s.c3Close,
      fvg:         s.fvgHigh ? `${s.fvgLow} – ${s.fvgHigh}` : null,
      // TradingView link for this specific candle
      tradingView: `https://www.tradingview.com/chart/?symbol=MEXC:${symbol}&interval=240`,
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