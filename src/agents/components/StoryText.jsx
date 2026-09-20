import { useState } from 'react'

const CLAMP_AT = 360

/** A field report's text. Long ones are clamped with a toggle, so a feed of
 *  stories stays a feed rather than an essay. */
export default function StoryText({ text }) {
  const [open, setOpen] = useState(false)
  const long = text.length > CLAMP_AT
  return (
    <div className="story">
      <p className={`txt${long && !open ? ' clamped' : ''}`}>{text}</p>
      {long && (
        <button type="button" className="linkbtn tiny" onClick={() => setOpen((o) => !o)}>
          {open ? 'Less' : 'Read the rest'}
        </button>
      )}
    </div>
  )
}
