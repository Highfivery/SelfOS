import { afterEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { Person } from '@shared/schemas';
import type { IntakeState } from '@shared/channels';
import { useNotificationSources } from './useNotificationSources';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useIntakeStore } from '../../stores/intakeStore';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';

const ME: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function asOwner(): void {
  useSessionStore.setState({
    activePerson: ME,
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: ME.id, roleId: 'owner', hasPin: false }],
    },
  });
}

/** A tiny component that runs the sources hook so the candidates land in the store. */
function Harness(): JSX.Element {
  useNotificationSources([]);
  return <div />;
}

afterEach(() => {
  clearMockBridge();
  useNotificationStore.getState().reset();
  useIntakeStore.getState().reset();
  useSessionStore.setState({ activePerson: null, access: null });
});

/** A completed intake with `basics` left inProgress (started, not finished), `c` blank → 1 area (55). */
function completeIntakeWithGap(): IntakeState {
  return {
    session: {
      id: 'intake-1',
      schemaVersion: 1,
      personId: ME.id,
      status: 'complete',
      sections: [
        {
          id: 'basics',
          status: 'inProgress',
          restricted: false,
          messages: [],
          answers: { a: 'x', b: 'y' }, // c unanswered
        },
      ],
      startedAt: 'now',
      updatedAt: 'now',
    },
    sections: [
      {
        id: 'basics',
        title: 'basics',
        blurb: '',
        restricted: false,
        adult: false,
        tier: 'core',
        mode: 'form',
        opener: '',
        questions: ['a', 'b', 'c'].map((id) => ({
          id,
          type: 'shortText' as const,
          prompt: id,
          required: false,
        })),
      },
    ],
    aiAvailable: true,
    adultAcknowledged: false,
  };
}

