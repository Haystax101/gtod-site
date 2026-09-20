// Password and token hashing on Web Crypto, which the default Convex runtime
// supports, so none of this needs a Node action.

// OWASP's 2023 figure for PBKDF2-HMAC-SHA256. ~75 ms in the Convex runtime.
const PBKDF2_ITERATIONS = 600_000

function toHex(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string) {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return toHex(bits)
}

/** `pbkdf2$<iterations>$<salt-hex>$<hash-hex>` so the cost can be raised later. */
export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${hash}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, saltHex, hash] = stored.split('$')
  if (scheme !== 'pbkdf2') return false
  const candidate = await derive(password, fromHex(saltHex), Number(iter))
  // Constant-time compare. Both are hex of equal length.
  if (candidate.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

/** True when a stored hash uses fewer iterations than we now require; rehash it at the next successful login. */
export function needsRehash(stored: string) {
  const [scheme, iter] = stored.split('$')
  return scheme !== 'pbkdf2' || Number(iter) < PBKDF2_ITERATIONS
}

export function newToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}

export async function sha256(text: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}
