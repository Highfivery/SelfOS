import { useState, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { Button } from '../../../design-system/components';
import styles from './Sessions.module.css';

/** The message composer. Enter sends; Shift+Enter inserts a newline. */
export function Composer({
  disabled,
  onSend,
  placeholder = 'Write a message…',
  autoFocus = true,
  initialText = '',
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Seed text to prefill (e.g. a synthesis observation handed off from Home, 40 §3.3). The user edits/sends. */
  initialText?: string;
}): JSX.Element {
  const [text, setText] = useState(initialText);

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.composer}>
      <textarea
        className={styles.textarea}
        aria-label="Message"
        placeholder={placeholder}
        value={text}
        rows={2}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button variant="primary" onClick={submit} disabled={disabled || !text.trim()}>
        <SendHorizontal size={16} aria-hidden="true" />
        Send
      </Button>
    </div>
  );
}
