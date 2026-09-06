import { Link } from "react-router-dom";
import LegalDocumentLayout, { LegalSection } from "../components/legal/LegalDocumentLayout";
import { getLegalConfig } from "../lib/legalConfig";

export default function Privacy() {
  const legal = getLegalConfig();
  const contact = legal.contactEmail ? (
    <a className="text-blue-700 hover:underline" href={`mailto:${legal.contactEmail}`}>
      {legal.contactEmail}
    </a>
  ) : (
    "the contact method provided with this beta"
  );

  return (
    <LegalDocumentLayout title="Privacy Policy">
      <p>
        This Privacy Policy describes how {legal.operatorLabel} (“we,” “us”) collect, use, and share
        information when you use {legal.productName} (the “Service”). It is written for this early-stage
        U.S. financial planning product. These policies should be reviewed by qualified legal counsel
        before a broad commercial launch.
      </p>

      <LegalSection title="Information you provide">
        <p>Depending on how you use the Service, you may provide:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Account details such as username, email address, and password (stored as a hash, not in plain text).</li>
          <li>Optional profile details such as display name and mobile phone number (used for bank-connection verification messages when you connect an institution).</li>
          <li>Household or workspace membership information.</li>
          <li>Financial accounts you create manually, including names, types, balances, credit limits, interest rates, and related settings.</li>
          <li>Transactions, notes, categories, budgets, spending targets, recurring bills and income, goals, scenarios, reconciliation sessions, and debt-to-income / affordability planning inputs.</li>
          <li>Support messages or other content you send us.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Financial information imported through Plaid">
        <p>
          If you choose to connect a financial institution, the Service uses Plaid Inc. (“Plaid”) to
          facilitate that connection. You interact with Plaid’s interface to authenticate with your
          institution. {legal.productName} does not collect or store your bank username and password.
        </p>
        <p>
          Plaid may receive and use information according to{" "}
          <a className="text-blue-700 hover:underline" href="https://plaid.com/legal/" rel="noreferrer">
            Plaid’s privacy policy and end-user terms
          </a>
          . After you connect an institution, we store information needed to provide the Service,
          which can include account metadata (such as institution name and account identifiers we
          associate with your household), balances, transactions, and an encrypted access token so
          the Service can sync data. We do not use that token to describe or recreate your bank
          login credentials.
        </p>
      </LegalSection>

      <LegalSection title="Payments processed by Stripe">
        <p>
          If you subscribe to Premium, payment is processed by Stripe. Checkout and the customer
          portal are hosted by Stripe. {legal.productName} does not collect or store full credit or
          debit card numbers. We store billing status on your account (for example, whether Premium
          is active) and related Stripe identifiers needed to operate the subscription. Stripe
          handles payment processing and retains payment records according to Stripe’s services and
          policies.
        </p>
      </LegalSection>

      <LegalSection title="How we use information">
        <p>We use information to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Operate and secure your account, including authentication, email verification, and password reset.</li>
          <li>Provide household financial organization, forecasting, budgeting, goals, and related features.</li>
          <li>Sync connected-institution data when you enable Plaid.</li>
          <li>Process subscriptions and communicate about billing.</li>
          <li>Diagnose errors, maintain the Service, and improve reliability.</li>
        </ul>
        <p>
          Forecasts and calculations are generated from the data available in your household and
          from user-provided inputs. They are estimates for planning, not advice.
        </p>
      </LegalSection>

      <LegalSection title="Authentication and security">
        <p>
          We use hashed passwords, session tokens (JWTs stored in your browser), optional email
          verification, and password reset. Keep your credentials confidential. We take reasonable
          steps to protect accounts, but no internet service can guarantee that unauthorized access
          will never occur.
        </p>
      </LegalSection>

      <LegalSection title="Household and shared access">
        <p>
          You may belong to a household or workspace that other people can join. Members of a
          household can access financial information stored in that household. Grant access only to
          people you trust. If you delete your user account, financial data that still belongs to a
          household with remaining members may stay available to those members. Data that exists
          only in a household where you are the last member may be removed as part of account
          deletion, after connected-bank and billing cleanup described in Settings.
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>
          We share information with vendors that help us operate the Service, including hosting and
          database providers, email delivery, Plaid (when you connect an institution), Stripe (when
          you subscribe), and error-monitoring providers when configured. We do not sell your
          personal information. We do not claim that information is never shared: operating the
          Service requires sharing appropriate information with these providers.
        </p>
      </LegalSection>

      <LegalSection title="Error monitoring and logs">
        <p>
          The Service may record application logs (for example, technical errors, performance
          timing, and standard server request metadata such as IP address and browser type through
          our hosting provider). When error monitoring is enabled, crash and exception reports may
          be sent to that provider so we can fix failures. We configure monitoring to avoid sending
          passwords, authentication tokens, bank credentials, and similar secrets. Monitoring is for
          reliability, not advertising, and we do not enable session replay for this product.
        </p>
      </LegalSection>

      <LegalSection title="Data export, deletion, and retention">
        <p>
          In Settings you can download a copy of financial data available to your account and delete
          your account (subject to the checks described there, such as household ownership and
          canceling an active subscription). Deletion removes your user account and personal profile
          data. Shared household financial data may remain for other members. Stripe and Plaid may
          retain records under their own policies. Hosting backups, database snapshots, and
          operational logs may persist for a limited time according to our infrastructure
          providers; we do not promise instant erasure from every backup.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          We use reasonable administrative and technical measures appropriate for an early-stage
          product, including hashed passwords, encrypted storage of Plaid access tokens, and
          transport encryption in production. No method of transmission or storage is completely
          secure. The Service is not a bank, is not FDIC-insured, and is not offered as
          “bank-level” or certified security.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          The Service is not directed to children under 13, and we do not knowingly collect
          personal information from children under 13. You must be old enough to form a binding
          contract in your jurisdiction to create an account (see the Terms of Service).
        </p>
      </LegalSection>

      <LegalSection title="U.S. operation">
        <p>
          The Service is operated for use in the United States. If you access it from another
          country, your information may be processed in the United States, where privacy laws may
          differ from those in your location.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update this policy. The “Last updated” date will change when we do. Continued use
          of the Service after an update means the revised policy applies to that use.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about privacy: {contact}. See also the{" "}
          <Link className="text-blue-700 hover:underline" to="/terms">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
