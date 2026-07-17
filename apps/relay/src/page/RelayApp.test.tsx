// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RelayContent, RelayResult } from '@selfos/core/schemas';

// Mock the relay crypto so the page flow is exercised without jsdom's partial WebCrypto (the crypto
// itself is unit-tested in @selfos/core). openContent/openResult yield whatever the current test set up.
let nextContent: RelayContent;
let nextResult: RelayResult;
vi.mock('@selfos/core/relay', () => ({
  contentKeyFromFragment: () => 'content-key',
  openContent: () => Promise.resolve(nextContent),
  openResult: () => Promise.resolve(nextResult),
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

    // The shared form renders the question; answering → Review & send → Submit reaches the thanks state.
    await userEvent.type(await screen.findByLabelText('One thing I do well?'), 'Listening');
    await userEvent.click(screen.getByRole('button', { name: /review & send/i }));
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText(/thanks for filling this out/i)).toBeInTheDocument();
  });

  it('steps through a multi-question questionnaire one at a time, unlocked (§25.1)', async () => {
    nextContent = content({
      questions: [
        { id: 'a', type: 'shortText', prompt: 'One thing I do well?', required: true },
        { id: 'b', type: 'shortText', prompt: 'One thing to improve?', required: false },
      ],
    });
    mockFetch({
      '/api/unlock': { status: 200, body: { ok: true, sealedContent: envelope, submitted: false } },
      '/api/respond': { status: 200, body: { ok: true } },
    });
    render(<RelayApp />);
    await userEvent.type(screen.getByLabelText(/your pin/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /open questionnaire/i }));
    await userEvent.click(await screen.findByRole('button', { name: /continue/i }));

    // One question at a time: step 1 of 2, primary "Next" (no Submit yet).
    expect(await screen.findByText('Question 1 of 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^submit$/i })).not.toBeInTheDocument();
    // Next advances FREELY even with the required first question empty (§25.1) — no block.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByText(/answer this question before continuing/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Question 2 of 2')).toBeInTheDocument();
    // Back, answer the required q1, then Review & send → Submit → thanks.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.type(screen.getByLabelText('One thing I do well?'), 'Listening');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: /review & send/i }));
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

  it('a compatibility submit lands on the "waiting for results" state (§17.12-D)', async () => {
    nextContent = content({ compatibility: { enabled: true, visibility: 'sharedReport' } });
    mockFetch({
      '/api/unlock': { status: 200, body: { ok: true, sealedContent: envelope, submitted: false } },
      '/api/respond': { status: 200, body: { ok: true } },
    });
    render(<RelayApp />);
    await userEvent.type(screen.getByLabelText(/your pin/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /open questionnaire/i }));
    await userEvent.click(await screen.findByRole('button', { name: /continue/i }));
    await userEvent.type(await screen.findByLabelText('One thing I do well?'), 'Listening');
    await userEvent.click(screen.getByRole('button', { name: /review & send/i }));
    await userEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    // Not the plain "thanks for filling this out" — the results-pending state.
    expect(await screen.findByText(/once everyone has answered/i)).toBeInTheDocument();
  });

  it('renders the sender-pushed report on a return visit (§17.12-D)', async () => {
    nextContent = content({ compatibility: { enabled: true, visibility: 'sharedReport' } });
    nextResult = {
      schemaVersion: 1,
      kind: 'report',
      headline: 'How you and Sam line up',
      summary: 'Mostly aligned, a couple of differences.',
      items: [
        {
          canonicalId: 'a',
          prompt: 'One thing I do well?',
          agreement: 'aligned',
          note: 'Both said listening.',
        },
      ],
      generatedAt: 'now',
    };
    mockFetch({
      '/api/unlock': {
        status: 200,
        body: { ok: true, sealedContent: envelope, submitted: true, sealedResult: envelope },
      },
    });
    render(<RelayApp />);
    await userEvent.type(screen.getByLabelText(/your pin/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /open questionnaire/i }));
    expect(await screen.findByText('How you and Sam line up')).toBeInTheDocument();
    expect(screen.getByText('One thing I do well?')).toBeInTheDocument();
    expect(screen.getByText(/you agree/i)).toBeInTheDocument();
  });
});
