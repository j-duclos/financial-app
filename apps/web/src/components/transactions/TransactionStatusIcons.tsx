import { ArrowLeftRight, CalendarClock, CheckCircle2, Download, Pencil } from "lucide-react";
import HoverTooltip from "../HoverTooltip";
import {
  resolveTransactionStatusIcons,
  STATUS_ICON_LABELS,
  type TransactionStatusInput,
} from "./transactionStatusUtils";

const ICONS = {
  reconciled: CheckCircle2,
  manual: Pencil,
  rule: CalendarClock,
  plaid: Download,
  transfer: ArrowLeftRight,
} as const;

const ICON_STYLES: Record<keyof typeof ICONS, string> = {
  reconciled: "text-emerald-600",
  manual: "text-slate-500",
  rule: "text-violet-600",
  plaid: "text-sky-700",
  transfer: "text-blue-600",
};

type Props = TransactionStatusInput & { className?: string };

export default function TransactionStatusIcons(props: Props) {
  const { className, ...input } = props;
  const icons = resolveTransactionStatusIcons(input);
  if (icons.length === 0) return null;

  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 ${className ?? ""}`}>
      {icons.map((kind) => {
        const Icon = ICONS[kind];
        const label = STATUS_ICON_LABELS[kind];
        return (
          <HoverTooltip key={kind} label={label}>
            <Icon className={`h-3.5 w-3.5 ${ICON_STYLES[kind]}`} aria-hidden />
          </HoverTooltip>
        );
      })}
    </span>
  );
}
