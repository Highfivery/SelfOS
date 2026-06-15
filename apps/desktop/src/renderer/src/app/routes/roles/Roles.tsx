import { useEffect } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import { CAPABILITIES, CAPABILITY_LABELS, roleAllows } from '@shared/capabilities';
import {
  AdminOnlyBadge,
  Card,
  Heading,
  Inline,
  Stack,
  Switch,
  Text,
} from '../../../design-system/components';
import type { CapabilityKey } from '@shared/capabilities';
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

  const toggle = async (role: Role, capability: CapabilityKey): Promise<void> => {
    // The Owner is the full-access role — every capability is locked on (the super-admin concept was removed
    // 2026-06-15, folding its powers into the Owner). Only non-owner roles are editable.
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
        <Inline gap={2}>
          <Heading level={2}>Roles</Heading>
          <AdminOnlyBadge />
        </Inline>
        <Text tone="secondary">
          Choose what each role can do. The owner always has full access.
        </Text>
      </Stack>

      {/* One card per role (07-mobile-platform responsive pass): a 3-up grid on desktop that stacks on
          phones, so there's never a horizontal scroll. The owner card is locked all-on. */}
      <div className={styles.roleGrid}>
        {roles.map((role) => {
          const isOwner = role.id === 'owner';
          return (
            <Card key={role.id} className={styles.roleCard}>
              <div className={styles.roleHead}>
                <Heading level={3}>{role.name}</Heading>
                {isOwner ? <span className={styles.fullAccess}>Full access</span> : null}
              </div>
              <ul className={styles.capList}>
                {CAPABILITIES.map((capability) => (
                  <li key={capability} className={styles.capRow}>
                    {/* The Switch's aria-label already carries the role-qualified name, so the visible
                        label is decorative to screen readers (avoids a double announcement per row). */}
                    <span className={styles.capLabel} aria-hidden="true">
                      {CAPABILITY_LABELS[capability]}
                    </span>
                    <Switch
                      checked={roleAllows(role, capability)}
                      disabled={isOwner}
                      aria-label={`${role.name}: ${CAPABILITY_LABELS[capability]}`}
                      onChange={() => void toggle(role, capability)}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </Stack>
  );
}
