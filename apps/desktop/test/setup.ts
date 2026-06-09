import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Unmount React trees between tests so queries don't match leftovers from a prior render.
afterEach(() => {
  cleanup();
});
