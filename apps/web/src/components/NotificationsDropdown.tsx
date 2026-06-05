import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useEffect, useState } from "react";
import {
  listUpcomingChargeNotifications,
  markUpcomingChargeNotificationRead,
} from "@budget-app/api-client";
import { formatDateDisplay } from "../lib/dateDisplay";

function formatDueDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return "today";
  if (d.getTime() === tomorrow.getTime()) return "tomorrow";
  if (d.getTime() === dayAfter.getTime()) return "in 2 days";
  return formatDateDisplay(iso.slice(0, 10));
}

export default function NotificationsDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["upcomingChargeNotifications"],
    queryFn: () => listUpcomingChargeNotifications({ page_size: 30 }),
  });

  const markRead = useMutation({
    mutationFn: markUpcomingChargeNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upcomingChargeNotifications"] });
    },
  });

  const unreadCount = data?.results?.filter((n) => !n.read_at).length ?? 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        aria-label="Upcoming charges"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded-lg border border-gray-200 bg-white shadow-lg z-50 max-h-96 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 text-sm font-medium text-gray-700">
            Upcoming charges
          </div>
          <div className="overflow-y-auto flex-1">
            {isLoading ? (
              <div className="p-4 text-sm text-gray-500">Loading…</div>
            ) : !data?.results?.length ? (
              <div className="p-4 text-sm text-gray-500">No upcoming charge reminders.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {data.results.map((n) => (
                  <li key={n.id} className="px-3 py-2 hover:bg-gray-50">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{n.rule_name}</p>
                        <p className="text-xs text-gray-500">
                          {n.account_name}
                          <span className="text-gray-400"> · Due {formatDueDate(n.due_date)}</span>
                        </p>
                      </div>
                      {!n.read_at && (
                        <button
                          type="button"
                          onClick={() => markRead.mutate(n.id)}
                          className="text-xs text-blue-600 hover:text-blue-800 shrink-0"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
