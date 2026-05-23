import { resolveTransactionSourceBadge, SOURCE_BADGE_STYLES } from "./sourceBadgeUtils";
import type { SourceBadgeInput } from "./sourceBadgeUtils";

type Props = SourceBadgeInput & { className?: string };

export default function TransactionSourceBadge(props: Props) {
  const badge = resolveTransactionSourceBadge(props);
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SOURCE_BADGE_STYLES[badge]} ${props.className ?? ""}`}
    >
      {badge}
    </span>
  );
}
