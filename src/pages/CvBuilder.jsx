import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { Check, Copy, FileText, Plus, Trash2, X } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { backendConfigured } from '../lib/backend.jsx'
import AppNav from '../components/AppNav.jsx'
import '../styles/cv.css'

/**
 * The CV builder.
 *
 * Structure and the applicant's own words. There is no "write it for me"
 * button anywhere here, on purpose: a CV a student cannot defend in an
 * interview is worse than a weaker one they wrote. The panel on the right
 * checks their draft against the playbook's own rules and says what is missing;
 * it never fills anything in.
 *
 * The sections follow the playbook exactly, because that is what we tell people
 * a CV should contain.
 */

const SECTIONS = [
  { id: 'target', label: 'Target role' },
  { id: 'contact', label: 'Contact details' },
  { id: 'statement', label: 'Personal statement' },
  { id: 'roles', label: 'Experience' },
  { id: 'internships', label: 'Internships' },
  { id: 'education', label: 'Education' },
  { id: 'skills', label: 'Skills' },
  { id: 'references', label: 'References' },
  { id: 'achievements', label: 'Achievements' },
]

const emptySkills = { tools: [], industry: [], soft: [] }
const listToText = (xs) => (xs ?? []).join('\n')
const textToList = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean)

/** Debounced autosave: typing should not fire a mutation per keystroke. */
function useAutosave(id, update) {
  const [pending, setPending] = useState(null)
  useEffect(() => {
    if (!pending || !id) return
    const t = setTimeout(() => {
      update({ id, patch: pending }).catch(() => {})
      setPending(null)
    }, 600)
    return () => clearTimeout(t)
  }, [pending, id, update])
  return setPending
}

export default function CvBuilder() {
  useEffect(() => {
    const prev = document.title
    document.title = 'CV builder | Get There One Day'
    return () => { document.title = prev }
  }, [])

  if (!backendConfigured) {
    return (
      <div className="gate">
        <h2>The CV builder isn't switched on yet</h2>
        <Link className="btn btn-secondary" to="/apprenticeships">Read the playbook instead</Link>
      </div>
    )
  }
  return <Gate />
}

function Gate() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) return <div className="gate"><div className="spinner" /></div>
  if (!isAuthenticated) {
    return (
      <div className="gate">
        <h2>Sign in to build your CV</h2>
        <p>Your drafts are saved to your account so you can tailor one per application.</p>
      </div>
    )
  }
  return <Workspace />
}

function Workspace() {
  const cvs = useQuery(api.cv.list) ?? []
  const create = useMutation(api.cv.create)
  const [activeId, setActiveId] = useState(null)

  // Open the most recent CV rather than an empty screen.
  useEffect(() => {
    if (!activeId && cvs.length) setActiveId(cvs[0]._id)
  }, [cvs, activeId])

  const startNew = async () => {
    const id = await create({ title: 'Untitled CV' })
    setActiveId(id)
  }

  return (
    <>
      <AppNav />
      <main className="cv-page">
        <aside className="cv-list">
          <div className="cv-list-top">
            <button type="button" className="btn btn-primary btn-sm" onClick={startNew}>
              <Plus size={15} /> New CV
            </button>
          </div>
          {cvs.length === 0 && (
            <p className="cv-empty">
              One CV per application. The playbook is blunt about tailoring each one.
            </p>
          )}
          {cvs.map((cv) => (
            <button
              type="button"
              key={cv._id}
              className={`cv-row${cv._id === activeId ? ' active' : ''}`}
              onClick={() => setActiveId(cv._id)}
            >
              <FileText size={15} />
              <span className="cv-row-main">
                <span className="cv-row-title">{cv.title}</span>
                <span className="cv-row-sub">
                  {cv.targetEmployer || cv.targetRole || 'No target role yet'}
                </span>
              </span>
              <span className="cv-row-score">{cv.complete}/{cv.totalChecks}</span>
            </button>
          ))}
        </aside>

        {activeId ? (
          <Editor key={activeId} id={activeId} onDeleted={() => setActiveId(null)} />
        ) : (
          <div className="cv-blank">
            <h2>Build a CV</h2>
            <p>Start one, then tailor a copy for each application.</p>
            <button type="button" className="btn btn-primary" onClick={startNew}>
              <Plus size={16} /> New CV
            </button>
          </div>
        )}
      </main>
    </>
  )
}

