import { RotateCcw } from 'lucide-react';
import {
  IconButton,
  Inline,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Text,
  TextInput,
} from '../design-system/components';
import { useSettingsStore } from './settingsStore';
import type { SettingDefinition } from './types';
import styles from './SettingField.module.css';

function renderControl(
  def: SettingDefinition,
  value: unknown,
  onChange: (value: unknown) => void,
): JSX.Element {
  const control = def.control;
  switch (control.type) {
    case 'switch':
      return <Switch checked={Boolean(value)} onChange={onChange} aria-label={def.label} />;
    case 'segmented':
      return (
        <SegmentedControl
          options={control.options}
          value={String(value)}
          onChange={onChange}
          aria-label={def.label}
        />
      );
    case 'select':
      return (
        <Select
          value={String(value)}
          aria-label={def.label}
          onChange={(event) => onChange(event.target.value)}
        >
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    case 'slider': {
      const num = Number(value);
      return (
        <Inline gap={3}>
          <Slider
            min={control.min}
            max={control.max}
            step={control.step}
            value={num}
            aria-label={def.label}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <Text size="sm" tone="secondary">
            {control.format ? control.format(num) : String(num)}
          </Text>
        </Inline>
      );
    }
    case 'text':
      return (
        <TextInput
          value={String(value ?? '')}
          placeholder={control.placeholder}
          aria-label={def.label}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'custom': {
      const Render = control.render;
      return <Render />;
    }
  }
}

export function SettingField({ def }: { def: SettingDefinition }): JSX.Element | null {
  const values = useSettingsStore((s) => s.values);
  const setValue = useSettingsStore((s) => s.set);
  const resetValue = useSettingsStore((s) => s.reset);

  if (def.visibleWhen && !def.visibleWhen(values)) return null;

  const value = values[def.key];
  const isDefault = JSON.stringify(value) === JSON.stringify(def.default);
  const resettable = def.control.type !== 'custom' && !isDefault;

  return (
    <div className={styles.row}>
      <div className={styles.info}>
        <Text weight={500}>{def.label}</Text>
        {def.description ? (
          <Text size="sm" tone="secondary">
            {def.description}
          </Text>
        ) : null}
      </div>
      <div className={styles.control}>
        <Inline gap={2}>
          {renderControl(def, value, (next) => void setValue(def.key, next))}
          {resettable ? (
            <IconButton aria-label={`Reset ${def.label}`} onClick={() => void resetValue(def.key)}>
              <RotateCcw size={15} aria-hidden="true" />
            </IconButton>
          ) : null}
        </Inline>
      </div>
    </div>
  );
}
