import { SHORT_FINANCIAL_DISCLAIMER } from "../../lib/legalConfig";

export default function FinancialDisclaimer({ className }: { className?: string }) {
  return (
    <p
      className={className ?? "text-xs text-gray-500"}
      data-testid="financial-disclaimer"
    >
      {SHORT_FINANCIAL_DISCLAIMER}
    </p>
  );
}
