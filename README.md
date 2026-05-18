# 🕯️ CRT Scanner Bot

MEXC 4H Candle Range Theory screener — deployed on Vercel, stored in Supabase, alerted via Telegram.

## Stack

| Layer | Service | Role |
|---|---|---|
| Code & CI | GitHub | Source of truth, auto-deploy trigger |
| Backend | Vercel (Node.js serverless) | API routes + Cron scheduler |
| Database | Supabase (Postgres) | Setup history, alert settings, scan logs |
| Alerts | Telegram Bot API | Push notifications |
| Editor | VSCode | Local dev |

## Project structure

```
crt-bot/
├── api/
│   ├── cron/scan.ts      ← Vercel Cron (every 15 min) — core scanner
│   ├── telegram.ts       ← Webhook for bot commands (/start, /stop, etc.)
│   └── health.ts         ← GET /api/health — last scan status
├── lib/
│   ├── types.ts          ← Shared TypeScript types
│   ├── mexc.ts           ← MEXC REST client
│   ├── crt.ts            ← CRT detection + alert formatter
│   ├── telegram.ts       ← sendMessage helper
│   └── supabase.ts       ← Typed Supabase client
├── supabase/
│   └── migrations/
│       └── 001_init.sql  ← Run once in Supabase SQL Editor
├── .vscode/              ← Workspace settings + recommended extensions
├── vercel.json           ← Cron schedule + function config
├── .env.example          ← Copy to .env.local for local dev
└── tsconfig.json
```

---

## Setup (step by step)

### 1. GitHub

```bash
git clone <this-repo>
cd crt-bot
npm install
```

### 2. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase/migrations/001_init.sql`
3. Go to **Settings → API** → copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copy the token → `TELEGRAM_BOT_TOKEN`
3. Choose a random string → `TELEGRAM_WEBHOOK_SECRET`
4. After deploying to Vercel, register the webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-vercel-url>/api/telegram?secret=<WEBHOOK_SECRET>"
```

### 4. Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` in project root → follow prompts → link to your GitHub repo
3. In Vercel Dashboard → **Settings → Environment Variables**, add all vars from `.env.example`
4. Vercel auto-generates `CRON_SECRET` — copy it and add it too
5. Every push to `main` auto-deploys

### 5. Local dev

```bash
cp .env.example .env.local
# fill in your values
vercel dev   # runs api routes locally on :3000
```

---

## Environment variables

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (service_role) |
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Any random string you choose |
| `MIN_MC_VOLUME_PROXY` | Default `10000` ($10K/day vol ≈ $100K MC) |
| `CRON_SECRET` | Vercel auto-generates (copy from dashboard) |

---

## Bot commands

| Command | Action |
|---|---|
| `/start` | Subscribe with default settings |
| `/stop` | Pause alerts |
| `/settings` | View your current config |
| `/bullish on\|off` | Toggle bullish alerts |
| `/bearish on\|off` | Toggle bearish alerts |
| `/watch BTCUSDT ETHUSDT` | Watch specific coins only |
| `/watchall` | Watch all coins (clears watchlist) |
| `/status` | Last scan stats |

---

## How the scanner works

Every 15 minutes Vercel Cron hits `/api/cron/scan`:

1. Fetches all MEXC USDT tickers
2. Filters by `MIN_MC_VOLUME_PROXY` (24h vol proxy for MC > $100K)
3. For each candidate, fetches last 50 closed 4H candles
4. Runs CRT detection — looks for 3-candle pattern:
   - **C1** sweeps prior swing H or L (liquidity grab)
   - **C2** consolidates inside C1 (>60% overlap)
   - **C3** closes beyond C1 midpoint → confirms direction
5. Deduplicates: skips if same symbol+direction alerted in last 4H
6. Saves every setup to `crt_setups` table (alerted or not)
7. Sends Telegram alert to each active subscriber (respecting their per-user settings)
8. Logs the scan run to `scan_logs`

---

## Supabase tables

### `crt_setups`
Every detected CRT pattern, whether alerted or not.

### `alert_settings`
One row per Telegram user. Controls what they receive.

### `scan_logs`
One row per cron run. Query to see scanner health.

```sql
-- Recent setups
select symbol, direction, c1_range_pct, sweep_pct, detected_at
from crt_setups order by detected_at desc limit 20;

-- Scan history
select started_at, symbols_scanned, setups_found, alerts_sent, error
from scan_logs order by started_at desc limit 10;
```
