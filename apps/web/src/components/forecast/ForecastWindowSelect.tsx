import {
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  type OperationalForecastDays,
} from "../../lib/forecastWindow";

type Props = {
  value: OperationalForecastDays;
  onChange: (days: OperationalForecastDays) => void;
  disabled?: boolean;
  testId?: string;
};

/** Compact Forecast Window control used on Dashboard and Action Center. */
export default function ForecastWindowSelect({
  value,
  onChange,
  disabled = false,
  testId = "forecast-window-select",
}: Props) {
  return (
    <label className="flex items-center gap-2 shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Forecast Window
      </span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as OperationalForecastDays)}
        disabled={disabled}
        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs sm:text-sm disabled:opacity-60"
        data-testid={testId}
      >
        {OPERATIONAL_FORECAST_DAY_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {FORECAST_WINDOW_LABELS[d]}
          </option>
        ))}
      </select>
    </label>
  );
}
