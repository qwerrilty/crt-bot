/**
 * GET /api/debug?symbol=BTC_USDT
 * Returns raw MEXC futures API response so we can inspect the structure.
 * Remove this file after debugging.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const symbol = String(req.query.symbol ?? 'BTC_USDT')

  try {
    // Test 1: ticker
    const tickerRes = await fetch(`https://contract.mexc.com/api/v1/contract/ticker?symbol=${symbol}`)
    const tickerRaw = await tickerRes.text()

    // Test 2: kline
    const klineRes = await fetch(`https://contract.mexc.com/api/v1/contract/kline/${symbol}?interval=Hour4&limit=5`)
    const klineRaw = await klineRes.text()

    return res.status(200).json({
      symbol,
      ticker: JSON.parse(tickerRaw),
      kline:  JSON.parse(klineRaw),
    })
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message })
  }
}