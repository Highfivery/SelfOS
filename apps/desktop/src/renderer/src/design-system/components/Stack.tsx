import type { CSSProperties, ReactNode } from 'react';
import { space, type SpaceStep } from '../spacing';
import styles from './Stack.module.css';

interface StackProps {
  gap?: SpaceStep;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  className?: string | undefined;
  children: ReactNode;
}

/** Vertical flex layout with token-based spacing. */
export function Stack({ gap = 4, align, justify, className, children }: StackProps): JSX.Element {
  const style: CSSProperties = { gap: space(gap), alignItems: align, justifyContent: justify };
  return (
    <div className={className ? `${styles.stack} ${className}` : styles.stack} style={style}>
      {children}
    </div>
  );
}
