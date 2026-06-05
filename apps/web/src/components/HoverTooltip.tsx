import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function placeTooltip(anchor: HTMLElement, tooltip: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const margin = 6;

  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const openUp = spaceBelow < tipRect.height && spaceAbove > spaceBelow;

  const top = openUp
    ? Math.max(margin, rect.top - tipRect.height - margin)
    : rect.bottom + margin;

  const centeredLeft = rect.left + rect.width / 2 - tipRect.width / 2;
  const left = Math.max(margin, Math.min(centeredLeft, window.innerWidth - tipRect.width - margin));

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
  /** Parent control (e.g. button) owns aria-label/title; this only renders the hover popup. */
  decorateOnly?: boolean;
};

/** Tooltip rendered in a portal so it is not clipped by overflow scroll regions. */
export default function HoverTooltip({ label, children, className = "", decorateOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (anchor && tooltip) placeTooltip(anchor, tooltip);
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, label]);

  const tooltip =
    open && typeof document !== "undefined"
      ? createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            style={{ position: "fixed", top: 0, left: 0 }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
          >
            {label}
          </span>,
          document.body
        )
      : null;

  return (
    <span
      ref={anchorRef}
      className={`inline-flex ${className}`}
      title={decorateOnly ? undefined : label}
      aria-label={decorateOnly ? undefined : label}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {tooltip}
    </span>
  );
}
