import { ThemeProvider } from './ThemeProvider';
import { BootGate } from './BootGate';

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <BootGate />
    </ThemeProvider>
  );
}
