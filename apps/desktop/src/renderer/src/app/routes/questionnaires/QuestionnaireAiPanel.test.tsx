import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