describe('useNotificationSources — responses-arrived (38 §3.1)', () => {
  it('names a single response and deep-links to that questionnaire’s Results', async () => {
    installMockBridge({
      notificationsResponsesArrived: () =>
        Promise.resolve([
          {
            questionnaireId: 'q1',
            title: 'Our week',
            submittedCount: 1,
            latestRecipientName: 'Angel',
            at: '2026-06-23T10:00:00.000Z',
          },
        ]),
    });
    asOwner();
    await useNotificationStore.getState().load(); // loaded → candidates resolve

    render(<Harness />);

    await waitFor(() => {
      const items = useNotificationStore.getState().notifications;
      const resp = items.find((n) => n.coalesceKey === 'responses-arrived:q1');
      expect(resp).toBeDefined();
      // Names the responder rather than a faceless count, and deep-links straight to Results.
      expect(resp?.title).toBe('Angel answered “Our week”');
      expect(resp?.action).toEqual({
        type: 'navigate',
        to: '/questionnaires?focus=q1&view=results',
      });
    });
  });

  it('nudges the sender about a still-unanswered send (reminder-due, 38 §3.3)', async () => {
    installMockBridge({
      notificationsRemindersDue: () =>
        Promise.resolve([
          { questionnaireId: 'q9', title: 'Our week', recipientName: 'Angel', count: 1 },
        ]),
    });
    asOwner();
    await useNotificationStore.getState().load();

    render(<Harness />);

    await waitFor(() => {
      const rem = useNotificationStore
        .getState()
        .notifications.find((n) => n.coalesceKey === 'reminder-due:q9');
      expect(rem?.title).toBe('Angel hasn’t answered “Our week” yet');
      expect(rem?.action).toEqual({
        type: 'navigate',
        to: '/questionnaires?focus=q9&view=results',
      });
    });
  });

  it('surfaces a stale goal as a goal-followup nudge (40 §3.2)', async () => {
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    installMockBridge({
      goalsList: () =>
        Promise.resolve([
          {
            id: 'g1',
            schemaVersion: 1,
            subjectPersonId: 'owner-1',
            text: 'finish the deck',
            status: 'open',
            provenance: { at: old },
            createdAt: old,
            updatedAt: old,
            lastTouchedAt: old,
          },
        ]),
    });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      const goal = useNotificationStore
        .getState()
        .notifications.find((n) => n.coalesceKey === 'goal-followup');
      expect(goal?.body).toContain('finish the deck');
      expect(goal?.action).toEqual({ type: 'navigate', to: '/goals' });
    });
  });

  it('surfaces the synthesis observation, but yields to a same-area depth invitation (40 §3.3/§3.7)', async () => {
    const synthesis = {
      schemaVersion: 1,
      subjectPersonId: 'owner-1',
      observation: 'Connection keeps surfacing across your reflections.',
      sources: ['sessions'],
      lifeArea: 'Relationships',
      computedAt: '2026-06-24T00:00:00.000Z',
    };
    // No competing depth nudge → the synthesis surfaces.
    installMockBridge({ coachingGetSynthesis: () => Promise.resolve(synthesis) });
    asOwner();
    await useNotificationStore.getState().load();
    const { unmount } = render(<Harness />);
    await waitFor(() => {
      const syn = useNotificationStore
        .getState()
        .notifications.find((n) => n.coalesceKey === 'coaching-synthesis');
      expect(syn?.body).toContain('Connection keeps surfacing');
    });
    unmount();
    clearMockBridge();
    useNotificationStore.getState().reset();

    // A depth invitation for the SAME life-area → the synthesis nudge yields (the actionable one wins).
    installMockBridge({
      coachingGetSynthesis: () => Promise.resolve(synthesis),
      profileSuggestions: () =>
        Promise.resolve([
          {
            id: 'd1',
            schemaVersion: 1,
            subjectPersonId: 'owner-1',
            kind: 'depth' as const,
            lifeArea: 'Relationships',
            observed: 'your family',
            rationale: 'family keeps coming up',
            sourceInsightId: 'i1',
            sourceKind: 'session' as const,
            restricted: false,
            status: 'pending' as const,
            createdAt: 'now',
            updatedAt: 'now',
          },
        ]),
    });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      // The depth/freshness nudge is present…
      expect(
        useNotificationStore
          .getState()
          .notifications.find((n) => n.coalesceKey === 'profile-freshness'),
      ).toBeDefined();
    });
    // …and the synthesis nudge is suppressed for the same area.
    expect(
      useNotificationStore
        .getState()
        .notifications.find((n) => n.coalesceKey === 'coaching-synthesis'),
    ).toBeUndefined();
  });

  it('raises onboarding-updated when a completed intake has unanswered questions (55)', async () => {
    installMockBridge({ intakeGetState: () => Promise.resolve(completeIntakeWithGap()) });
    asOwner();
    await useNotificationStore.getState().load();
    await useIntakeStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      const n = useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'onboarding-updated');
      expect(n).toBeDefined();
      expect(n?.title).toBe('More of your profile to fill in');
      expect(n?.body).toContain('1 area');
      expect(n?.signature).toBe('1'); // the outstanding total (onIncrease keys off it)
      expect(n?.action).toEqual({ type: 'navigate', to: '/onboarding' });
    });
  });

  it('does NOT raise onboarding-updated for a still-in-progress intake (first-run owns it)', async () => {
    const st = completeIntakeWithGap();
    st.session.status = 'inProgress';
    installMockBridge({ intakeGetState: () => Promise.resolve(st) });
    asOwner();
    await useNotificationStore.getState().load();
    await useIntakeStore.getState().load();
    render(<Harness />);
    await waitFor(() => expect(useIntakeStore.getState().loaded).toBe(true));
    expect(
      useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'onboarding-updated'),
    ).toBeUndefined();
  });

  it('nudges the sender when a recipient edited their answers after analysis (answers-updated, 56)', async () => {
    installMockBridge({
      notificationsAnswersUpdated: () =>
        Promise.resolve([
          {
            assignmentId: 'as1',
            questionnaireId: 'q7',
            title: 'Our week',
            recipientName: 'Angel',
            revision: 2,
            at: '2026-07-07T10:00:00.000Z',
          },
        ]),
    });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      const n = useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'answers-updated:as1');
      expect(n?.title).toBe('Angel updated their answers to “Our week”');
      expect(n?.signature).toBe('2'); // the revision — onIncrease re-surfaces on a further edit
      expect(n?.action).toEqual({
        type: 'navigate',
        to: '/questionnaires?focus=q7&view=results',
      });
    });
  });

  it('summarizes multiple responses without naming any one responder', async () => {
    installMockBridge({
      notificationsResponsesArrived: () =>
        Promise.resolve([
          {
            questionnaireId: 'q2',
            title: 'Team pulse',
            submittedCount: 3,
            latestRecipientName: 'Mara',
            at: '2026-06-23T11:00:00.000Z',
          },
        ]),
    });
    asOwner();
    await useNotificationStore.getState().load();

    render(<Harness />);

    await waitFor(() => {
      const resp = useNotificationStore
        .getState()
        .notifications.find((n) => n.coalesceKey === 'responses-arrived:q2');
      expect(resp?.title).toBe('New responses to “Team pulse”');
      expect(resp?.body).toBe('3 responses are ready to review.');
    });
  });
});

