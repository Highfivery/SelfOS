import { afterEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { Person } from '@shared/schemas';
import { useNotificationSources } from './useNotificationSources';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSessionStore } from '../../stores/sessionStore';
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
  useSessionStore.setState({ activePerson: null, access: null });
});

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
