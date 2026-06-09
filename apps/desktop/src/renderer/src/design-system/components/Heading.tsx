import type { ReactNode } from 'react';
import styles from './typography.module.css';

interface HeadingProps {
  level?: 1 | 2 | 3;
  id?: string;
  className?: string | undefined;
  children: ReactNode;
}

const TAGS = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;

export function Heading({ level = 2, id, className, children }: HeadingProps): JSX.Element {
  const Tag = TAGS[level];
  const cls = [styles.heading, styles[`h${level}`], className].filter(Boolean).join(' ');
  return (
    <Tag id={id} className={cls}>
      {children}
    </Tag>
  );
}
