/**
 * Compile-time guard for **rebuild-from-input** handlers (12 §5.1).
 *
 * Several services rebuild a full record from a narrower renderer `Input` type plus a **hand-listed** set
 * of main-owned fields taken from the existing record (`upsertPerson`, `upsertRelationship`,
 * `saveQuestionnaire`, `dreamSave`). That list is opt-in, so adding an additive-optional main-written
 * field to the FULL schema silently makes it droppable on the next edit — and the failure is silent data
 * loss, not an error.
 *
 * That is not hypothetical: `Dream.image` was wiped by "Edit dream" → Save, orphaning the encrypted image
 * bytes with nothing pointing at them. Every one of these handlers is one forgotten field away from the
 * same bug, so each declares which main-owned fields it handles and asserts the set is exhaustive.
 *
 * Usage — list every field the handler either sets fresh or carries forward:
 *
 * ```ts
 * const _guard: AssertMainOwnedHandled<
 *   Person,
 *   PersonInput,
 *   'schemaVersion' | 'createdAt' | 'updatedAt' | 'avatarPath'
 * > = true;
 * void _guard; // the `void` satisfies no-unused-vars; the type is the real assertion
 * ```
 *
 * If the full schema gains a main-owned field, this stops compiling until someone decides whether an
 * edit keeps it. **Do not "fix" a failure by widening the list without adding the corresponding line in
 * the handler** — the guard proves a field was CLASSIFIED, not that the code actually writes it.
 */

/** The fields of `Full` the renderer cannot send — the main process owns them. */
export type MainOwnedFields<Full, Input> = Exclude<keyof Full, keyof Input>;

/**
 * `true` when `Handled` covers every main-owned field of `Full`, otherwise `never` (a compile error at
 * the assignment). `Handled` is constrained to real main-owned keys, so a stale or misspelled entry —
 * e.g. `'avatarPth'` — is caught too rather than sitting silently.
 */
export type AssertMainOwnedHandled<Full, Input, Handled extends MainOwnedFields<Full, Input>> =
  Exclude<MainOwnedFields<Full, Input>, Handled> extends never ? true : never;
