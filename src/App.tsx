import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import { Capture } from './pages/Capture'
import { Export } from './pages/Export'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Review } from './pages/Review'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Home />} />
          <Route path="/capture/:sessionId" element={<Capture />} />
          <Route path="/review/:sessionId" element={<Review />} />
          <Route path="/export/:sessionId" element={<Export />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
