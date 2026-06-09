import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  variant?: 'ghost' | 'secondary';
  children: ReactNode;
}

/** Square, icon-only button. `aria-label` is required for accessibility. */
export function IconButton({
  variant = 'ghost',
  type = 'button',
  className,
  children,
  ...rest
}: IconButtonProps): JSX.Element {
  const cls = [styles.iconButton, variant === 'secondary' ? styles.secondary : undefined, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
