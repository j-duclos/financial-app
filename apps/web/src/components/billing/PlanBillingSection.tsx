import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, createCheckoutSession, createPortalSession } from "@budget-app/api-client";
import {
  ALREADY_PREMIUM_MESSAGE,
  BILLING_STATUS_QUERY_KEY,
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  PREMIUM_BENEFITS,
  PREMIUM_MONTHLY_PRICE_DISPLAY,
  FREE_PLAN_LIMITS,
} from "../../lib/billing";
import {
  billingActionErrorMessage,
  billingStatusLabel,
  isEmailVerificationRequiredError,
  premiumPeriodCopy,
  redirectToExternalUrl,
} from "../../lib/billingDisplay";
import { useBillingStatus } from "../../hooks/useBillingStatus";
import BillingNotice from "./BillingNotice";
import PlanBadge from "./PlanBadge";
import ResendVerificationButton from "../ResendVerificationButton";

const primaryButtonClass =
  "inline-flex items-center justify-center py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500";
const secondaryButtonClass =
  "inline-flex items-center justify-center py-2 px-4 bg-white text-gray-800 text-sm font-medium rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500";

export default function PlanBillingSection() {
  const queryClient = useQueryClient();
  const { billing, isLoading, isError, refetch } = useBillingStatus();
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "error"; text: string } | null>(
    null
  );
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

  const checkoutMu = useMutation({
    mutationFn: () => createCheckoutSession(),
    onSuccess: (session) => {
      if (!session.url) {
        setNotice({
          tone: "error",
          text: "Checkout could not be started. Please try again.",
        });
        return;
      }
      redirectToExternalUrl(session.url);
    },
    onError: async (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        await queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
        await refetch();
        setEmailVerificationRequired(false);
        setNotice({ tone: "info", text: ALREADY_PREMIUM_MESSAGE });
        return;
      }
      if (isEmailVerificationRequiredError(error)) {
        setEmailVerificationRequired(true);
        setNotice({ tone: "error", text: EMAIL_VERIFICATION_REQUIRED_MESSAGE });
        return;
      }
      setEmailVerificationRequired(false);
      setNotice({ tone: "error", text: billingActionErrorMessage(error) });
    },
  });

  const portalMu = useMutation({
    mutationFn: () => createPortalSession(),
    onSuccess: (session) => {
      if (!session.url) {
        setNotice({
          tone: "error",
          text: "The billing portal could not be opened. Please try again.",
        });
        return;
      }
      redirectToExternalUrl(session.url);
    },
    onError: (error: unknown) => {
      setNotice({ tone: "error", text: billingActionErrorMessage(error) });
    },
  });

  if (isLoading) {
    return (
      <section
        className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-3"
        aria-busy="true"
        data-testid="plan-billing-section"
      >
        <h2 className="text-lg font-medium text-gray-900">Plan &amp; Billing</h2>
        <p className="text-sm text-gray-600">Loading your plan…</p>
      </section>
    );
  }

  if (isError || !billing) {
    return (
      <section
        className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-3"
        data-testid="plan-billing-section"
      >
        <h2 className="text-lg font-medium text-gray-900">Plan &amp; Billing</h2>
        <BillingNotice tone="error">
          Your plan details could not be loaded. You can still use the rest of Settings.
        </BillingNotice>
        <button type="button" className={secondaryButtonClass} onClick={() => void refetch()}>
          Try again
        </button>
      </section>
    );
  }

  const isPremium = billing.is_premium;
  const period = premiumPeriodCopy(billing);
  const checkoutBusy = checkoutMu.isPending;
  const portalBusy = portalMu.isPending;

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-5"
      data-testid="plan-billing-section"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium text-gray-900">Plan &amp; Billing</h2>
        <PlanBadge plan={isPremium ? "PREMIUM" : "FREE"} />
      </div>

      {notice ? <BillingNotice tone={notice.tone}>{notice.text}</BillingNotice> : null}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-gray-500">Plan</dt>
          <dd className="mt-0.5 font-medium text-gray-900">{isPremium ? "Premium" : "Free"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Status</dt>
          <dd className="mt-0.5 font-medium text-gray-900">{billingStatusLabel(billing)}</dd>
        </div>
        {period ? (
          <div className="sm:col-span-2">
            <dt className="text-gray-500">{period.label}</dt>
            <dd className="mt-0.5 font-medium text-gray-900">{period.date}</dd>
            {period.cancelNotice ? (
              <p className="mt-1 text-sm text-gray-600">{period.cancelNotice}</p>
            ) : null}
          </div>
        ) : null}
      </dl>

      {!isPremium ? (
        <>
          <p className="text-sm text-gray-600">
            Track up to {FREE_PLAN_LIMITS.manual_accounts} manually managed accounts, unlimited
            manual transactions, {FREE_PLAN_LIMITS.recurring_rules} active recurring rules,{" "}
            {FREE_PLAN_LIMITS.goals} goals, and a {FREE_PLAN_LIMITS.operational_forecast_days}-day
            forecast. Upgrade for automatic bank syncing and longer planning.
          </p>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-gray-900">Premium</h3>
              <p className="text-sm font-medium text-gray-900">{PREMIUM_MONTHLY_PRICE_DISPLAY}</p>
            </div>
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
              {PREMIUM_BENEFITS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={checkoutBusy}
              aria-busy={checkoutBusy || undefined}
              onClick={() => {
                if (checkoutBusy) return;
                setNotice(null);
                setEmailVerificationRequired(false);
                checkoutMu.mutate();
              }}
            >
              {checkoutBusy ? "Opening checkout…" : "Upgrade to Premium"}
            </button>
            {emailVerificationRequired ? (
              <div data-testid="checkout-email-verification-required">
                <ResendVerificationButton />
              </div>
            ) : null}
            <p className="text-xs text-gray-500" data-testid="billing-legal-note">
              Premium renews automatically until canceled. The price shown here and in Stripe
              Checkout applies to that purchase. Manage or cancel in the billing portal after
              checkout. See{" "}
              <Link to="/terms" className="text-blue-700 hover:underline">
                Terms of Service
              </Link>
              ,{" "}
              <Link to="/privacy" className="text-blue-700 hover:underline">
                Privacy Policy
              </Link>
              , and billing language in the Terms.
            </p>
          </div>
        </>
      ) : null}

      {billing.has_stripe_customer ? (
        <div className="space-y-2">
          {isPremium ? (
            <p className="text-sm text-gray-600">
              Update your payment method, view invoices, or cancel in the Stripe billing portal.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              Manage payment methods and invoices for your billing account.
            </p>
          )}
          <button
            type="button"
            className={isPremium ? primaryButtonClass : secondaryButtonClass}
            disabled={portalBusy}
            aria-busy={portalBusy || undefined}
            onClick={() => {
              if (portalBusy) return;
              setNotice(null);
              portalMu.mutate();
            }}
          >
            {portalBusy ? "Opening billing portal…" : "Manage Billing"}
          </button>
        </div>
      ) : null}

      <p className="text-xs text-gray-500" data-testid="billing-legal-links">
        Billing and cancellation are described in the{" "}
        <Link to="/terms" className="text-blue-700 hover:underline">
          Terms of Service
        </Link>
        . See also the{" "}
        <Link to="/privacy" className="text-blue-700 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </section>
  );
}
