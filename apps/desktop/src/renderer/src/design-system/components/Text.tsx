import type { ReactNode } from 'react';
import styles from './typography.module.css';

type TextElement = 'p' | 'span' | 'div';
type Size = 'xs' | 'sm' | 'base' | 'md';
type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent';
type Weight = 400 | 500 | 600;

interface TextProps {
  as?: TextElement;
  size?: Size;
  tone?: Tone;
  weight?: Weight;
  serif?: boolean;
  id?: string;
  className?: string | undefined;
  children: ReactNode;
}

export function Text({
  as: Tag = 'p',
  size = 'base',
  tone = 'primary',
  weight = 400,
  serif = false,
  id,
  className,
  children,
}: TextProps): JSX.Element {
  const cls = [
    styles.text,
    styles[`size-${size}`],
    styles[`tone-${tone}`],
    styles[`weight-${weight}`],
    serif ? styles.serif : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag id={id} className={cls}>
      {children}
    </Tag>
  );
}
