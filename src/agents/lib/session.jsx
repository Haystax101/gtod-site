import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@gen/api'

const KEY = 'gtod.agent.token'
const Ctx = createContext(null)

function readToken() {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

export function SessionProvider({ children }) {
  const [token, setTokenState] = useState(readToken)
  const me = useQuery(api.agents.me, { token: token ?? undefined })
  const touch = useMutation(api.agents.touch)
  const logOutMutation = useMutation(api.agents.logOut)

  const setToken = useCallback((t) => {
    try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch {}
    setTokenState(t)
  }, [])

  // A token the server no longer recognises (expired, removed) is dropped so
  // the gate shows instead of a permanently loading page.
  useEffect(() => {
    if (token && me === null) setToken(null)
  }, [token, me, setToken])

  useEffect(() => {
    if (token && me) touch({ token }).catch(() => {})
  }, [token, me?._id]) // eslint-disable-line react-hooks/exhaustive-deps

  const logOut = useCallback(async () => {
    if (token) await logOutMutation({ token }).catch(() => {})
    setToken(null)
  }, [token, logOutMutation, setToken])

  const value = useMemo(
    () => ({ token, setToken, me: me ?? null, loading: token !== null && me === undefined, logOut }),
    [token, setToken, me, logOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  return useContext(Ctx)
}

/** ConvexError carries its message in .data; anything else is a bug, so show something generic. */
export function errMsg(e) {
  if (e && typeof e.data === 'string') return e.data
  if (e?.data?.message) return e.data.message
  return 'Something went wrong. Try again.'
}
