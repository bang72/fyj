import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return <LegalPage eyebrow="Legal" title="Terms of Service">
    <h2>1. Eligibility</h2><p>MIVO is an adults-only service. You must be at least 18 years old, legally able to enter this agreement, and not prohibited from using the service. Providing a false birth date, attempting to contact minors, or helping a banned person return may result in immediate suspension.</p>
    <h2>2. The service</h2><p>MIVO provides anonymous one-to-one matching, private messaging, mutual identity reveals, and mutual Connections. A match, Trust label, or verification badge is never a guarantee that another person is safe, truthful, or compatible.</p>
    <h2>3. Your account</h2><p>You are responsible for your password, recovery codes, and activity from your active sessions. Use an anonymous username that does not disclose sensitive personal information. We may rate-limit, suspend, or ban accounts to protect people or the service.</p>
    <h2>4. Conduct</h2><p>You must follow the Community Guidelines. Harassment, threats, hate, scams, spam, impersonation, sexual exploitation, attempts to involve anyone under 18, automation, scraping, and bypassing safety controls are prohibited. Do not pressure someone to reveal identity or contact details.</p>
    <h2 id="subscriptions">5. Subscriptions</h2><p>MIVO Plus is Rp20.000 per month and includes up to 20 successful gender-filtered matches per system day. Only a completed match uses quota; a failed search does not. MIVO Max is Rp30.000 per month and has no ordinary daily gender-match quota, but fair-use, anti-bot, and abuse limits still apply. Random matching and normal conversation remain free.</p><p>A subscription renews automatically through the configured payment provider until cancelled. The provider shows the final amount, taxes if any, renewal date, refund terms, and cancellation controls before payment. Cancelling stops future renewal and normally preserves access through the paid period. Entitlements are activated only after verified provider events.</p>
    <h2>6. Content and privacy</h2><p>You keep ownership of messages and profile material you provide. You grant MIVO a limited permission to store, transmit, moderate, and delete that material solely to operate and protect the service. Identity information remains server-side until the relevant mutual reveal is unlocked.</p>
    <h2>7. Ending service</h2><p>You may delete your account in Profile. We may restrict access for safety, legal, security, or operational reasons. Safety evidence and required transaction records may be retained for the limited periods described in the Privacy Policy.</p>
    <h2>8. Availability and liability</h2><p>The service is provided on an “as available” basis. We do not promise uninterrupted matching or that another person will respond. To the extent permitted by law, MIVO is not liable for indirect losses or conduct outside the service. Nothing here limits rights that cannot legally be excluded.</p>
    <h2>9. Contact and changes</h2><p>Material changes will be announced in-app before taking effect when reasonably possible. Until a dedicated support address is configured, safety reports must be submitted through the in-chat Shield so they enter the protected moderation workflow.</p>
  </LegalPage>;
}
