import { WifiOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default function OfflinePage() {
  return <main className="legal-shell offline-page"><Image src="/mivo-logo.jpg" alt="MIVO" width={58} height={58} unoptimized /><WifiOff /><h1>You’re offline</h1><p>Your account and cached shell are safe, but MIVO cannot search for matches or send chat messages without a live connection.</p><Link href="/">Try again</Link></main>;
}