function Editor({ id, onDeleted }) {
  const cv = useQuery(api.cv.get, { id })
  const update = useMutation(api.cv.update)
  const duplicate = useMutation(api.cv.duplicate)
  const remove = useMutation(api.cv.remove)
  const save = useAutosave(id, update)
  const [draft, setDraft] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => { if (cv && !draft) setDraft(cv) }, [cv, draft])

  const set = useCallback((patch) => {
    setDraft((d) => ({ ...d, ...patch }))
    save((p) => ({ ...(p ?? {}), ...patch }))
  }, [save])

  if (!cv || !draft) return <div className="cv-editor"><div className="spinner" /></div>

  return (
    <div className="cv-editor">
      <div className="cv-editor-head">
        <input
          className="cv-title"
          value={draft.title ?? ''}
          onChange={(e) => set({ title: e.target.value })}
          aria-label="CV name"
        />
        <div className="cv-head-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => duplicate({ id })}>
            <Copy size={14} /> Tailor a copy
          </button>
          {confirmDelete ? (
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={async () => { await remove({ id }); onDeleted() }}
            >
              Delete for good?
            </button>
          ) : (
            <button type="button" className="icon-btn" aria-label="Delete CV" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </button>
          )}
        </div>
      </div>

      <div className="cv-body">
        <div className="cv-form">
          <Section id="target" title="Target role">
            <p className="cv-hint">
              A CV aimed at nothing reads like it. Name the role and pull its wording into
              your statement and bullets.
            </p>
            <Field label="Role" value={draft.targetRole} onChange={(v) => set({ targetRole: v })} placeholder="e.g. Finance Degree Apprenticeship" />
            <Field label="Employer" value={draft.targetEmployer} onChange={(v) => set({ targetEmployer: v })} placeholder="e.g. PwC" />
          </Section>

          <Section id="contact" title="Contact details">
            <Field label="Full name" value={draft.fullName} onChange={(v) => set({ fullName: v })} />
            <Field label="Email" value={draft.email} onChange={(v) => set({ email: v })} placeholder="firstname.lastname@..." />
            <Field label="Phone" value={draft.phone} onChange={(v) => set({ phone: v })} />
          </Section>

          <Section id="statement" title="Personal statement">
            <p className="cv-hint">Three to five sentences. Who you are, and a couple of things that matter.</p>
            <textarea
              className="cv-textarea"
              rows={5}
              value={draft.personalStatement ?? ''}
              onChange={(e) => set({ personalStatement: e.target.value })}
              placeholder="I am a…"
            />
          </Section>

          <EntryList
            id="roles"
            title="Experience"
            hint="Part-time jobs, volunteering, clubs. Start each bullet with an action verb."
            entries={draft.roles ?? []}
            fields={[['title', 'Role'], ['employer', 'Employer'], ['dates', 'Dates']]}
            blank={{ title: '', employer: '', dates: '', bullets: [] }}
            onChange={(roles) => set({ roles })}
          />

          <EntryList
            id="internships"
            title="Internships and work experience"
            hint="Insight days and virtual schemes count. This is the section that sets people apart."
            entries={draft.internships ?? []}
            fields={[['scheme', 'Scheme'], ['employer', 'Employer'], ['dates', 'Dates']]}
            blank={{ scheme: '', employer: '', dates: '', bullets: [] }}
            onChange={(internships) => set({ internships })}
          />

          <Section id="education" title="Education">
            <p className="cv-hint">A-Levels with grades or predictions, GCSEs, and any relevant modules.</p>
            <SimpleEntries
              entries={draft.education ?? []}
              fields={[['qualification', 'Qualification'], ['detail', 'Subjects and grades'], ['school', 'School'], ['dates', 'Dates']]}
              blank={{ qualification: '', detail: '', school: '', dates: '' }}
              onChange={(education) => set({ education })}
              addLabel="Add qualification"
            />
          </Section>

          <Section id="skills" title="Skills">
            <p className="cv-hint">One per line.</p>
            <ListField label="Tools and technologies" value={draft.skills?.tools} onChange={(tools) => set({ skills: { ...emptySkills, ...draft.skills, tools } })} />
            <ListField label="Industry knowledge" value={draft.skills?.industry} onChange={(industry) => set({ skills: { ...emptySkills, ...draft.skills, industry } })} />
            <ListField label="Soft skills" value={draft.skills?.soft} onChange={(soft) => set({ skills: { ...emptySkills, ...draft.skills, soft } })} />
          </Section>

          <Section id="references" title="References">
            <SimpleEntries
              entries={draft.references ?? []}
              fields={[['name', 'Name'], ['role', 'Job title'], ['company', 'Company'], ['email', 'Email']]}
              blank={{ name: '', role: '', company: '', email: '' }}
              onChange={(references) => set({ references })}
              addLabel="Add reference"
            />
          </Section>

          <Section id="achievements" title="Achievements">
            <p className="cv-hint">Prizes, sport, Young Enterprise, debating. One per line.</p>
            <ListField value={draft.achievements} onChange={(achievements) => set({ achievements })} />
          </Section>
        </div>

        <aside className="cv-side">
          <Checklist checks={cv.checks} words={cv.words} />
          <Preview cv={draft} />
        </aside>
      </div>
    </div>
  )
}

function Section({ id, title, children }) {
  return (
    <section className="cv-section" id={`cv-${id}`}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="cv-field">
      <span>{label}</span>
      <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  )
}

function ListField({ label, value, onChange }) {
  return (
    <label className="cv-field">
      {label && <span>{label}</span>}
      <textarea
        rows={4}
        value={listToText(value)}
        onChange={(e) => onChange(textToList(e.target.value))}
      />
    </label>
  )
}

