import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export function LegalPage({ eyebrow, title, updated = "3 September 2026", children }: { eyebrow: string; title: string; updated?: string; children: React.ReactNode }) {
  return <main className="legal-shell"><Link className="legal-back" href="/"><ArrowLeft size={17} /> Back to MIVO</Link><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>Effective and last updated: {updated}</p>{children}</main>;
}
