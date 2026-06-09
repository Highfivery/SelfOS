import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './Slider.module.css';

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="range"
      className={className ? `${styles.slider} ${className}` : styles.slider}
      {...rest}
    />
  );
});
