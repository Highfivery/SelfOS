import { useState } from 'react';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  Button,
  Card,
  Heading,
  Inline,
  Select,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import type { Person } from '@shared/channels';

/** Grant, update, or revoke a person's login (role + optional PIN) so they can use the app. */
export function AccessSection({ person }: { person: Person }): JSX.Element {
  const access = useSessionStore((s) => s.access);
  const reload = useSessionStore((s) => s.load);

  const account = access?.accounts.find((candidate) => candidate.personId === person.id) ?? null;
  const isOwner = account?.roleId === 'owner';
  const grantableRoles = (access?.roles ?? []).filter((role) => role.id !== 'owner');

  const [roleId, setRoleId] = useState(account?.roleId ?? grantableRoles[0]?.id ?? 'member');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.selfos?.accessSetAccount({
        personId: person.id,
        roleId: isOwner ? 'owner' : roleId,
        ...(pin.trim() ? { pin: pin.trim() } : {}),
      });
      setPin('');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.selfos?.accessRemoveAccount(person.id);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={3}>Access</Heading>
        <Text size="sm" tone="secondary">
          {account
            ? `${person.displayName} can sign in${isOwner ? ' as the owner' : ` as a ${account.roleId}`}${account.hasPin ? ' (PIN set)' : ''}.`
            : `${person.displayName} has no login yet — they’re a data record only.`}
        </Text>
        <Inline gap={2} wrap>
          {!isOwner ? (
            <Select
              aria-label="Role"
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              {grantableRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          ) : null}
          <TextInput
            type="password"
            aria-label="PIN"
            placeholder={account?.hasPin ? 'New PIN (optional)' : 'PIN (optional)'}
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          <Button variant="secondary" onClick={() => void save()} disabled={busy}>
            {account ? 'Update access' : 'Grant access'}
          </Button>
          {account && !isOwner ? (
            <Button variant="secondary" onClick={() => void revoke()} disabled={busy}>
              Revoke
            </Button>
          ) : null}
        </Inline>
      </Stack>
    </Card>
  );
}
