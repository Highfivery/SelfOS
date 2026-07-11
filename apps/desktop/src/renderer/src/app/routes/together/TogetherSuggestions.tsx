import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import type { TogetherSuggestion } from '@shared/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import { useTogetherStore } from '../../../stores/togetherStore';
import styles from './Together.module.css';

/**
 * The coach's SUGGESTION cards for a session (58 §5.6) — a guided exercise the pair could start, or a
 * compatibility check-in to explore a topic. Nothing sends or starts on its own: each card offers an explicit
 * action. A `guide` suggestion starts a new Together session; a `questionnaire` suggestion opens the
 * Questionnaires builder (the existing, user-confirmed compat-send flow — never an auto-send).
 */
export function TogetherSuggestions({
  sessionId,
  partnerId,
}: {
  sessionId: string;
  partnerId: string;
}): JSX.Element | null {
  const navigate = useNavigate();
  const create = useTogetherStore((s) => s.create);
  // A new coach reply may have written a suggestion — re-fetch when the message count changes.
  const messageCount = useTogetherStore((s) => s.open?.messages.length ?? 0);
  const [items, setItems] = useState<TogetherSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const list = (await window.selfos?.togetherSuggestions(sessionId)) ?? [];
    setItems(list);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh, messageCount]);

  const startGuide = async (guideId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const result = await create(partnerId, undefined, guideId);
    if (result.ok) navigate(`/together/session/${result.session.id}`);
    else {
      setError(result.message);
      setBusy(false);
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <Card>
      <Stack gap={2}>
        <Inline gap={2} align="center">
          <Lightbulb size={16} aria-hidden="true" />
          <Heading level={3}>Ideas from your coach</Heading>
        </Inline>
        <Text size="sm" tone="secondary">
          Suggestions you can choose to try — nothing happens until you do.
        </Text>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Stack gap={2}>
          {items.map((s) => {
            const guideId = s.kind === 'guide' ? s.guideId : undefined;
            return (
              <div key={s.id} className={styles.suggestionRow}>
                <Text size="sm">{s.prompt}</Text>
                {guideId ? (
                  // A real, non-adult guided exercise → start a new Together session.
                  <Inline gap={2} align="center">
                    <Button
                      onClick={() => void startGuide(guideId)}
                      disabled={busy}
                      aria-busy={busy}
                    >
                      Start this exercise
                    </Button>
                  </Inline>
                ) : s.kind === 'questionnaire' ? (
                  // A compatibility check-in → the existing, user-confirmed Questionnaires flow (a doorway).
                  <Inline gap={2} align="center">
                    <Button variant="secondary" onClick={() => navigate('/questionnaires')}>
                      Open a check-in
                    </Button>
                  </Inline>
                ) : null}
                {/* A guide suggestion whose exercise isn't startable here (adult/unknown) is a plain prompt
                    card with no action — the 18+/explicit exercises live behind their own gates (§3.10). */}
              </div>
            );
          })}
        </Stack>
      </Stack>
    </Card>
  );
}
