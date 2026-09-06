import { PAGE_SHELL } from "../../lib/pageLayout";
import BillingNotice from "./BillingNotice";
import { useBillingReturnNotice } from "../../hooks/useBillingReturnNotice";

/** Checkout return banner. Safe to mount in Layout so / and /profile both work. */
export default function BillingReturnBanner() {
  const notice = useBillingReturnNotice();
  if (!notice) return null;
  return (
    <div className={`${PAGE_SHELL} pt-4`}>
      <BillingNotice tone={notice.tone}>{notice.text}</BillingNotice>
    </div>
  );
}
