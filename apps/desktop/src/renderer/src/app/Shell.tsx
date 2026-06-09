import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Home } from './routes/Home';
import { Gallery } from './routes/Gallery';

/** The main app (rendered once the vault is ready): router + sidebar layout. */
export function Shell(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          {import.meta.env.DEV ? <Route path="gallery" element={<Gallery />} /> : null}
        </Route>
      </Routes>
    </HashRouter>
  );
}
