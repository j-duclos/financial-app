import { Link } from "react-router-dom";
import LegalDocumentLayout, { LegalSection } from "../components/legal/LegalDocumentLayout";
import { getLegalConfig } from "../lib/legalConfig";

export default function Terms() {
  const legal = getLegalConfig();
  const contact = legal.contactEmail ? (
    <a className="text-blue-700 hover:underline" href={`mailto:${legal.contactEmail}`}>
      {legal.contactEmail}
    </a>
  ) : (
    "the contact method provided with this beta"
  );

  return (
    <LegalDocumentLayout title="Terms of Service">
      <p>
        These Terms of Service (“Terms”) govern your use of {legal.productName} (the “Service”),
        operated by {legal.operatorLabel} (“we,” “us”). By creating an account or using the Service,
        you agree to these Terms. If you do not agree, do not use the Service.
      </p>
      <p className="text-sm text-gray-600">
        These Terms are a developer draft for public beta. They should be reviewed by qualified
        legal counsel before a broad commercial launch.
      </p>

      <LegalSection title="Eligibility">
        <p>
          You must be at least 18 years old, or the age of majority in your jurisdiction if higher,
          and able to form a binding contract. The Service is intended for personal financial
          organization in the United States.
        </p>
      </LegalSection>

      <LegalSection title="Accounts and credentials">
        <p>
          You are responsible for your username, password, and for activity on your account. Keep
          credentials confidential. Tell us promptly if you believe your account has been misused.
          You must provide accurate information and keep your email address current so we can send
          verification and recovery messages.
        </p>
      </LegalSection>

      <LegalSection title="Authorized use">
        <p>
          You may use the Service only for lawful personal or household financial organization. You
          may not attempt to access another user’s account, disrupt the Service, reverse engineer
          the software except as allowed by law, scrape the Service in a way that harms
          availability, or use the Service to commit fraud.
        </p>
      </LegalSection>

      <LegalSection title="Prohibited use">
        <p>
          You may not use the Service for unlawful purposes, to impersonate others, to probe or
          attack our systems, to circumvent usage limits, or to process data you are not authorized
          to access. We may suspend or terminate accounts that violate these Terms.
        </p>
      </LegalSection>

      <LegalSection title="Financial information and accuracy">
        <p>
          You are responsible for the accuracy of information you enter. Data imported from a
          financial institution may be delayed, incomplete, duplicated, or incorrect. Always verify
          balances, transactions, and due dates with your institution before making important
          decisions.
        </p>
      </LegalSection>

      <LegalSection title="Connected financial accounts">
        <p>
          Connecting an institution is optional and uses Plaid. Plaid’s terms apply to that
          connection. We store encrypted tokens and synced financial data so the Service can
          function. You can disconnect links in the product; exclusive connections may also be
          revoked when an account is deleted as described in Settings.
        </p>
      </LegalSection>

      <LegalSection title="Not advice; no special status">
        <p>
          The Service provides planning, organization, forecasting, budgeting, and informational
          tools. It is not financial, investment, tax, accounting, or legal advice. Forecasts and
          projected balances are estimates based on available and user-provided data; they are not
          guarantees. {legal.productName} is not a bank, lender, brokerage, investment adviser,
          accountant, attorney, or fiduciary. We are not FDIC-insured.
        </p>
      </LegalSection>

      <LegalSection title="Premium subscriptions and billing">
        <p>
          Some features require a paid Premium subscription. The price shown in the app and on
          Stripe Checkout at the time of purchase is the price that applies to that purchase.
          Subscriptions renew automatically until you cancel. You manage payment methods, invoices,
          and cancellation through the Stripe billing portal linked from Settings. Cancellation
          follows Stripe’s subscription behavior for this product (including any remaining access
          through the current paid period when Stripe provides it). Promotional or current pricing
          is not guaranteed for future purchases.
        </p>
        <p>
          Payments are processed by Stripe. We do not store full card numbers. Stripe may retain
          payment records under its policies.
        </p>
      </LegalSection>

      <LegalSection title="Households">
        <p>
          If you share a household, other members may see financial information in that household.
          You are responsible for inviting only people you trust. Deleting your user account does
          not always delete household data that remaining members still use.
        </p>
      </LegalSection>

      <LegalSection title="Availability">
        <p>
          We aim to keep the Service available but do not guarantee uninterrupted or error-free
          operation. Features may change. Beta software may contain bugs.
        </p>
      </LegalSection>

      <LegalSection title="Intellectual property">
        <p>
          We and our licensors own the Service software, design, and trademarks. You retain rights
          to the financial content you submit. You grant us a limited license to host and process
          that content solely to provide the Service.
        </p>
      </LegalSection>

      <LegalSection title="Third-party services">
        <p>
          The Service relies on third parties including hosting providers, email delivery, Plaid,
          and Stripe. Their terms and privacy policies apply to their services. We are not
          responsible for third-party outages or changes.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers">
        <p>
          THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY
          LAW, WE DISCLAIM WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. We do not warrant that forecasts are accurate or that imported data is
          complete.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA, OR GOODWILL,
          ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR CLAIMS RELATING TO THE
          SERVICE IS LIMITED TO THE GREATER OF (A) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE
          TWELVE MONTHS BEFORE THE CLAIM OR (B) FIFTY U.S. DOLLARS ($50). Some jurisdictions do not
          allow certain limitations; in those places, our liability is limited to the fullest
          extent permitted.
        </p>
      </LegalSection>

      <LegalSection title="Termination and account deletion">
        <p>
          You may delete your account in Settings, subject to the product’s checks (for example,
          transferring household ownership when required, and canceling an active paid
          subscription). We may suspend or terminate access if you violate these Terms or if we
          discontinue the Service. After deletion, some records may remain with payment providers
          or in backups as described in the Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may modify the Service or these Terms. We will update the “Last updated” date when
          Terms change. If you continue using the Service after changes take effect, the new Terms
          apply.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>
          These Terms are governed by the laws of the State of {legal.state}, United States,
          without regard to conflict-of-law rules, except that this clause does not deprive you of
          mandatory consumer protections that cannot be waived in your place of residence.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these Terms: {contact}. Privacy practices are described in the{" "}
          <Link className="text-blue-700 hover:underline" to="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
