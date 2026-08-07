import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import { acknowledgeAdult } from '../conversations/guidanceService';
import { setYnmOptIn } from '../together/ynmService';
import { submitSectionForm } from '../intake/intakeService';
import { resolveIntakeActivityRows } from '../intimacy/activityRows';
import { matrixRowKey, type IntakeAnswerValue } from '../schemas';
import { recordSentSuggestion } from './emailSuggestionService';
import { writeEncryptedJson } from '../vault';
import type { EmailResponse } from '../schemas';
import {
  listEmailPartners,
  resolveIntimacyEmailTarget,
  listIntimacyInventoryOffers,
  applyIntimacyInventoryOffer,
} from './emailIntimacy';

const key = generateMasterKey();
const now = new Date('2026-09-01T12:00:00.000Z');

// A stable, universal (non-oral) activity rowKey both partners can rate.
const ACT = matrixRowKey(resolveIntakeActivityRows({}).find((r) => matrixRowKey(r).length > 0)!);

async function seedPartners(fs: ReturnType<typeof memFileSystem>) {
  const a = await upsertPerson(fs, key, { displayName: 'Ash', isSubject: true, tags: [] });
  const b = await upsertPerson(fs, key, { displayName: 'Bo', isSubject: true, tags: [] });
  await upsertRelationship(fs, key, { fromPersonId: a.id, toPersonId: b.id, type: 'partner' });
  return { a, b };
}

async function fullyConsent(fs: ReturnType<typeof memFileSystem>, aId: string, bId: string) {
  await acknowledgeAdult(fs, key, aId);
  await acknowledgeAdult(fs, key, bId);
  await setYnmOptIn(fs, key, aId, bId, true, now);
  await setYnmOptIn(fs, key, bId, aId, true, now);
  // Both rate the shared act ≥ curious (3).
  await submitSectionForm(
    fs,
    key,
    aId,
    'intimacy',
    { activities: { [ACT]: 3 } as unknown as IntakeAnswerValue },
    now,
    undefined,
    false,
  );
  await submitSectionForm(
    fs,
    key,
    bId,
    'intimacy',
    { activities: { [ACT]: 4 } as unknown as IntakeAnswerValue },
    now,
    undefined,
    false,
  );
}

describe('listEmailPartners (67 §8.2)', () => {
  it('returns only partner-typed relations', async () => {
    const fs = memFileSystem();
    const a = await upsertPerson(fs, key, { displayName: 'Ash', isSubject: true, tags: [] });
    const b = await upsertPerson(fs, key, { displayName: 'Bo', isSubject: true, tags: [] });
    const c = await upsertPerson(fs, key, { displayName: 'Cy', isSubject: true, tags: [] });
    await upsertRelationship(fs, key, { fromPersonId: a.id, toPersonId: b.id, type: 'partner' });
    await upsertRelationship(fs, key, { fromPersonId: a.id, toPersonId: c.id, type: 'friend' });
    const partners = await listEmailPartners(fs, key, a.id);
    expect(partners.map((p) => p.id)).toEqual([b.id]);
  });
});

describe('resolveIntimacyEmailTarget (67 §8.2 — gated, shared-data-only)', () => {
  it('is null unless both 18+-acked, both YNM opted-in, and a mutual overlap exists', async () => {
    const fs = memFileSystem();
    const { a, b } = await seedPartners(fs);
    // Nothing consented yet → null.
    expect(await resolveIntimacyEmailTarget(fs, key, a.id)).toBeNull();
    await fullyConsent(fs, a.id, b.id);
    const target = await resolveIntimacyEmailTarget(fs, key, a.id);
    expect(target).not.toBeNull();
    expect(target?.partnerId).toBe(b.id);
    expect(target?.overlap.some((o) => o.key === ACT)).toBe(true);
  });

  it('revokes immediately when the partner removes their YNM opt-in', async () => {
    const fs = memFileSystem();
    const { a, b } = await seedPartners(fs);
    await fullyConsent(fs, a.id, b.id);
    await setYnmOptIn(fs, key, b.id, a.id, false, now); // partner opts out
    expect(await resolveIntimacyEmailTarget(fs, key, a.id)).toBeNull();
  });
});

describe('intimacy inventory offers (67 §3.6)', () => {
  it('surfaces an offer from an im-game intimacy tap, and applying it bumps the inventory (then the offer clears)', async () => {
    const fs = memFileSystem();
    const { a, b } = await seedPartners(fs);
    await fullyConsent(fs, a.id, b.id); // a's rating for ACT is 3 (< top)
    await recordSentSuggestion(fs, key, a.id, {
      id: 'si',
      schemaVersion: 1,
      family: 'ai-suggestion-intimacy',
      suggestionType: 'intimacy',
      text: 'an idea',
      subjectKey: ACT,
      tokens: [],
      sentAt: '2026-08-28T00:00:00.000Z',
    });
    const resp: EmailResponse = {
      id: 'ri',
      schemaVersion: 1,
      family: 'ai-suggestion-intimacy',
      kind: 'intimacy-reaction',
      answer: 'im-game',
      suggestionId: 'si',
      sensitivity: 'intimacy',
      source: 'relay-tap',
      edited: false,
      respondedAt: '2026-08-29T00:00:00.000Z',
    };
    await writeEncryptedJson(fs, `people/${a.id}/email/responses/ri.enc`, resp, key);

    const offers = await listIntimacyInventoryOffers(fs, key, a.id);
    expect(offers.some((o) => o.actKey === ACT)).toBe(true);

    expect(await applyIntimacyInventoryOffer(fs, key, a.id, ACT, now)).toBe(true);
    // Self-resolving: the rating is now at the top, so the offer is gone.
    expect(await listIntimacyInventoryOffers(fs, key, a.id)).toHaveLength(0);
  });
});