/** Entries that carry bullet points: experience and internships. */
function EntryList({ id, title, hint, entries, fields, blank, onChange }) {
  const patch = (i, key, val) => {
    const next = entries.map((e, j) => (i === j ? { ...e, [key]: val } : e))
    onChange(next)
  }
  return (
    <Section id={id} title={title}>
      {hint && <p className="cv-hint">{hint}</p>}
      {entries.map((entry, i) => (
        <div className="cv-entry" key={i}>
          <button
            type="button"
            className="icon-btn cv-entry-remove"
            aria-label="Remove entry"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            <X size={15} />
          </button>
          {fields.map(([key, label]) => (
            <Field key={key} label={label} value={entry[key]} onChange={(v) => patch(i, key, v)} />
          ))}
          <ListField
            label="Bullets, one per line"
            value={entry.bullets}
            onChange={(bullets) => patch(i, 'bullets', bullets)}
          />
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...entries, blank])}>
        <Plus size={14} /> Add
      </button>
    </Section>
  )
}

/** Entries that are just fields: education and references. */
function SimpleEntries({ entries, fields, blank, onChange, addLabel }) {
  const patch = (i, key, val) => onChange(entries.map((e, j) => (i === j ? { ...e, [key]: val } : e)))
  return (
    <>
      {entries.map((entry, i) => (
        <div className="cv-entry" key={i}>
          <button
            type="button"
            className="icon-btn cv-entry-remove"
            aria-label="Remove entry"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            <X size={15} />
          </button>
          {fields.map(([key, label]) => (
            <Field key={key} label={label} value={entry[key]} onChange={(v) => patch(i, key, v)} />
          ))}
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...entries, blank])}>
        <Plus size={14} /> {addLabel}
      </button>
    </>
  )
}

function Checklist({ checks, words }) {
  const passed = checks.filter((c) => c.passed).length
  return (
    <div className="cv-checks">
      <div className="cv-checks-head">
        <span className="eyebrow">Against the playbook</span>
        <span className="cv-checks-score">{passed}/{checks.length}</span>
      </div>
      <div className="meter"><i style={{ width: `${(passed / checks.length) * 100}%` }} /></div>
      <ul>
        {checks.map((c) => (
          <li key={c.id} className={c.passed ? 'ok' : ''}>
            <span className="tick">{c.passed ? <Check size={13} /> : null}</span>
            <span>
              {c.label}
              {c.detail && <em>{c.detail}</em>}
            </span>
          </li>
        ))}
      </ul>
      <p className="cv-words">About {words} words.</p>
    </div>
  )
}

/** Live preview, using the same paper styling as the playbook's example CV. */
function Preview({ cv }) {
  const skills = cv.skills ?? emptySkills
  const hasSkills = useMemo(
    () => skills.tools.length || skills.industry.length || skills.soft.length,
    [skills],
  )
  return (
    <div className="cv-preview">
      <div className="eyebrow">Preview</div>
      <div className="paper">
        <div className="name">{cv.fullName || 'Your name'}</div>
        <div className="contact">
          {[cv.email, cv.phone].filter(Boolean).join(' | ') || 'email | phone'}
        </div>
        {cv.personalStatement && <p className="cv-intro">{cv.personalStatement}</p>}

        {(cv.roles ?? []).length > 0 && <h4>Previous roles and experience</h4>}
        {(cv.roles ?? []).map((r, i) => (
          <div key={i}>
            <div className="role">{[r.title, r.employer, r.dates].filter(Boolean).join(' | ')}</div>
            <ul>{r.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
          </div>
        ))}

        {(cv.internships ?? []).length > 0 && <h4>Internships</h4>}
        {(cv.internships ?? []).map((r, i) => (
          <div key={i}>
            <div className="role">{[r.scheme, r.employer, r.dates].filter(Boolean).join(' | ')}</div>
            <ul>{r.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
          </div>
        ))}

        {(cv.education ?? []).length > 0 && <h4>Education</h4>}
        {(cv.education ?? []).length > 0 && (
          <ul>
            {cv.education.map((e, i) => (
              <li key={i}>{[e.qualification, e.detail, e.school, e.dates].filter(Boolean).join(' | ')}</li>
            ))}
          </ul>
        )}

        {hasSkills && <h4>Skills</h4>}
        {hasSkills && (
          <ul>
            {skills.tools.length > 0 && <li>Tools and technologies: {skills.tools.join(', ')}</li>}
            {skills.industry.length > 0 && <li>Industry knowledge: {skills.industry.join(', ')}</li>}
            {skills.soft.length > 0 && <li>Soft skills: {skills.soft.join(', ')}</li>}
          </ul>
        )}

        {(cv.references ?? []).length > 0 && <h4>References</h4>}
        {(cv.references ?? []).length > 0 && (
          <ul>
            {cv.references.map((r, i) => (
              <li key={i}>{[r.name, r.role, r.company, r.email].filter(Boolean).join(', ')}</li>
            ))}
          </ul>
        )}

        {(cv.achievements ?? []).length > 0 && <h4>Achievements</h4>}
        {(cv.achievements ?? []).length > 0 && (
          <ul>{cv.achievements.map((a, i) => <li key={i}>{a}</li>)}</ul>
        )}
      </div>
    </div>
  )
}

export { SECTIONS }
