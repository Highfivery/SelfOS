// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Person, SayLinesResult, SayLinesView, StarredLine } from '@shared/schemas';
import { SayLines } from './SayLines';
import { useSayLinesStore } from '../../../stores/sayLinesStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

/**
 * 75 — the "Say something to <name>" surface.
 *
 * The states that matter are the ones the owner will actually meet: the EMPTY state (§3.4/§7.1 — his own
 * partner has marked nothing, so it is the common case, not an edge case), the ready state, and the two
 * honest failures. Every gate is the bridge's; these cover what the person is shown.
 */

const PARTNER = 'partner-1';

const person = (): Person => ({
  id: 'me',
  schemaVersion: 1,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
});

const view = (over: Partial<SayLinesView> = {}): SayLinesView => ({
  partnerId: PARTNER,
  partnerName: 'Angel',
  ready: true,
  kept: [],
  ...over,
});

const kept = (over: Partial<StarredLine> = {}): StarredLine => ({
  id: 'k1',
  text: 'You are mine tonight.',
  createdAt: 'now',
  ...over,
});

const result = (over: Partial<SayLinesResult> = {}): SayLinesResult => ({
  ok: true,
  lines: [],
  kept: [],
  degraded: false,
  ...over,
});

function mount(partnerId = PARTNER, partnerName = 'Angel'): ReturnType<typeof render> {
  useSessionStore.setState({ activePerson: person() });
  return render(
    <MemoryRouter initialEntries={['/together/desire']}>
      <Routes>
        <Route
          path="/together/desire"
          element={<SayLines partnerId={partnerId} partnerName={partnerName} />}
        />
        <Route path="/tests/dirty-talk/take" element={<div>THE DIRTY TALK TAKE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useSayLinesStore.getState().reset();
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('SayLines (75)', () => {
  it('writes lines, keeps one, and never names a source', async () => {
    const star = vi.fn(() => Promise.resolve([kept({ text: 'Come here, good girl.' })]));
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view()),
      togetherSayLines: () =>
        Promise.resolve(result({ lines: ['Come here, good girl.', 'You are mine tonight.'] })),
      togetherStarLine: star,
    });
    mount();

    await screen.findByRole('heading', { name: 'Say something to Angel' });
    expect(screen.getByText('18+')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Write me some lines' }));
    await screen.findByText('Come here, good girl.');
    expect(screen.getByText('You are mine tonight.')).toBeInTheDocument();
    // Copy is on every line (§3.1) — nothing is sent from here (§2, the no-delivery non-goal).
    expect(screen.getByRole('button', { name: 'Copy: Come here, good girl.' })).toBeInTheDocument();

    // The footer states the boundary the feature is built to hold, in both directions.
    expect(screen.getByText(/Written from what Angel has marked/)).toBeInTheDocument();
    expect(screen.getByText(/never names a source/)).toBeInTheDocument();
    expect(screen.getByText(/never told you used this/)).toBeInTheDocument();

    // Star persists through the bridge and comes back as Kept.
    await userEvent.click(screen.getByRole('button', { name: 'Keep this: Come here, good girl.' }));
    await waitFor(() =>
      expect(star).toHaveBeenCalledWith(
        expect.objectContaining({ partnerId: PARTNER, text: 'Come here, good girl.' }),
      ),
    );
    expect(await screen.findByText('Kept lines')).toBeInTheDocument();
  });

  it('APPENDS a second batch rather than replacing the first (§3.1)', async () => {
    let call = 0;
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view()),
      togetherSayLines: () => {
        call += 1;
        return Promise.resolve(result({ lines: [call === 1 ? 'First line.' : 'Second line.'] }));
      },
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Write me some lines' }));
    await screen.findByText('First line.');
    // The label carries the state — ONE control, because generation always appends.
    await userEvent.click(screen.getByRole('button', { name: 'Write more' }));
    await screen.findByText('Second line.');
    expect(screen.getByText('First line.')).toBeInTheDocument(); // never discarded
  });

  it('the EMPTY state is honest, offers the take, and never nudges her (§3.4/§11.1-7)', async () => {
    installMockBridge({ togetherSayLinesState: () => Promise.resolve(view({ ready: false })) });
    mount();

    expect(await screen.findByText('Angel hasn’t marked anything yet')).toBeInTheDocument();
    expect(screen.getByText(/there’s nothing here to write from yet/)).toBeInTheDocument();
    // No generator at all in this state — no dead button that could only fail.
    expect(screen.queryByRole('button', { name: 'Write me some lines' })).not.toBeInTheDocument();
    // Exactly ONE action, and it is a link to the take — no notification, no outbound message (§11.1-7).
    expect(screen.queryByRole('button', { name: /ask angel/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing you do here is shown to them/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'See what it asks' }));
    expect(await screen.findByText('THE DIRTY TALK TAKE')).toBeInTheDocument();
  });

  it('a kept line SURVIVES the partner clearing their lexicon — it is your own saved content (§8.3)', async () => {
    /*
     * The exact case §11.1-9 decides: her marks go, `ready` flips false, and prose he chose to keep stays.
     * Rendering the kept list only in the ready branch would put the empty state over his own saved lines
     * and tell him they were gone while they sat safe on disk.
     */
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view({ ready: false, kept: [kept()] })),
    });
    mount();
    expect(await screen.findByText('Angel hasn’t marked anything yet')).toBeInTheDocument();
    expect(screen.getByText('Kept lines')).toBeInTheDocument();
    expect(screen.getByText('You are mine tonight.')).toBeInTheDocument();
    // Still removable — nothing about the empty state locks his own content.
    expect(
      screen.getByRole('button', { name: 'Stop keeping: You are mine tonight.' }),
    ).toBeInTheDocument();
  });

  it('"everything was filtered" is its own sentence, and never blames her data (§7.3)', async () => {
    const filtered = 'Everything it wrote touched something you’ve ruled out.';
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view()),
      togetherSayLines: () =>
        Promise.resolve(
          result({ ok: false, degraded: true, reason: 'MALFORMED', message: filtered }),
        ),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Write me some lines' }));
    expect(await screen.findByText(filtered)).toBeInTheDocument();
    // Distinct from the AI-unavailable sentence, and it never names what was ruled out.
    expect(screen.queryByText(/AI isn’t available/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hasn’t marked/)).not.toBeInTheDocument();
  });

  it('AI-off says so, and the kept list still reads (§7.4)', async () => {
    const aiOff = 'AI isn’t available right now — check Settings, then try again.';
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view({ kept: [kept()] })),
      togetherSayLines: () =>
        Promise.resolve(result({ ok: false, degraded: true, message: aiOff })),
    });
    mount();
    await screen.findByText('You are mine tonight.');
    await userEvent.click(screen.getByRole('button', { name: 'Write me some lines' }));
    expect(await screen.findByText(aiOff)).toBeInTheDocument();
    /*
     * The mock deliberately returns an EMPTY kept list with the failure — the hostile shape a refused gate
     * produces. A failed generation must not fold it back into the view, or the screen empties a list that
     * is safe on disk.
     */
    expect(screen.getByText('You are mine tonight.')).toBeInTheDocument();
  });

  it('a chip FILLS the brief box rather than replacing what they typed (§3.1)', async () => {
    installMockBridge({ togetherSayLinesState: () => Promise.resolve(view()) });
    mount();
    const box = await screen.findByLabelText('Anything particular? — optional');
    await userEvent.type(box, 'about last night');
    await userEvent.click(screen.getByRole('button', { name: 'Tonight' }));
    expect(box).toHaveValue('about last night · Tonight');
  });

  it('prefills the box with what they last asked for (§11.1-10)', async () => {
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view({ lastBrief: 'wanting her tonight' })),
    });
    mount();
    await waitFor(() =>
      expect(screen.getByLabelText('Anything particular? — optional')).toHaveValue(
        'wanting her tonight',
      ),
    );
  });

  it('switching partner clears the brief — it is about ONE partner, in their own words', async () => {
    /*
     * The component stays MOUNTED across a partner switch (the picker only changes the prop), so without an
     * explicit reset the text typed for one partner sits in the box under another partner's name.
     */
    installMockBridge({
      togetherSayLinesState: (input) =>
        Promise.resolve(
          input.partnerId === PARTNER
            ? view({ lastBrief: 'wanting her tonight' })
            : view({ partnerId: 'other-1', partnerName: 'Robin' }),
        ),
    });
    const { rerender } = mount();
    const box = await screen.findByLabelText('Anything particular? — optional');
    await waitFor(() => expect(box).toHaveValue('wanting her tonight'));

    rerender(
      <MemoryRouter initialEntries={['/together/desire']}>
        <Routes>
          <Route
            path="/together/desire"
            element={<SayLines partnerId="other-1" partnerName="Robin" />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Say something to Robin' });
    await waitFor(() =>
      expect(screen.getByLabelText('Anything particular? — optional')).toHaveValue(''),
    );
  });

  it('shows realtime progress while it writes — a phase, an elapsed timer and an ETA (§3.5)', async () => {
    let release: (r: SayLinesResult) => void = () => {};
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view()),
      togetherSayLines: () => new Promise<SayLinesResult>((resolve) => (release = resolve)),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Write me some lines' }));

    const bar = await screen.findByRole('progressbar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByText(/finding their register…/)).toBeInTheDocument();
    expect(screen.getByText(/0s elapsed · about 16s left/)).toBeInTheDocument();

    release(result({ lines: ['Done.'] }));
    await screen.findByText('Done.');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('$ is admin-only by construction — a member sees no cost at all', async () => {
    installMockBridge({
      togetherSayLinesState: () => Promise.resolve(view()),
      // The bridge redacts `costUsd` for anyone without `budgets.manage`, so its ABSENCE is the member case.
      togetherSayLines: () => Promise.resolve(result({ lines: ['A line.'] })),
    });
    mount(); // `can()` is false with no `access` loaded — a member
    await userEvent.click(await screen.findByRole('button', { name: 'Write me some lines' }));
    await screen.findByText('A line.');
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Admin only')).not.toBeInTheDocument();
  });
});
