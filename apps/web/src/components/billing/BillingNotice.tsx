export type BillingNoticeTone = "success" | "info" | "error";

export default function BillingNotice({
  tone,
  children,
  id,
}: {
  tone: BillingNoticeTone;
  children: React.ReactNode;
  id?: string;
}) {
  const toneClass =
    tone === "success"
      ? "bg-green-50 text-green-800 border-green-200"
      : tone === "error"
        ? "bg-red-50 text-red-800 border-red-200"
        : "bg-blue-50 text-blue-800 border-blue-200";
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-md border px-3 py-2 text-sm ${toneClass}`}
    >
      {children}
    </p>
  );
}
