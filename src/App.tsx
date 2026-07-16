import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Capture } from './pages/Capture'
import { Export } from './pages/Export'
import { Home } from './pages/Home'
import { Review } from './pages/Review'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/capture/:sessionId" element={<Capture />} />
        <Route path="/review/:sessionId" element={<Review />} />
        <Route path="/export/:sessionId" element={<Export />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
