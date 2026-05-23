import { useEffect, useRef, useState } from "react";
import type { Account } from "@budget-app/shared";
import {
  healthDetailsSummary,
  healthInlineLabel,
} from "../lib/accountHealthDisplay";
import { riskStatusClass } from "../lib/safeToSpendLabels";

type Props = {
  status: string | null | undefined;
  reason?: string | null;
  account?: Account;
  compact?: boolean;
  inline?: boolean;
  className?: string;
};

/** Account health badge with inline reason and optional detail popover. */
export default function AccountHealthBadge({
  status,
  reason,
  account,
  compact = false,
  inline = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!status) return null;

  const sizeClass = compact
    ? "px-1.5 py-0.5 text-[10px]"
    : "px-2 py-0.5 text-xs";

  const inlineText = healthInlineLabel(status, reason);
  const detailLines = account ? healthDetailsSummary(account) : [];
  const hasDetails = detailLines.length > 0 || Boolean(reason?.trim());
  const reasonSuffix = inlineText.includes(" — ")
    ? inlineText.split(" — ").slice(1).join(" — ")
    : null;

  const statusOnly = inlineText.split(" — ")[0];

  const badge = (
    <span
      className={`inline-flex rounded font-medium ${sizeClass} ${riskStatusClass(status)}`}
    >
      {statusOnly}
    </span>
  );

  return (
    <div
      ref={ref}
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

      {open && hasDetails ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 min-w-[12rem] max-w-[18rem] rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-left"
        >
          <p
            className={`font-medium ${riskStatusClass(status)} inline-flex rounded px-1.5 py-0.5 text-xs mb-1.5`}
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
        </div>
      ) : null}
    </div>
  );
}
