import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { MAX_BOOK_STYLES } from '@shared/schemas';
import { useDreamStore } from '../../../stores/dreamStore';
import { useGuidanceStore } from '../../../stores/guidanceStore';
import { livePartnerEdge } from '@selfos/core/people';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Books.module.css';
import { specimenFor } from './begin';
import { useEffect, useState } from 'react';
import type { BookConfig } from '@shared/schemas';
import { Labeled } from './Labeled';
import { LENGTH_CARDS, stylesForType, VOICE_OPTIONS } from './bookConfigOptions';
import type { Length, Style, Voice } from './bookConfigOptions';

export function StorySetup({
  typeId,
  titleHint,
  personNameForPreview,
  aiUnavailable = false,
  onCreate,
  onCancel,
}: {
  /** Chosen on the preceding "what kind of book?" screen (72 §3.2). */
  typeId: string;
  titleHint: string;
  personNameForPreview: string;
  /** AI unavailable → the create-and-draft CTA is disabled (the notice above the card explains why). */
  aiUnavailable?: boolean;
  onCreate: (typeId: string, title: string, config: BookConfig) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [voice, setVoice] = useState<Voice>('third');
  const [style, setStyle] = useState<Style>('warm');
  const [length, setLength] = useState<Length>('full');
  const [typeOptions, setTypeOptions] = useState<Record<string, string>>({});
  const [sourceIds, setSourceIds] = useState<string[]>([]);

  const bookTypes = useStoryStore((s) => s.bookTypes);
  const activePerson = useSessionStore((s) => s.activePerson);
  // A person option always names SOMEONE ELSE — the hero of your children's book, the subject of a
  // portrait ("a book about one person you love"). Offering the author themselves is never the answer,
  // and it read as a bug the moment the answer started reaching the prose.
  const allPeople = usePeopleStore((s) => s.people).filter((p) => p.id !== activePerson?.id);
  const relationships = usePeopleStore((s) => s.relationships);
  const loadPeople = usePeopleStore((s) => s.load);
  // The partner picker reads the relationship graph, so this screen loads it itself rather than relying on
  // whichever route happened to populate the store first.
  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);
  // A shared book is with a PARTNER, so its picker offers only live partner edges — the same edge the
  // bridge re-checks at create and that keeps the book readable afterwards (72 §5.8). Offering anyone else
  // would be a control whose only outcome is a refusal.
  const people =
    bookTypes.find((t) => t.id === typeId)?.sharedWithPartner && activePerson
      ? allPeople.filter((p) => livePartnerEdge(relationships, activePerson.id, p.id))
      : allPeople;

  const dreams = useDreamStore((s) => s.dreams);
  const adultAcknowledged = useGuidanceStore((s) => s.adultAcknowledged);
  const acknowledgeAdult = useGuidanceStore((s) => s.acknowledgeAdult);
  const bookType = bookTypes.find((t) => t.id === typeId);

  // Everything a type asks at commission is DECLARED by the type (72 §4.1), so this renders whatever it
  // declares — a new kind of book adds no code here.
  const options = bookType?.options ?? [];
  const answered = (id: string): string =>
    typeOptions[id] ?? options.find((o) => o.id === id)?.choices?.[0]?.value ?? '';
  const missing = options.filter((o) => o.required && !answered(o.id).trim());
  const blockedByAge = Boolean(bookType?.gates.adult) && !adultAcknowledged;
  // Only the registers THIS kind of book has (72 §4.1). A style the type doesn't declare resolves to an
  // empty directive downstream, so offering one would silently strip the tone steering from the book.
  const sharedWithPartner = Boolean(bookType?.sharedWithPartner);
  const styleChoices = stylesForType(bookType?.stylePresets);
  // Switching type can strip the chosen register out from under the picker — fall back to its first.
  const effectiveStyle = styleChoices.some((c) => c.value === style)
    ? style
    : (styleChoices[0]?.value ?? 'warm');
  // Registers COMBINE (72 §3.2): pick up to three and the book is written in all of them. `style` stays the
  // primary (first picked) so a book commissioned here still reads correctly everywhere that shows one.
  const [extraStyles, setExtraStyles] = useState<Style[]>([]);
  // A pre-selected default is NOT a choice. Without this, the first card someone clicks ADDS to the default
  // and they quietly get two registers when they meant one — "Warm + Cinematic" for a biography.
  const [pickedStyle, setPickedStyle] = useState(false);
  const chosenStyles = [effectiveStyle, ...extraStyles.filter((v) => v !== effectiveStyle)];
  const toggleStyle = (value: Style): void => {
    if (!pickedStyle) {
      setPickedStyle(true);
      setStyle(value);
      setExtraStyles([]);
      return;
    }
    if (value === effectiveStyle) {
      // Deselecting the primary promotes the next pick, so there is always at least one.
      const next = extraStyles.filter((v) => v !== value);
      if (next.length === 0) return;
      setStyle(next[0] as Style);
      setExtraStyles(next.slice(1));
      return;
    }
    if (extraStyles.includes(value)) {
      setExtraStyles(extraStyles.filter((v) => v !== value));
      return;
    }
    if (chosenStyles.length >= MAX_BOOK_STYLES) return;
    setExtraStyles([...extraStyles, value]);
  };

  // "How your biographer will sound" — the specimen re-renders per style × voice (§13.3).
  const specimen = specimenFor(typeId, { style: effectiveStyle, voice });

  return (
    <Card>
      <Stack gap={4}>
        <Stack gap={2}>
          <Heading level={2}>Commission your book</Heading>
          <Text tone="secondary">
            {sharedWithPartner
              ? // A shared book reads BOTH lives, so the line that promises what gets read has to say so —
                // and has to be honest about the one thing it doesn't read (72 §5.8).
                'Your biographer reads what it knows about both of you, apart from anything you marked private during onboarding. Choose how it should read — and see how it will sound.'
              : 'Your biographer reads everything it knows about you unless you exclude it later. Choose how it should read — and see how it will sound.'}
          </Text>
        </Stack>

        {blockedByAge ? (
          <Banner tone="warning">
            <Stack gap={2}>
              <Text size="sm">
                This kind of book is explicit and for adults only. Confirming also unlocks the app’s
                other adult content.
              </Text>
              <Inline>
                <Button onClick={() => void acknowledgeAdult()}>I’m 18 or older</Button>
              </Inline>
            </Stack>
          </Banner>
        ) : null}

        <div className={styles.commission}>
          {/* The form. */}
          <div className={styles.commissionForm}>
            {options.map((option) => (
              <Labeled key={option.id} label={option.label}>
                <Stack gap={1}>
                  {option.kind === 'choice' ? (
                    <div
                      className={styles.styleGallery}
                      role="radiogroup"
                      aria-label={option.label}
                    >
                      {(option.choices ?? []).map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          role="radio"
                          aria-checked={answered(option.id) === c.value}
                          aria-label={c.label}
                          className={`${styles.styleCard} ${
                            answered(option.id) === c.value ? styles.styleCardOn : ''
                          }`}
                          onClick={() =>
                            setTypeOptions((prev) => ({ ...prev, [option.id]: c.value }))
                          }
                        >
                          <span className={styles.styleCardName}>{c.label}</span>
                          {c.description ? (
                            <span className={styles.styleCardHint}>{c.description}</span>
                          ) : null}
                          {/* One line of what this choice actually reads like (72 §3.2). */}
                          {c.example ? (
                            <span className={styles.choiceExample}>“{c.example}”</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : option.kind === 'person' && option.multiple ? (
                    // Several people may be named — a picture book can star two siblings. Stored
                    // comma-separated, which is what `required` already validates and what the prompt
                    // builder already splits.
                    <div className={styles.styleGallery} role="group" aria-label={option.label}>
                      {people.map((person) => {
                        const chosen = answered(option.id)
                          .split(',')
                          .map((id) => id.trim())
                          .filter(Boolean);
                        const on = chosen.includes(person.id);
                        return (
                          <button
                            key={person.id}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            aria-label={person.displayName}
                            className={`${styles.styleCard} ${on ? styles.styleCardOn : ''}`}
                            onClick={() =>
                              setTypeOptions((prev) => ({
                                ...prev,
                                [option.id]: (on
                                  ? chosen.filter((id) => id !== person.id)
                                  : [...chosen, person.id]
                                ).join(','),
                              }))
                            }
                          >
                            <span className={styles.styleCardName}>{person.displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : option.kind === 'person' ? (
                    <Select
                      value={answered(option.id)}
                      aria-label={option.label}
                      onChange={(e) =>
                        setTypeOptions((prev) => ({ ...prev, [option.id]: e.target.value }))
                      }
                    >
                      <option value="">Choose someone…</option>
                      {people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.displayName}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <TextInput
                      value={answered(option.id)}
                      aria-label={option.label}
                      {...(option.placeholder ? { placeholder: option.placeholder } : {})}
                      onChange={(e) =>
                        setTypeOptions((prev) => ({ ...prev, [option.id]: e.target.value }))
                      }
                    />
                  )}
                  {option.help ? (
                    <Text size="sm" tone="secondary">
                      {option.help}
                    </Text>
                  ) : null}
                </Stack>
              </Labeled>
            ))}
            {bookType?.sourceSelect === 'dream' ? (
              <Labeled label="Which dreams">
                <Stack gap={1}>
                  <Text size="sm" tone="secondary">
                    Pick the ones you want in this book, or leave them all unticked to draw on every
                    dream you’ve recorded.
                  </Text>
                  <div className={styles.dreamPicker} role="group" aria-label="Which dreams">
                    {dreams.map((d) => (
                      <label key={d.id} className={styles.dreamPickerRow}>
                        <input
                          type="checkbox"
                          checked={sourceIds.includes(d.id)}
                          onChange={(e) =>
                            setSourceIds((prev) =>
                              e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id),
                            )
                          }
                        />
                        <Text size="sm">{d.title?.trim() || 'Untitled dream'}</Text>
                      </label>
                    ))}
                  </div>
                </Stack>
              </Labeled>
            ) : null}
            <Labeled label="Title (optional)">
              <Stack gap={1}>
                <TextInput
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Title"
                  placeholder={titleHint}
                />
                <Text size="sm" tone="secondary">
                  Leave blank and your biographer will suggest a title from your story — you can
                  rename it before it starts writing.
                </Text>
              </Stack>
            </Labeled>
            <Labeled label="Narrative voice">
              <SegmentedControl
                options={VOICE_OPTIONS}
                value={voice}
                onChange={setVoice}
                aria-label="Narrative voice"
              />
            </Labeled>
            <Labeled label="Style">
              <div className={styles.styleGallery} role="group" aria-label="Style">
                {styleChoices.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="checkbox"
                    aria-checked={chosenStyles.includes(s.value)}
                    aria-label={s.label}
                    aria-describedby={`style-hint-${s.value}`}
                    disabled={
                      !chosenStyles.includes(s.value) && chosenStyles.length >= MAX_BOOK_STYLES
                    }
                    className={`${styles.styleCard} ${chosenStyles.includes(s.value) ? styles.styleCardOn : ''}`}
                    onClick={() => toggleStyle(s.value)}
                  >
                    <span className={styles.styleCardName}>{s.label}</span>
                    <span id={`style-hint-${s.value}`} className={styles.styleCardHint}>
                      {s.hint}
                    </span>
                    {/* A line of what this register actually reads like, at the chosen voice — the same
                        thing the explicit ladder does. The rail below only ever samples ONE style, and with
                        registers combining, the comparison is the point. */}
                    {specimenFor(typeId, { style: s.value, voice }) ? (
                      // No wrapping quote marks: the serif italic already reads as a sample, and several
                      // specimens open with dialogue — "Filthy talk" rendered as ““Say it,” …".
                      <span className={styles.styleCardSample}>
                        {specimenFor(typeId, { style: s.value, voice })}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </Labeled>
            <Labeled label="Length">
              <div className={styles.lengthCards} role="radiogroup" aria-label="Length">
                {LENGTH_CARDS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    role="radio"
                    aria-checked={length === l.value}
                    aria-label={l.label}
                    aria-describedby={`length-hint-${l.value}`}
                    className={`${styles.lengthCard} ${length === l.value ? styles.lengthCardOn : ''}`}
                    onClick={() => setLength(l.value)}
                  >
                    <span className={styles.styleCardName}>{l.label}</span>
                    <span id={`length-hint-${l.value}`} className={styles.styleCardHint}>
                      {l.sub}
                    </span>
                  </button>
                ))}
              </div>
            </Labeled>
          </div>

          {/* The live preview rail. */}
          <aside className={styles.commissionPreview} aria-label="Preview">
            <div className={styles.previewCover} aria-hidden="true">
              <span className={styles.previewCoverKicker}>{bookType?.label ?? 'A Book'}</span>
              <span className={styles.previewCoverTitle}>{title.trim() || titleHint}</span>
              {personNameForPreview ? (
                <span className={styles.previewCoverBy}>{personNameForPreview}</span>
              ) : null}
            </div>
            <div className={styles.previewSpecimen}>
              <Text size="sm" tone="tertiary">
                How your biographer will sound
              </Text>
              {specimen ? (
                <p aria-label="Specimen" className={styles.previewSpecimenText}>
                  {specimen}
                </p>
              ) : null}
            </div>
          </aside>
        </div>

        <Text size="sm" tone="secondary">
          Roughly 10–20 minutes to write the first draft — you can keep using SelfOS while it works.
        </Text>
        <Inline justify="flex-end">
          <Button onClick={onCancel}>Cancel</Button>
          {/* Honest label (§8.2): this click commissions the WHOLE first draft (outline + every chapter),
              the app's largest single AI run — not just an outline. */}
          <Button
            variant="primary"
            disabled={aiUnavailable || blockedByAge || missing.length > 0}
            onClick={() =>
              onCreate(typeId, title.trim(), {
                voice,
                // The register actually shown as chosen — never one this type doesn't offer.
                style: effectiveStyle,
                // Only when more than one was picked, so a single-register book stays byte-identical to
                // what it was before registers could combine.
                ...(chosenStyles.length > 1 ? { styles: chosenStyles } : {}),
                length,
                autoRefresh: true,
                typeOptions: Object.fromEntries(options.map((o) => [o.id, answered(o.id)])),
                sourceIds,
              })
            }
          >
            Write my book
          </Button>
        </Inline>
      </Stack>
    </Card>
  );
}
