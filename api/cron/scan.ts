/**
 * Vercel Cron — runs every 15 minutes (see vercel.json)
 * Scans all MEXC USDT pairs, detects CRT setups, saves to Supabase,
 * and sends Telegram alerts to all active subscribers.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getAllUsdtTickers, get4hKlines } from '../../lib/mexc'
import { detectCrt, buildAlertMessage }   from '../../lib/crt'
import { sendMessage }                    from '../../lib/bot'
import { supabase }                       from '../../lib/supabase'
import type { CrtSetup }                  from '../../lib/types'

// ─── Auth guard (Vercel passes CRON_SECRET automatically) ────────────────────
function isAuthorized(req: VercelRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true   // dev mode: no secret set
  return req.headers['authorization'] === `Bearer ${cronSecret}`
}

// ─── Dedup: was this symbol+direction already alerted in last N hours? ────────
async function wasRecentlyAlerted(symbol: string, direction: string): Promise<boolean> {
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() // 4h window
  const { data } = await supabase
    .from('crt_setups')
    .select('id')
    .eq('symbol', symbol)
    .eq('direction', direction)
    .eq('alerted', true)
    .gte('created_at', since)
    .limit(1)
  return (data?.length ?? 0) > 0
}

// ─── Save setup to Supabase ──────────────────────────────────────────────────
async function saveSetup(setup: CrtSetup, alerted: boolean): Promise<string | null> {
  const { data, error } = await supabase
    .from('crt_setups')
    .insert({
      ...setup,
      // map camelCase → snake_case for Supabase columns
      c1_open_time:   setup.c1OpenTime,
      c1_high:        setup.c1High,
      c1_low:         setup.c1Low,
      c1_mid:         setup.c1Mid,
      c1_range_pct:   setup.c1RangePct,
      c1_body_pct:    setup.c1BodyPct,
      sweep_pct:      setup.sweepPct,
      c2_overlap_pct: setup.c2OverlapPct,
      c3_close:       setup.c3Close,
      fvg_high:       setup.fvgHigh,
      fvg_low:        setup.fvgLow,
      last_price:     setup.lastPrice,
      price_change_pct: setup.priceChangePct,
      volume_24h:     setup.volume24h,
      detected_at:    setup.detectedAt,
      alerted,
    })
    .select('id')
    .single()

  if (error) {
    console.error(`[db] saveSetup ${setup.symbol}:`, error.message)
    return null
  }
  return data?.id ?? null
}

// ─── Fetch active subscribers ────────────────────────────────────────────────
async function getActiveSubscribers() {
  const { data, error } = await supabase
    .from('alert_settings')
    .select('*')
    .eq('active', true)
  if (error) throw new Error(`getActiveSubscribers: ${error.message}`)
  return data ?? []
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const startedAt = new Date().toISOString()
  let symbolsScanned = 0
  let setupsFound    = 0
  let alertsSent     = 0
  let cronError: string | null = null

  // ── Log scan start ────────────────────────────────────────────────────────
  const { data: logRow } = await supabase
    .from('scan_logs')
    .insert({ started_at: startedAt, finished_at: null, symbols_scanned: 0, setups_found: 0, alerts_sent: 0, error: null })
    .select('id')
    .single()
  const logId = logRow?.id

  try {
    // ── 1. Fetch all tickers ────────────────────────────────────────────────
    const tickers = await getAllUsdtTickers()
    const minVol  = parseFloat(process.env.MIN_MC_VOLUME_PROXY ?? '10000')

    // Filter by volume proxy for MC > $100K
    const candidates = tickers.filter(t => parseFloat(t.quoteVolume) >= minVol)
    symbolsScanned = candidates.length
    console.log(`[scan] ${candidates.length} candidates (vol >= $${minVol})`)

    // ── 2. Fetch subscribers once (shared for all alerts) ──────────────────
    const subscribers = await getActiveSubscribers()
    if (subscribers.length === 0) {
      console.log('[scan] No active subscribers — setups will be saved but not alerted')
    }

    // ── 3. Process symbols in batches to stay within Vercel memory ─────────
    const BATCH = 50
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH)

      await Promise.all(batch.map(async ticker => {
        try {
          const candles = await get4hKlines(ticker.symbol)
          if (candles.length < 5) return

          const setup = detectCrt(candles, ticker)
          if (!setup) return

          setupsFound++

          // ── Dedup: skip if same symbol+direction alerted in last 4h ──────
          const alreadyAlerted = await wasRecentlyAlerted(setup.symbol, setup.direction)
          await saveSetup(setup, !alreadyAlerted)

          if (alreadyAlerted) {
            console.log(`[scan] skip (recent): ${setup.symbol} ${setup.direction}`)
            return
          }

          // ── Send to each active subscriber ────────────────────────────────
          const message = buildAlertMessage(setup)

          for (const sub of subscribers) {
            // Respect per-user direction preferences
            if (setup.direction === 'BULLISH' && !sub.notify_bullish) continue
            if (setup.direction === 'BEARISH' && !sub.notify_bearish) continue

            // Respect per-user watchlist (empty = all coins)
            if (sub.watchlist.length > 0 && !sub.watchlist.includes(setup.symbol)) continue

            // Respect per-user MC volume proxy
            if (parseFloat(ticker.quoteVolume) < sub.min_mc_volume) continue

            try {
              await sendMessage(sub.chat_id, message)
              alertsSent++
            } catch (e) {
              console.error(`[telegram] ${sub.chat_id}:`, (e as Error).message)
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

  // ── Update scan log ────────────────────────────────────────────────────────
  if (logId) {
    await supabase
      .from('scan_logs')
      .update({
        finished_at:     new Date().toISOString(),
        symbols_scanned: symbolsScanned,
        setups_found:    setupsFound,
        alerts_sent:     alertsSent,
        error:           cronError,
      })
      .eq('id', logId)
  }

  return res.status(200).json({
    ok:             !cronError,
    symbolsScanned,
    setupsFound,
    alertsSent,
    error:          cronError,
  })
}
