// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RelayContent } from '@selfos/core/schemas';

// Mock the relay crypto so the page flow is exercised without jsdom's partial WebCrypto (the crypto
// itself is unit-tested in @selfos/core). openContent yields whatever the current test set up.
let nextContent: RelayContent;
vi.mock('@selfos/core/relay', () => ({
  contentKeyFromFragment: () => 'content-key',
  openContent: () => Promise.resolve(nextContent),
  openImageBytes: () => Promise.resolve(new Uint8Array()),
  sealResponse: () =>
    Promise.resolve({ epk: 'E', env: { v: 1, alg: 'aes-256-gcm', iv: '', tag: '', data: '' } }),
}));

import { RelayApp } from './RelayApp';

const envelope = { v: 1 as const, alg: 'aes-256-gcm' as const, iv: '', tag: '', data: '' };

function content(over: Partial<RelayContent['questionnaire']> = {}): RelayContent {
  return {
    schemaVersion: 1,
    questionnaire: {
      id: 'q1',
      schemaVersion: 1,
      version: 1,
      title: 'How am I doing?',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'a', type: 'shortText', prompt: 'One thing I do well?', required: true }],
      createdAt: 'now',
      updatedAt: 'now',
      ...over,
    },
    publicKey: 'pk',
    senderName: 'Sam',
    disclosure: 'Your answers are private.',
    images: {},
  };
}

function mockFetch(routes: Record<string, { status: number; body: unknown }>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const route = routes[String(input)] ?? { status: 404, body: {} };
      return Promise.resolve(new Response(JSON.stringify(route.body), { status: route.status }));
    }),
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/q/tok#k=content-key');
  nextContent = content();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RelayApp', () => {
  it('gates on the PIN, then shows consent and the questionnaire', async () => {
    mockFetch({
      '/api/unlock': { status: 200, body: { ok: true, sealedContent: envelope, submitted: false } },
      '/api/respond': { status: 200, body: { ok: true } },
    });
    render(<RelayApp />);
    expect(screen.getByText(/enter the pin/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/your pin/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /open questionnaire/i }));

    // Consent screen: the derived disclosure + who's asking.
    expect(await screen.findByText('Your answers are private.')).toBeInTheDocument();
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    // The shared form renders the question; answering + submit reaches the thanks state.
    await userEvent.type(await screen.findByLabelText('One thing I do well?'), 'Listening');
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText(/thanks for filling this out/i)).toBeInTheDocument();
  });

  it('shows the attempts-left error on a wrong PIN', async () => {
    mockFetch({
      '/api/unlock': { status: 401, body: { error: 'wrong pin', attemptsRemaining: 4 } },
    });
    render(<RelayApp />);
    await userEvent.type(screen.getByLabelText(/your pin/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /open questionnaire/i }));
    expect(await screen.findByText(/4 attempts left/i)).toBeInTheDocument();
  });

  it('requires an 18+ date of birth before explicit content can continue', async () => {
    nextContent = content({ sensitivity: 'explicit' });
    mockFetch({
      '/api/unlock': { status: 200, body: { ok: true, sealedContent: envelope, submitted: false } },
    });
    render(<RelayApp />);
    await userEvent.type(screen.getByLabelText(/your pin/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /open questionnaire/i }));

    // The DOB gate blocks Continue until an adult birthdate is entered.
    const cont = await screen.findByRole('button', { name: /continue/i });
    expect(cont).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/date of birth/i), '1990-01-01');
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('shows the already-submitted thank-you on a return visit', async () => {
    mockFetch({
      '/api/unlock': { status: 200, body: { ok: true, sealedContent: envelope, submitted: true } },
    });
    render(<RelayApp />);
    await userEvent.type(screen.getByLabelText(/your pin/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /open questionnaire/i }));
    expect(await screen.findByText(/already answered/i)).toBeInTheDocument();
  });
});
