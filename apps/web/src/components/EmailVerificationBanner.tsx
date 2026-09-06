import { useProfileQuery } from "../lib/profileQuery";
import ResendVerificationButton from "./ResendVerificationButton";

export default function EmailVerificationBanner() {
  const { data: profile } = useProfileQuery();

  if (!profile?.email || profile.email_verified !== false) return null;

  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 flex flex-wrap items-center justify-between gap-2"
      role="status"
      data-testid="email-verification-banner"
    >
      <p className="text-sm text-amber-950">Verify your email to protect your account.</p>
      <ResendVerificationButton />
    </div>
  );
}
