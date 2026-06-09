import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...rest }: CardProps): JSX.Element {
  return (
    <div className={className ? `${styles.card} ${className}` : styles.card} {...rest}>
      {children}
    </div>
  );
}
