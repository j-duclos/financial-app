import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createStaffBetaTesterInvitation,
  extendStaffComplimentaryPremium,
  listStaffBetaTesterInvitations,
  resendStaffBetaTesterInvitation,
  revokeStaffBetaTesterInvitation,
  type StaffBetaTesterInvitation,
} from "@budget-app/api-client";
import { formatFullDate } from "@budget-app/shared";
import { PAGE_SHELL_PY_LOOSE } from "../lib/pageLayout";
import { useProfileQuery } from "../lib/profileQuery";

const QUERY_KEY = ["staff", "beta-testers"] as const;

const primaryButtonClass =
  "inline-flex items-center justify-center py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed";
const secondaryButtonClass =
  "inline-flex items-center justify-center py-1.5 px-2.5 bg-white text-gray-800 text-xs font-medium rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed";
const dangerButtonClass =
  "inline-flex items-center justify-center py-1.5 px-2.5 bg-white text-red-700 text-xs font-medium rounded border border-red-200 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed";

const PRESETS: { label: string; days: number }[] = [
  { label: "30 days", days: 30 },
  { label: "60 days", days: 60 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
];

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function toDateInput(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputFromIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return toDateInput(d);
}

function endOfLocalDayIso(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59`).toISOString();
}

function statusBadgeClass(status: string): string {
  const value = status.toLowerCase();
  if (value === "pending") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (value === "accepted") return "bg-blue-50 text-blue-800 ring-blue-200";
  if (value === "expired") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (value === "revoked") return "bg-red-50 text-red-800 ring-red-200";
  return "bg-gray-50 text-gray-700 ring-gray-200";
}

function formatStatus(status: string): string {
  const value = status.toLowerCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

export default function BetaTesters() {
  const { data: profile, isLoading: profileLoading } = useProfileQuery();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [premiumDate, setPremiumDate] = useState(toDateInput(addDays(90)));
  const [inviteDays, setInviteDays] = useState("7");
  const [viewUser, setViewUser] = useState<StaffBetaTesterInvitation | null>(null);
  const [extendRow, setExtendRow] = useState<StaffBetaTesterInvitation | null>(null);
  const [extendDate, setExtendDate] = useState("");

  const listQuery = useQuery({
    queryKey: [...QUERY_KEY, search, statusFilter],
    queryFn: () =>
      listStaffBetaTesterInvitations({
        q: search.trim() || undefined,
        status: statusFilter || undefined,
      }),
    enabled: profile?.is_staff === true,
  });

  const createMu = useMutation({
    mutationFn: createStaffBetaTesterInvitation,
    onSuccess: async (result) => {
      setNotice(`Beta invitation sent to ${result.email}.`);
      setError(null);
      setInviteOpen(false);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const resendMu = useMutation({
    mutationFn: resendStaffBetaTesterInvitation,
    onSuccess: async (result) => {
      setNotice(`Invitation resent to ${result.email}.`);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const revokeMu = useMutation({
    mutationFn: revokeStaffBetaTesterInvitation,
    onSuccess: async () => {
      setNotice("Invitation revoked.");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const extendMu = useMutation({
    mutationFn: ({ userId, until }: { userId: number; until: string }) =>
      extendStaffComplimentaryPremium(userId, until),
    onSuccess: async () => {
      setNotice("Complimentary Premium expiration updated.");
      setError(null);
      setExtendRow(null);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const rows = listQuery.data?.results ?? [];
  const busy = createMu.isPending || resendMu.isPending || revokeMu.isPending || extendMu.isPending;

  const empty = useMemo(
    () => !listQuery.isLoading && rows.length === 0 && !listQuery.isError,
    [listQuery.isLoading, listQuery.isError, rows.length]
  );

  if (profileLoading) {
    return (
      <div className={PAGE_SHELL_PY_LOOSE}>
        <p className="text-sm text-gray-600">Loading…</p>
      </div>
    );
  }

  if (!profile?.is_staff) {
    return (
      <div className={PAGE_SHELL_PY_LOOSE}>
        <h1 className="text-2xl font-semibold text-gray-900">Forbidden</h1>
        <p className="mt-2 text-sm text-gray-600">You do not have access to this page.</p>
      </div>
    );
  }

  function openInvite(email = "") {
    setInviteEmail(email);
    setPremiumDate(toDateInput(addDays(90)));
    setInviteDays("7");
    setInviteOpen(true);
    setError(null);
  }

  function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (createMu.isPending) return;
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!premiumDate) {
      setError("Choose a Premium through date.");
      return;
    }
    const days = Math.max(1, Number(inviteDays) || 7);
    createMu.mutate({
      email,
      complimentary_premium_until: endOfLocalDayIso(premiumDate),
      expires_at: addDays(days).toISOString(),
    });
  }

  return (
    <div className={PAGE_SHELL_PY_LOOSE}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Beta Testers</h1>
          <p className="mt-1 text-sm text-gray-600">
            Invite selected users to complimentary FlowSight Premium access.
          </p>
        </div>
        <button type="button" className={primaryButtonClass} onClick={() => openInvite()}>
          Invite beta tester
        </button>
      </div>

      {notice ? (
        <p className="mt-4 text-sm text-emerald-700" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
          aria-label="Search email"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
          aria-label="Filter status"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>

      {listQuery.isLoading ? (
        <p className="mt-6 text-sm text-gray-600">Loading invitations…</p>
      ) : null}
      {listQuery.isError ? (
        <p className="mt-6 text-sm text-red-600">Could not load invitations.</p>
      ) : null}

      {empty ? (
        <div className="mt-10 rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-sm text-gray-700">No beta testers yet.</p>
          <button type="button" className={`${primaryButtonClass} mt-4`} onClick={() => openInvite()}>
            Invite your first beta tester
          </button>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Email</th>
                <th className="px-4 py-2 font-semibold">Invitation status</th>
                <th className="px-4 py-2 font-semibold">Premium access through</th>
                <th className="px-4 py-2 font-semibold">Invitation expires</th>
                <th className="px-4 py-2 font-semibold">Accepted user</th>
                <th className="px-4 py-2 font-semibold">Created date</th>
                <th className="px-4 py-2 font-semibold">Accepted date</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = (row.status || "").toLowerCase();
                return (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass(status)}`}
                      >
                        {formatStatus(status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {formatFullDate(row.complimentary_premium_until) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {formatFullDate(row.expires_at) ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.accepted_user?.username || row.accepted_user?.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatFullDate(row.created_at) ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{formatFullDate(row.accepted_at) ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {status === "pending" ? (
                          <>
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`Resend invitation to ${row.email}?`)) {
                                  resendMu.mutate(row.id);
                                }
                              }}
                            >
                              Resend
                            </button>
                            <button
                              type="button"
                              className={dangerButtonClass}
                              disabled={busy}
                              onClick={() => {
                                if (
                                  confirm(
                                    "Revoke this invitation? The existing invitation link will stop working."
                                  )
                                ) {
                                  revokeMu.mutate(row.id);
                                }
                              }}
                            >
                              Revoke
                            </button>
                          </>
                        ) : null}
                        {status === "accepted" ? (
                          <>
                            <button
                              type="button"
                              className={secondaryButtonClass}
                              onClick={() => setViewUser(row)}
                            >
                              View user
                            </button>
                            {row.accepted_user?.id ? (
                              <button
                                type="button"
                                className={secondaryButtonClass}
                                onClick={() => {
                                  setExtendRow(row);
                                  setExtendDate(dateInputFromIso(row.complimentary_premium_until));
                                }}
                              >
                                Extend Premium
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        {status === "expired" || status === "revoked" ? (
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={() => openInvite(row.email)}
                          >
                            Send new invitation
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg"
            onSubmit={submitInvite}
          >
            <h2 className="text-lg font-semibold text-gray-900">Invite beta tester</h2>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Email</span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                autoComplete="email"
              />
            </label>
            <div>
              <p className="text-sm font-medium text-gray-700">Complimentary Premium access</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.days}
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => setPremiumDate(toDateInput(addDays(preset.days)))}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-sm">
                <span className="text-gray-700">Premium through date</span>
                <input
                  type="date"
                  required
                  value={premiumDate}
                  onChange={(e) => setPremiumDate(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Invitation expires (days)</span>
              <input
                type="number"
                min={1}
                value={inviteDays}
                onChange={(e) => setInviteDays(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={createMu.isPending}
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className={primaryButtonClass} disabled={createMu.isPending}>
                {createMu.isPending ? "Sending…" : "Send invitation"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {viewUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-gray-900">Accepted user</h2>
            <p className="text-sm text-gray-700">Username: {viewUser.accepted_user?.username ?? "—"}</p>
            <p className="text-sm text-gray-700">Email: {viewUser.accepted_user?.email ?? viewUser.email}</p>
            <p className="text-sm text-gray-700">
              Premium through: {formatFullDate(viewUser.complimentary_premium_until) ?? "—"}
            </p>
            <button type="button" className={secondaryButtonClass} onClick={() => setViewUser(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {extendRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-lg"
            onSubmit={(e) => {
              e.preventDefault();
              const userId = extendRow.accepted_user?.id;
              if (!userId || !extendDate || extendMu.isPending) return;
              extendMu.mutate({ userId, until: endOfLocalDayIso(extendDate) });
            }}
          >
            <h2 className="text-lg font-semibold text-gray-900">Extend Premium</h2>
            <p className="text-sm text-gray-700">
              Current expiration: {formatFullDate(extendRow.complimentary_premium_until) ?? "—"}
            </p>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">New expiration</span>
              <input
                type="date"
                required
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={extendMu.isPending}
                onClick={() => setExtendRow(null)}
              >
                Cancel
              </button>
              <button type="submit" className={primaryButtonClass} disabled={extendMu.isPending}>
                {extendMu.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