describe('useNotificationSources — auto check-ins (63)', () => {
  const autoInboxItem = {
    assignmentId: 'a1',
    title: 'A quick check-in',
    type: 'general',
    questionCount: 3,
    status: 'sent' as const,
    privacy: 'standard' as const,
    senderName: 'Ben',
    createdAt: 'now',
    favorite: false,
    answerable: true,
    hasDraft: false,
    fromSelf: true,
    autoCheckin: {
      targetId: 't-self',
      intent: 'deepen' as const,
      rationale: 'why',
      generatedAt: 'now',
    },
  };

  it('surfaces "a new reflection is ready" for a waiting auto check-in, linking to the Inbox', async () => {
    installMockBridge({ assignmentsInbox: () => Promise.resolve([autoInboxItem]) });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      const n = useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'auto-checkin-ready');
      expect(n?.title).toBe('A new reflection is ready');
      expect(n?.action).toEqual({ type: 'navigate', to: '/inbox' });
    });
  });

  it('fires the one-time "it’s now on" notice when the config was seeded (still enabled)', async () => {
    installMockBridge({
      autoCheckinsGetConfig: () =>
        Promise.resolve({
          schemaVersion: 1,
          enabled: true,
          seededAt: '2026-07-15T00:00:00.000Z',
          targets: [],
        }),
    });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      const n = useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'auto-checkin-enabled');
      expect(n?.title).toBe('Auto check-ins is now on');
      expect(n?.action).toEqual({ type: 'navigate', to: '/questionnaires' });
    });
  });

  it('fires a first-time notice when someone sets up check-ins for you — but not for one you’ve turned off (§3.3a)', async () => {
    installMockBridge({
      autoCheckinsIncomingStreams: () =>
        Promise.resolve([
          {
            senderPersonId: 'angel',
            senderName: 'Angel',
            cadence: 'weekly',
            includeIntimacy: false,
            blocked: false,
          },
          {
            senderPersonId: 'cara',
            senderName: 'Cara',
            cadence: 'daily',
            includeIntimacy: false,
            blocked: true, // already turned off → no notice
          },
        ]),
    });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      const n = useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'auto-checkin-incoming:angel');
      expect(n?.title).toBe('Angel set up check-ins for you');
      expect(n?.action).toEqual({ type: 'navigate', to: '/questionnaires' });
    });
    // The blocked sender does not notify.
    expect(
      useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'auto-checkin-incoming:cara'),
    ).toBeUndefined();
  });

  it('does NOT fire the seed notice once turned off, nor the ready notice with nothing waiting', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([]),
      autoCheckinsGetConfig: () =>
        Promise.resolve({
          schemaVersion: 1,
          enabled: false,
          seededAt: '2026-07-15T00:00:00.000Z',
          targets: [],
        }),
    });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    // Let the effects settle, then assert neither candidate exists.
    await waitFor(() => expect(useNotificationStore.getState().notifications).toBeDefined());
    const keys = useNotificationStore.getState().notifications.map((n) => n.coalesceKey);
    expect(keys).not.toContain('auto-checkin-enabled');
    expect(keys).not.toContain('auto-checkin-ready');
  });
});

describe('useNotificationSources — story-shared (64 §3.6)', () => {
  const sharedBook = (over: Record<string, unknown> = {}) => ({
    authorPersonId: 'auth1',
    authorName: 'Angel',
    bookId: 'b1',
    title: 'The Weight of Quiet',
    publishedAt: '2026-07-16T00:00:00.000Z',
    chapterCount: 5,
    newChapters: 5,
    neverOpened: true,
    updated: true,
    ...over,
  });

  it('surfaces a one-time notification for a NEVER-opened shared book, keyed per book', async () => {
    installMockBridge({ storySharedBooks: () => Promise.resolve([sharedBook()]) });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => {
      const n = useNotificationStore
        .getState()
        .notifications.find((x) => x.coalesceKey === 'story-shared:auth1:b1');
      expect(n).toBeDefined();
      expect(n?.title).toBe('Angel shared their story');
      expect(n?.action).toEqual({ type: 'navigate', to: '/story' });
    });
  });

  it('does NOT notify once the book has been opened (updated marker only, never re-notifies)', async () => {
    // Opened before, but the author republished (updated) — the quiet marker shows on /story, no bell.
    installMockBridge({
      storySharedBooks: () => Promise.resolve([sharedBook({ neverOpened: false, updated: true })]),
    });
    asOwner();
    await useNotificationStore.getState().load();
    render(<Harness />);
    await waitFor(() => expect(useNotificationStore.getState().notifications).toBeDefined());
    const keys = useNotificationStore.getState().notifications.map((n) => n.coalesceKey);
    expect(keys.some((k) => k.startsWith('story-shared:'))).toBe(false);
  });
});
