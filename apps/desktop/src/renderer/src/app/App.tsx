import { HashRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './ThemeProvider';
import { AppShell } from './AppShell';
import { Home } from './routes/Home';
import { Gallery } from './routes/Gallery';

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            {import.meta.env.DEV ? <Route path="gallery" element={<Gallery />} /> : null}
          </Route>
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}
