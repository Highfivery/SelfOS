import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DevicesControl } from './DevicesControl';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import type { DeviceView } from '@shared/channels';

const now = new Date().toISOString();
const devices: DeviceView[] = [
  {
    deviceId: 'A',
    label: "Ben's Mac",
    platform: 'macos',
    createdAt: now,
    lastSeenAt: now,
    isThisDevice: true,
    lastActivePersonName: 'Ben',
  },
  {
    deviceId: 'B',
    label: 'iPhone',
    platform: 'ios',
    createdAt: now,
    lastSeenAt: now,
    isThisDevice: false,
    lastActivePersonName: null,
  },
];

afterEach(() => clearMockBridge());

describe('DevicesControl (28 §3.1)', () => {
  it('lists devices, marks this device, and disables revoking it', async () => {
    installMockBridge({ devicesList: () => Promise.resolve(devices) });
    render(<DevicesControl />);
    expect(await screen.findByText("Ben's Mac")).toBeInTheDocument();
    expect(screen.getByText('iPhone')).toBeInTheDocument();
    expect(screen.getByText('· This device')).toBeInTheDocument();
    // Revoke is disabled on "this device" (Ben's Mac), enabled on the iPhone.
    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' });
    expect(revokeButtons[0]).toBeDisabled(); // this device
    expect(revokeButtons[1]).toBeEnabled();
  });

  it('renames a device via the bridge', async () => {
    const devicesRename = vi.fn(() => Promise.resolve());
    installMockBridge({ devicesList: () => Promise.resolve(devices), devicesRename });
    render(<DevicesControl />);
    await screen.findByText('iPhone');
    await userEvent.click(screen.getAllByRole('button', { name: 'Rename' })[1]!);
    const input = screen.getByLabelText('Rename iPhone');
    await userEvent.clear(input);
    await userEvent.type(input, 'Work phone');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(devicesRename).toHaveBeenCalledWith({ deviceId: 'B', label: 'Work phone' });
  });

  it('revoke opens the serious dialog and shows the new phrase on success', async () => {
    const keysRotate = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        recoveryPhrase: 'amber tide fox quill river stone',
        reencryptedFileCount: 12,
        revokedDeviceIds: ['B'],
        cancelledInviteCount: 0,
      }),
    );
    installMockBridge({ devicesList: () => Promise.resolve(devices), keysRotate });
    render(<DevicesControl />);
    await screen.findByText('iPhone');
    await userEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[1]!);

    // The serious dialog lists the consequences.
    expect(screen.getByRole('dialog', { name: 'Revoke iPhone' })).toBeInTheDocument();
    expect(screen.getByText(/re-encrypt your entire vault/i)).toBeInTheDocument();
    expect(screen.getByText(/change your recovery phrase/i)).toBeInTheDocument();
    expect(screen.getByText(/sign out all other devices/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Revoke & re-key' }));
    expect(keysRotate).toHaveBeenCalledWith({ revokeDeviceIds: ['B'] });
    // The new phrase is shown once.
    await waitFor(() =>
      expect(screen.getByText('amber tide fox quill river stone')).toBeInTheDocument(),
    );
    expect(screen.getByText(/won’t be shown again/i)).toBeInTheDocument();
  });
});
