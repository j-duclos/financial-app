import { Archive, CheckCircle, Copy, Edit, Pause, Trash2 } from "lucide-react";
import QuickActionMenu from "../quickActions/QuickActionMenu";
import type { QuickActionDef, QuickActionId } from "../../lib/accountQuickActions";
import type { FinancialGoal } from "@budget-app/shared";

type Props = {
  goal: FinancialGoal;
  onEdit: () => void;
  onDuplicate: () => void;
  onPause: () => void;
  onComplete: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

export default function GoalActionMenu({
  goal,
  onEdit,
  onDuplicate,
  onPause,
  onComplete,
  onArchive,
  onDelete,
}: Props) {
  const isActive = goal.status === "active";
  const isPaused = goal.status === "paused";

  const actions: QuickActionDef[] = [
    { id: "edit" as QuickActionId, label: "Edit", icon: Edit, tier: "secondary" },
    { id: "duplicate" as QuickActionId, label: "Duplicate", icon: Copy, tier: "secondary" },
  ];

  if (isActive) {
    actions.push({ id: "pause" as QuickActionId, label: "Pause", icon: Pause, tier: "secondary" });
    actions.push({
      id: "complete" as QuickActionId,
      label: "Complete",
      icon: CheckCircle,
      tier: "secondary",
    });
  }
  if (isActive || isPaused) {
    actions.push({ id: "archive" as QuickActionId, label: "Archive", icon: Archive, tier: "secondary" });
  }

  const dangerActions: QuickActionDef[] = [
    { id: "delete" as QuickActionId, label: "Delete", icon: Trash2, tier: "secondary", danger: true },
  ];

  function handleAction(action: QuickActionDef) {
    switch (action.id) {
      case "edit":
        onEdit();
        break;
      case "duplicate":
        onDuplicate();
        break;
      case "pause":
        onPause();
        break;
      case "complete":
        onComplete();
        break;
      case "archive":
        onArchive();
        break;
      case "delete":
        onDelete();
        break;
      default:
        break;
    }
  }

  return (
    <QuickActionMenu
      menuLabel="Goal actions"
      actions={actions}
      dangerActions={dangerActions}
      onAction={handleAction}
    />
  );
}
