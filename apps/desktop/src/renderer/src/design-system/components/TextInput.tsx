import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './TextInput.module.css';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, type = 'text', ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={className ? `${styles.input} ${className}` : styles.input}
        {...rest}
      />
    );
  },
);
