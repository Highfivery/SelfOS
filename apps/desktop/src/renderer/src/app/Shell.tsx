import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Home } from './routes/Home';
import { Gallery } from './routes/Gallery';
import { Sessions } from './routes/sessions/Sessions';
import { People } from './routes/people/People';
import { Roles } from './routes/roles/Roles';
import { Usage } from './routes/usage/Usage';
import { SettingsScreen } from '../settings/SettingsScreen';
import { useSettingsStore } from '../settings/settingsStore';

/** The main app (rendered once the vault is ready): router + sidebar layout. */
export function Shell(): JSX.Element {
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="people" element={<People />} />
          <Route path="roles" element={<Roles />} />
          <Route path="usage" element={<Usage />} />
          <Route path="settings" element={<SettingsScreen />} />
          {import.meta.env.DEV ? <Route path="gallery" element={<Gallery />} /> : null}
        </Route>
      </Routes>
    </HashRouter>
  );
}
