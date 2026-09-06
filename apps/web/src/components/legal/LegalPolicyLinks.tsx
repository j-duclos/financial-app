import { Link } from "react-router-dom";

export default function LegalPolicyLinks({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-sm text-gray-600"} data-testid="legal-policy-links">
      <Link to="/privacy" className="text-blue-700 hover:underline">
        Privacy Policy
      </Link>
      <span aria-hidden="true"> · </span>
      <Link to="/terms" className="text-blue-700 hover:underline">
        Terms of Service
      </Link>
    </p>
  );
}
