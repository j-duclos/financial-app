import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BILLING_CONFIRM_MAX_ATTEMPTS,
  BILLING_CONFIRM_POLL_MS,
  CHECKOUT_CANCELED_MESSAGE,
  CHECKOUT_CONFIRMING_MESSAGE,
  CHECKOUT_STILL_CONFIRMING_MESSAGE,
  PREMIUM_ACTIVE_MESSAGE,
} from "../lib/billing";
import type { BillingNoticeTone } from "../components/billing/BillingNotice";
import { useBillingStatus } from "./useBillingStatus";

export type BillingReturnNotice = { tone: BillingNoticeTone; text: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Handles ?billing=success|canceled after Stripe Checkout.
 * Premium is never granted from the query string — only from refetched server state.
 */
export function useBillingReturnNotice(): BillingReturnNotice | null {
  const [searchParams, setSearchParams] = useSearchParams();
  const billingFlag = searchParams.get("billing");
  const watchingReturn = billingFlag === "success";
  const { refetch, isLoading, billing } = useBillingStatus({ enabled: watchingReturn });
  const [notice, setNotice] = useState<BillingReturnNotice | null>(null);
  const handledRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const flag = searchParams.get("billing");
    if (!flag || handledRef.current) return;
    if (flag !== "success" && flag !== "canceled") return;

    const stripReturnParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete("billing");
      next.delete("session_id");
      setSearchParams(next, { replace: true });
    };

    if (flag === "canceled") {
      handledRef.current = true;
      setNotice({ tone: "info", text: CHECKOUT_CANCELED_MESSAGE });
      stripReturnParams();
      return;
    }

    setNotice({ tone: "info", text: CHECKOUT_CONFIRMING_MESSAGE });
    if (isLoading) return;

    handledRef.current = true;
    const alreadyPremium = billing?.is_premium === true;

    void (async () => {
      if (alreadyPremium) {
        if (!mountedRef.current) return;
        setNotice({ tone: "success", text: PREMIUM_ACTIVE_MESSAGE });
        stripReturnParams();
        return;
      }

      for (let attempt = 0; attempt < BILLING_CONFIRM_MAX_ATTEMPTS; attempt += 1) {
        const result = await refetch();
        if (!mountedRef.current) return;
        if (result.data?.is_premium) {
          setNotice({ tone: "success", text: PREMIUM_ACTIVE_MESSAGE });
          stripReturnParams();
          return;
        }
        if (attempt < BILLING_CONFIRM_MAX_ATTEMPTS - 1) {
          // First retry is immediate in case the initial refetch shared the in-flight query.
          await sleep(attempt === 0 ? 0 : BILLING_CONFIRM_POLL_MS);
        }
      }
      if (!mountedRef.current) return;
      setNotice({ tone: "info", text: CHECKOUT_STILL_CONFIRMING_MESSAGE });
      stripReturnParams();
    })();
  }, [billing, isLoading, refetch, searchParams, setSearchParams]);

  return notice;
}
