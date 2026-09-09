"use client";

import { CircleAlert, RefreshCw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="system-state">
      <div className="system-state-card">
        <span className="system-state-icon"><CircleAlert /></span>
        <p className="eyebrow">MIVO V2</p>
        <h1>Something went wrong</h1>
        <p>The app hit an unexpected error. Your session is not automatically deleted.</p>
        <button className="primary-button" onClick={reset}><RefreshCw size={17} /> Try again</button>
      </div>
    </main>
  );
}
