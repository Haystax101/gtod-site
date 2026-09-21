import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useSession } from './lib/session'
import Shell from './components/Shell'
import Gate from './pages/Gate'
import Briefing from './pages/Briefing'
import Missions from './pages/Missions'
import Board from './pages/Board'
import Coverage from './pages/Coverage'
import Forum from './pages/Forum'
import Thread from './pages/Thread'
import Room from './pages/Room'
import { Dispatch, DispatchList } from './pages/Dispatches'
import Line from './pages/Line'
import Me from './pages/Me'
import Profile from './pages/Profile'
import Story from './pages/Story'
import HQ from './pages/HQ'
import Terms from './pages/Terms'

function Loading() {
  return (
    <div className="gate">
      <div className="row" style={{ gap: 12 }}>
        <span className="spin" />
        <span className="eyebrow">Verifying clearance</span>
      </div>
    </div>
  )
}

export default function App() {
  const { me, loading } = useSession()
  const location = useLocation()

  if (location.pathname === '/terms') return <Terms />
  if (loading) return <Loading />
  if (!me) return <Gate />

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Briefing />} />
        <Route path="missions" element={<Missions />} />
        <Route path="board" element={<Board />} />
        <Route path="coverage" element={<Coverage />} />
        <Route path="forum" element={<Forum />} />
        <Route path="forum/room/:room" element={<Room />} />
        <Route path="forum/:threadId" element={<Thread />} />
        <Route path="dispatches" element={<DispatchList />} />
        <Route path="dispatches/:id" element={<Dispatch />} />
        <Route path="line" element={<Line />} />
        <Route path="me" element={<Me />} />
        <Route path="a/:handle" element={<Profile />} />
        <Route path="s/:submissionId" element={<Story />} />
        <Route path="hq/*" element={me.rank === 'lead' ? <HQ /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
