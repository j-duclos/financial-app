import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usePlaidLink } from "react-plaid-link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPlaidRedirectUri } from "../lib/plaidRedirectUri";
import {
  ApiError,
  createPlaidLinkToken,
  disconnectPlaidLinkedAccount,
  exchangePlaidPublicToken,
  getPlaidMeta,
  listPlaidItems,
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

export function PlaidConnectBar({
  householdId,
  redirectAfterLink,
  oauthReturnPage = false,
  defaultExpanded = false,
}: {
  householdId: number | null;
  /** Navigate here after a successful Link exchange (e.g. OAuth return page → Accounts). */
  redirectAfterLink?: string;
  /** Minimal UI on /plaid/oauth-return — only resume Link, not the full connections panel. */
  oauthReturnPage?: boolean;
  /** When false (default), the connections list is collapsed until the user expands it. */
  defaultExpanded?: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  /** Set only when completing Plaid OAuth return (same link_token as before redirect). */
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(null);
  const [plaidError, setPlaidError] = useState<string | null>(null);
  const [fetchingLink, setFetchingLink] = useState(false);
  const [syncingItemId, setSyncingItemId] = useState<number | null>(null);
  /** Which account row triggered import (same item sync may cover sibling accounts on one login). */
  const [syncingLinkedId, setSyncingLinkedId] = useState<number | null>(null);
  const [disconnectingLinkedId, setDisconnectingLinkedId] = useState<number | null>(null);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);

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
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const plaidCredentialsMissing = Boolean(plaidMeta && !plaidMeta.plaid_configured);

  // Drop stale sync/link errors after server env vars are fixed (error text stays in state until cleared).
  useEffect(() => {
    if (plaidMeta?.plaid_configured) {
      setPlaidError((prev) =>
        prev?.includes("Plaid API keys are not set") ? null : prev
      );
    }
  }, [plaidMeta?.plaid_configured]);

  const items = itemsData?.results ?? [];
  const totalLinkedAccounts = items.reduce((n, it) => n + (it.linked_accounts?.length ?? 0), 0);

  const busy = syncingItemId != null || disconnectingLinkedId != null;

  const runImport = useCallback(
    async (itemId: number, linkedAccountId: number) => {
      setPlaidError(null);
      setSyncingItemId(itemId);
      setSyncingLinkedId(linkedAccountId);
      try {
        const r = await syncPlaidItem(itemId);
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
        setSyncingItemId(null);
        setSyncingLinkedId(null);
      }
    },
    [queryClient]
  );

  const runDisconnectAccount = useCallback(
    async (linkedAccountId: number, label: string) => {
      if (
        !window.confirm(
          `Disconnect Plaid from “${label}”? The account and transactions already in the app stay. You can link again later.`
        )
      ) {
        return;
      }
      setPlaidError(null);
      setDisconnectingLinkedId(linkedAccountId);
      try {
        await disconnectPlaidLinkedAccount(linkedAccountId);
        setStatusLine(`Disconnected Plaid from ${label}.`);
        await queryClient.invalidateQueries({ queryKey: ["plaid-items"] });
        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      } catch (e) {
        setPlaidError(formatPlaidError(e));
      } finally {
        setDisconnectingLinkedId(null);
      }
    },
    [queryClient]
  );

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
        setStatusLine("Bank linked. Use Import on each account below to pull transactions.");
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
      : `${items.length} login${items.length === 1 ? "" : "s"}, ${totalLinkedAccounts} account${totalLinkedAccounts === 1 ? "" : "s"}`;

  const collapsedBanner =
    !expanded && (plaidCredentialsMissing || plaidError || statusLine || itemsError) ? (
      <p
        className={`text-xs truncate px-3 pb-2 ${
          statusLine && !plaidError && !itemsError && !plaidCredentialsMissing
            ? "text-emerald-900"
            : "text-red-700"
        }`}
        role={plaidError || itemsError || plaidCredentialsMissing ? "alert" : undefined}
      >
        {plaidCredentialsMissing
          ? "Plaid is not configured on the server."
          : plaidError
            ? plaidError
            : itemsError
              ? "Could not load bank connections."
              : statusLine}
      </p>
    ) : null;

  return (
    <>
      {linkHost}
      <div
        className="w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 shadow-sm"
        data-testid="plaid-connect-panel"
        data-expanded={expanded}
      >
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${
            expanded ? "border-b border-slate-200" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-80"
            aria-expanded={expanded}
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 ${
                expanded ? "rotate-90" : ""
              }`}
              aria-hidden
            />
            <span className="text-sm font-semibold text-slate-800">Bank connections (Plaid)</span>
            <span className="text-xs text-slate-500 truncate">{summaryHint}</span>
          </button>
          <button
            type="button"
            onClick={() => void startLink()}
            disabled={fetchingLink || busy}
            className="shrink-0 rounded-md border border-slate-400 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 shadow-sm hover:bg-slate-100 disabled:opacity-60"
          >
            {fetchingLink ? "Starting…" : "Link a bank"}
          </button>
        </div>

        {collapsedBanner}

        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="px-3 py-2 space-y-3 max-h-[min(20rem,50vh)] overflow-y-auto">
          {plaidCredentialsMissing ? (
            <p className="text-xs text-red-800" role="alert">
              Plaid is not configured on the server — Import and Link will not work until API keys are set.
            </p>
          ) : null}

          {itemsLoading && items.length === 0 ? (
            <p className="text-xs text-slate-500">Loading connections…</p>
          ) : null}

          {items.length > 0 ? (
            <ul className="space-y-3">
              {items.map((it) => {
                const bank = it.institution_name?.trim() || "Bank";
                const accounts = it.linked_accounts ?? [];
                return (
                  <li key={it.id} className="rounded-md border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-1.5 bg-slate-100 border-b border-slate-200 text-sm font-semibold text-slate-800">
                      {bank}
                    </div>
                    {accounts.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-slate-600">No accounts mapped for this login.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {accounts.map((la) => {
                          const label = displayAccountName(la.account_name, bank);
                          const mask = la.mask ? `···${la.mask}` : "";
                          return (
                            <li
                              key={la.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                              data-testid={`plaid-account-row-${la.account_id}`}
                            >
                              <span className="text-sm text-slate-800 min-w-0">
                                {label}
                                {mask ? (
                                  <span className="text-slate-500 font-mono text-xs ml-1">{mask}</span>
                                ) : null}
                              </span>
                              <span className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="text-sm font-medium text-emerald-800 hover:underline disabled:opacity-50"
                                  onClick={() => void runImport(it.id, la.id)}
                                >
                                  {syncingLinkedId === la.id ? "Importing…" : "Import"}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                                  onClick={() => void runDisconnectAccount(la.id, label)}
                                >
                                  {disconnectingLinkedId === la.id ? "Disconnecting…" : "Disconnect"}
                                </button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : !itemsLoading ? (
            <p className="text-xs text-slate-600">No banks linked yet.</p>
          ) : null}

          {itemsError ? (
            <p className="text-xs text-red-700" role="alert">
              Could not load bank connections.
            </p>
          ) : null}
          {plaidError ? (
            <p className="text-xs text-red-700 whitespace-pre-wrap" role="alert">
              {plaidError}
            </p>
          ) : null}
          {statusLine ? (
            <p className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
              {statusLine}
            </p>
          ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
