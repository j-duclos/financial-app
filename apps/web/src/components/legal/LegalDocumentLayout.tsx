import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getLegalConfig } from "../../lib/legalConfig";
import SiteFooter from "./SiteFooter";

export default function LegalDocumentLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { auth } = useAuth();
  const legal = getLegalConfig();
  const signedIn = Boolean(auth.access);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-gray-900">{legal.productName}</p>
          {signedIn ? (
            <Link to="/" className="text-sm text-blue-700 hover:underline">
              Back to app
            </Link>
          ) : (
            <Link to="/login" className="text-sm text-blue-700 hover:underline">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <main className="flex-1">
        <article className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900">{title}</h1>
          <p className="mt-2 text-sm text-gray-500">
            Last updated: <time dateTime={legal.lastUpdatedIso}>{legal.lastUpdated}</time>
          </p>
          <div className="mt-8 space-y-8 text-sm sm:text-base leading-relaxed text-gray-800">
            {children}
          </div>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}
