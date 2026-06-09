import { HashRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './ThemeProvider';
import { AppShell } from './AppShell';
import { Home } from './routes/Home';

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
          </Route>
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}
