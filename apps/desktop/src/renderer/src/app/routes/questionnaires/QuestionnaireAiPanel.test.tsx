import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { QuestionnaireAiPanel } from './QuestionnaireAiPanel';

afterEach(() => clearMockBridge());

describe('QuestionnaireAiPanel — initialBrief (59 §3.5)', () => {
  it('opens expanded and pre-fills the brief when a Home "Ideas" card seeds one', () => {
    installMockBridge();
    render(
      <QuestionnaireAiPanel
        aiReady
        type="intimacy"
        sensitivity="explicit"
        existingPrompts={[]}
        onGenerated={() => {}}
        initialBrief="A flirty, explicit questionnaire about our desires."
      />,
    );
    // Expanded (the brief field is visible) + pre-filled.
    const brief = screen.getByLabelText(/what do you want to explore/i);
    expect(brief).toHaveValue('A flirty, explicit questionnaire about our desires.');
  });

  it('stays collapsed + empty with no initialBrief', () => {
    installMockBridge();
    render(
      <QuestionnaireAiPanel
        aiReady
        type="general"
        sensitivity="standard"
        existingPrompts={[]}
        onGenerated={() => {}}
      />,
    );
    // Collapsed: the brief field isn't rendered until the header is opened.
    expect(screen.queryByLabelText(/what do you want to explore/i)).toBeNull();
    expect(screen.getByRole('button', { name: /draft with ai/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('QuestionnaireAiPanel — question count (08 §23.4)', () => {
  it('defaults to 5 and passes the chosen count to generate', async () => {
    const generate = vi.fn(() => Promise.resolve({ ok: true as const, questions: [] }));
    installMockBridge({ questionnairesGenerate: generate });
    render(
      <QuestionnaireAiPanel
        aiReady
        type="general"
        sensitivity="standard"
        existingPrompts={[]}
        onGenerated={() => {}}
        initialBrief="the move" // opens the panel expanded
      />,
    );
    const countSelect = screen.getByLabelText(/number of questions/i);
    expect(countSelect).toHaveValue('5');
    fireEvent.change(countSelect, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /generate questions/i }));
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    const [firstArg] = generate.mock.calls[0] as unknown as [{ count?: number }];
    expect(firstArg).toMatchObject({ count: 12 });
  });

  it('does NOT surface the household intimacy-topic manager (moved to Settings, §23.6)', () => {
    installMockBridge();
    render(
      <QuestionnaireAiPanel
        aiReady
        type="intimacy"
        sensitivity="explicit"
        existingPrompts={[]}
        onGenerated={() => {}}
        initialBrief="our desires" // opens the panel expanded
      />,
    );
    expect(screen.queryByText(/add a consensual-adult topic/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /add topic/i })).toBeNull();
  });
});
