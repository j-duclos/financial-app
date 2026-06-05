export function DashboardSectionSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 rounded-lg bg-gray-200/80" />
      ))}
    </div>
  );
}

export default function DashboardSkeleton({ omitHealth = false }: { omitHealth?: boolean }) {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading dashboard">
      {!omitHealth && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={`health-${i}`}
              className={`h-[4.5rem] rounded-lg bg-gray-200/80 animate-pulse ${i === 0 ? "rounded-xl border-2 border-blue-200 ring-1 ring-blue-100/80" : ""}`}
            />
          ))}
        </div>
      )}
      <DashboardSectionSkeleton rows={2} />
      <DashboardSectionSkeleton rows={3} />
      <DashboardSectionSkeleton rows={4} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={`resource-${i}`} className="h-[4.25rem] rounded-lg bg-gray-200/70 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
