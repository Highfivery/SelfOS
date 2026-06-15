import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Home } from './routes/home/Home';
import { Gallery } from './routes/Gallery';
import { Sessions } from './routes/sessions/Sessions';
import { Questionnaires } from './routes/questionnaires/Questionnaires';
import { Inbox } from './routes/inbox/Inbox';
import { Memory } from './routes/memory/Memory';
import { Dreams } from './routes/dreams/Dreams';
import { DreamPatterns } from './routes/dreams/DreamPatterns';
import { Onboarding } from './routes/onboarding/Onboarding';
import { People } from './routes/people/People';
import { Roles } from './routes/roles/Roles';
import { Usage } from './routes/usage/Usage';
import { SettingsScreen } from '../settings/SettingsScreen';
import { useSettingsStore } from '../settings/settingsStore';
import { useNavStore } from '../stores/navStore';

/** The main app (rendered once the vault is ready): router + sidebar layout. */
export function Shell(): JSX.Element {
  useEffect(() => {
    void useSettingsStore.getState().load();
    void useNavStore.getState().load();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="questionnaires" element={<Questionnaires />} />
          <Route path="inbox" element={<Inbox />} />
          <Route path="memory" element={<Memory />} />
          <Route path="dreams" element={<Dreams />} />
          <Route path="dreams/patterns" element={<DreamPatterns />} />
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
