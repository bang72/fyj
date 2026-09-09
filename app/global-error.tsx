"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id">
      <body>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui", background: "#050610", color: "#f7f7ff" }}>
          <section style={{ width: "min(100%, 520px)", padding: 28, border: "1px solid rgba(190,199,255,.18)", borderRadius: 24, background: "#10142b" }}>
            <p style={{ margin: 0, opacity: .7 }}>MIVO V2</p>
            <h1 style={{ margin: "10px 0" }}>App recovery needed</h1>
            <p style={{ opacity: .75, lineHeight: 1.6 }}>Reload the app shell and try once more.</p>
            <button onClick={reset} style={{ minHeight: 46, padding: "0 18px", border: 0, borderRadius: 14, cursor: "pointer", fontWeight: 700 }}>Reload app</button>
          </section>
        </main>
      </body>
    </html>
  );
}
