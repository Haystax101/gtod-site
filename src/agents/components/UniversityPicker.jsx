import { useEffect, useMemo, useRef, useState } from 'react'
import { NOT_AT_UNI, OTHER_UNI, UNIVERSITIES, universityById } from '../../../convex/lib/universities'

const EXTRAS = [NOT_AT_UNI, OTHER_UNI]

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Type-to-filter combobox over the UK university list. value/onChange carry
 * the university id. Matching ignores "University of" so "leeds" finds all
 * three Leeds institutions and "ucl" finds UCL.
 */
/** Picker plus the free-text box that appears when "Somewhere else" is chosen. */
export function UniversityField({ value, onChange, other, onOther, id = 'uni' }) {
  return (
    <>
      <UniversityPicker id={id} value={value} onChange={onChange} />
      {value === OTHER_UNI.id && (
        <input className="input" style={{ marginTop: 8 }} placeholder="Name it, and HQ will add it to the list" value={other} onChange={(e) => onOther(e.target.value)} maxLength={80} />
      )}
    </>
  )
}

export default function UniversityPicker({ value, onChange, id = 'uni', autoFocus }) {
  const selected = universityById(value)
  const [text, setText] = useState(selected?.name ?? '')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef(null)

  useEffect(() => { if (!open) setText(selected?.name ?? '') }, [value, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const q = norm(text)
    if (!q) return [...UNIVERSITIES.slice(0, 8), ...EXTRAS]
    const words = q.split(' ')
    const score = (name) => {
      const n = norm(name)
      const stripped = n.replace(/\b(the|university|of|for|college|london)\b/g, ' ').replace(/\s+/g, ' ').trim()
      if (!words.every((w) => n.includes(w))) return 0
      if (stripped === q) return 4
      if (stripped.startsWith(q) || n.startsWith(q)) return 3
      if (stripped.split(' ').some((t) => t.startsWith(words[0]))) return 2
      return 1
    }
    const ranked = [...UNIVERSITIES, ...EXTRAS]
      .map((u) => [u, score(u.name)])
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))
      .map(([u]) => u)
    // "Somewhere else" is always reachable, so nobody is stuck if their place is missing.
    if (!ranked.includes(OTHER_UNI)) ranked.push(OTHER_UNI)
    return ranked.slice(0, 12)
  }, [text])

  useEffect(() => {
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [])

  function pick(u) {
    onChange(u.id)
    setText(u.name)
    setOpen(false)
  }

  function onKey(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(matches.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[hi]) pick(matches[hi]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="combo" ref={box}>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Start typing… e.g. Leeds, UCL, Cardiff Met"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); if (value) onChange('') }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {selected && <span className="combo-tick">✓</span>}
      {open && (
        <ul className="combo-list" role="listbox">
          {matches.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={u.id === value}
              className={`${i === hi ? 'hi' : ''} ${u.id === 'none' || u.id === 'other' ? 'extra' : ''}`}
              onPointerDown={(e) => { e.preventDefault(); pick(u) }}
              onMouseEnter={() => setHi(i)}
            >
              {u.name}
            </li>
          ))}
          {matches.length === 0 && <li className="extra">No match. Try fewer words.</li>}
        </ul>
      )}
    </div>
  )
}
