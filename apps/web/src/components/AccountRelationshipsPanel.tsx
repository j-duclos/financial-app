import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Account, AccountRelationship, AccountRelationshipType } from "@budget-app/shared";
import { getEffectiveDisplayName } from "@budget-app/shared";
import {
  createAccountRelationship,
  deactivateAccountRelationship,
  listAccountRelationships,
} from "@budget-app/api-client";

const RELATIONSHIP_TYPE_LABELS: Record<AccountRelationshipType, string> = {
  autopay: "Autopay",
  transfer: "Transfer",
  savings_funding: "Savings funding",
  debt_payment: "Debt payment",
  credit_card_payment: "Credit card payment",
  loan_payment: "Loan payment",
  investment_contribution: "Investment",
  bill_funding: "Bill funding",
  paycheck_deposit: "Paycheck deposit",
  other: "Other",
};

type Props = {
  accountId: number;
  accounts: Account[];
  outgoing?: AccountRelationship[];
  incoming?: AccountRelationship[];
};

export default function AccountRelationshipsPanel({
  accountId,
  accounts,
  outgoing: outgoingProp,
  incoming: incomingProp,
}: Props) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    direction: "outgoing" as "outgoing" | "incoming",
    other_account: "",
    relationship_type: "transfer" as AccountRelationshipType,
    default_amount: "",
    default_day: "",
    frequency: "monthly",
  });

  const { data: fetched } = useQuery({
    queryKey: ["account-relationships", accountId],
    queryFn: () => listAccountRelationships({ account: accountId }),
    enabled: outgoingProp === undefined && incomingProp === undefined,
  });

  const outgoing =
    outgoingProp ?? (fetched ?? []).filter((r) => r.source_account === accountId);
  const incoming =
    incomingProp ?? (fetched ?? []).filter((r) => r.destination_account === accountId);
  const all = [...outgoing, ...incoming.filter((r) => !outgoing.some((o) => o.id === r.id))];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["account-relationships"] });
    queryClient.invalidateQueries({ queryKey: ["account", accountId] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  const createMu = useMutation({
    mutationFn: () => {
      const otherId = Number(form.other_account);
      const source = form.direction === "outgoing" ? accountId : otherId;
      const dest = form.direction === "outgoing" ? otherId : accountId;
      return createAccountRelationship({
        source_account: source,
        destination_account: dest,
        relationship_type: form.relationship_type,
        default_amount: form.default_amount.trim() || null,
        default_day: form.default_day.trim() ? Number(form.default_day) : null,
        frequency: form.frequency,
      });
    },
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      setForm((f) => ({ ...f, other_account: "", default_amount: "", default_day: "" }));
    },
  });

  const deactivateMu = useMutation({
    mutationFn: (id: number) => deactivateAccountRelationship(id),
    onSuccess: invalidate,
  });

  const otherAccounts = accounts.filter((a) => a.id !== accountId);

  return (
    <div className="col-span-full border-t pt-3 mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">Account relationships</p>
        <button
          type="button"
          className="text-sm text-blue-600 hover:underline"
          onClick={() => setShowAdd((v) => !v)}
        >
          {showAdd ? "Cancel" : "Add link"}
        </button>
      </div>
      {all.length === 0 && !showAdd && (
        <p className="text-sm text-gray-500">No linked accounts yet.</p>
      )}
      <ul className="space-y-2">
        {all.map((rel) => (
          <li
            key={rel.id}
            className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
          >
            <span className="font-medium text-gray-800">
              {rel.source_account_name}
              <span className="mx-1 text-gray-400">→</span>
              {rel.destination_account_name}
            </span>
            <span className="rounded bg-white border px-1.5 py-0.5 text-xs text-gray-700">
              {rel.relationship_type_display ||
                RELATIONSHIP_TYPE_LABELS[rel.relationship_type]}
            </span>
            {rel.default_amount && (
              <span className="text-gray-600">${rel.default_amount}</span>
            )}
            {rel.default_day != null && (
              <span className="text-gray-500 text-xs">day {rel.default_day}</span>
            )}
            {rel.frequency && rel.frequency !== "one_time" && (
              <span className="text-gray-500 text-xs">{rel.frequency}</span>
            )}
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                rel.is_active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"
              }`}
            >
              {rel.is_active ? "Active" : "Inactive"}
            </span>
            {rel.is_active && (
              <button
                type="button"
                className="ml-auto text-xs text-red-600 hover:underline"
                disabled={deactivateMu.isPending}
                onClick={() => deactivateMu.mutate(rel.id)}
              >
                Deactivate
              </button>
            )}
          </li>
        ))}
      </ul>
      {showAdd && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 border rounded bg-white">
          <div>
            <label className="block text-xs font-medium text-gray-600">Direction</label>
            <select
              value={form.direction}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  direction: e.target.value as "outgoing" | "incoming",
                }))
              }
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="outgoing">Money goes out from this account</option>
              <option value="incoming">Money comes in to this account</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Other account</label>
            <select
              value={form.other_account}
              onChange={(e) => setForm((f) => ({ ...f, other_account: e.target.value }))}
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
              required
            >
              <option value="">Select account</option>
              {otherAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {getEffectiveDisplayName(a)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Type</label>
            <select
              value={form.relationship_type}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  relationship_type: e.target.value as AccountRelationshipType,
                }))
              }
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
            >
              {Object.entries(RELATIONSHIP_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Frequency</label>
            <select
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="monthly">Monthly</option>
              <option value="biweekly">Biweekly</option>
              <option value="weekly">Weekly</option>
              <option value="twice_monthly">Twice monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
              <option value="one_time">One time</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Amount (optional)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.default_amount}
              onChange={(e) => setForm((f) => ({ ...f, default_amount: e.target.value }))}
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Day of month (optional)</label>
            <input
              type="number"
              min={1}
              max={31}
              value={form.default_day}
              onChange={(e) => setForm((f) => ({ ...f, default_day: e.target.value }))}
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="button"
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
              disabled={!form.other_account || createMu.isPending}
              onClick={() => createMu.mutate()}
            >
              {createMu.isPending ? "Saving…" : "Add relationship"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
