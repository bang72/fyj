import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Safety" };

export default function SafetyPage() {
  return <LegalPage eyebrow="Safety Shield" title="Stay in control">
    <h2>Keep early conversations here</h2><p>Identity Layers exist so you can learn someone’s personality before sharing more. Decline a reveal whenever you are uncertain. A Verified Human or Trusted label is a limited signal, never a promise of good intent.</p>
    <h2>Notice pressure and urgency</h2><p>Be cautious when someone quickly asks to move platforms, requests money, pushes a risky link, creates an emergency, asks for explicit material, or discourages you from checking their claims.</p>
    <h2>Use clean exits</h2><p>Next and End Chat are always valid choices. Block acts immediately and prevents future matching. Report preserves only the evidence needed for moderation; the other person does not receive your identity or selected reason.</p>
    <h2>Protect location and contact details</h2><p>Never share an exact live location, home address, workplace schedule, financial credentials, recovery codes, or identity document. If you later meet someone, choose a public place, arrange your own transport, and tell a trusted person.</p>
    <h2>Immediate danger</h2><p>MIVO is not an emergency service. Leave the conversation, preserve what you safely can, contact local emergency services when someone is in immediate danger, and submit a Threat or Underage concern report through the Shield.</p>
  </LegalPage>;
}
