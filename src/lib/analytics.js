const KEY = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'

export const analyticsEnabled = Boolean(KEY && KEY.startsWith('phc_'))

let client = null
const queue = []

// posthog-js is ~300 kB, so it's only downloaded when a key is configured.
export function initAnalytics() {
  if (!analyticsEnabled) return
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(KEY, { api_host: HOST, defaults: '2025-05-24' })
    client = posthog
    queue.splice(0).forEach(([event, props]) => posthog.capture(event, props))
  })
}

export function track(event, props) {
  if (!analyticsEnabled) return
  if (client) client.capture(event, props)
  else queue.push([event, props])
}

// Single-page app: PostHog only sees the first load by itself, so we tell it about route changes.
export function trackPageview() {
  track('$pageview')
}
