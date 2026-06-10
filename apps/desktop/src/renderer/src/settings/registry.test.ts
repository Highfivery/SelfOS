import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Info } from 'lucide-react';
import {
  __resetRegistry,
  getDefaults,
  getSections,
  registerSection,
  registerSettings,
} from './registry';
import { defineSetting } from './types';

afterEach(() => __resetRegistry());

function section(id: string, order: number): void {
  registerSection({ id, title: id, icon: Info, order });
}

const flag = (key: string, section: string) =>
  defineSetting({
    key,
    section,
    label: key,
    schema: z.boolean(),
    default: false,
    control: { type: 'switch' },
  });

describe('settings registry', () => {
  it('returns sections sorted by order', () => {
    section('general', 2);
    section('appearance', 1);
    expect(getSections().map((s) => s.id)).toEqual(['appearance', 'general']);
  });

  it('enforces unique keys', () => {
    section('general', 1);
    registerSettings([flag('general.x', 'general')]);
    expect(() => registerSettings([flag('general.x', 'general')])).toThrow(/Duplicate setting key/);
  });

  it('rejects settings for unknown sections', () => {
    expect(() => registerSettings([flag('x.y', 'missing')])).toThrow(/Unknown section/);
  });

  it('collects defaults from registered settings', () => {
    section('general', 1);
    registerSettings([
      defineSetting({
        key: 'general.flag',
        section: 'general',
        label: 'Flag',
        schema: z.boolean(),
        default: true,
        control: { type: 'switch' },
      }),
    ]);
    expect(getDefaults()).toEqual({ 'general.flag': true });
  });
});
