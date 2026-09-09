import { useMemo } from 'react'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { ConvexReactClient } from 'convex/react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'

export const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL
// The marketing pages work without any backend; Charge needs both keys.
export const backendConfigured = Boolean(CLERK_KEY && CONVEX_URL)

function ConfiguredProviders({ children }) {
  const convex = useMemo(() => new ConvexReactClient(CONVEX_URL), [])
  return (
    <ClerkProvider publishableKey={CLERK_KEY} afterSignOutUrl="/">
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  )
}

export function Providers({ children }) {
  if (!backendConfigured) return children
  return <ConfiguredProviders>{children}</ConfiguredProviders>
}
