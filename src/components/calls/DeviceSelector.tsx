'use client';
// src/components/calls/DeviceSelector.tsx
import { useEffect, useState } from 'react';
import type { MediaTransport, MediaDeviceOption } from '@/lib/calls/types';
import type { Dict } from '@/lib/i18n/dict';

const KINDS: { kind: MediaDeviceKind; labelKey: keyof Dict }[] = [
  { kind: 'audioinput', labelKey: 'microphone' },
  { kind: 'videoinput', labelKey: 'camera' },
  { kind: 'audiooutput', labelKey: 'speaker' },
];

export function DeviceSelector({
  transport, dict,
}: {
  transport: React.RefObject<MediaTransport | null>;
  dict: Dict;
}) {
  const [devices, setDevices] = useState<Record<string, MediaDeviceOption[]>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = transport.current;
    if (!t) return;
    let cancelled = false;

    (async () => {
      const next: Record<string, MediaDeviceOption[]> = {};
      for (const { kind } of KINDS) {
        try { next[kind] = await t.listDevices(kind); } catch { next[kind] = []; }
      }
      if (!cancelled) setDevices(next);
    })();

    return () => { cancelled = true; };
  }, [transport]);

  async function pick(kind: MediaDeviceKind, deviceId: string) {
    setSelected((p) => ({ ...p, [kind]: deviceId }));
    // Persisted so the choice survives the next call.
    // A camera or microphone id identifies hardware on THIS machine. There
    // is no sensible server representation of "the second USB microphone on
    // this laptop", so the localStorage rule does not apply here.
    // eslint-disable-next-line no-restricted-properties
    try { localStorage.setItem(`device:${kind}`, deviceId); } catch { /* private mode */ }
    await transport.current?.selectDevice(kind, deviceId);
  }

  return (
    <div className="space-y-2 p-3" data-testid="device-selector">
      {KINDS.map(({ kind, labelKey }) => (
        <label key={kind} className="block text-xs">
          <span className="mb-1 block">{dict[labelKey] as string}</span>
          <select
            value={selected[kind] ?? ''}
            onChange={(e) => pick(kind, e.target.value)}
            data-testid={`device-${kind}`}
            aria-label={dict[labelKey] as string}
            className="touch-target w-full rounded-md border border-[var(--border)] px-2"
          >
            <option value="">{dict.defaultDevice}</option>
            {(devices[kind] ?? []).map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
