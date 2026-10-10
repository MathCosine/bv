import { useState } from 'react'
import type { Backend, User } from '../lib/backend'
import type { BackendChoice, Role } from '../lib/config'
import { guessRole } from '../lib/config'
import { IconProjector, IconTablet } from '../ui/icons'

export function Setup({ onDone }: { onDone: (c: BackendChoice) => void }) {
  const [mode, setMode] = useState<'pick' | 'supabase'>('pick')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')

  if (mode === 'pick') {
    return (
      <div className="center-page">
        <div className="card">
          <h1>Set up Overhead</h1>
          <p>Pick where your lessons and drawings are kept.</p>
          <button className="choice" onClick={() => setMode('supabase')}>
            <b>Connect my Supabase project</b>
            <span>For the real thing: your laptop and iPad stay in sync over the internet. Free. The steps are in the README.</span>
          </button>
          <button className="choice" onClick={() => onDone({ kind: 'local' })}>
            <b>Just try it on this device</b>
            <span>Nothing to set up. Open it in two windows to see the live sync. Nothing leaves this browser.</span>
          </button>
        </div>
      </div>
    )
  }

  const save = () => {
    const u = url.trim().replace(/\/+$/, '')
    if (!/^https:\/\/.+/.test(u)) return setErr('The project URL starts with https:// and is on the Supabase project settings page.')
    if (key.trim().length < 20) return setErr('That key looks too short. Copy the publishable key (or the older "anon" key).')
    onDone({ kind: 'supabase', url: u, key: key.trim() })
  }

  return (
    <div className="center-page">
      <div className="card">
        <h1>Connect Supabase</h1>
        <p>In Supabase, open your project and press <b>Connect</b> at the top. Copy these two things.</p>
        <label className="field">
          <span>Project URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcdefgh.supabase.co" autoCapitalize="off" autoCorrect="off" />
        </label>
        <label className="field">
          <span>Publishable (or anon) key</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_…" autoCapitalize="off" autoCorrect="off" />
        </label>
        {err && <p className="error">{err}</p>}
        <p className="hint">You&rsquo;ll paste the same two things on the iPad. (Or set them once as GitHub repo variables, see the README, and nobody has to paste anything.)</p>
        <div className="card-actions">
          <button className="btn red" onClick={save}>Connect</button>
          <button className="text-btn" onClick={() => setMode('pick')}>Back</button>
        </div>
      </div>
    </div>
  )
}

export function SignIn({ backend, onSignedIn, onReset }: { backend: Backend; onSignedIn: (u: User) => void; onReset: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await backend.signIn(email.trim(), password)
      const u = await backend.user()
      if (u) onSignedIn(u)
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="center-page">
      <form className="card" onSubmit={submit}>
        <h1>Sign in</h1>
        <p>Use the account you made in your Supabase project. Do this once on the laptop and once on the iPad.</p>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="off" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="card-actions">
          <button className="btn red" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="text-btn" onClick={onReset}>Use a different project</button>
        </div>
      </form>
    </div>
  )
}

export function RolePicker({ onPick }: { onPick: (r: Role) => void }) {
  const guess = guessRole()
  const options: { role: Role; title: string; body: string; icon: React.ReactNode }[] = [
    { role: 'projector', title: 'The projector', body: 'The laptop plugged into the projector. Shows the slides big, with your pods down the side. You edit pods here.', icon: <IconProjector width={28} height={28} /> },
    { role: 'pad', title: 'My drawing pad', body: 'The iPad. You write on the slides with the Apple Pencil and everything shows up on the projector.', icon: <IconTablet width={28} height={28} /> },
  ]
  if (guess === 'pad') options.reverse()
  return (
    <div className="center-page">
      <div className="card">
        <h1>What&rsquo;s this device?</h1>
        <p>You can change this later from the lesson list.</p>
        {options.map((o) => (
          <button key={o.role} className="choice" onClick={() => onPick(o.role)}>
            <span className="icon">{o.icon}</span>
            <b>{o.title}</b>
            <span>{o.body}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
