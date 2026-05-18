const TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const BASE  = `https://api.telegram.org/bot${TOKEN}`

export async function sendMessage(chatId: string, text: string): Promise<void> {
  const res = await fetch(`${BASE}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      chat_id:    chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`)
  }
}

export async function setWebhook(webhookUrl: string): Promise<void> {
  const res = await fetch(`${BASE}/setWebhook`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: webhookUrl }),
  })
  if (!res.ok) throw new Error(`setWebhook failed: ${res.status}`)
}
