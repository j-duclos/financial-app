import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

export default function CollapsibleGoalSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <section className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left font-semibold text-gray-900 mb-2 group px-0"
      >
        <ChevronDown
          className={`h-4 w-4 text-gray-500 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden
        />
        <span>{title}</span>
        <span className="text-sm font-normal text-gray-500">({count})</span>
      </button>
      {open ? children : null}
    </section>
  );
}
