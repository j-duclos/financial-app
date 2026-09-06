import type { ReactNode } from "react";
import SiteFooter from "./SiteFooter";

export default function PublicScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="flex-1 flex items-center justify-center p-4">{children}</div>
      <SiteFooter />
    </div>
  );
}
