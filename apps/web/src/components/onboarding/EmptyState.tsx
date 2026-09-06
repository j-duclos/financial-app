import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type EmptyStateAction = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
};

type Props = {
  title: string;
  description: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  children?: ReactNode;
  testId?: string;
};

function ActionButton({ action }: { action: EmptyStateAction }) {
  const className =
    action.variant === "secondary"
      ? "inline-flex items-center justify-center py-2 px-4 rounded border border-gray-300 bg-white text-sm font-medium text-gray-800 hover:bg-gray-50"
      : "inline-flex items-center justify-center py-2 px-4 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700";
  if (action.to) {
    return (
      <Link to={action.to} className={className} onClick={action.onClick}>
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={action.onClick}>
      {action.label}
    </button>
  );
}

export default function EmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
  testId = "empty-state",
}: Props) {
  return (
    <div
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center space-y-3"
      data-testid={testId}
    >
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-600 max-w-lg mx-auto">{description}</p>
      {children}
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap gap-2 justify-center pt-1">
          {primaryAction ? <ActionButton action={primaryAction} /> : null}
          {secondaryAction ? <ActionButton action={{ ...secondaryAction, variant: secondaryAction.variant ?? "secondary" }} /> : null}
        </div>
      )}
    </div>
  );
}
