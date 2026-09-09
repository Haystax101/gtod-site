// "Charge": cha + rge, the two logo colours, for Charlie and George.
export function Wordmark({ className = '' }) {
  return (
    <span className={`wordmark ${className}`} aria-label="Charge">
      <span className="cha">cha</span><span className="rge">rge</span>
    </span>
  )
}

export function ChargeMark({ size }) {
  return (
    <span className="charge-mark" style={size ? { width: size, height: size, fontSize: size * 0.4 } : undefined} aria-hidden="true">
      C
    </span>
  )
}
