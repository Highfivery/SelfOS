import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, FileSystem, ImageClient, ImageGenerateOutcome } from '../host';
import type { Dream, Person } from '../schemas';
import { DreamSchema } from '../schemas';
import type { Relationship } from '../schemas';
import { savePerson, saveRelationship } from '../people';
import { queryUsage, setPersonBudget } from '../usage';
import { getDream, saveDream } from './dreamService';
import {
  buildImagePromptInput,
  deleteDreamImage,
  generateDreamImage,
  getDreamImage,
  getSharedDreamImage,
  isDreamImagePath,
  listImagesSharedWith,
  setDreamImageShare,
  type GenerateDreamImageDeps,
} from './dreamImageService';

const key = generateMasterKey();
const NOW = new Date('2026-06-12T00:00:00.000Z');

let fs: FileSystem;
const claudeCaptured: { input?: string | undefined } = {};
const imageCaptured: { prompt?: string | undefined } = {};

beforeEach(() => {
  fs = memFileSystem();
  claudeCaptured.input = undefined;
  imageCaptured.prompt = undefined;
});

/** A fake Claude that records the distillation input and returns a fixed, NAME-FREE distilled prompt. */
function fakeClaude(distilled = 'a soft surreal dreamscape of open doorways'): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: (options) => {
      claudeCaptured.input = options.messages.map((m) => m.content).join('\n');
      return Promise.resolve({
        text: distilled,
        usage: { inputTokens: 20, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

/** A fake image client that records the prompt OpenAI would see and returns a configurable outcome. */
function fakeImage(outcome?: ImageGenerateOutcome): ImageClient {
  return {
    generate: (options) => {
      imageCaptured.prompt = options.prompt;
      return Promise.resolve(
        outcome ?? {
          ok: true,
          image: { bytes: new Uint8Array([1, 2, 3, 4, 5]), mime: 'image/png' },
        },
      );
    },
  };
}

function person(over: Partial<Person> & { id: string }): Person {
  return {
    schemaVersion: 1,
    displayName: `Name-${over.id}`,
    isSubject: false,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

function dream(over: Partial<Dream> & { id: string; personId: string }): Dream {
  return {
    schemaVersion: 1,
    narrative: 'a quiet dream',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    ...over,
  };
}

function deps(over: Partial<GenerateDreamImageDeps> = {}): GenerateDreamImageDeps {
  return {
    fs,
    key,
    claude: fakeClaude(),
    image: fakeImage(),
    anthropicApiKey: 'sk-ant',
    openaiApiKey: 'sk-openai',
    consent: true,
    claudeModel: 'claude-sonnet-4-6',
    imageModel: 'gpt-image-2',
    style: 'dreamlike',
    personId: 'p1',
    dreamId: 'd1',
    now: NOW,
    ...over,
  };
}

async function allUsage(personId = 'p1'): Promise<{ type: string; costUsd: number }[]> {
  return (
    await queryUsage(fs, key, {
      from: '2000-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
      personId,
    })
  ).map((e) => ({ type: e.type, costUsd: e.costUsd }));
}

describe('generateDreamImage', () => {
  it('distills → renders → encrypts to image.enc, stamps Dream.image, and meters both events', async () => {
    await saveDream(
      fs,
      key,
      dream({ id: 'd1', personId: 'p1', narrative: 'rooms that rearrange' }),
    );

    const result = await generateDreamImage(deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor).toMatchObject({
      style: 'dreamlike',
      mime: 'image/png',
      model: 'gpt-image-2',
    });

    // The bytes round-trip through encryption.
    const image = await getDreamImage(fs, key, 'p1', 'd1');
    expect(image?.mime).toBe('image/png');
    expect(Array.from(image?.bytes ?? [])).toEqual([1, 2, 3, 4, 5]);

    // The descriptor is stamped on the dream.
    expect((await getDream(fs, key, 'p1', 'd1'))?.image?.model).toBe('gpt-image-2');

    // Both usage events recorded: the token-based prompt distillation + the flat image charge.
    const usage = await allUsage();
    expect(usage.find((u) => u.type === 'dream.imagePrompt')?.costUsd).toBeGreaterThan(0);
    expect(usage.find((u) => u.type === 'dream.image')?.costUsd).toBeCloseTo(0.17);
  });

  it('threads the chosen style + Settings style notes into the distillation input (§15.2)', async () => {
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1', narrative: 'a quiet shoreline' }));
    const result = await generateDreamImage(
      deps({ style: 'cinematic', styleNotes: 'muted earth tones, golden-hour light' }),
    );
    expect(result.ok).toBe(true);
    expect(claudeCaptured.input).toContain('Visual style: cinematic.');
    expect(claudeCaptured.input).toContain(
      'Additional style direction: muted earth tones, golden-hour light.',
    );
    expect(claudeCaptured.input?.toLowerCase()).toContain('non-photorealistic');
  });

  it('omits the style-direction line when no style notes are set', async () => {
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1', narrative: 'a quiet shoreline' }));
    await generateDreamImage(deps({ style: 'pastel' }));
    expect(claudeCaptured.input).toContain('Visual style: pastel.');
    expect(claudeCaptured.input).not.toContain('Additional style direction:');
  });

  it('sends OpenAI ONLY the Claude-distilled prompt — never the narrative or a real name', async () => {
    await saveDream(
      fs,
      key,
      dream({ id: 'd1', personId: 'p1', narrative: 'I dreamed of Alexandra in a glass house' }),
    );
    const result = await generateDreamImage(
      deps({ claude: fakeClaude('a soft surreal dreamscape') }),
    );
    expect(result.ok).toBe(true);
    // OpenAI sees the distilled output verbatim — not the narrative, and not the name within it.
    expect(imageCaptured.prompt).toBe('a soft surreal dreamscape');
    expect(imageCaptured.prompt).not.toContain('Alexandra');
  });

  it('feeds a linked person’s name-free depiction into distillation, never their name or private data', async () => {
    await savePerson(
      fs,
      key,
      person({
        id: 'p2',
        displayName: 'Alexandra',
        appearanceDescription: 'tall with curly hair',
        gender: 'female',
        ethnicity: 'Korean',
        healthNotes: 'HEALTH-SECRET',
      }),
    );
    await saveDream(
      fs,
      key,
      dream({
        id: 'd1',
        personId: 'p1',
        narrative: 'a figure stood in a doorway', // no name in the narrative
        people: [{ personId: 'p2' }],
      }),
    );

    await generateDreamImage(deps());
    // The depiction subset reaches the distillation input...
    expect(claudeCaptured.input).toContain('tall with curly hair');
    expect(claudeCaptured.input).toContain('female');
    expect(claudeCaptured.input).toContain('Korean');
    // ...but never the person's name or any private field.
    expect(claudeCaptured.input).not.toContain('Alexandra');
    expect(claudeCaptured.input).not.toContain('HEALTH-SECRET');
  });

  it('a free-name dream person contributes no depiction (only the narrative)', async () => {
    await saveDream(
      fs,
      key,
      dream({ id: 'd1', personId: 'p1', narrative: 'a walk', people: [{ name: 'Bob' }] }),
    );
    await generateDreamImage(deps());
    expect(claudeCaptured.input).not.toContain('a figure —'); // no depiction note was added
  });

  it('REFUSED records the distillation but NOT the flat image charge, and stores no image', async () => {
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const result = await generateDreamImage(
      deps({ image: fakeImage({ ok: false, reason: 'REFUSED', message: 'policy' }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('REFUSED');

    const usage = await allUsage();
    expect(usage.some((u) => u.type === 'dream.imagePrompt')).toBe(true);
    expect(usage.some((u) => u.type === 'dream.image')).toBe(false); // uncharged refusal is not metered
    expect(await getDreamImage(fs, key, 'p1', 'd1')).toBeNull();
    expect((await getDream(fs, key, 'p1', 'd1'))?.image).toBeUndefined();
  });

  it('a transport ERROR is not metered for the image; an oversized/wrong-MIME return IS (billed)', async () => {
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    // Transport error — the provider didn't bill, so no dream.image.
    const transport = await generateDreamImage(
      deps({ image: fakeImage({ ok: false, reason: 'ERROR', message: 'network' }) }),
    );
    expect(transport.ok).toBe(false);
    expect((await allUsage()).some((u) => u.type === 'dream.image')).toBe(false);

    // Wrong-MIME return — the call WAS billed, so dream.image is metered even though nothing is stored.
    fs = memFileSystem();
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    const billed = await generateDreamImage(
      deps({
        image: fakeImage({ ok: true, image: { bytes: new Uint8Array([1]), mime: 'image/tiff' } }),
      }),
    );
    expect(billed.ok).toBe(false);
    if (billed.ok) return;
    expect(billed.reason).toBe('ERROR');
    expect((await allUsage()).some((u) => u.type === 'dream.image')).toBe(true);
    expect(await getDreamImage(fs, key, 'p1', 'd1')).toBeNull();
  });

  it('refuses without consent / without a key / over budget, and meters nothing pre-generation', async () => {
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));

    const noConsent = await generateDreamImage(deps({ consent: false }));
    expect(noConsent.ok).toBe(false);
    if (!noConsent.ok) expect(noConsent.reason).toBe('NO_CONSENT');

    const noOpenAi = await generateDreamImage(deps({ openaiApiKey: null }));
    if (!noOpenAi.ok) expect(noOpenAi.reason).toBe('NO_KEY');

    const noClaude = await generateDreamImage(deps({ anthropicApiKey: null }));
    if (!noClaude.ok) expect(noClaude.reason).toBe('NO_KEY');

    await setPersonBudget(fs, key, 'p1', { limitUsd: 0, period: 'week', warnRatio: 0.8 });
    const overBudget = await generateDreamImage(deps());
    if (!overBudget.ok) expect(overBudget.reason).toBe('BUDGET');

    expect(await allUsage()).toEqual([]); // no AI call ran on any refused path
  });

  it('regenerate overwrites the image + descriptor, preserves shareableWith, and a failed regen keeps the old one', async () => {
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await generateDreamImage(deps({ style: 'painterly' }));

    // Manually mark it shared (slice 5 owns the UI; here we assert the descriptor carries it forward).
    const afterFirst = await getDream(fs, key, 'p1', 'd1');
    await saveDream(fs, key, {
      ...afterFirst!,
      image: { ...afterFirst!.image!, shareableWith: ['x'] },
    });

    const regen = await generateDreamImage(
      deps({
        style: 'watercolor',
        image: {
          generate: (o) => {
            imageCaptured.prompt = o.prompt;
            return Promise.resolve({
              ok: true,
              image: { bytes: new Uint8Array([9, 9]), mime: 'image/png' },
            });
          },
        },
      }),
    );
    expect(regen.ok).toBe(true);
    if (regen.ok) expect(regen.descriptor.style).toBe('watercolor');
    const reread = await getDream(fs, key, 'p1', 'd1');
    expect(reread?.image?.shareableWith).toEqual(['x']); // sharing preserved across regenerate
    expect(Array.from((await getDreamImage(fs, key, 'p1', 'd1'))?.bytes ?? [])).toEqual([9, 9]);

    // A failed regenerate keeps the existing image (no destructive overwrite before success).
    await generateDreamImage(
      deps({ image: fakeImage({ ok: false, reason: 'ERROR', message: 'x' }) }),
    );
    expect(Array.from((await getDreamImage(fs, key, 'p1', 'd1'))?.bytes ?? [])).toEqual([9, 9]);
  });

  it('deletes the image bytes + clears the descriptor', async () => {
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1' }));
    await generateDreamImage(deps());
    expect(await getDreamImage(fs, key, 'p1', 'd1')).not.toBeNull();

    await deleteDreamImage(fs, key, 'p1', 'd1', NOW);
    expect(await getDreamImage(fs, key, 'p1', 'd1')).toBeNull();
    expect((await getDream(fs, key, 'p1', 'd1'))?.image).toBeUndefined();
  });
});

describe('dream image sharing', () => {
  function relate(a: string, b: string): Relationship {
    return {
      id: `r-${a}-${b}`,
      schemaVersion: 1,
      fromPersonId: a,
      toPersonId: b,
      type: 'partner',
      createdAt: 'now',
      updatedAt: 'now',
    };
  }

  async function seedSharedImage(sensitivity: Dream['sensitivity'] = 'standard'): Promise<void> {
    await savePerson(fs, key, person({ id: 'p1', displayName: 'Dreamer' }));
    await savePerson(fs, key, person({ id: 'p2', displayName: 'Partner' }));
    await saveRelationship(fs, key, relate('p1', 'p2'));
    await saveDream(fs, key, dream({ id: 'd1', personId: 'p1', sensitivity }));
    await generateDreamImage(deps({ personId: 'p1', dreamId: 'd1' }));
  }

  it('shares an image with a related person, and a recipient reads it; un-share denies at read time', async () => {
    await seedSharedImage();
    expect(
      await setDreamImageShare({
        fs,
        key,
        dreamerId: 'p1',
        dreamId: 'd1',
        targetPersonId: 'p2',
        shared: true,
        now: NOW,
      }),
    ).toEqual({ ok: true });

    // The recipient reads it...
    expect(await getSharedDreamImage(fs, key, 'p2', 'p1', 'd1')).not.toBeNull();
    expect((await listImagesSharedWith(fs, key, 'p2')).map((s) => s.dreamId)).toEqual(['d1']);

    // ...until it's un-shared — then the read re-gate denies immediately.
    await setDreamImageShare({
      fs,
      key,
      dreamerId: 'p1',
      dreamId: 'd1',
      targetPersonId: 'p2',
      shared: false,
      now: NOW,
    });
    expect(await getSharedDreamImage(fs, key, 'p2', 'p1', 'd1')).toBeNull();
    expect(await listImagesSharedWith(fs, key, 'p2')).toEqual([]);
  });

  it('denies a recipient after the RELATIONSHIP is removed, without touching shareableWith', async () => {
    await seedSharedImage();
    await setDreamImageShare({
      fs,
      key,
      dreamerId: 'p1',
      dreamId: 'd1',
      targetPersonId: 'p2',
      shared: true,
      now: NOW,
    });
    // Remove the relationship file → the read-time re-gate drops the share.
    await fs.remove('relationships/r-p1-p2.enc');
    expect(await getSharedDreamImage(fs, key, 'p2', 'p1', 'd1')).toBeNull();
    expect(await listImagesSharedWith(fs, key, 'p2')).toEqual([]);
  });

  it('refuses to share a sensitive-tier dream + a non-related target', async () => {
    await seedSharedImage('explicit');
    expect(
      await setDreamImageShare({
        fs,
        key,
        dreamerId: 'p1',
        dreamId: 'd1',
        targetPersonId: 'p2',
        shared: true,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'SENSITIVE' });

    // A standard dream, but a target the dreamer isn't related to.
    await saveDream(fs, key, dream({ id: 'd2', personId: 'p1' }));
    await generateDreamImage(deps({ personId: 'p1', dreamId: 'd2' }));
    await savePerson(fs, key, person({ id: 'p3', displayName: 'Stranger' }));
    expect(
      await setDreamImageShare({
        fs,
        key,
        dreamerId: 'p1',
        dreamId: 'd2',
        targetPersonId: 'p3',
        shared: true,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});

describe('isDreamImagePath', () => {
  it('accepts a dream image path and rejects anything else', () => {
    expect(isDreamImagePath('people/p1/dreams/d1/image.enc')).toBe(true);
    expect(isDreamImagePath('config/recovery.enc')).toBe(false);
    expect(isDreamImagePath('people/p1/dreams/d1/dream.enc')).toBe(false);
    expect(isDreamImagePath('people/p1/dreams/../../secret/image.enc')).toBe(false);
  });
});

describe('buildImagePromptInput (pure, name-free)', () => {
  it('includes the narrative, name-free depiction notes, style, and non-photorealistic framing', () => {
    const out = buildImagePromptInput({
      narrative: 'a long corridor',
      depictionNotes: ['a figure — appearance: tall, gender: female, age 30'],
      style: 'watercolor',
    });
    expect(out).toContain('a long corridor');
    expect(out).toContain('a figure — appearance: tall');
    expect(out).toContain('Visual style: watercolor.');
    expect(out.toLowerCase()).toContain('non-photorealistic');
    expect(out).toContain('NEVER by name');
  });

  it('omits the figures section entirely when there are no depiction notes', () => {
    const out = buildImagePromptInput({
      narrative: 'mist',
      depictionNotes: ['', '  '],
      style: 's',
    });
    expect(out).not.toContain('Figures that appeared');
  });

  it('appends the free-text style direction when styleNotes are present (§15.2)', () => {
    const out = buildImagePromptInput({
      narrative: 'a meadow',
      depictionNotes: [],
      style: 'cinematic',
      styleNotes: 'muted earth tones, soft focus, golden-hour light',
    });
    expect(out).toContain('Visual style: cinematic.');
    expect(out).toContain(
      'Additional style direction: muted earth tones, soft focus, golden-hour light.',
    );
    // The baseline non-photorealistic framing still follows (and still wins) even for a non-dreamlike preset.
    expect(out.toLowerCase()).toContain('non-photorealistic');
    // Order: the direction sits after the style line and before the framing.
    expect(out.indexOf('Visual style:')).toBeLessThan(out.indexOf('Additional style direction:'));
    expect(out.indexOf('Additional style direction:')).toBeLessThan(
      out.toLowerCase().indexOf('non-photorealistic'),
    );
  });

  it('omits the direction line entirely when styleNotes are blank or absent (§15.4)', () => {
    const blank = buildImagePromptInput({
      narrative: 'a meadow',
      depictionNotes: [],
      style: 'pastel',
      styleNotes: '   ',
    });
    const absent = buildImagePromptInput({
      narrative: 'a meadow',
      depictionNotes: [],
      style: 'pastel',
    });
    expect(blank).not.toContain('Additional style direction:');
    expect(absent).not.toContain('Additional style direction:');
  });
});

describe('Dream.image schema', () => {
  it('is additive-optional — a dream without it still parses', () => {
    const d = dream({ id: 'd1', personId: 'p1' });
    expect(() => DreamSchema.parse(d)).not.toThrow();
    expect(DreamSchema.parse(d).image).toBeUndefined();
  });
});
