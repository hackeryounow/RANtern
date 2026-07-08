import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import Dialer from './pages/Dialer';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/history" element={<History />} />
          <Route path="/dialer" element={<Dialer />} />
          {/* Legacy redirects */}
          <Route path="/provision" element={<Navigate to="/" replace />} />
          <Route path="/test" element={<Navigate to="/" replace />} />
          <Route path="/settings" element={<Navigate to="/" replace />} />
          <Route path="/ngap-stats" element={<Navigate to="/" replace />} />
          <Route path="/profile" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
