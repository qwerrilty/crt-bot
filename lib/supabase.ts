import { createClient } from '@supabase/supabase-js'
import type { CrtSetupRow, AlertSettingsRow, ScanLogRow } from './types'

export type Database = {
  public: {
    Tables: {
      crt_setups: {
        Row: CrtSetupRow
        Insert: Omit<CrtSetupRow, 'id' | 'created_at'>
        Update: Partial<Omit<CrtSetupRow, 'id' | 'created_at'>>
      }
      alert_settings: {
        Row: AlertSettingsRow
        Insert: Omit<AlertSettingsRow, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<AlertSettingsRow, 'id' | 'created_at'>>
      }
      scan_logs: {
        Row: ScanLogRow
        Insert: Omit<ScanLogRow, 'id'>
        Update: Partial<Omit<ScanLogRow, 'id'>>
      }
    }
  }
}

const url  = process.env.SUPABASE_URL!
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

export const supabase = createClient<Database>(url, key)
