import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '@gen/api'
import { useSession } from '../lib/session'
import { Avatar, Handle, RankPill } from '../components/Badges'
import { pluralise } from '../lib/format'
import outline from '../lib/uk.geo.json'

// No tile server: the map is the Natural Earth coastline (public domain) drawn
// as vectors on the app's own background. Nothing to key, nothing to attribute,
// and it looks like a briefing-room map rather than Google Maps.
const UK_BOUNDS = [[49.9, -8.2], [58.7, 1.8]]

export default function Coverage() {
  const { token } = useSession()
  const groups = useQuery(api.agents.coverage, { token })
  const mapEl = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)

  useEffect(() => {
    if (!mapEl.current || map.current) return
    const m = L.map(mapEl.current, { zoomControl: false, attributionControl: false, scrollWheelZoom: false, minZoom: 4, maxZoom: 9, maxBounds: [[47, -14], [62, 8]] })
    L.geoJSON(outline, {
      style: (f) => ({
        color: f.properties.a3 === 'GBR' ? '#8a8177' : '#3a3330',
        weight: f.properties.a3 === 'GBR' ? 1.2 : 1,
        fillColor: f.properties.a3 === 'GBR' ? '#221e1c' : '#171413',
        fillOpacity: 1,
      }),
      interactive: false,
    }).addTo(m)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    m.fitBounds(UK_BOUNDS, { padding: [10, 10] })
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    return () => { m.remove(); map.current = null }
  }, [])

  useEffect(() => {
    if (!map.current || !layer.current || !groups) return
    layer.current.clearLayers()
    const mapped = groups.filter((g) => g.lat !== null)
    for (const g of mapped) {
      const n = g.agents.length
      const r = 7 + Math.sqrt(n) * 5
      const marker = L.circleMarker([g.lat, g.lng], {
        radius: r, color: '#f4eee3', weight: 1.5, fillColor: '#f2662b', fillOpacity: 0.85,
      })
      const list = g.agents.slice(0, 12).map((a) => `<li>@${esc(a.displayHandle)} <span>${esc(a.rankLabel)}</span></li>`).join('')
      const more = n > 12 ? `<li class="more">+${n - 12} more</li>` : ''
      marker.bindPopup(`<div class="pop"><b>${esc(g.name)}</b><div class="cnt">${n} ${n === 1 ? 'agent' : 'agents'}</div><ul>${list}${more}</ul></div>`, { maxWidth: 260 })
      marker.bindTooltip(`${g.name} · ${n}`, { direction: 'top', opacity: 0.9 })
      marker.addTo(layer.current)
    }
    if (mapped.length) {
      const b = L.latLngBounds(mapped.map((g) => [g.lat, g.lng])).pad(0.4)
      map.current.fitBounds(b.isValid() ? b : UK_BOUNDS, { padding: [20, 20], maxZoom: 7 })
    }
  }, [groups])

  const total = groups?.reduce((s, g) => s + g.agents.length, 0) ?? 0
  const unis = groups?.filter((g) => g.lat !== null).length ?? 0

  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">Deployment · <b>Operative coverage</b></span>
        <h1 className="display">Coverage</h1>
        <p className="small">{groups ? `${pluralise(total, 'agent')} across ${pluralise(unis, 'university', 'universities')}.` : 'Where the programme has people on the ground.'}</p>
      </div>

      <div className="cats">
        <Link to="/board" className="btn xs ghost">Leaderboard</Link>
        <Link to="/coverage" className="btn xs">Coverage map</Link>
      </div>

      <div className="card mapcard">
        <div className="map" ref={mapEl} />
      </div>

      <div className="card">
        <div className="card-head"><span className="eyebrow">By university</span></div>
        {groups === undefined && <div className="empty"><span className="spin" /></div>}
        {groups?.map((g) => (
          <details key={g.universityId} className="cov">
            <summary>
              <span className="cov-n">{g.agents.length}</span>
              <span className="cov-name">{g.name}</span>
            </summary>
            <div className="cov-list">
              {g.agents.map((a) => (
                <div key={a._id} className="feed-item">
                  <Avatar agent={a} />
                  <div className="txt"><b><Handle agent={a} /></b></div>
                  <RankPill rank={a.rank} rankLabel={a.rankLabel} small />
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="footnote">Not on the map? Set your university under your file. · Coastline: Natural Earth</p>
    </div>
  )
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
