import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import NGAPStats from './pages/NGAPStats';
import History from './pages/History';
import Profile from './pages/Profile';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ngap-stats" element={<NGAPStats />} />
          <Route path="/history" element={<History />} />
          <Route path="/profile" element={<Profile />} />
          {/* Legacy redirects */}
          <Route path="/provision" element={<Navigate to="/" replace />} />
          <Route path="/test" element={<Navigate to="/" replace />} />
          <Route path="/settings" element={<Navigate to="/profile" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
