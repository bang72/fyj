import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Community Guidelines" };

export default function GuidelinesPage() {
  return <LegalPage eyebrow="Community" title="Community Guidelines">
    <h2>Consent is the product</h2><p>Respect every “not yet,” declined reveal, block, and clean exit. Never pressure someone for a photo, location, social handle, money, sexual content, or an explanation for leaving.</p>
    <h2>Adults only</h2><p>MIVO is strictly 18+. Do not use the service if you are younger, pretend to be younger, seek contact with minors, or share sexual content involving anyone who may be under 18. Report an underage concern immediately through the Shield.</p>
    <h2>No harm or hate</h2><p>Harassment, threats, stalking, non-consensual sexual behavior, hate based on protected characteristics, glorification of violence, and encouragement of self-harm are prohibited.</p>
    <h2>No scams or manipulation</h2><p>Do not request payments, run investment or romance scams, impersonate another person, distribute malware, repeatedly post links, scrape users, automate conversations, evade rate limits, or return after a ban.</p>
    <h2>Protect private information</h2><p>Do not publish another person’s messages, photo, contact detail, or location without clear permission. Identity unlock means mutual sharing inside that conversation—not permission to redistribute it.</p>
    <h2>Enforcement</h2><p>Moderators review context and retained evidence. Outcomes can include no action, content removal, warnings, temporary suspension, or ban. Trust labels can change based on confirmed—not merely alleged—violations. Reports submitted in bad faith may themselves be restricted.</p>
  </LegalPage>;
}
