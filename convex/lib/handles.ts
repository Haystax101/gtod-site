// TikTok username rules: 2-24 characters, letters, digits, underscores and
// full stops. A leading @ is tolerated and stripped. The handle is stored
// lowercased (TikTok handles are case-insensitive) with the typed case kept
// separately for display.

export const HANDLE_RULE = /^[a-z0-9_.]{2,24}$/

export function normaliseHandle(raw: string) {
  return raw.trim().replace(/^@+/, '').toLowerCase()
}

export function handleProblem(raw: string): string | null {
  const h = normaliseHandle(raw)
  if (h.length < 2) return 'That is too short to be a TikTok username.'
  if (h.length > 24) return 'TikTok usernames are at most 24 characters.'
  if (!HANDLE_RULE.test(h)) return 'TikTok usernames only contain letters, numbers, underscores and full stops.'
  if (h.endsWith('.')) return 'A TikTok username cannot end with a full stop.'
  return null
}

export const MIN_PASSWORD = 8
