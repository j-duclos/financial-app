import { Link } from "react-router-dom";
import { FOOTER_FINANCIAL_NOTE } from "../../lib/legalConfig";

export default function SiteFooter() {
  return (
    <footer
      className="border-t border-gray-200 bg-white px-4 py-4 text-center text-xs text-gray-500 space-y-2"
      data-testid="site-footer"
    >
      <p>{FOOTER_FINANCIAL_NOTE}</p>
      <p className="space-x-4">
        <Link to="/privacy" className="text-blue-700 hover:underline">
          Privacy
        </Link>
        <Link to="/terms" className="text-blue-700 hover:underline">
          Terms
        </Link>
      </p>
    </footer>
  );
}
