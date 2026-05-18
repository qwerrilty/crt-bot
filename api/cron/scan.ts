import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getAllUsdtTickers, get4hKlines } from '../../lib/mexc'
import { detectCrt, buildAlertMessage }   from '../../lib/crt'
import { sendMessage }                    from '../../lib/bot'
import { supabase }                       from '../../lib/supabase'
import type { CrtSetup }                  from '../../lib/types'

const db = supabase as any

function isAuthorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers['authorization'] === `Bearer ${secret}`
}

async function wasRecentlyAlerted(symbol: string, direction: string): Promise<boolean> {
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data } = await db
    .from('crt_setups')
    .select('id')
    .eq('symbol', symbol)
    .eq('direction', direction)
    .eq('alerted', true)
    .gte('created_at', since)
    .limit(1)
  return (data?.length ?? 0) > 0
}

async function saveSetup(setup: CrtSetup, alerted: boolean): Promise<void> {
  const { error } = await db.from('crt_setups').insert({
    symbol:           setup.symbol,
    direction:        setup.direction,
    c1_open_time:     setup.c1OpenTime,
    c1_close_time:    setup.c1CloseTime,
    c1_high:          setup.c1High,
    c1_low:           setup.c1Low,
    c1_mid:           setup.c1Mid,
    c1_range_pct:     setup.c1RangePct,
    c2_open_time:     setup.c2OpenTime,
    c2_close_time:    setup.c2CloseTime,
    c2_body_high:     setup.c2BodyHigh,
    c2_body_low:      setup.c2BodyLow,
    sweep_pct:        setup.sweepPct,
    wick_pct:         setup.wickPct,
    c2_body_overlap:  setup.c2BodyOverlapPct,
    fvg_high:         setup.fvgHigh,
    fvg_low:          setup.fvgLow,
    last_price:       setup.lastPrice,
    price_change_pct: setup.priceChangePct,
    volume_24h:       setup.volume24h,
    detected_at:      setup.detectedAt,
    alerted,
  })
  if (error) console.error(`[db] ${setup.symbol}:`, error.message)
}

async function getSubscribers() {
  const { data, error } = await db.from('alert_settings').select('*').eq('active', true)
  if (error) throw new Error(error.message)
  return data ?? []
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const startedAt    = new Date().toISOString()
  let symbolsScanned = 0
  let setupsFound    = 0
  let alertsSent     = 0
  let cronError: string | null = null

  const { data: logRow } = await db
    .from('scan_logs')
    .insert({ started_at: startedAt, finished_at: null, symbols_scanned: 0, setups_found: 0, alerts_sent: 0, error: null })
    .select('id').single()
  const logId = logRow?.id

  try {
    const tickers    = await getAllUsdtTickers()
    const minVol     = parseFloat(process.env.MIN_MC_VOLUME_PROXY ?? '10000')
    const candidates = tickers.filter(t => parseFloat(t.quoteVolume) >= minVol)
    symbolsScanned   = candidates.length
    console.log(`[scan] ${candidates.length} candidates`)

    const subscribers = await getSubscribers()

    const BATCH = 50
    for (let i = 0; i < candidates.length; i += BATCH) {
      await Promise.all(candidates.slice(i, i + BATCH).map(async ticker => {
        try {
          const candles = await get4hKlines(ticker.symbol)
          if (candles.length < 2) return

          const setup = detectCrt(candles, ticker)
          if (!setup) return

          setupsFound++

          const alreadyAlerted = await wasRecentlyAlerted(setup.symbol, setup.direction)
          await saveSetup(setup, !alreadyAlerted)
          if (alreadyAlerted) return

          const message = buildAlertMessage(setup)

          for (const sub of subscribers) {
            if (setup.direction === 'BULLISH' && !sub.notify_bullish) continue
            if (setup.direction === 'BEARISH' && !sub.notify_bearish) continue
            if (sub.watchlist.length > 0 && !sub.watchlist.includes(setup.symbol)) continue
            if (parseFloat(ticker.quoteVolume) < sub.min_mc_volume) continue
            try {
              await sendMessage(sub.chat_id, message)
              alertsSent++
            } catch (e) {
              console.error(`[tg] ${sub.chat_id}:`, (e as Error).message)
            }
          }
        } catch (e) {
          console.error(`[scan] ${ticker.symbol}:`, (e as Error).message)
        }
      }))
    }
  } catch (e) {
    cronError = (e as Error).message
    console.error('[scan] fatal:', cronError)
  }

  if (logId) {
    await db.from('scan_logs').update({
      finished_at: new Date().toISOString(),
      symbols_scanned: symbolsScanned,
      setups_found: setupsFound,
      alerts_sent: alertsSent,
      error: cronError,
    }).eq('id', logId)
  }

  return res.status(200).json({ ok: !cronError, symbolsScanned, setupsFound, alertsSent, error: cronError })
}