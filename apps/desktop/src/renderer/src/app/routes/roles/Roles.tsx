import { useEffect } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { CAPABILITIES, CAPABILITY_LABELS, roleAllows } from '@shared/capabilities';
import { Heading, Stack, Switch, Text } from '../../../design-system/components';
import type { Role } from '@shared/channels';
import styles from './Roles.module.css';

/** Owner-editable role × capability matrix (04-people-roles §4.3). Owner always keeps full access. */
export function Roles(): JSX.Element {
  const access = useSessionStore((s) => s.access);
  const reload = useSessionStore((s) => s.load);

  useEffect(() => {
    void reload();
  }, [reload]);

  const roles = access?.roles ?? [];

  const toggle = async (role: Role, capability: string): Promise<void> => {
    if (role.id === 'owner') return;
    const updated: Role = {
      ...role,
      capabilities: { ...role.capabilities, [capability]: !role.capabilities[capability] },
    };
    await window.selfos?.accessSaveRole(updated);
    await reload();
  };

  return (
    <Stack gap={5}>
      <Stack gap={1}>
        <Heading level={2}>Roles</Heading>
        <Text tone="secondary">
          Choose what each role can do. The owner always has full access.
        </Text>
      </Stack>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.capCol}>
                Capability
              </th>
              {roles.map((role) => (
                <th key={role.id} scope="col">
                  {role.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((capability) => (
              <tr key={capability}>
                <th scope="row" className={styles.capCol}>
                  {CAPABILITY_LABELS[capability]}
                </th>
                {roles.map((role) => (
                  <td key={role.id} className={styles.cell}>
                    <Switch
                      checked={roleAllows(role, capability)}
                      disabled={role.id === 'owner'}
                      aria-label={`${role.name}: ${CAPABILITY_LABELS[capability]}`}
                      onChange={() => void toggle(role, capability)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Stack>
  );
}
