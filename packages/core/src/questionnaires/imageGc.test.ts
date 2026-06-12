import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { FileSystem } from '../host';
import type { QuestionnaireInput } from '../schemas';
import { createAssignment } from './assignmentService';
import { deleteSend, purgeQuestionnaire } from './deletionService';
import { collectReferencedImagePaths, garbageCollectImages } from './imageGc';
import { getQuestionnaireImage, storeQuestionnaireImage } from './imageService';
import { saveQuestionnaire } from './questionnaireService';

const key = generateMasterKey();

const bytes = new Uint8Array([1, 2, 3, 4, 5]);

async function storeImage(fs: FileSystem): Promise<string> {
  return storeQuestionnaireImage(fs, key, bytes);
}

function defWith(
  imagePath: string | null,
  over: Partial<QuestionnaireInput> = {},
): QuestionnaireInput {
  return {
    title: 'With an image',
    type: 'role-feedback',
    sensitivity: 'standard',
    questions: [
      {
        id: 'q1',
        type: 'shortText',
        prompt: 'Look at this',
        required: false,
        ...(imagePath ? { media: { imagePath, alt: 'a thing', mime: 'image/png' } } : {}),
      },
    ],
    ...over,
  };
}

describe('question-image garbage collection', () => {
  it('reaps an orphan image (stored but never referenced) and keeps a referenced one', async () => {
    const fs = memFileSystem();
    const orphan = await storeImage(fs);
    const used = await storeImage(fs);
    await saveQuestionnaire(fs, key, defWith(used));

    expect(await collectReferencedImagePaths(fs, key)).toEqual(new Set([used]));
    const deleted = await garbageCollectImages(fs, key);
    expect(deleted).toEqual([orphan]);
    expect(await getQuestionnaireImage(fs, key, used)).not.toBeNull(); // kept
    expect(await getQuestionnaireImage(fs, key, orphan)).toBeNull(); // reaped
  });

  it('does NOT reap an image dropped from the def while still frozen in a sent snapshot', async () => {
    const fs = memFileSystem();
    const img = await storeImage(fs);
    const def = await saveQuestionnaire(fs, key, defWith(img));
    // Send it — the snapshot freezes the image reference.
    const send = await createAssignment(fs, key, {
      questionnaireId: def.id,
      senderPersonId: 'p1',
      recipient: { kind: 'person', personId: 'p2' },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    // Now edit the def to remove the image.
    await saveQuestionnaire(fs, key, defWith(null, { id: def.id }));

    // The live def no longer references it, but the sent snapshot still does → it must survive GC.
    expect(await garbageCollectImages(fs, key)).toEqual([]);
    expect(await getQuestionnaireImage(fs, key, img)).not.toBeNull();

    // Deleting that send drops the last reference → the next GC reaps it.
    await deleteSend(fs, key, send.id);
    expect(await getQuestionnaireImage(fs, key, img)).toBeNull();
  });

  it('purgeQuestionnaire reaps the questionnaire’s images (purge-on-delete)', async () => {
    const fs = memFileSystem();
    const img = await storeImage(fs);
    const def = await saveQuestionnaire(fs, key, defWith(img));
    await createAssignment(fs, key, {
      questionnaireId: def.id,
      senderPersonId: 'p1',
      recipient: { kind: 'person', personId: 'p2' },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });

    await purgeQuestionnaire(fs, key, def.id);
    expect(await getQuestionnaireImage(fs, key, img)).toBeNull();
  });

  it('keeps an image shared by two questionnaires until both are gone', async () => {
    const fs = memFileSystem();
    const img = await storeImage(fs);
    const a = await saveQuestionnaire(fs, key, defWith(img, { title: 'A' }));
    const b = await saveQuestionnaire(fs, key, defWith(img, { title: 'B' }));

    await purgeQuestionnaire(fs, key, a.id);
    expect(await getQuestionnaireImage(fs, key, img)).not.toBeNull(); // still used by B
    await purgeQuestionnaire(fs, key, b.id);
    expect(await getQuestionnaireImage(fs, key, img)).toBeNull();
  });
});
