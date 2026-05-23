import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlaidLink } from "react-plaid-link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPlaidRedirectUri } from "../lib/plaidRedirectUri";
import type { PlaidItem } from "@budget-app/api-client";
import {
  ApiError,
  clearManualTransactions,
  clearManualTransactionsPreview,
  createPlaidLinkToken,
  deletePlaidItem,
  exchangePlaidPublicToken,
  getPlaidMeta,
  listPlaidItems,
  resetPlaidItemSyncCursor,
  syncPlaidItem,
} from "@budget-app/api-client";

/** Survives full-page OAuth return (Chase, etc.). */
const PLAID_LINK_TOKEN_SESSION_KEY = "budget-app.plaid.link_token_pending";

function persistPendingLinkToken(token: string): void {
  try {
    sessionStorage.setItem(PLAID_LINK_TOKEN_SESSION_KEY, token);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(PLAID_LINK_TOKEN_SESSION_KEY, token);
  } catch {
    /* ignore */
  }
}

function readPendingLinkToken(): string | null {
  try {
    return (
      sessionStorage.getItem(PLAID_LINK_TOKEN_SESSION_KEY) || localStorage.getItem(PLAID_LINK_TOKEN_SESSION_KEY)
    );
  } catch {
    return null;
  }
}

function clearPendingLinkToken(): void {
  try {
    sessionStorage.removeItem(PLAID_LINK_TOKEN_SESSION_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PLAID_LINK_TOKEN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

type PlaidExitError = { error_message?: string; error_code?: string; display_message?: string };

/**
 * react-plaid-link's usePlaidLink does not put ``receivedRedirectUri`` in its useEffect deps, so the Plaid
 * instance never picks up OAuth return. Remounting this component when ``receivedRedirectUri`` appears
 * forces a fresh Plaid.create with the full URL (Plaid/Chase otherwise show a generic internal error).
 */
function PlaidLinkHost({
  linkToken,
  receivedRedirectUri,
  householdId,
  onExchangeSuccess,
  onSessionEnd,
  onLinkUiError,
}: {
  linkToken: string;
  receivedRedirectUri: string | null;
  /** Null only briefly on load; exchange waits for a number. */
  householdId: number | null;
  onExchangeSuccess: (publicToken: string) => Promise<void>;
  onSessionEnd: () => void;
  onLinkUiError: (message: string) => void;
}) {
  const openedRef = useRef<string | null>(null);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri ?? undefined,
    onSuccess: (publicToken) => {
      void onExchangeSuccess(publicToken);
    },
    onExit: (err: PlaidExitError | null) => {
      if (err && (err.error_message || err.display_message || err.error_code)) {
        onLinkUiError(
          [err.display_message, err.error_message, err.error_code].filter(Boolean).join(" — ")
        );
      }
      onSessionEnd();
    },
    onEvent: (eventName, metadata) => {
      if (eventName === "ERROR" || metadata.error_code) {
        const parts = [
          metadata.error_message,
          metadata.error_code,
          metadata.institution_name,
          metadata.request_id,
        ].filter(Boolean);
        if (parts.length) onLinkUiError(`Plaid: ${parts.join(" — ")}`);
      }
    },
  });

  useEffect(() => {
    if (!linkToken || !ready) return;
    const openKey = receivedRedirectUri ? `${linkToken}\0oauth` : linkToken;
    if (openedRef.current === openKey) return;
    openedRef.current = openKey;
    open();
  }, [linkToken, ready, open, receivedRedirectUri]);

  return null;
}

function stripOAuthParamsFromLocation(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("oauth_state_id")) return;
  url.searchParams.delete("oauth_state_id");
  const q = url.searchParams.toString();
  window.history.replaceState({}, "", url.pathname + (q ? `?${q}` : "") + url.hash);
}

function formatPlaidError(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

/**
 * OAuth redirect_uri is origin + /plaid/oauth-return (or VITE_PLAID_REDIRECT_URI) — must match Plaid
 * “Allowed redirect URIs” exactly. Legacy /transactions still works if allowlisted.
 */
function plaidTunnelOriginMismatchHint(): string | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") {
    return "You are on localhost. Plaid uses this tab’s URL as redirect_uri. If you only allowlisted an https tunnel (e.g. …lhr.life), open the app at that https URL in the address bar—not localhost—then try Link a bank again.";
  }
  return null;
}

