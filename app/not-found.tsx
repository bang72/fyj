import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="system-state">
      <div className="system-state-card">
        <span className="system-state-icon"><SearchX /></span>
        <p className="eyebrow">404 · MIVO V2</p>
        <h1>This space does not exist</h1>
        <p>The link may have expired or the page has moved.</p>
        <Link className="primary-button" href="/"><ArrowLeft size={17} /> Back to MIVO</Link>
      </div>
    </main>
  );
}
