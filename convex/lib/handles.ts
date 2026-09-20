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

// The passwords people actually type. Not exhaustive: it is the floor, not a strength meter.
const COMMON = new Set(`password password1 password123 passw0rd 12345678 123456789 1234567890 qwerty123 qwertyuiop
11111111 00000000 iloveyou sunshine princess football baseball welcome1 letmein1 abc12345 monkey123 dragon123
superman batman123 trustno1 whatever changeme freshers freshers1 freshers2026 uni2026 university tiktok123
liverpool chelsea1 arsenal1 manchester password! password1! qwerty1234 asdfghjkl zxcvbnm1 1q2w3e4r 1234qwer`.split(/\s+/))

export function passwordProblem(password: string, handle: string): string | null {
  if (password.length < MIN_PASSWORD) return `Password needs at least ${MIN_PASSWORD} characters.`
  if (password.length > 128) return 'That password is too long.'
  const lower = password.toLowerCase()
  if (COMMON.has(lower) || COMMON.has(lower.replace(/[^a-z0-9]/g, ''))) return 'That password is on every hacker\'s list. Pick something less common.'
  if (handle.length >= 4 && lower.includes(handle.toLowerCase())) return 'Your password cannot contain your username.'
  if (/^(.)\1+$/.test(password) || /^(?:0123|1234|2345|3456|4567|5678|6789|7890|abcd|qwer)/i.test(password) && password.length < 12) return 'Too predictable. Mix it up a bit.'
  return null
}