/** Backend stored names like "Capital One · …"; strip repeated institution prefix for display under that bank. */
function displayAccountName(fullName: string, institution: string): string {
  const inst = institution.trim();
  if (!inst) return fullName;
  const dotPrefix = `${inst} · `;
  let s = fullName.trim();
  while (s.startsWith(dotPrefix)) {
    s = s.slice(dotPrefix.length).trimStart();
  }
  if (s.length === 0) return fullName;
  return s;
}

/** Same fingerprint ⇒ same institution + same masks + same account names — duplicate Link sessions. */
function connectionFingerprint(it: PlaidItem): string {
  const instKey = `${it.institution_id}|${(it.institution_name ?? "").trim()}`;
  const parts = (it.linked_accounts ?? [])
    .map((la) => {
      const mask = (la.mask ?? "").trim();
      const nm = (la.account_name ?? "").trim();
      return `${mask}::${nm}`;
    })
    .sort();
  return `${instKey}@@${parts.join("@@")}`;
}

function linkedAtLabel(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

export function PlaidConnectBar({
  householdId,
  redirectAfterLink,
  oauthReturnPage = false,
}: {
  householdId: number | null;
  /** Navigate here after a successful Link exchange (e.g. OAuth return page → Accounts). */
  redirectAfterLink?: string;
  /** Minimal UI on /plaid/oauth-return — only resume Link, not the full connections panel. */
  oauthReturnPage?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  /** Set only when completing Plaid OAuth return (same link_token as before redirect). */
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(null);
  const [plaidError, setPlaidError] = useState<string | null>(null);
  const [fetchingLink, setFetchingLink] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [resettingCursorId, setResettingCursorId] = useState<number | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  /** OAuth return: restore immediately — do not wait for householdId (that blocked Link from reopening). */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("oauth_state_id")) return;
    const stored = readPendingLinkToken();
    if (!stored) {
      setPlaidError(
        "Bank sign-in could not resume (missing session). Close this and use Connect bank again."
      );
      stripOAuthParamsFromLocation();
      return;
    }
    setPlaidError(null);
    setLinkToken(stored);
    setReceivedRedirectUri(window.location.href);
  }, []);

  useEffect(() => {
    if (!statusLine) return;
    const t = window.setTimeout(() => setStatusLine(null), 10000);
    return () => window.clearTimeout(t);
  }, [statusLine]);

  const { data: itemsData, isError: itemsError, isFetching: itemsLoading } = useQuery({
    queryKey: ["plaid-items", householdId],
    queryFn: () => listPlaidItems({ household: householdId!, page_size: 50 }),
    enabled: householdId != null,
  });

  const { data: plaidMeta } = useQuery({
    queryKey: ["plaid-meta"],
    queryFn: () => getPlaidMeta(),
    enabled: householdId != null,
    staleTime: 60_000,
  });

  const showLivePlaidChecklist =
    plaidMeta &&
    plaidMeta.plaid_configured &&
    (plaidMeta.plaid_env === "production" || plaidMeta.plaid_env === "development");

  const items = itemsData?.results ?? [];
  const totalLinkedAccounts = items.reduce((n, it) => n + (it.linked_accounts?.length ?? 0), 0);

  const duplicateFingerprints = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) {
      const fp = connectionFingerprint(it);
      counts.set(fp, (counts.get(fp) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [fp, n] of counts) {
      if (n > 1) dups.add(fp);
    }
    return dups;
  }, [items]);

  const hasDuplicateConnections = duplicateFingerprints.size > 0;

  const onSuccess = useCallback(
    async (publicToken: string) => {
      if (householdId == null) {
        setPlaidError(
          "Bank linked, but the page is still loading your household. Refresh this page once—your bank should stay connected."
        );
        return;
      }
      setPlaidError(null);
      try {
        await exchangePlaidPublicToken({ public_token: publicToken, household_id: householdId });
        setLinkToken(null);
        setReceivedRedirectUri(null);
        clearPendingLinkToken();
        stripOAuthParamsFromLocation();
        setStatusLine("Bank linked. Use Import on each login below to pull transactions.");
        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
        await queryClient.invalidateQueries({ queryKey: ["plaid-items"] });
        await queryClient.invalidateQueries({ queryKey: ["transactions"] });
        await queryClient.invalidateQueries({ queryKey: ["timeline"] });
        if (redirectAfterLink) {
          navigate(redirectAfterLink, { replace: true });
        }
      } catch (e) {
        setPlaidError(formatPlaidError(e));
      }
    },
    [householdId, queryClient, redirectAfterLink, navigate]
  );

  const closeLinkSession = useCallback(() => {
    setLinkToken(null);
    setReceivedRedirectUri(null);
    clearPendingLinkToken();
    stripOAuthParamsFromLocation();
  }, []);

  const startLink = async () => {
    if (householdId == null || fetchingLink) return;
    setPlaidError(null);
    setFetchingLink(true);
    try {
      const redirect_uri = getPlaidRedirectUri();
      const { link_token } = await createPlaidLinkToken(householdId, { redirect_uri });
      persistPendingLinkToken(link_token);
      setLinkToken(link_token);
    } catch (e) {
      setPlaidError(formatPlaidError(e));
    } finally {
      setFetchingLink(false);
    }
  };

  const linkHost =
    linkToken != null ? (
      <PlaidLinkHost
        key={`${linkToken}__${receivedRedirectUri ?? ""}`}
        linkToken={linkToken}
        receivedRedirectUri={receivedRedirectUri}
        householdId={householdId}
        onExchangeSuccess={onSuccess}
        onSessionEnd={closeLinkSession}
        onLinkUiError={setPlaidError}
      />
    ) : null;

  if (householdId == null) {
    return (
      <>
        {linkHost}
        {oauthReturnPage ? (
          plaidError ? (
            <p className="text-sm text-red-700 whitespace-pre-wrap mt-3" role="alert">
              {plaidError}
            </p>
          ) : (
            <p className="text-sm text-slate-600 text-center mt-3">Resuming bank sign-in…</p>
          )
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 max-w-xl">
            Set a <strong className="font-medium text-slate-700">default household</strong> in Profile, or{" "}
            <strong className="font-medium text-slate-700">create a household</strong> on this page — then you can link a
            bank and import transactions.
          </div>
        )}
      </>
    );
  }

  if (oauthReturnPage) {
    return (
      <>
        {linkHost}
        {plaidError ? (
          <p className="text-sm text-red-700 whitespace-pre-wrap mt-3" role="alert">
            {plaidError}
          </p>
        ) : (
          <p className="text-sm text-slate-600 text-center mt-3">Resuming bank sign-in…</p>
        )}
        {statusLine ? (
          <p className="text-xs text-emerald-950 bg-emerald-50 border border-emerald-200 rounded px-2 py-2 mt-3">
            {statusLine}
          </p>
        ) : null}
      </>
    );
  }

  const summaryHint =
    items.length === 0
      ? "No banks linked yet"
      : `${items.length} bank login${items.length === 1 ? "" : "s"}, ${totalLinkedAccounts} account${totalLinkedAccounts === 1 ? "" : "s"}`;

  const tunnelOriginHint = plaidTunnelOriginMismatchHint();

  return (
    <>
      {linkHost}
    <div className="w-full min-w-0 flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 pr-2 pb-2 pt-2 pl-0 shadow-sm">
      <details className="group flex-1 min-w-[12rem] [&_summary::-webkit-details-marker]:hidden">
        <summary className="cursor-pointer list-none px-3 py-1 flex flex-wrap items-baseline gap-x-2 gap-y-0">
          <span className="text-sm font-semibold text-slate-800">Bank connections (Plaid)</span>
          <span className="text-xs text-slate-500">{summaryHint}</span>
        </summary>

      <div className="border-t border-slate-200 px-3 pb-3 pt-1 mt-1 space-y-3 max-h-[min(22rem,55vh)] overflow-y-auto">
        {showLivePlaidChecklist ? (
          <details className="rounded-md border border-sky-200 bg-sky-50/80 px-2 py-2 text-xs text-slate-800 leading-snug">
            <summary className="cursor-pointer font-medium text-sky-950">
              Live banks (e.g. Chase): Plaid still shows only &quot;Internal error&quot;?
            </summary>
            <p className="mt-2 text-slate-700">
              Plaid documents this exact symptom as usually <strong className="font-medium">not</strong> your redirect
              URL when it is already correct. Check these in order (all in the Plaid Dashboard):
            </p>
            <ol className="mt-1.5 list-decimal pl-4 space-y-1 text-slate-700">
              <li>
                A <strong className="font-medium">Link use case</strong> is selected (Team / Link settings — see{" "}
                <a className="text-sky-800 underline" href={plaidMeta.plaid_dashboard_home} target="_blank" rel="noreferrer">
                  dashboard
                </a>
                ).
              </li>
              <li>
                <strong className="font-medium">OAuth registration for Chase</strong> — if Link logs show{" "}
                <code className="text-[11px]">INSTITUTION_REGISTRATION_REQUIRED</code>, open{" "}
                <a
                  className="text-sky-800 underline"
                  href={plaidMeta.oauth_institution_status_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  OAuth institution status
                </a>{" "}
                and{" "}
                <a className="text-sky-800 underline" href={plaidMeta.oauth_institutions_url} target="_blank" rel="noreferrer">
                  US OAuth institutions
                </a>
                ; Chase can stay blocked for up to ~24h after approval.
              </li>
              <li>
                <strong className="font-medium">Allowed redirect URIs</strong> match this app exactly (including{" "}
                <code className="text-[11px]">/plaid/oauth-return</code> for OAuth return):{" "}
                <a className="text-sky-800 underline" href={plaidMeta.redirect_uris_url} target="_blank" rel="noreferrer">
                  Developers → API
                </a>
                .
              </li>
              <li>
                Disable <strong className="font-medium">ad blockers</strong> for this tunnel host — they can break
                Link.
              </li>
            </ol>
            <p className="mt-2">
              <a className="text-sky-800 underline" href={plaidMeta.troubleshooting_url} target="_blank" rel="noreferrer">
                Plaid: Link troubleshooting
              </a>
            </p>
          </details>
        ) : null}

        <p className="text-xs text-slate-600 leading-snug pt-1">
          Each row is one <strong className="font-medium text-slate-700">bank login</strong> (one completed Plaid Link).
          Running Link again for the same bank creates <strong className="font-medium text-slate-700">another login</strong>
          — duplicate rows with the same accounts. Keep one and disconnect the rest so imports are not confusing.
        </p>
        <p className="text-xs text-slate-600 leading-snug">
          To attach imports to accounts you already created on the{" "}
          <strong className="font-medium text-slate-700">Accounts</strong> page, set{" "}
          <strong className="font-medium text-slate-700">Last four digits</strong> there so it matches Plaid — we do{" "}
          <strong className="font-medium text-slate-700">not</strong> match by account name.
        </p>

        {hasDuplicateConnections ? (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 px-2 py-2 text-xs text-amber-950 leading-snug"
            role="status"
          >
            <strong className="font-semibold">Duplicate connections detected.</strong> Two or more rows list the same
            institution and accounts — usually from linking the same bank more than once. Transactions only need{" "}
            <strong className="font-medium">one</strong> active login; extras create duplicate app accounts and wasted
            imports. Disconnect duplicates you don&apos;t need (accounts stay on the Accounts page until you delete them).
          </div>
        ) : null}

        {itemsLoading && items.length === 0 ? (
          <p className="text-xs text-slate-500">Loading connections…</p>
        ) : null}

        {items.length > 0 ? (
          <ul className="space-y-2">
            {items.map((it) => (
              <ConnectionCard
                key={it.id}
                it={it}
                isLikelyDuplicate={duplicateFingerprints.has(connectionFingerprint(it))}
                syncing={syncingId === it.id}
                removing={removingId === it.id}
                resettingCursor={resettingCursorId === it.id}
                setPlaidError={setPlaidError}
                setStatusLine={setStatusLine}
                onSync={async () => {
                  setPlaidError(null);
                  setSyncingId(it.id);
                  try {
                    const r = await syncPlaidItem(it.id);
                    const parts = [
                      r.added ? `${r.added} new` : null,
                      r.merged ? `${r.merged} linked to your manual entries` : null,
                      r.modified ? `${r.modified} updated` : null,
                      r.removed ? `${r.removed} removed` : null,
                    ].filter(Boolean);
                    if (parts.length) {
                      setStatusLine(`Import: ${parts.join(", ")}.`);
                    } else {
                      setStatusLine(
                        "Import finished — no new posted transactions from Plaid (often already imported). Pending charges are skipped until they post. Try Import again in a few minutes if you just linked."
                      );
                    }
                    await queryClient.invalidateQueries({ queryKey: ["transactions"] });
                    await queryClient.invalidateQueries({ queryKey: ["accounts"] });
                    await queryClient.invalidateQueries({ queryKey: ["timeline"] });
                  } catch (e) {
                    setPlaidError(formatPlaidError(e));
                  } finally {
                    setSyncingId(null);
                  }
                }}
                onDisconnect={async () => {
                  if (
                    !window.confirm(
                      "Disconnect this bank login from Plaid? Imported transactions stay in the app. Remove accounts from the Accounts page only if you don’t need them."
                    )
                  ) {
                    return;
                  }
                  setPlaidError(null);
                  setRemovingId(it.id);
                  try {
                    await deletePlaidItem(it.id);
                    setStatusLine("Disconnected.");
                    await queryClient.invalidateQueries({ queryKey: ["plaid-items"] });
                  } catch (e) {
                    setPlaidError(formatPlaidError(e));
                  } finally {
                    setRemovingId(null);
                  }
                }}
                onResetSyncCursor={async () => {
                  if (
                    !window.confirm(
                      "Reset Plaid’s sync cursor for this bank login? Use this if you cleared transactions in the app but Import shows nothing new. The next Import will ask Plaid for history again (may return many transactions)."
                    )
                  ) {
                    return;
                  }
                  setPlaidError(null);
                  setResettingCursorId(it.id);
                  try {
                    const r = await resetPlaidItemSyncCursor(it.id);
                    setStatusLine(r.detail);
                    await queryClient.invalidateQueries({ queryKey: ["plaid-items"] });
                  } catch (e) {
                    setPlaidError(formatPlaidError(e));
                  } finally {
                    setResettingCursorId(null);
                  }
                }}
              />
            ))}
          </ul>
        ) : !itemsLoading ? (
          <p className="text-xs text-slate-600">
            No banks linked — use the <strong className="font-medium text-slate-700">Link a bank</strong> button.
          </p>
        ) : null}

        {itemsError ? (
          <p className="text-xs text-red-700" role="alert">
            Could not load bank connections. Refresh or try again.
          </p>
        ) : null}
        {tunnelOriginHint ? (
          <p className="text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded px-2 py-2 leading-snug" role="status">
            {tunnelOriginHint}
          </p>
        ) : null}
        {plaidError ? (
          <p className="text-xs text-red-700 whitespace-pre-wrap" role="alert">
            {plaidError}
          </p>
        ) : null}
        {statusLine ? (
          <p className="text-xs text-emerald-950 bg-emerald-50 border border-emerald-200 rounded px-2 py-2 whitespace-pre-wrap leading-snug">
            {statusLine}
          </p>
        ) : null}

        <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-200 pt-2">
          SMS during bank sign-in: add your mobile number on Profile when your bank texts a code.
        </p>
      </div>
      </details>
      <button
        type="button"
        onClick={() => void startLink()}
        disabled={fetchingLink}
        className="shrink-0 rounded-md border border-slate-400 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed mt-0.5"
      >
        {fetchingLink ? "Starting…" : "Link a bank"}
      </button>
    </div>
    </>
  );
}

