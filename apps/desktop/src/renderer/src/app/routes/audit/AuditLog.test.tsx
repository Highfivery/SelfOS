import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { RawAccessAuditEntry } from '@shared/schemas';
import { AuditLog } from './AuditLog';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => clearMockBridge());

const entry = (over: Partial<RawAccessAuditEntry> = {}): RawAccessAuditEntry => ({
  schemaVersion: 1,
  at: '2026-06-11T10:00:00.000Z',
  by: 'super-admin',
  viaSuperAdmin: true,
  assignmentId: 'a1',
  recipientName: 'Alex',
  action: 'revealRaw',
  ...over,
});

describe('AuditLog', () => {
  it('shows the empty state + the admin-only marker when nothing was ever revealed', async () => {
    installMockBridge({ auditList: () => Promise.resolve([]) });
    render(<AuditLog />);
    expect(await screen.findByText('Nothing has ever been revealed.')).toBeInTheDocument();
    expect(screen.getByText('Admin only')).toBeInTheDocument();
  });

  it('lists reveal entries, distinguishing super-admin from a readRaw sender', async () => {
    installMockBridge({
      auditList: () =>
        Promise.resolve([entry(), entry({ viaSuperAdmin: false, by: 'p1', recipientName: 'Bri' })]),
    });
    render(<AuditLog />);
    await waitFor(() => expect(screen.getAllByText('Revealed raw answers')).toHaveLength(2));
    expect(screen.getByText('Super-admin')).toBeInTheDocument();
    expect(screen.getByText('Sender (readRaw)')).toBeInTheDocument();
  });

  it('renders a restricted-onboarding reveal entry distinctly', async () => {
    installMockBridge({
      auditList: () =>
        Promise.resolve([
          entry({
            action: 'revealRestricted',
            assignmentId: undefined,
            recipientName: undefined,
            subjectPersonId: 'p1',
            subjectName: 'Sam',
            viaSuperAdmin: false,
          }),
        ]),
    });
    render(<AuditLog />);
    expect(await screen.findByText('Revealed restricted onboarding content')).toBeInTheDocument();
    expect(screen.getByText('readRestricted')).toBeInTheDocument();
    expect(screen.getByText(/Sam’s onboarding/)).toBeInTheDocument();
  });
});
