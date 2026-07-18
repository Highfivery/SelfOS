import { describe, expect, it } from 'vitest';
import type { RelationshipType } from '@shared/schemas';
import {
  currentSharePreset,
  nextSharePreset,
  sharePresetLabel,
  typesForPreset,
} from './sharePresets';

const available: RelationshipType[] = ['partner', 'parent', 'sibling', 'friend', 'coworker'];

describe('sharePresets (65 §3.4)', () => {
  it('maps each preset to the right type set against the graph', () => {
    expect(typesForPreset('private', available)).toEqual([]);
    expect(typesForPreset('partner', available)).toEqual(['partner']);
    // Close family = ['partner', ...CLOSE_FAMILY] ∩ the graph (friend/coworker excluded).
    expect(typesForPreset('family', available)).toEqual(['partner', 'parent', 'sibling']);
    expect(typesForPreset('everyone', available)).toEqual(available);
  });

  it('reads the current preset from a fact', () => {
    expect(currentSharePreset({ shareable: true }, available)).toBe('everyone'); // legacy broadcast
    expect(currentSharePreset({ shareable: false, shareableTypes: [] }, available)).toBe('private');
    expect(currentSharePreset({ shareable: false, shareableTypes: ['partner'] }, available)).toBe(
      'partner',
    );
    expect(
      currentSharePreset(
        { shareable: false, shareableTypes: ['partner', 'parent', 'sibling'] },
        available,
      ),
    ).toBe('family');
    expect(currentSharePreset({ shareable: false, shareableTypes: available }, available)).toBe(
      'everyone',
    );
    // A per-type scope that matches no preset reads as custom.
    expect(currentSharePreset({ shareable: false, shareableTypes: ['coworker'] }, available)).toBe(
      'custom',
    );
  });

  it('cycles private → partner → family → everyone → private; custom restarts at private', () => {
    expect(nextSharePreset('private')).toBe('partner');
    expect(nextSharePreset('partner')).toBe('family');
    expect(nextSharePreset('family')).toBe('everyone');
    expect(nextSharePreset('everyone')).toBe('private');
    expect(nextSharePreset('custom')).toBe('private');
  });

  it('labels each preset', () => {
    expect(sharePresetLabel('private')).toBe('Just me');
    expect(sharePresetLabel('partner')).toBe('Partner');
    expect(sharePresetLabel('family')).toBe('Close family');
    expect(sharePresetLabel('everyone')).toBe('Everyone');
  });
});
