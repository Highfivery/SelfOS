import { RotateCcw } from 'lucide-react';
import {
  AdminOnlyBadge,
  IconButton,
  Inline,
  SegmentedControl,
  Select,
  Slider,
  Switch,
  Text,
  Textarea,
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
    case 'select': {
      const current = String(value);
      // A persisted free-string value not present in any option still renders (a removed/legacy/custom
      // value), so a controlled select never silently displays the wrong option (the panel mirrors this).
      const allValues = new Set(
        'groups' in control
          ? control.groups.flatMap((group) => group.options.map((o) => o.value))
          : control.options.map((o) => o.value),
      );
      return (
        <Select value={current} aria-label={def.label} onChange={(e) => onChange(e.target.value)}>
          {allValues.has(current) ? null : <option value={current}>{current}</option>}
          {'groups' in control
            ? control.groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))
            : control.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
        </Select>
      );
    }
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
    case 'textarea':
      return (
        <Textarea
          value={String(value ?? '')}
          placeholder={control.placeholder}
          rows={control.rows}
          maxLength={control.maxLength}
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
  const onChange = (next: unknown): void => void setValue(def.key, next);
  const isDefault = JSON.stringify(value) === JSON.stringify(def.default);

  // Custom rows (info, actions, long content) and multiline textareas render full-width and stacked so the
  // content has room to wrap instead of being crushed into the fixed control column. A textarea keeps the
  // reset affordance (custom rows manage their own state).
  if (def.control.type === 'custom' || def.control.type === 'textarea') {
    const isTextarea = def.control.type === 'textarea';
    return (
      <div className={styles.stacked}>
        <Inline gap={2} justify="space-between">
          <Inline gap={2}>
            <Text weight={500}>{def.label}</Text>
            {def.adminOnly ? <AdminOnlyBadge /> : null}
          </Inline>
          {isTextarea && !isDefault ? (
            <IconButton aria-label={`Reset ${def.label}`} onClick={() => void resetValue(def.key)}>
              <RotateCcw size={15} aria-hidden="true" />
            </IconButton>
          ) : null}
        </Inline>
        {def.description ? (
          <Text size="sm" tone="secondary">
            {def.description}
          </Text>
        ) : null}
        <div className={styles.customBody}>{renderControl(def, value, onChange)}</div>
      </div>
    );
  }

  return (
    <div className={styles.row}>
      <div className={styles.info}>
        <Inline gap={2}>
          <Text weight={500}>{def.label}</Text>
          {def.adminOnly ? <AdminOnlyBadge /> : null}
        </Inline>
        {def.description ? (
          <Text size="sm" tone="secondary">
            {def.description}
          </Text>
        ) : null}
      </div>
      <div className={styles.control}>
        <Inline gap={2}>
          {renderControl(def, value, onChange)}
          {!isDefault ? (
            <IconButton aria-label={`Reset ${def.label}`} onClick={() => void resetValue(def.key)}>
              <RotateCcw size={15} aria-hidden="true" />
            </IconButton>
          ) : null}
        </Inline>
      </div>
    </div>
  );
}
