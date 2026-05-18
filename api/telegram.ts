/**
 * Telegram webhook handler
 * Commands:
 *   /start          — subscribe with default settings
 *   /stop           — unsubscribe
 *   /settings       — show current settings
 *   /bullish on|off — toggle bullish alerts
 *   /bearish on|off — toggle bearish alerts
 *   /watch BTCUSDT ETHUSDT … — set watchlist (empty to watch all)
 *   /watchall       — clear watchlist, watch all coins
 *   /status         — last scan stats
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from '../lib/supabase'
import { sendMessage } from '../lib/bot'

interface TgMessage {
  message_id: number
  from: { id: number; username?: string; first_name?: string }
  chat: { id: number; type: string }
  text?: string
}

interface TgUpdate {
  update_id: number
  message?: TgMessage
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getOrCreateSettings(chatId: string) {
  const { data } = await (supabase as any)
    .from('alert_settings')
    .select('*')
    .eq('chat_id', chatId)
    .single()
  return data
}

async function reply(chatId: string, text: string) {
  await sendMessage(chatId, text)
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleCommand(chatId: string, text: string) {
  const [cmd, ...args] = text.trim().split(/\s+/)

  switch (cmd.toLowerCase()) {

    case '/start': {
      const existing = await getOrCreateSettings(chatId)
      if (existing) {
        await (supabase as any)
          .from('alert_settings')
          .update({ active: true, updated_at: new Date().toISOString() })
          .eq('chat_id', chatId)
        await reply(chatId, '✅ *CRT alerts re-enabled!*\nUse /settings to see your config.')
      } else {
        await (supabase as any).from('alert_settings').insert({
          chat_id:        chatId,
          min_mc_volume:  10000,
          watchlist:      [],
          notify_bullish: true,
          notify_bearish: true,
          active:         true,
        })
        await reply(chatId,
          '👋 *Welcome to CRT Scanner!*\n\n' +
          '📡 You\'ll get notified of all MEXC 4H CRT setups on coins with MC > $100K.\n\n' +
          '*Commands:*\n' +
          '`/stop` — pause alerts\n' +
          '`/bullish off` — disable bullish alerts\n' +
          '`/bearish off` — disable bearish alerts\n' +
          '`/watch BTCUSDT ETHUSDT` — watch specific coins\n' +
          '`/watchall` — watch all coins\n' +
          '`/settings` — show your config\n' +
          '`/status` — last scan info'
        )
      }
      break
    }

    case '/stop': {
      await (supabase as any)
        .from('alert_settings')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('chat_id', chatId)
      await reply(chatId, '⏸️ Alerts paused. Send /start to resume.')
      break
    }

    case '/settings': {
      const s = await getOrCreateSettings(chatId)
      if (!s) {
        await reply(chatId, 'No settings found. Send /start first.')
        break
      }
      const watchStr = s.watchlist.length > 0 ? s.watchlist.join(', ') : 'All coins'
      await reply(chatId,
        `⚙️ *Your Settings*\n\n` +
        `Status:     ${s.active ? '🟢 Active' : '🔴 Paused'}\n` +
        `Bullish:    ${s.notify_bullish ? '✅' : '❌'}\n` +
        `Bearish:    ${s.notify_bearish ? '✅' : '❌'}\n` +
        `Watchlist:  ${watchStr}\n` +
        `MC Filter:  24h vol ≥ $${s.min_mc_volume.toLocaleString()}`
      )
      break
    }

    case '/bullish': {
      const on = args[0]?.toLowerCase() !== 'off'
      await (supabase as any)
        .from('alert_settings')
        .update({ notify_bullish: on, updated_at: new Date().toISOString() })
        .eq('chat_id', chatId)
      await reply(chatId, `Bullish alerts: ${on ? '✅ ON' : '❌ OFF'}`)
      break
    }

    case '/bearish': {
      const on = args[0]?.toLowerCase() !== 'off'
      await (supabase as any)
        .from('alert_settings')
        .update({ notify_bearish: on, updated_at: new Date().toISOString() })
        .eq('chat_id', chatId)
      await reply(chatId, `Bearish alerts: ${on ? '✅ ON' : '❌ OFF'}`)
      break
    }

    case '/watch': {
      if (args.length === 0) {
        await reply(chatId, 'Usage: `/watch BTCUSDT ETHUSDT ...`')
        break
      }
      const symbols = args.map(s => s.toUpperCase())
      await (supabase as any)
        .from('alert_settings')
        .update({ watchlist: symbols, updated_at: new Date().toISOString() })
        .eq('chat_id', chatId)
      await reply(chatId, `👀 Watching: ${symbols.join(', ')}`)
      break
    }

    case '/watchall': {
      await (supabase as any)
        .from('alert_settings')
        .update({ watchlist: [], updated_at: new Date().toISOString() })
        .eq('chat_id', chatId)
      await reply(chatId, '🌐 Watching all coins (MC > $100K)')
      break
    }

    case '/status': {
      const { data } = await (supabase as any)
        .from('scan_logs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .single()

      if (!data) {
        await reply(chatId, 'No scan runs recorded yet.')
        break
      }
      const dur = data.finished_at
        ? Math.round((new Date(data.finished_at).getTime() - new Date(data.started_at).getTime()) / 1000)
        : null
      await reply(chatId,
        `📊 *Last Scan*\n\n` +
        `🕐 Started:  ${new Date(data.started_at).toUTCString()}\n` +
        `⏱️ Duration: ${dur != null ? `${dur}s` : 'running…'}\n` +
        `🔍 Scanned:  ${data.symbols_scanned} pairs\n` +
        `📐 Setups:   ${data.setups_found}\n` +
        `📨 Alerts:   ${data.alerts_sent}\n` +
        `${data.error ? `❌ Error: ${data.error}` : '✅ No errors'}`
      )
      break
    }

    default:
      await reply(chatId, `Unknown command. Send /start for help.`)
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify secret token in URL query
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret && req.query.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const update: TgUpdate = req.body
  const msg = update.message
  if (!msg?.text) return res.status(200).end()   // ignore non-text updates

  const chatId = String(msg.chat.id)
  try {
    await handleCommand(chatId, msg.text)
  } catch (e) {
    console.error('[webhook] error:', (e as Error).message)
  }

  return res.status(200).end()
}