function ClearManualOnlyButton({
  accountId,
  label,
  disabled,
  setPlaidError,
  setStatusLine,
}: {
  accountId: number;
  label: string;
  disabled: boolean;
  setPlaidError: (msg: string | null) => void;
  setStatusLine: (msg: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setPlaidError(null);
    setBusy(true);
    try {
      const { eligible_count: n } = await clearManualTransactionsPreview(accountId);
      if (n === 0) {
        setStatusLine(`No manual-only rows to remove on “${label}”.`);
        return;
      }
      const ok = window.confirm(
        `Remove ${n} manual-only transaction(s) on “${label}”? Bank-imported lines from Plaid stay. This cannot be undone.`
      );
      if (!ok) return;
      const r = await clearManualTransactions(accountId, { confirm: true });
      setStatusLine(r.detail);
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
    } catch (e) {
      setPlaidError(formatPlaidError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={disabled || busy}
      className="text-[11px] font-medium text-amber-900/90 underline decoration-amber-700/50 hover:decoration-amber-900 disabled:opacity-50 disabled:no-underline"
      title="Remove hand-entered rows without a Plaid id so Import can repopulate from the bank"
      onClick={() => void run()}
    >
      {busy ? "Clearing…" : "Clear manual-only"}
    </button>
  );
}

function ConnectionCard({
  it,
  isLikelyDuplicate,
  syncing,
  removing,
  resettingCursor,
  setPlaidError,
  setStatusLine,
  onSync,
  onDisconnect,
  onResetSyncCursor,
}: {
  it: PlaidItem;
  isLikelyDuplicate: boolean;
  syncing: boolean;
  removing: boolean;
  resettingCursor: boolean;
  setPlaidError: (msg: string | null) => void;
  setStatusLine: (msg: string | null) => void;
  onSync: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onResetSyncCursor: () => Promise<void>;
}) {
  const bank = it.institution_name?.trim() || "Bank";
  const linked = linkedAtLabel(it.created_at);
  const accounts = it.linked_accounts ?? [];
  const itemTail = it.item_id && it.item_id.length > 8 ? it.item_id.slice(-8) : it.item_id || "";

  return (
    <li
      className={`rounded-md border p-3 shadow-sm ${
        isLikelyDuplicate ? "border-amber-400 bg-amber-50/60" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
            <span className="text-sm font-semibold text-slate-900">{bank}</span>
            {linked ? (
              <span className="text-[11px] text-slate-500">Linked {linked}</span>
            ) : null}
            {itemTail ? (
              <span className="text-[11px] font-mono text-slate-400" title="Plaid Item — tells identical-looking rows apart">
                Item …{itemTail}
              </span>
            ) : null}
            {isLikelyDuplicate ? (
              <span className="text-[11px] font-semibold text-amber-900 bg-amber-200/80 px-1.5 py-0 rounded">
                Duplicate?
              </span>
            ) : null}
          </div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Accounts in this login ({accounts.length})
          </p>
          <ul className="text-sm text-slate-800 space-y-1 pl-1 border-l-2 border-slate-200 ml-0.5">
            {accounts.map((la) => (
              <li key={la.id} className="pl-2 break-words leading-snug flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span>
                  <span>{displayAccountName(la.account_name, bank)}</span>
                  {la.mask ? (
                    <span className="text-slate-600 font-mono text-[13px]" title="Last digits from Plaid">
                      {" "}
                      …{la.mask}
                    </span>
                  ) : null}
                </span>
                <ClearManualOnlyButton
                  accountId={la.account_id}
                  label={displayAccountName(la.account_name, bank)}
                  disabled={syncing || removing}
                  setPlaidError={setPlaidError}
                  setStatusLine={setStatusLine}
                />
              </li>
            ))}
          </ul>
          {accounts.length === 0 ? (
            <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1 border border-amber-100">
              No accounts mapped yet — try Import or reconnect this bank.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-row sm:flex-col gap-2 sm:items-end">
          <button
            type="button"
            disabled={syncing || removing || resettingCursor}
            className="text-sm font-medium text-emerald-800 hover:underline disabled:opacity-50 disabled:no-underline"
            onClick={() => void onSync()}
          >
            {syncing ? "Importing…" : "Import transactions"}
          </button>
          <button
            type="button"
            disabled={syncing || removing || resettingCursor}
            className="text-[11px] font-medium text-slate-600 hover:underline disabled:opacity-50 disabled:no-underline"
            title="If Import returns no rows after you deleted local transactions, reset Plaid’s cursor then Import again"
            onClick={() => void onResetSyncCursor()}
          >
            {resettingCursor ? "Resetting…" : "Reset import cursor"}
          </button>
          <button
            type="button"
            disabled={syncing || removing || resettingCursor}
            className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50 disabled:no-underline"
            onClick={() => void onDisconnect()}
          >
            {removing ? "Removing…" : "Disconnect"}
          </button>
        </div>
      </div>
    </li>
  );
}
