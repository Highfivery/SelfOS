import type { CSSProperties, ReactNode } from 'react';
import type { FlexAlign, FlexJustify } from '../alignment';
import { space, type SpaceStep } from '../spacing';
import styles from './Inline.module.css';

interface InlineProps {
  gap?: SpaceStep;
  align?: FlexAlign;
  justify?: FlexJustify;
  wrap?: boolean;
  className?: string | undefined;
  children: ReactNode;
}

/** Horizontal flex layout with token-based spacing. */
export function Inline({
  gap = 3,
  align = 'center',
  justify,
  wrap = false,
  className,
  children,
}: InlineProps): JSX.Element {
  const style: CSSProperties = {
    gap: space(gap),
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? 'wrap' : 'nowrap',
  };
  return (
    <div className={className ? `${styles.inline} ${className}` : styles.inline} style={style}>
      {children}
    </div>
  );
}
