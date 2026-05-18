import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabase } from '../lib/supabase'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const { data } = await supabase
    .from('scan_logs')
    .select('started_at, finished_at, symbols_scanned, setups_found, alerts_sent, error')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  return res.status(200).json({
    status:   'ok',
    lastScan: data ?? null,
    time:     new Date().toISOString(),
  })
}
