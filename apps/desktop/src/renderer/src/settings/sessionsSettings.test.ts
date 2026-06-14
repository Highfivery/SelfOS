import { describe, expect, it } from 'vitest';
import './builtins';
import { registerBuiltinSettings } from './builtins';
import { getDefinition, getDefinitionsForSection, getSections } from './registry';

// The built-ins are registered as a module side effect; calling again is idempotent.
registerBuiltinSettings();

describe('Sessions settings (09 §3/§14)', () => {
  it('registers a Sessions section', () => {
    expect(getSections().some((s) => s.id === 'sessions')).toBe(true);
  });

  it('registers the memory toggle (default ON) and auto-summarize toggle (default OFF, vault-scoped)', () => {
    const memory = getDefinition('sessions.memoryEnabled');
    expect(memory?.section).toBe('sessions');
    expect(memory?.default).toBe(true);
    expect(memory?.scope).toBe('vault');

    const auto = getDefinition('sessions.autoSummarizeOnEnd');
    expect(auto?.section).toBe('sessions');
    expect(auto?.default).toBe(false);
    expect(auto?.scope).toBe('vault');
  });

  it('hides auto-summarize when session memory is off', () => {
    const auto = getDefinition('sessions.autoSummarizeOnEnd');
    expect(auto?.visibleWhen?.({ 'sessions.memoryEnabled': false })).toBe(false);
    expect(auto?.visibleWhen?.({ 'sessions.memoryEnabled': true })).toBe(true);
    // The Sessions section exposes exactly these two toggles.
    expect(
      getDefinitionsForSection('sessions')
        .map((d) => d.key)
        .sort(),
    ).toEqual(['sessions.autoSummarizeOnEnd', 'sessions.memoryEnabled']);
  });
});
