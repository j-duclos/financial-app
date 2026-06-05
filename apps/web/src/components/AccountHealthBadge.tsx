import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Account } from "@budget-app/shared";
import {
  accountListHealthDetailLines,
  buildAccountListHealthReason,
  healthDetailsSummary,
  healthInlineLabel,
} from "../lib/accountHealthDisplay";
import { normalizeSeverity, severityShowsAlert, severityTokens } from "../lib/severity";

type Props = {
  status: string | null | undefined;
  reason?: string | null;
  account?: Account;
  compact?: boolean;
  inline?: boolean;
  alwaysExpandedInline?: boolean;
  className?: string;
};

function placePopover(anchor: HTMLElement, popover: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  const margin = 4;

  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const openUp = spaceBelow < popRect.height && spaceAbove > spaceBelow;

  const top = openUp
    ? Math.max(margin, rect.top - popRect.height - margin)
    : rect.bottom + margin;

  const left = Math.max(
    margin,
    Math.min(rect.left, window.innerWidth - popRect.width - margin)
  );

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

/** Account health badge with inline reason and optional detail popover. */
export default function AccountHealthBadge({
  status,
  reason,
  account,
  compact = false,
  inline = false,
  alwaysExpandedInline = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;

    const update = () => {
      if (anchorRef.current && popoverRef.current) {
        placePopover(anchorRef.current, popoverRef.current);
      }
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, status, reason, account?.id]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!status || !severityShowsAlert(normalizeSeverity(status))) return null;

  const sizeClass = compact
    ? "px-1.5 py-0.5 text-[10px]"
    : "px-2 py-0.5 text-xs";

  const showAlwaysExpandedInline = inline && alwaysExpandedInline;
  const displayReason = showAlwaysExpandedInline && account
    ? buildAccountListHealthReason(reason, account)
    : reason?.trim() ?? null;
  const inlineText = healthInlineLabel(
    status,
    showAlwaysExpandedInline ? displayReason : reason
  );
  const detailLines =
    account && showAlwaysExpandedInline
      ? accountListHealthDetailLines(account)
      : account
        ? healthDetailsSummary(account)
        : [];
  const hasDetails = detailLines.length > 0 || Boolean(displayReason ?? reason?.trim());
  const reasonSuffix = showAlwaysExpandedInline
    ? displayReason
    : inlineText.includes(" — ")
      ? inlineText.split(" — ").slice(1).join(" — ")
      : null;

  const statusOnly = inlineText.split(" — ")[0];

  const badge = (
    <span
      className={`inline-flex rounded font-medium ${sizeClass} ${severityTokens(status).badgeClass}`}
    >
      {statusOnly}
    </span>
  );

  const popover =
    open && hasDetails && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            style={{ position: "fixed", top: 0, left: 0 }}
            className="z-50 min-w-[12rem] max-w-[18rem] rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-left"
          >
            <p
              className={`font-medium ${severityTokens(status).badgeClass} inline-flex rounded px-1.5 py-0.5 text-xs mb-1.5`}
            >
              {inlineText}
            </p>
            {detailLines.length > 0 ? (
              <ul className="space-y-1 text-xs text-gray-600">
                {detailLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : reason ? (
              <p className="text-xs text-gray-600">{reason}</p>
            ) : null}
          </div>,
          document.body
        )
      : null;

  if (showAlwaysExpandedInline) {
    return (
      <div
        ref={anchorRef}
        className={`relative flex flex-col items-start gap-1 w-full min-w-0 ${className}`}
      >
        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-1 w-full min-w-0">
          {badge}
          {reasonSuffix ? (
            <span
              className={`text-gray-700 flex-1 min-w-0 leading-snug ${compact ? "text-[10px]" : "text-sm"}`}
            >
              {reasonSuffix}
            </span>
          ) : null}
        </div>
        {detailLines.length > 0 ? (
          <ul className={`space-y-0.5 text-gray-600 ${compact ? "text-[10px]" : "text-xs"}`}>
            {detailLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={anchorRef}
      className={`relative inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${className}`}
    >
      {hasDetails ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left touch-manipulation rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-expanded={open}
          aria-haspopup="true"
          title={inlineText}
        >
          {badge}
          {inline && reasonSuffix ? (
            <span
              className={`text-gray-600 ${compact ? "text-[10px]" : "text-xs"} max-w-[14rem] truncate`}
            >
              {reasonSuffix}
            </span>
          ) : null}
        </button>
      ) : (
        <span title={inlineText}>{badge}</span>
      )}
      {popover}
    </div>
  );
}
