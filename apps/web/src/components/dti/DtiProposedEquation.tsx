import type { DtiProposedEquation } from "@budget-app/shared";
import { formatDtiMoney, formatDtiPercent } from "../../lib/dtiDisplay";

type Props = {
  equation: DtiProposedEquation;
};

export default function DtiProposedEquation({ equation }: Props) {
  return (
    <div
      className="rounded-md border border-gray-200 bg-white p-3 space-y-2 text-sm"
      data-testid="dti-proposed-equation"
    >
      <h3 className="font-semibold text-gray-900">How proposed DTI is calculated</h3>
      <dl className="grid grid-cols-1 gap-1">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Estimated housing payment</dt>
          <dd className="tabular-nums text-gray-900">{formatDtiMoney(equation.estimated_housing_payment)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Other included monthly debt</dt>
          <dd className="tabular-nums text-gray-900">{formatDtiMoney(equation.other_included_monthly_debt)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Total proposed obligations</dt>
          <dd className="tabular-nums font-medium text-gray-900">
            {formatDtiMoney(equation.total_proposed_obligations)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Gross monthly income</dt>
          <dd className="tabular-nums text-gray-900">{formatDtiMoney(equation.gross_monthly_income)}</dd>
        </div>
      </dl>
      <p className="text-gray-800">
        {formatDtiMoney(equation.total_proposed_obligations)} ÷ {formatDtiMoney(equation.gross_monthly_income)}{" "}
        = proposed back-end DTI {formatDtiPercent(equation.proposed_back_end_dti_percent)}
      </p>
      <p className="text-gray-800">
        {formatDtiMoney(equation.estimated_housing_payment)} ÷ {formatDtiMoney(equation.gross_monthly_income)}{" "}
        = proposed front-end DTI {formatDtiPercent(equation.proposed_front_end_dti_percent)}
      </p>
    </div>
  );
}
