import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewQuestionnaireStart } from './NewQuestionnaireStart';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { DEFAULT_ROLES } from '@shared/capabilities';

afterEach(() => {
  usePeopleStore.setState({ people: [], loaded: false });
  useSessionStore.setState({ activePerson: null, access: null });
});

function seed(canExternal = true): void {
  usePeopleStore.setState({
    people: [
      {
        id: 'p1',
        schemaVersion: 1,
        displayName: 'Mara',
        isSubject: true,
        tags: [],
        createdAt: 'n',
        updatedAt: 'n',
      },
    ],
    loaded: true,
  });
  // The Owner has sendExternal; a member-as-active without it hides the external option.
  useSessionStore.setState({
    activePerson: {
      id: 'o1',
      schemaVersion: 1,
      displayName: 'Ben',
      isSubject: true,
      tags: [],
      createdAt: 'n',
      updatedAt: 'n',
    },
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: 'o1', roleId: canExternal ? 'owner' : 'guest', hasPin: false }],
    },
  });
}

describe('NewQuestionnaireStart (§17.3)', () => {
  it('resolves to a bound household recipient', async () => {
    seed();
    const onChosen = vi.fn();
    render(<NewQuestionnaireStart onChosen={onChosen} onCancel={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Who is this for?'), 'p1');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onChosen).toHaveBeenCalledWith({
      compat: false,
      recipient: { kind: 'person', personId: 'p1' },
    });
  });

  it('blocks Continue until a recipient is chosen (can’t author for nobody)', async () => {
    seed();
    const onChosen = vi.fn();
    render(<NewQuestionnaireStart onChosen={onChosen} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onChosen).not.toHaveBeenCalled();
    expect(screen.getByText(/choose who this is for/i)).toBeInTheDocument();
  });

  it('resolves to an external recipient with a required name', async () => {
    seed();
    const onChosen = vi.fn();
    render(<NewQuestionnaireStart onChosen={onChosen} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Someone else (link)' }));
    await userEvent.type(screen.getByLabelText('Their name'), 'Alex');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onChosen).toHaveBeenCalledWith({
      compat: false,
      recipient: { kind: 'external', displayName: 'Alex' },
    });
  });

  it('resolves to a compatibility questionnaire (no single recipient)', async () => {
    seed();
    const onChosen = vi.fn();
    render(<NewQuestionnaireStart onChosen={onChosen} onCancel={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Compatibility (two people)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onChosen).toHaveBeenCalledWith({ compat: true });
  });

  it('hides the external option without questionnaires.sendExternal', () => {
    seed(false);
    render(<NewQuestionnaireStart onChosen={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Someone else (link)' })).not.toBeInTheDocument();
  });
});
