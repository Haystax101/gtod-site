import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@gen/api'
import { useSession } from '../lib/session'

const LABEL = { salute: 'Salute', laugh: 'Laugh', heart: 'Love it' }

/**
 * The three taps under a story. Counts come from the server; a tap flips this
 * row's own state straight away so it feels instant, and the next query
 * result overwrites it with the truth.
 */
export default function Reactions({ submissionId, reactions }) {
  const { token } = useSession()
  const react = useMutation(api.stories.react)
  const [pending, setPending] = useState({})

  async function tap(kind) {
    const now = reactions.find((r) => r.kind === kind)
    const mine = pending[kind]?.mine ?? now.mine
    const count = pending[kind]?.count ?? now.count
    setPending((p) => ({ ...p, [kind]: { mine: !mine, count: count + (mine ? -1 : 1) } }))
    try {
      await react({ token, submissionId, kind })
    } catch {
      setPending((p) => {
        const { [kind]: _drop, ...rest } = p
        return rest
      })
    }
  }

  return (
    <div className="reactions">
      {reactions.map((r) => {
        const mine = pending[r.kind]?.mine ?? r.mine
        const count = pending[r.kind]?.count ?? r.count
        return (
          <button
            key={r.kind}
            type="button"
            className={`reaction${mine ? ' on' : ''}`}
            onClick={() => tap(r.kind)}
            aria-pressed={mine}
            aria-label={`${LABEL[r.kind]}${count ? ` (${count})` : ''}`}
            title={LABEL[r.kind]}
          >
            <span className="e">{r.emoji}</span>
            {count > 0 && <span className="n">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
