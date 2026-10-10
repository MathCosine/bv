import { useEffect, useRef, useState } from 'react'
import type { Backend, User } from './lib/backend'
import { backendFor, readChoice, readRole, saveChoice, saveRole, type BackendChoice, type Role } from './lib/config'
import { Hub } from './lib/hub'
import { Session } from './lib/session'
import { useHashRoute } from './ui/hooks'
import { Library } from './views/Library'
import { PadView } from './views/PadView'
import { ProjectorView } from './views/ProjectorView'
import { RolePicker, Setup, SignIn } from './views/Setup'

export function App() {
  const [choice, setChoice] = useState<BackendChoice | null>(readChoice)
  if (!choice) {
    return (
      <Setup
        onDone={(c) => {
          saveChoice(c)
          setChoice(c)
        }}
      />
    )
  }
  return (
    <WithBackend
      key={JSON.stringify(choice)}
      backend={backendFor(choice)}
      onReset={() => {
        saveChoice(null)
        setChoice(null)
      }}
    />
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="center-page">
      <p className="hint">{children}</p>
    </div>
  )
}

function WithBackend({ backend, onReset }: { backend: Backend; onReset: () => void }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [role, setRole] = useState<Role | null>(readRole)
  useEffect(() => {
    backend.user().then(setUser).catch(() => setUser(null))
  }, [backend])

  if (user === undefined) return <Note>Loading&hellip;</Note>
  if (!user) return <SignIn backend={backend} onSignedIn={setUser} onReset={onReset} />
  if (!role) {
    return (
      <RolePicker
        onPick={(r) => {
          saveRole(r)
          setRole(r)
        }}
      />
    )
  }
  return (
    <Connected
      key={`${user.id}:${role}`}
      backend={backend}
      user={user}
      role={role}
      onSwitchRole={() => {
        const r = role === 'pad' ? 'projector' : 'pad'
        saveRole(r)
        setRole(r)
      }}
      onSignOut={async () => {
        await backend.signOut()
        setUser(null)
      }}
      onReset={onReset}
    />
  )
}

interface ConnectedProps {
  backend: Backend
  user: User
  role: Role
  onSwitchRole: () => void
  onSignOut: () => void
  onReset: () => void
}

function Connected(props: ConnectedProps) {
  const { backend, user, role } = props
  const [hub, setHub] = useState<Hub | null>(null)
  useEffect(() => {
    const h = new Hub(backend.pipe(user), role)
    setHub(h)
    return () => h.destroy()
  }, [backend, user, role])
  if (!hub) return <Note>Connecting&hellip;</Note>
  return <Routes {...props} hub={hub} />
}

function Routes({ backend, user, role, hub, onSwitchRole, onSignOut, onReset }: ConnectedProps & { hub: Hub }) {
  const [route, go] = useHashRoute()
  const lessonId = route.startsWith('/l/') ? route.slice(3) : null
  const current = useRef(lessonId)
  current.current = lessonId

  // Follow the other device: open whatever lesson the iPad opens.
  useEffect(
    () =>
      hub.on((m, _from, fromRole) => {
        if (m.t === 'deleted' && m.lesson === current.current) go('/')
        if (!('lesson' in m) || !m.lesson) return
        if (role === 'projector' && fromRole === 'pad') {
          if (m.t === 'open' || (m.t === 'hello' && !current.current)) go(`/l/${m.lesson}`)
        }
        if (role === 'pad' && fromRole === 'projector' && m.t === 'open' && !current.current) go(`/l/${m.lesson}`)
      }),
    [hub, role, go],
  )

  const open = (id: string) => {
    hub.sendNow({ t: 'open', lesson: id })
    go(`/l/${id}`)
  }

  if (lessonId) return <LessonRoute key={lessonId} id={lessonId} backend={backend} hub={hub} role={role} onExit={() => go('/')} />
  return (
    <Library
      backend={backend}
      user={user}
      hub={hub}
      role={role}
      onOpen={open}
      onSwitchRole={onSwitchRole}
      onSignOut={onSignOut}
      onReset={onReset}
    />
  )
}

function LessonRoute({ id, backend, hub, role, onExit }: { id: string; backend: Backend; hub: Hub; role: Role; onExit: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let s: Session | null = null
    let live = true
    backend
      .getLesson(id)
      .then(async (lesson) => {
        if (!live) return
        if (!lesson) {
          setErr('That lesson isn’t here any more.')
          return
        }
        const mine = new Session(backend, hub, lesson, role)
        s = mine
        await mine.load()
        if (live) setSession(mine)
        else mine.close()
      })
      .catch((e) => live && setErr((e as Error).message))
    return () => {
      live = false
      s?.close()
      hub.setLesson(null)
    }
  }, [id, backend, hub, role])

  if (err) {
    return (
      <div className="center-page">
        <div className="card">
          <h1>Hmm.</h1>
          <p>{err}</p>
          <button className="btn" onClick={onExit}>Back to lessons</button>
        </div>
      </div>
    )
  }
  if (!session) return <Note>Opening the lesson&hellip;</Note>
  return role === 'pad' ? (
    <PadView session={session} hub={hub} backend={backend} onExit={onExit} />
  ) : (
    <ProjectorView session={session} hub={hub} backend={backend} onExit={onExit} />
  )
}
