/** Routes. Every page renders inside the app shell. */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { Home } from './pages/Home';
import { History } from './pages/History';
import { Usage } from './pages/Usage';
import { SessionPage } from './session/SessionPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { Profiles } from './pages/settings/Profiles';
import { Permissions } from './pages/settings/Permissions';
import { Provider } from './pages/settings/Provider';
import { Language } from './pages/settings/Language';
import { Collaboration } from './pages/settings/Collaboration';
import { General } from './pages/settings/General';
import { Mcp } from './pages/Mcp';
import { Skills } from './pages/Skills';
import { Hooks } from './pages/Hooks';
import { Jobs } from './pages/Jobs';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="sessions" element={<History />} />
        <Route path="s/:id" element={<SessionPage />} />
        <Route path="mcp" element={<Mcp />} />
        <Route path="skills" element={<Skills />} />
        <Route path="hooks" element={<Hooks />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="usage" element={<Usage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="general" replace />} />
          <Route path="general" element={<General />} />
          <Route path="profiles" element={<Profiles />} />
          <Route path="permissions" element={<Permissions />} />
          <Route path="collaboration" element={<Collaboration />} />
          <Route path="provider" element={<Provider />} />
          <Route path="language" element={<Language />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
