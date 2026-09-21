/**
 * Renders a dispatch body. Plain text with a little structure, no HTML:
 *   blank line      -> new paragraph
 *   "## Heading"    -> section heading
 *   "- item"        -> bullet list
 *   "> quote"       -> pull quote
 *   **bold** and _italic_ inline
 * Everything is built as React nodes, never injected as markup.
 */
export default function Prose({ text }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <div className="prose dispatch-body">
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        if (/^##\s/.test(lines[0])) return <h2 key={i} className="display">{inline(lines[0].replace(/^##\s+/, ''))}</h2>
        if (lines.length > 1 && lines.every((l) => /^-\s/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^-\s+/, ''))}</li>)}</ul>
        if (lines.every((l) => /^>\s?/.test(l))) return <blockquote key={i}>{inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}</blockquote>
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>{inline(l)}{j < lines.length - 1 && <br />}</span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function inline(s) {
  const parts = s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>
    if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>
    return p
  })
}
