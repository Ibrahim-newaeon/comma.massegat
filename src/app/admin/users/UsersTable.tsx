'use client';
// src/app/admin/users/UsersTable.tsx
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, apiPatch, ApiError } from '@/lib/csrfClient';
import { InviteDialog } from '@/components/admin/InviteDialog';
import { formatDateTime, type Dict, type Locale } from '@/lib/i18n/dict';

type Row = {
  id: string; email: string; displayName: string; displayNameAr: string | null;
  role: string; isActive: boolean; totpEnabled: boolean; createdAt: string;
  approvalStatus: string; createdVia: string;
};

export function UsersTable({ dict, locale, users }: { dict: Dict; locale: Locale; users: Row[] }) {
  const router = useRouter();
  const pending = users.filter((u) => u.approvalStatus === 'pending');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', displayName: '', displayNameAr: '', role: 'member' });
  const [invite, setInvite] = useState<{
    setupUrl: string; expiresAt: string; displayName: string; email: string; isReset: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createUser() {
    setBusy(true); setError(null);
    try {
      const data = await apiPost<{ setupUrl: string; expiresAt?: string }>('/api/admin/users', {
        email: form.email,
        displayName: form.displayName,
        displayNameAr: form.displayNameAr || undefined,
        role: form.role,
        locale,
      });
      setInvite({
        setupUrl: data.setupUrl,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        isReset: false,
      });
      setForm({ email: '', displayName: '', displayNameAr: '', role: 'member' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : dict.error);
    } finally { setBusy(false); }
  }

  async function act(id: string, action: string, role?: string) {
    setBusy(true); setError(null);
    try {
      const data = await apiPatch<{ setupUrl?: string; expiresAt?: string }>(`/api/admin/users/${id}`, { action, role });
      if (data.setupUrl) {
        const u = users.find((x) => x.id === id);
        setInvite({
          setupUrl: data.setupUrl,
          expiresAt: data.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
          displayName: u?.displayName ?? '',
          email: u?.email ?? '',
          isReset: true,
        });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : dict.error);
    } finally { setBusy(false); }
  }

  const field = 'touch-target w-full rounded-md border border-[var(--border)] px-3';

  return (
    <div className="space-y-6">
      <button type="button" data-testid="toggle-create-user" onClick={() => setCreating((v) => !v)}
        className="touch-target rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)]">
        {dict.createUser}
      </button>

      {creating && (
        <div className="space-y-3 rounded-lg border border-[var(--border)] p-4" data-testid="create-user-form">
          <input placeholder={dict.email} value={form.email} dir="ltr"
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            data-testid="new-user-email" className={`force-ltr ${field}`} />
          <input placeholder={dict.displayName} value={form.displayName} dir="auto"
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            data-testid="new-user-name" className={field} />
          <input placeholder={dict.displayNameAr} value={form.displayNameAr} dir="auto"
            onChange={(e) => setForm({ ...form, displayNameAr: e.target.value })}
            data-testid="new-user-name-ar" className={field} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            data-testid="new-user-role" aria-label={dict.role} className={field}>
            <option value="member">member</option>
            <option value="moderator">moderator</option>
            <option value="admin">admin</option>
          </select>
          <button type="button" onClick={createUser} disabled={busy || !form.email || !form.displayName}
            data-testid="submit-create-user"
            className="touch-target w-full rounded-md bg-[var(--accent)] px-4 font-medium text-[var(--accent-on)] disabled:opacity-50">
            {busy ? dict.loading : dict.createUser}
          </button>
        </div>
      )}

      {invite && (
        <InviteDialog
          dict={dict}
          locale={locale}
          setupUrl={invite.setupUrl}
          expiresAt={invite.expiresAt}
          displayName={invite.displayName}
          email={invite.email}
          isReset={invite.isReset}
          onClose={() => setInvite(null)}
        />
      )}

      {pending.length > 0 && (
        <section data-testid="pending-approvals"
          className="rounded-xl border border-[var(--highlight)] bg-[var(--highlight-subtle)] p-4">
          <h2 className="mb-3 text-sm font-semibold">
            {dict.pendingApproval} ({pending.length})
          </h2>
          {pending.map((u) => (
            <div key={u.id} data-testid={`pending-${u.id}`}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-2 last:border-0">
              <span className="min-w-0">
                <bdi dir="auto" className="block truncate text-sm font-medium">{u.displayName}</bdi>
                <span className="force-ltr block truncate text-xs text-[var(--muted)]">{u.email}</span>
              </span>
              <span className="flex shrink-0 gap-2">
                <button type="button" onClick={() => act(u.id, 'approve')} disabled={busy}
                  data-testid={`approve-${u.id}`}
                  className="touch-target rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-on)] disabled:opacity-50">
                  {dict.approve}
                </button>
                <button type="button" onClick={() => act(u.id, 'reject')} disabled={busy}
                  data-testid={`reject-${u.id}`}
                  className="touch-target rounded-lg border border-[var(--danger)] px-4 text-sm text-[var(--danger)] disabled:opacity-50">
                  {dict.reject}
                </button>
              </span>
            </div>
          ))}
        </section>
      )}

      {error && <p role="alert" data-testid="admin-error" className="text-sm text-[var(--danger)]">{error}</p>}

      {/* Narrow viewports scroll the table rather than overflowing the page.
          Without this, cells spill outside the viewport and the action buttons
          in the last column cannot be tapped at all. */}
      <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[720px] text-start text-sm" data-testid="users-table">
        <thead>
          <tr className="border-b border-[var(--border)] text-start">
            <th className="p-2 text-start">{dict.displayName}</th>
            <th className="p-2 text-start">{dict.email}</th>
            <th className="p-2 text-start">{dict.role}</th>
            <th className="p-2 text-start">{dict.status}</th>
            <th className="p-2 text-start">TOTP</th>
            <th className="p-2 text-start">{dict.time}</th>
            <th className="p-2 text-start" />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-[var(--border)]" data-testid={`user-row-${u.email}`}>
              <td className="p-2"><bdi dir="auto">{locale === 'ar' && u.displayNameAr ? u.displayNameAr : u.displayName}</bdi></td>
              <td className="p-2"><span className="force-ltr">{u.email}</span></td>
              <td className="p-2" data-testid={`role-${u.email}`}>{u.role}</td>
              <td className="p-2" data-testid={`status-${u.email}`}
                  data-approval={u.approvalStatus} data-active={u.isActive}>
                {/* Approval wins over isActive: a pending account can be
                    "active" and still be refused at login, which is exactly
                    how three accounts ended up stuck. */}
                {u.approvalStatus === 'pending' ? (
                  <span className="rounded-full bg-[var(--highlight-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--highlight)]">
                    {dict.pendingApproval}
                  </span>
                ) : u.approvalStatus === 'rejected' ? (
                  <span className="text-[var(--danger)]">{dict.reject}</span>
                ) : (
                  u.isActive ? dict.active : dict.inactive
                )}
              </td>
              <td className="p-2">{u.totpEnabled ? '✓' : '—'}</td>
              <td className="p-2">{formatDateTime(new Date(u.createdAt), locale)}</td>
              <td className="p-2">
                <div className="flex gap-2 whitespace-nowrap">
                  <button type="button" disabled={busy}
                    onClick={() => act(u.id, u.isActive ? 'deactivate' : 'reactivate')}
                    data-testid={`toggle-active-${u.email}`}
                    className="touch-target rounded-md border border-[var(--border)] px-3 text-xs">
                    {u.isActive ? dict.deactivate : dict.reactivate}
                  </button>
                  <button type="button" disabled={busy} onClick={() => act(u.id, 'reset_password')}
                    data-testid={`reset-${u.email}`}
                    className="touch-target rounded-md border border-[var(--border)] px-3 text-xs">
                    {dict.resetPassword}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
