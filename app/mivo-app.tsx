"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Bell,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Crown,
  Dices,
  Download,
  Eye,
  HeartHandshake,
  Home,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircleQuestion,
  MessageSquareReply,
  RefreshCw,
  Send,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
  UserRound,
  UsersRound,
  Venus,
  Mars,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Vibe = { id: string; label: string };
type Message = {
  publicId: string;
  sender: "me" | "them" | "system";
  sequence: number;
  kind: string;
  body: string;
  reply: { publicId: string; body: string } | null;
  deliveredAt: string;
  createdAt: string;
  read: boolean;
  suspiciousUrl: boolean;
  optimistic?: boolean;
  failed?: boolean;
};
type Partner = {
  publicId: string;
  alias: string;
  trustBand: "new" | "established" | "trusted";
  verifiedHuman: boolean;
  connectionLevel: "stranger" | "familiar" | "vibe" | "connected";
  connectionState: "online" | "away" | "offline";
  vibes: Vibe[];
  age?: string | null;
  location?: string | null;
  photoUrl?: string;
  contact?: { type: string | null; value: string } | null;
};
type Room = {
  publicId: string;
  status: "active" | "ended";
  matchMode: string;
  createdAt: string;
  endedAt: string | null;
  endReason: string | null;
  retentionUntil: string | null;
  messageCount: number;
  latestSequence: number;
  myRetention: "chat" | "24h" | "7d" | "keep";
  partnerTyping: boolean;
  partner: Partner;
  reveals: Array<{ layer: number; status: string; myDecision: number | null }>;
  vibeCheck: { myChoice: string | null; result: "available" | "pending" | "mutual" | "not_yet" };
};
type Viewer = {
  publicId: string;
  status: "active" | "suspended";
  username: string;
  alias: string;
  avatarHue: number;
  photoUrl?: string | null;
  bio: string;
  age: number;
  birthDate: string;
  gender: string;
  region: string | null;
  city: string | null;
  locationConsent: boolean;
  ageVisibility: "range" | "exact" | "hidden";
  contactType: string | null;
  contactValue: string | null;
  desiredGender: "random" | "woman" | "man";
  readReceipts: boolean;
  sensitiveMedia: "blur" | "block";
  reconnectPolicy: "allow" | "connections" | "nobody";
  appearance: "dark" | "light" | "system";
  pushEnabled: boolean;
  trustBand: "new" | "established" | "trusted";
  verifiedHuman: boolean;
  role: "USER" | "MODERATOR" | "ADMIN";
  vibes: string[];
  createdAt: string;
};
type Bootstrap = {
  authenticated: boolean;
  vibes: Vibe[];
  capabilities: { realtime: boolean; billing: boolean; verification: boolean; media: boolean; version: string; transport: "ably" | "polling" };
  viewer?: Viewer;
  entitlement?: { plan: "FREE" | "PLUS" | "MAX"; used: number; genderFilter: { allowed: boolean; remaining: number | null }; current_period_end: string | null; cancel_at_period_end: number };
  search?: { state: "idle" | "queued" | "searching"; desiredGender?: string; vibes?: string[]; expanded?: boolean; since?: string };
  room?: Room | null;
  messages?: Message[];
  connections?: Array<{ public_id: string; created_at: string; source_room_public_id: string | null; partner_public_id: string; trust_band: string; partner_alias: string; avatar_hue: number }>;
  notifications?: Array<{ public_id: string; type: string; title: string; body: string; entity_public_id: string | null; read_at: string | null; created_at: string }>;
  secondChances?: Array<{ id: string; room_public_id: string; requester_alias: string; expires_at: string }>;
};

type AccountSecurity = {
  sessions: Array<{ sessionId: string; device_label: string; created_at: string; last_seen_at: string; expires_at: string; current: boolean }>;
  blocks: Array<{ public_id: string; alias: string; created_at: string }>;
};

const REPORT_OPTIONS = [
  ["harassment", "Harassment"], ["sexual_content", "Sexual content"], ["spam", "Spam"],
  ["scam", "Scam"], ["threat", "Threat"], ["hate", "Hate"],
  ["underage_concern", "Underage concern"], ["impersonation", "Impersonation"], ["other", "Other"],
] as const;

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) }, cache: "no-store" });
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error || "Permintaan belum berhasil.");
  return result;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`mivo-brand ${compact ? "is-compact" : ""}`}>
      <Image src="/mivo-logo.jpg" alt="" width={compact ? 38 : 76} height={compact ? 38 : 76} className="mivo-brand-image" priority={!compact} unoptimized />
      <div>
        <strong>MIVO <em className="mivo-brand-version">V2</em></strong>
        {!compact && <span>Meet the vibe, not the profile.</span>}
      </div>
    </div>
  );
}

function LoadingScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <main className="loading-screen" aria-label="MIVO sedang dimuat">
      {error ? <CircleAlert className="load-error-icon" /> : <div className="loading-orbits"><i /><i /></div>}
      <Logo />
      <p>{error ?? "Preparing your space…"}</p>
      {error && <button className="secondary-button" onClick={onRetry}><RefreshCw size={17} /> Try again</button>}
    </main>
  );
}

function SuspendedScreen() {
  async function logout() {
    await requestJson("/api/auth/logout", { method: "POST", body: "{}" });
    location.reload();
  }
  return <main className="auth-shell"><section className="auth-card suspended-card"><Logo /><CircleAlert size={34} /><div className="auth-heading"><span className="eyebrow">Account review</span><h1>Account temporarily suspended</h1><p>Access is paused while MIVO reviews safety signals. Read the Community Guidelines for context, then contact the service operator to appeal.</p></div><Link className="secondary-button" href="/guidelines">Community Guidelines</Link><button className="text-button" onClick={logout}><LogOut size={17} /> Log out</button></section></main>;
}

function AuthScreen({ vibes, onAuthenticated }: { vibes: Vibe[]; onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register" | "recover" | "codes">("login");
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [selectedVibes, setSelectedVibes] = useState<string[]>(["chill"]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (mode === "register" && step === 1) {
      const birthDate = String(data.get("birthDate") ?? "");
      const birthday = new Date(`${birthDate}T00:00:00Z`);
      const adultDate = new Date(); adultDate.setUTCFullYear(adultDate.getUTCFullYear() - 18);
      if (!birthDate || birthday > adultDate) return toast.error("MIVO hanya untuk usia 18 tahun ke atas.");
      sessionStorage.setItem("mivo-register-part1", JSON.stringify(Object.fromEntries(data)));
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await requestJson("/api/auth/login", { method: "POST", body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
        await onAuthenticated();
      } else if (mode === "recover") {
        await requestJson("/api/auth/recover", { method: "POST", body: JSON.stringify({ username: data.get("username"), recoveryCode: data.get("recoveryCode"), newPassword: data.get("newPassword"), confirmPassword: data.get("confirmPassword") }) });
        toast.success("Password berhasil diubah.");
        await onAuthenticated();
      } else {
        const partOne = JSON.parse(sessionStorage.getItem("mivo-register-part1") ?? "{}") as Record<string, string>;
        const result = await requestJson<{ recoveryCodes: string[] }>("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ ...partOne, vibes: selectedVibes, acceptedTerms: data.get("acceptedTerms") === "on", website: data.get("website") ?? "" }),
        });
        sessionStorage.removeItem("mivo-register-part1");
        setRecoveryCodes(result.recoveryCodes);
        setMode("codes");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Belum berhasil.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "codes") {
    return (
      <main className="auth-shell">
        <section className="auth-card recovery-card">
          <Logo />
          <div className="auth-heading"><span className="eyebrow">One-time recovery</span><h1>Save these codes</h1><p>Ini satu-satunya cara memulihkan akun tanpa email atau nomor HP. Setiap kode hanya dapat dipakai sekali.</p></div>
          <div className="recovery-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
          <button className="secondary-button" onClick={() => navigator.clipboard.writeText(recoveryCodes.join("\n")).then(() => toast.success("Recovery codes disalin."))}><Copy size={18} /> Copy all</button>
          <button className="primary-button" onClick={onAuthenticated}><Check size={19} /> I’ve saved them</button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Logo />
        <div className="auth-tabs" role="tablist" aria-label="Pilih autentikasi">
          <button role="tab" aria-selected={mode === "login"} onClick={() => { setMode("login"); setStep(1); }}>Sign in</button>
          <button role="tab" aria-selected={mode === "register"} onClick={() => { setMode("register"); setStep(1); }}>Create account</button>
        </div>
        {mode === "recover" ? (
          <form onSubmit={submit} className="auth-form">
            <button type="button" className="text-button back-link" onClick={() => setMode("login")}><ArrowLeft size={17} /> Back to sign in</button>
            <div className="auth-heading"><span className="eyebrow">Account recovery</span><h1>Use a recovery code</h1><p>Satu kode akan dinonaktifkan setelah berhasil digunakan.</p></div>
            <label>Username<input name="username" autoComplete="username" required /></label>
            <label>Recovery code<input name="recoveryCode" autoCapitalize="characters" required /></label>
            <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={10} required /></label>
            <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required /></label>
            <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <RefreshCw size={19} />} Reset password</button>
          </form>
        ) : mode === "login" ? (
          <form onSubmit={submit} className="auth-form">
            <div className="auth-heading"><span className="eyebrow">Welcome back</span><h1>Find your vibe.</h1><p>Your username is enough. No email or phone number needed.</p></div>
            <label>Username<input name="username" autoComplete="username" required autoFocus /></label>
            <label>Password<span className="password-wrap"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required /><button type="button" aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"} onClick={() => setShowPassword((value) => !value)}><Eye size={18} /></button></span></label>
            <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Zap size={19} />} Sign in</button>
            <button type="button" className="text-button" onClick={() => setMode("recover")}>Use a recovery code</button>
          </form>
        ) : step === 1 ? (
          <form onSubmit={submit} className="auth-form">
            <div className="step-line"><span>01</span><i /><span className="muted">02</span></div>
            <div className="auth-heading"><span className="eyebrow">Private by default</span><h1>Create your MIVO</h1><p>Only your anonymous alias is shown when you first match.</p></div>
            <label>Username<input name="username" autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9._]+" required /></label>
            <label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
            <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
            <div className="field-row"><label>Date of birth<input name="birthDate" type="date" required /></label><label>Gender<select name="gender" defaultValue="private"><option value="woman">Woman</option><option value="man">Man</option><option value="nonbinary">Nonbinary</option><option value="private">Prefer private</option></select></label></div>
            <p className="age-note"><Shield size={15} /> MIVO is 18+. Your birth date stays hidden by default.</p>
            <button className="primary-button">Continue <ChevronRight size={19} /></button>
          </form>
        ) : (
          <form onSubmit={submit} className="auth-form">
            <div className="step-line"><span className="done">01</span><i /><span>02</span></div>
            <button type="button" className="text-button back-link" onClick={() => setStep(1)}><ArrowLeft size={17} /> Back</button>
            <div className="auth-heading"><span className="eyebrow">Pick up to five</span><h1>What’s your vibe?</h1><p>We use overlap to find a better first conversation.</p></div>
            <div className="vibe-grid compact">{vibes.map((vibe) => <button key={vibe.id} type="button" aria-pressed={selectedVibes.includes(vibe.id)} onClick={() => setSelectedVibes((current) => current.includes(vibe.id) ? current.filter((id) => id !== vibe.id) : current.length < 5 ? [...current, vibe.id] : current)}>{vibe.label}</button>)}</div>
            <input name="website" tabIndex={-1} autoComplete="off" className="honeypot" aria-hidden="true" />
            <label className="check-label"><input name="acceptedTerms" type="checkbox" required /> <span>I’m 18+ and agree to the <a href="/terms" target="_blank">Terms</a>, <a href="/privacy" target="_blank">Privacy Policy</a>, and <a href="/guidelines" target="_blank">Community Guidelines</a>.</span></label>
            <button className="primary-button" disabled={busy || selectedVibes.length === 0}>{busy ? <LoaderCircle className="spin" /> : <Sparkles size={19} />} Create account</button>
          </form>
        )}
      </section>
    </main>
  );
}

function Avatar({ alias, hue = 250, photoUrl, size = "md" }: { alias: string; hue?: number; photoUrl?: string; size?: "sm" | "md" | "lg" }) {
  // Private avatar responses require the viewer's session cookie, so they intentionally bypass the public image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return photoUrl ? <img className={`avatar ${size}`} src={photoUrl} alt={`${alias} avatar`} /> : <span className={`avatar ${size}`} style={{ "--avatar-hue": hue } as React.CSSProperties} aria-label={`${alias} anonymous avatar`}>{alias.slice(0, 1).toUpperCase()}</span>;
}

function TrustBadge({ band }: { band: Partner["trustBand"] | Viewer["trustBand"] }) {
  const label = band === "new" ? "New" : band === "established" ? "Established" : "Trusted";
  return <span className={`trust-badge ${band}`}><Shield size={12} /> {label}</span>;
}

function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{body}</p>{action}</div>;
}

type ActionBody = Record<string, unknown> & { action: string };

function SearchSurface({ search, onCancel, onExpand }: {
  search: NonNullable<Bootstrap["search"]>;
  onCancel: () => void;
  onExpand: () => void;
}) {
  const started = search.since ? new Date(search.since).toLocaleTimeString("en-ID", { hour: "2-digit", minute: "2-digit" }) : "now";
  return (
    <main className="search-screen">
      <button className="round-button search-close" aria-label="Batalkan pencarian" onClick={onCancel}><X /></button>
      <div className="orb-stage" aria-hidden="true"><span /><span /><i /></div>
      <div className="search-copy">
        <span className="eyebrow">Live matchmaking</span>
        <h1>Someone’s out there.</h1>
        <p>No match yet. We’re still looking for a real person who’s online now.</p>
        <div className="search-meta"><Clock3 size={15} /> Started {started} · {search.expanded ? "Expanded search" : "Vibe-first search"}</div>
      </div>
      <div className="search-actions">
        {!search.expanded && <button className="secondary-button" onClick={onExpand}><RefreshCw size={18} /> Expand search</button>}
        <button className="text-button danger-text" onClick={onCancel}>Cancel search</button>
      </div>
    </main>
  );
}

function HomeScreen({ data, selectedGender, selectedVibes, onGender, onVibe, onSearch, lastEndedRoom, feedbackRoom, onSecondChance, onFeedback }: {
  data: Bootstrap;
  selectedGender: "random" | "woman" | "man";
  selectedVibes: string[];
  onGender: (value: "random" | "woman" | "man") => void;
  onVibe: (value: string) => void;
  onSearch: () => void;
  lastEndedRoom: string | null;
  feedbackRoom: string | null;
  onSecondChance: () => void;
  onFeedback: (rating: "great" | "okay" | "skip") => void;
}) {
  const choices = [
    { id: "random" as const, label: "Random", detail: "Free", icon: <Dices /> },
    { id: "woman" as const, label: "Women", detail: "Plus", icon: <Venus /> },
    { id: "man" as const, label: "Men", detail: "Plus", icon: <Mars /> },
  ];
  return (
    <section className="home-screen page-section">
      <div className="home-hero">
        <span className="eyebrow">Personality before profile</span>
        <h1>Who do you want<br />to vibe with?</h1>
        <p>Meet one person at a time. Talk first, reveal only by mutual choice.</p>
      </div>

      {feedbackRoom && (
        <div className="conversation-feedback-card">
          <div><Sparkles size={18} /><span><strong>How was that conversation?</strong><small>Your private answer helps MIVO improve future matching.</small></span></div>
          <div className="conversation-feedback-actions">
            <button type="button" onClick={() => onFeedback("great")}>Great vibe</button>
            <button type="button" onClick={() => onFeedback("okay")}>It was okay</button>
            <button type="button" onClick={() => onFeedback("skip")}>Don’t rematch soon</button>
          </div>
        </div>
      )}

      {lastEndedRoom && (
        <button className="second-chance-banner" onClick={onSecondChance}>
          <span><RefreshCw size={18} /><strong>Ended by accident?</strong></span>
          <small>Send a private Second Chance request</small>
          <ChevronRight size={18} />
        </button>
      )}

      <fieldset className="choice-fieldset">
        <legend>Match preference</legend>
        <div className="match-choices">
          {choices.map((choice) => (
            <button key={choice.id} type="button" aria-pressed={selectedGender === choice.id} onClick={() => onGender(choice.id)}>
              <span>{choice.icon}</span><strong>{choice.label}</strong><small>{choice.detail}</small>
            </button>
          ))}
        </div>
        {selectedGender !== "random" && data.entitlement?.genderFilter.remaining !== null && (
          <p className="quota-copy">{data.entitlement?.genderFilter.remaining} successful filtered matches left today.</p>
        )}
      </fieldset>

      <fieldset className="choice-fieldset vibe-fieldset">
        <legend>Vibe selector <span>{selectedVibes.length}/5</span></legend>
        <div className="vibe-grid">
          {data.vibes.map((vibe) => <button key={vibe.id} type="button" aria-pressed={selectedVibes.includes(vibe.id)} onClick={() => onVibe(vibe.id)}>{vibe.label}</button>)}
        </div>
      </fieldset>

      <button className="primary-button find-button" disabled={!selectedVibes.length} onClick={onSearch}><Zap size={20} /> Find my vibe</button>
      <p className="privacy-promise"><LockKeyhole size={15} /> Your exact identity is never part of matchmaking.</p>
    </section>
  );
}

function MessageBubble({ message, onReply, onReport, onRetry }: {
  message: Message;
  onReply: (message: Message) => void;
  onReport: (message: Message) => void;
  onRetry: (message: Message) => void;
}) {
  if (message.kind === "icebreaker") {
    return <article className="icebreaker-card"><MessageCircleQuestion size={20} /><span>Break the ice</span><strong>{message.body}</strong></article>;
  }
  if (message.sender === "system") return <p className="system-message">{message.body}</p>;
  const time = new Date(message.createdAt).toLocaleTimeString("en-ID", { hour: "2-digit", minute: "2-digit" });
  return (
    <article className={`message-row ${message.sender === "me" ? "mine" : "theirs"}`}>
      <div className={`chat-bubble ${message.failed ? "failed" : ""}`}>
        {message.reply && <blockquote>{message.reply.body}</blockquote>}
        <p>{message.body}</p>
        {message.suspiciousUrl && <span className="url-warning"><CircleAlert size={13} /> Be careful with unfamiliar links</span>}
        <span className="message-state">{message.optimistic ? "Sending…" : message.failed ? "Failed" : message.sender === "me" ? message.read ? "Read" : "Delivered" : time}</span>
      </div>
      <div className="message-tools">
        {message.failed ? <button onClick={() => onRetry(message)} aria-label="Coba kirim ulang"><RefreshCw size={14} /></button> : <button onClick={() => onReply(message)} aria-label="Balas pesan"><MessageSquareReply size={14} /></button>}
        {message.sender === "them" && <button onClick={() => onReport(message)} aria-label="Laporkan pesan"><Shield size={14} /></button>}
      </div>
    </article>
  );
}

function ChatScreen({ data, onAction, onReload, onLeave }: {
  data: Bootstrap;
  onAction: <T>(body: ActionBody) => Promise<T>;
  onReload: () => Promise<void>;
  onLeave: (kind: "end" | "next", roomId: string) => void;
}) {
  const room = data.room!;
  const [composer, setComposer] = useState("");
  const [reply, setReply] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [iceOpen, setIceOpen] = useState(false);
  const [vibeOpen, setVibeOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [reportMessage, setReportMessage] = useState<Message | null>(null);
  const [reportCategory, setReportCategory] = useState("harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [pendingMessages, setPendingMessages] = useState<Message[]>([]);
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState((data.messages?.[0]?.sequence ?? 1) > 1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const lastReadSent = useRef(0);
  const eligibleVibe = room.messageCount >= 6;
  const committedMessages = Array.from(new Map([...historyMessages, ...(data.messages ?? [])].map((message) => [message.publicId, message])).values())
    .sort((left, right) => left.sequence - right.sequence);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [data.messages?.length, pendingMessages.length, room.partnerTyping]);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  useEffect(() => {
    if (room.status !== "active" || room.latestSequence <= lastReadSent.current || document.hidden) return;
    lastReadSent.current = room.latestSequence;
    void onAction({ action: "message.read", roomPublicId: room.publicId, sequence: room.latestSequence });
  }, [onAction, room.latestSequence, room.publicId, room.status]);

  function typing() {
    if (Date.now() - lastTypingSent.current > 2_500) {
      lastTypingSent.current = Date.now();
      void onAction({ action: "typing", roomPublicId: room.publicId, typing: true });
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => void onAction({ action: "typing", roomPublicId: room.publicId, typing: false }), 3800);
  }

  async function transmit(body: string, replyValue: Message["reply"], optimisticId = `temp_${crypto.randomUUID()}`) {
    if (busy) return;
    const optimistic: Message = { publicId: optimisticId, sender: "me", sequence: room.latestSequence + 1, kind: "text", body, reply: replyValue, deliveredAt: "", createdAt: new Date().toISOString(), read: false, suspiciousUrl: false, optimistic: true };
    setPendingMessages((current) => current.some((message) => message.publicId === optimisticId) ? current.map((message) => message.publicId === optimisticId ? optimistic : message) : [...current, optimistic]);
    setBusy(true);
    try {
      await onAction({ action: "message.send", roomPublicId: room.publicId, body, replyPublicId: replyValue?.publicId ?? null });
      setPendingMessages((current) => current.filter((message) => message.publicId !== optimisticId));
      await onReload();
    } catch (error) {
      setPendingMessages((current) => current.map((message) => message.publicId === optimisticId ? { ...message, optimistic: false, failed: true } : message));
      toast.error(error instanceof Error ? error.message : "Pesan gagal dikirim.");
    } finally { setBusy(false); }
  }

  function send(event?: FormEvent) {
    event?.preventDefault();
    const body = composer.trim();
    if (!body || busy) return;
    setComposer("");
    const replyValue = reply ? { publicId: reply.publicId, body: reply.body } : null;
    setReply(null);
    void transmit(body, replyValue);
  }

  async function simpleAction(body: ActionBody, success?: string) {
    try { await onAction(body); if (success) toast.success(success); await onReload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Belum berhasil."); }
  }

  async function submitReport() {
    try {
      await onAction({ action: "room.report", roomPublicId: room.publicId, category: reportCategory, details: reportDetails, messagePublicId: reportMessage?.publicId ?? null });
      toast.success("Report received. Thank you for helping keep MIVO safe.");
      setReportMessage(null); setSafetyOpen(false); setReportDetails("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Laporan belum terkirim."); }
  }

  async function loadEarlier() {
    const before = committedMessages[0]?.sequence;
    if (!before || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const result = await requestJson<{ messages: Message[]; hasMore: boolean }>(`/api/sync?room=${encodeURIComponent(room.publicId)}&before=${before}`);
      setHistoryMessages((current) => Array.from(new Map([...result.messages, ...current].map((message) => [message.publicId, message])).values()).sort((left, right) => left.sequence - right.sequence));
      setHasMoreHistory(result.hasMore);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Riwayat belum dapat dimuat.");
    } finally {
      setLoadingHistory(false);
    }
  }

  const nextLayer = [1, 2, 3, 4].find((layer) => !room.reveals.some((item) => item.layer === layer && item.status === "unlocked"));
  const layerLabels = ["Age", "General location", "Profile photo", "Contact exchange"];
  return (
    <main className="chat-screen">
      <header className="chat-header">
        <button className="round-button" onClick={() => setEndOpen(true)} aria-label="Kembali atau akhiri chat"><ArrowLeft /></button>
        <div className="partner-heading"><Avatar alias={room.partner.alias} photoUrl={room.partner.photoUrl} /><span><strong>{room.partner.alias}</strong><small>{room.partner.connectionLevel} · {room.partnerTyping ? "typing…" : room.partner.connectionState}</small></span></div>
        <button className="round-button" onClick={() => setSafetyOpen(true)} aria-label="Safety shield"><Shield /></button>
      </header>

      <section className="identity-strip">
        <div><TrustBadge band={room.partner.trustBand} />{room.partner.verifiedHuman && <span className="verified-badge"><BadgeCheck size={13} /> Verified Human</span>}</div>
        <div className="shared-vibes">{room.partner.vibes.map((vibe) => <span key={vibe.id}>{vibe.label}</span>)}</div>
        {(room.partner.age || room.partner.location || room.partner.contact) && <p>{[room.partner.age, room.partner.location, room.partner.contact?.value].filter(Boolean).join(" · ")}</p>}
      </section>

      <div className="message-list" ref={listRef} aria-live="polite">
        {hasMoreHistory && <button className="history-button" disabled={loadingHistory} onClick={loadEarlier}>{loadingHistory ? <LoaderCircle className="spin" /> : <Clock3 />} Load earlier messages</button>}
        {committedMessages.length === 0 && <div className="chat-welcome"><div className="mini-orbs"><i /><i /></div><strong>New connection</strong><p>You both chose {room.partner.vibes[0]?.label ?? "a shared vibe"}. Start with what’s on your mind.</p></div>}
        {[...committedMessages, ...pendingMessages].map((message) => <MessageBubble key={message.publicId} message={message} onReply={setReply} onReport={setReportMessage} onRetry={(failed) => void transmit(failed.body, failed.reply, failed.publicId)} />)}
        {room.partnerTyping && <div className="typing-bubble"><i /><i /><i /></div>}
      </div>

      <div className="chat-prompts">
        <button onClick={() => setIceOpen(true)}><MessageCircleQuestion size={16} /> Break the ice</button>
        {eligibleVibe && room.vibeCheck.result === "available" && <button className="accent-chip" onClick={() => setVibeOpen(true)}><Sparkles size={16} /> Feeling the vibe?</button>}
        {room.vibeCheck.result === "mutual" && nextLayer && <button className="accent-chip" onClick={() => setIdentityOpen(true)}><Layers3 size={16} /> Reveal layer {nextLayer}</button>}
        <button onClick={() => setRetentionOpen(true)}><Clock3 size={16} /> Keep after chat</button>
      </div>

      {room.vibeCheck.result === "pending" && <p className="private-result"><LockKeyhole size={14} /> Choice saved. Results stay private until both answer.</p>}
      {room.vibeCheck.result === "not_yet" && <p className="private-result">Not a mutual vibe yet. No one’s choice is revealed.</p>}
      {room.vibeCheck.result === "mutual" && <div className="you-vibe"><span><Sparkles /></span><div><strong>You two vibe.</strong><small>Identity Layers are now available.</small></div></div>}

      <form className="composer" onSubmit={send}>
        {reply && <div className="reply-preview"><span><small>Replying to</small>{reply.body.slice(0, 90)}</span><button type="button" aria-label="Batalkan balasan" onClick={() => setReply(null)}><X size={16} /></button></div>}
        {typeof navigator !== "undefined" && !navigator.onLine && <div className="offline-composer"><WifiOff size={15} /> Offline — messages can’t be sent.</div>}
        <textarea value={composer} onChange={(event) => { setComposer(event.target.value); typing(); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(pointer:fine)").matches) { event.preventDefault(); void send(); } }} maxLength={2000} rows={1} placeholder="Say what’s on your mind…" aria-label="Message" />
        <button type="submit" aria-label="Kirim pesan" disabled={!composer.trim() || busy || (typeof navigator !== "undefined" && !navigator.onLine)}>{busy ? <LoaderCircle className="spin" /> : <Send />}</button>
      </form>

      <Sheet open={iceOpen} onOpenChange={setIceOpen}><SheetContent side="bottom" className="mivo-sheet"><SheetHeader><SheetTitle>Break the ice</SheetTitle><SheetDescription>Both of you will see the same curated question.</SheetDescription></SheetHeader><div className="sheet-grid">{["Funny", "Random", "Deep", "Dreams", "Music", "Gaming", "Life"].map((category) => <button key={category} onClick={() => { setIceOpen(false); void simpleAction({ action: "icebreaker", roomPublicId: room.publicId, category }); }}>{category}</button>)}</div></SheetContent></Sheet>

      <Sheet open={vibeOpen} onOpenChange={setVibeOpen}><SheetContent side="bottom" className="mivo-sheet vibe-sheet"><SheetHeader><SheetTitle>Feeling the vibe?</SheetTitle><SheetDescription>Your answer stays private until both people choose. If it isn’t mutual, MIVO never reveals who chose what.</SheetDescription></SheetHeader><div className="vibe-choice-actions"><button className="primary-button" onClick={() => { setVibeOpen(false); void simpleAction({ action: "vibe.check", roomPublicId: room.publicId, choice: "vibing" }); }}><Sparkles size={18} /> Vibing</button><button className="secondary-button" onClick={() => { setVibeOpen(false); void simpleAction({ action: "vibe.check", roomPublicId: room.publicId, choice: "not_yet" }); }}><Clock3 size={18} /> Not yet</button></div></SheetContent></Sheet>

      <Sheet open={identityOpen} onOpenChange={setIdentityOpen}><SheetContent side="bottom" className="mivo-sheet"><SheetHeader><SheetTitle>Ready to reveal a little more?</SheetTitle><SheetDescription>Nothing is sent to the other person’s client until both of you agree.</SheetDescription></SheetHeader><div className="layer-stack">{layerLabels.map((label, index) => { const layer = index + 1; const reveal = room.reveals.find((item) => item.layer === layer); return <div key={label} className={reveal?.status === "unlocked" ? "unlocked" : ""}><span>{reveal?.status === "unlocked" ? <Check /> : <LockKeyhole />}</span><p><strong>Layer {layer}</strong><small>{label}</small></p><em>{reveal?.status === "unlocked" ? "Open" : reveal?.myDecision === 1 ? "Waiting" : reveal?.status === "dismissed" ? "Not now" : "Locked"}</em></div>; })}</div>{nextLayer && <div className="sheet-actions"><button className="primary-button" onClick={() => { setIdentityOpen(false); void simpleAction({ action: "identity.vote", roomPublicId: room.publicId, layer: nextLayer, approve: true }, "Your choice is saved privately."); }}><Layers3 size={18} /> Reveal {layerLabels[nextLayer - 1]}</button><button className="text-button" onClick={() => { setIdentityOpen(false); void simpleAction({ action: "identity.vote", roomPublicId: room.publicId, layer: nextLayer, approve: false }); }}>Not now</button></div>}</SheetContent></Sheet>

      <Sheet open={retentionOpen} onOpenChange={setRetentionOpen}><SheetContent side="bottom" className="mivo-sheet"><SheetHeader><SheetTitle>Keep this connection for…</SheetTitle><SheetDescription>The room follows the shorter choice. “Keep” creates a Connection only when both choose it.</SheetDescription></SheetHeader><div className="retention-list">{[["chat", "Just this chat", "Deleted when the chat ends"], ["24h", "24 hours", "A little time to reconsider"], ["7d", "7 days", "Keep the conversation for a week"], ["keep", "Keep", "Mutual choice creates a Connection"]].map(([value, label, detail]) => <button key={value} aria-pressed={room.myRetention === value} onClick={() => { setRetentionOpen(false); void simpleAction({ action: "retention", roomPublicId: room.publicId, choice: value }, "Retention choice saved."); }}><Clock3 /><span><strong>{label}</strong><small>{detail}</small></span><Check /></button>)}</div></SheetContent></Sheet>

      <Sheet open={safetyOpen} onOpenChange={setSafetyOpen}><SheetContent side="bottom" className="mivo-sheet safety-sheet"><SheetHeader><SheetTitle>Safety Shield</SheetTitle><SheetDescription>Your comfort comes first. Leaving never needs an explanation.</SheetDescription></SheetHeader><a href="/safety" target="_blank"><BookOpen /> Safety tips <ChevronRight /></a><button onClick={() => { setSafetyOpen(false); setReportMessage({} as Message); }}><CircleAlert /> Report this conversation <ChevronRight /></button><button onClick={() => { if (confirm("Block this person and end the conversation?")) void simpleAction({ action: "room.block", roomPublicId: room.publicId }, "Blocked. You won’t be matched again.").then(() => onLeave("end", room.publicId)); }}><Shield /> Block <ChevronRight /></button><button onClick={() => setEndOpen(true)}><X /> End chat <ChevronRight /></button></SheetContent></Sheet>

      <Dialog open={Boolean(reportMessage)} onOpenChange={(open) => { if (!open) setReportMessage(null); }}><DialogContent className="mivo-dialog"><DialogHeader><DialogTitle>Send a private report</DialogTitle><DialogDescription>{reportMessage?.publicId ? "The selected message will be preserved as evidence." : "The other person won’t be told who reported them."}</DialogDescription></DialogHeader><label>Reason<select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)}>{REPORT_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>What happened?<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={1000} rows={4} placeholder="Share only what moderators need to know." /></label><DialogFooter><button className="secondary-button" onClick={() => setReportMessage(null)}>Cancel</button><button className="danger-button" disabled={!reportDetails.trim()} onClick={submitReport}><Shield size={17} /> Submit report</button></DialogFooter></DialogContent></Dialog>

      <Dialog open={endOpen} onOpenChange={setEndOpen}><DialogContent className="mivo-dialog"><DialogHeader><DialogTitle>Leave this conversation?</DialogTitle><DialogDescription>{room.myRetention === "chat" ? "With your current choice, this conversation will be deleted after it ends." : `Your retention choice is ${room.myRetention}. The shorter mutual choice applies.`}</DialogDescription></DialogHeader><DialogFooter className="end-actions"><button className="secondary-button" onClick={() => { setEndOpen(false); void simpleAction({ action: "room.end", roomPublicId: room.publicId }).then(() => onLeave("end", room.publicId)); }}>End chat</button><button className="primary-button" onClick={() => { setEndOpen(false); void onAction({ action: "room.next", roomPublicId: room.publicId, desiredGender: data.viewer?.desiredGender ?? "random", vibes: data.viewer?.vibes ?? ["random"] }).then(() => onLeave("next", room.publicId)).catch((error) => toast.error(error instanceof Error ? error.message : "Belum berhasil.")); }}><RefreshCw size={17} /> Next</button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}

function ConnectionsScreen({ data, onAction, onReload, onOpenChat }: { data: Bootstrap; onAction: <T>(body: ActionBody) => Promise<T>; onReload: () => Promise<void>; onOpenChat: () => void }) {
  const connections = data.connections ?? [];
  const [selected, setSelected] = useState<(typeof connections)[number] | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState("harassment");
  const [reportDetails, setReportDetails] = useState("");
  async function open(publicId: string) { try { await onAction({ action: "connection.open", connectionPublicId: publicId }); await onReload(); onOpenChat(); } catch (error) { toast.error(error instanceof Error ? error.message : "Connection belum dapat dibuka."); } }
  async function submitReport() {
    if (!selected?.source_room_public_id) return;
    try {
      await onAction({ action: "room.report", roomPublicId: selected.source_room_public_id, category: reportCategory, details: reportDetails });
      toast.success("Report received."); setReportOpen(false); setReportDetails("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Laporan belum terkirim."); }
  }
  async function blockSelected() {
    if (!selected?.source_room_public_id || !confirm("Block this person and remove the connection?")) return;
    try { await onAction({ action: "room.block", roomPublicId: selected.source_room_public_id }); toast.success("Blocked. You won’t be matched again."); setSafetyOpen(false); await onReload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Belum berhasil."); }
  }
  return <section className="page-section list-screen"><div className="page-heading"><span className="eyebrow">Mutual only</span><h1>Connections</h1><p>People you both chose to keep. No followers, no popularity score.</p></div>{connections.length ? <div className="connection-list">{connections.map((connection) => <article key={connection.public_id}><Avatar alias={connection.partner_alias} hue={connection.avatar_hue} /><div><strong>{connection.partner_alias}</strong><span><TrustBadge band={connection.trust_band as Partner["trustBand"]} /></span><small>Connected {new Date(connection.created_at).toLocaleDateString("en-ID", { day: "numeric", month: "short" })}</small></div><button className="round-button" aria-label={`Chat dengan ${connection.partner_alias}`} onClick={() => open(connection.public_id)}><MessageSquareReply /></button><button className="round-button quiet" aria-label={`Safety options for ${connection.partner_alias}`} onClick={() => { setSelected(connection); setSafetyOpen(true); }}><Shield /></button><button className="round-button quiet" aria-label="Hapus connection" onClick={() => confirm("Remove this connection?") && void onAction({ action: "connection.remove", connectionPublicId: connection.public_id }).then(onReload)}><Trash2 /></button></article>)}</div> : <EmptyState icon={<HeartHandshake />} title="No connections yet" body="When both people choose Keep, the connection will appear here." />}<Sheet open={safetyOpen} onOpenChange={setSafetyOpen}><SheetContent side="bottom" className="mivo-sheet safety-sheet"><SheetHeader><SheetTitle>Connection safety</SheetTitle><SheetDescription>Report or block {selected?.partner_alias}. These actions are private.</SheetDescription></SheetHeader><button disabled={!selected?.source_room_public_id} onClick={() => { setSafetyOpen(false); setReportOpen(true); }}><CircleAlert /> Report <ChevronRight /></button><button disabled={!selected?.source_room_public_id} onClick={blockSelected}><Shield /> Block and remove <ChevronRight /></button></SheetContent></Sheet><Dialog open={reportOpen} onOpenChange={setReportOpen}><DialogContent className="mivo-dialog"><DialogHeader><DialogTitle>Report this connection</DialogTitle><DialogDescription>Only share what moderators need to review.</DialogDescription></DialogHeader><label>Reason<select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)}>{REPORT_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>What happened?<textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={1000} rows={4} /></label><DialogFooter><button className="secondary-button" onClick={() => setReportOpen(false)}>Cancel</button><button className="danger-button" disabled={!reportDetails.trim()} onClick={submitReport}><Shield size={17} /> Submit report</button></DialogFooter></DialogContent></Dialog></section>;
}

function ActivityScreen({ data, onAction, onReload, onOpenChat }: { data: Bootstrap; onAction: <T>(body: ActionBody) => Promise<T>; onReload: () => Promise<void>; onOpenChat: () => void }) {
  const notifications = data.notifications ?? [];
  const second = data.secondChances ?? [];
  async function respond(roomId: string, accept: boolean) { try { const result = await onAction<{ accepted: boolean }>({ action: "second_chance.respond", roomPublicId: roomId, accept }); await onReload(); if (result.accepted) onOpenChat(); else toast.success("Your private choice was saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Belum berhasil."); } }
  return <section className="page-section list-screen"><div className="page-heading row-heading"><div><span className="eyebrow">Private updates</span><h1>Activity</h1></div>{notifications.some((item) => !item.read_at) && <button className="text-button" onClick={() => requestJson("/api/account", { method: "PATCH", body: JSON.stringify({ action: "read_notifications" }) }).then(onReload)}>Mark all read</button>}</div>{second.map((item) => <article className="second-card" key={item.id}><RefreshCw /><div><strong>Second Chance</strong><p>{item.requester_alias} would like to reconnect. Your answer stays private unless you both agree.</p></div><div><button className="primary-button small" onClick={() => respond(item.room_public_id, true)}>Reconnect</button><button className="text-button" onClick={() => respond(item.room_public_id, false)}>Not now</button></div></article>)}{notifications.length ? <div className="activity-list">{notifications.map((note) => <article key={note.public_id} className={!note.read_at ? "unread" : ""}><span>{note.type === "identity_unlock" ? <Layers3 /> : note.type === "mutual_vibe" ? <Sparkles /> : note.type === "safety" ? <Shield /> : <Bell />}</span><div><strong>{note.title}</strong><p>{note.body}</p><small>{new Date(note.created_at).toLocaleString("en-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div></article>)}</div> : !second.length && <EmptyState icon={<Bell />} title="Quiet for now" body="Identity unlocks, connections, Second Chances, and safety updates appear here." />}</section>;
}

function ProfileScreen({ data, onReload, onPaywall }: { data: Bootstrap; onReload: () => Promise<void>; onPaywall: () => void }) {
  const viewer = data.viewer!;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [security, setSecurity] = useState<AccountSecurity | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profileVibes, setProfileVibes] = useState(viewer.vibes);

  async function profile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget);
    try { await requestJson("/api/account", { method: "PATCH", body: JSON.stringify({ action: "profile", bio: form.get("bio"), region: form.get("region"), city: form.get("city"), locationConsent: form.get("locationConsent") === "on", ageVisibility: form.get("ageVisibility"), contactType: form.get("contactType"), contactValue: form.get("contactValue"), vibes: profileVibes }) }); toast.success("Profile privacy saved."); await onReload(); setSettingsOpen(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Belum berhasil."); } finally { setBusy(false); }
  }
  async function preferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget);
    try {
      await requestJson("/api/account", { method: "PATCH", body: JSON.stringify({
        action: "preferences",
        readReceipts: form.get("readReceipts") === "on",
        sensitiveMedia: viewer.sensitiveMedia,
        reconnectPolicy: form.get("reconnectPolicy"),
        appearance: form.get("appearance"),
        pushEnabled: viewer.pushEnabled,
      }) });
      toast.success("Privacy controls saved.");
      await onReload();
      setControlsOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Belum berhasil.");
    } finally { setBusy(false); }
  }
  async function password(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { const result = await requestJson<{ message: string }>("/api/account", { method: "PATCH", body: JSON.stringify({ action: "password", currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword"), confirmPassword: form.get("confirmPassword") }) }); toast.success(result.message); setPasswordOpen(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Belum berhasil."); } }
  async function logout() { await requestJson("/api/auth/logout", { method: "POST", body: "{}" }); location.reload(); }
  async function uploadPhoto(file: File) { const form = new FormData(); form.set("photo", file); try { const response = await fetch("/api/avatar", { method: "POST", body: form }); const result = await response.json(); if (!response.ok) throw new Error(result.error); toast.success("Private profile photo saved."); await onReload(); } catch (error) { toast.error(error instanceof Error ? error.message : "Photo upload failed."); } }
  async function loadSecurity(openBlocked = false) { try { const result = await requestJson<AccountSecurity>("/api/account"); setSecurity(result); if (openBlocked) setBlockedOpen(true); else setPasswordOpen(true); } catch (error) { toast.error(error instanceof Error ? error.message : "Security settings belum dapat dimuat."); } }
  async function billing(action: "manage" | "restore") { try { const result = await requestJson<{ url?: string; restored?: boolean }>("/api/billing", { method: "POST", body: JSON.stringify({ action }) }); if (result.url) location.href = result.url; else { toast.success(result.restored ? "Purchase restored." : "No active purchase was found."); await onReload(); } } catch (error) { toast.error(error instanceof Error ? error.message : "Billing belum tersedia."); } }
  return <section className="page-section profile-screen"><div className="profile-hero"><div className="avatar-ring"><Avatar alias={viewer.alias} hue={viewer.avatarHue} photoUrl={viewer.photoUrl ?? undefined} size="lg" />{data.capabilities.media && <label className="photo-upload" aria-label="Upload private profile photo"><Camera /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} /></label>}</div><div><span className="eyebrow">Anonymous by design</span><h1>{viewer.alias}</h1><p>@{viewer.username}</p><div><TrustBadge band={viewer.trustBand} />{viewer.verifiedHuman && <span className="verified-badge"><BadgeCheck size={13} /> Verified Human</span>}</div></div></div><div className="profile-vibes">{viewer.vibes.map((id) => <span key={id}>{data.vibes.find((vibe) => vibe.id === id)?.label ?? id}</span>)}</div><p className="trust-note"><Shield size={16} /> Trust labels reflect account signals, not a guarantee of safety.</p>
    <div className="settings-list">
      <button onClick={() => setSettingsOpen(true)}><UserRound /><span><strong>Profile & privacy</strong><small>Identity reveal defaults and optional details</small></span><ChevronRight /></button>
      <button onClick={() => setControlsOpen(true)}><Settings2 /><span><strong>Privacy & appearance</strong><small>Read receipts, reconnects, and display theme</small></span><ChevronRight /></button>
      <button onClick={onPaywall}><Crown /><span><strong>{data.entitlement?.plan === "FREE" ? "MIVO membership" : `MIVO ${data.entitlement?.plan}`}</strong><small>{data.entitlement?.plan === "FREE" ? "See gender filtering plans" : data.entitlement?.cancel_at_period_end ? "Cancels at period end" : "Subscription active"}</small></span><ChevronRight /></button>
      <button onClick={() => loadSecurity()}><LockKeyhole /><span><strong>Password & sessions</strong><small>Change password, recovery codes, and active sessions</small></span><ChevronRight /></button>
      <button onClick={() => loadSecurity(true)}><Shield /><span><strong>Blocked users</strong><small>Review people you blocked</small></span><ChevronRight /></button>
      <a href="/api/export"><Download /><span><strong>Download my data</strong><small>Private JSON export</small></span><ChevronRight /></a>
      {(viewer.role === "MODERATOR" || viewer.role === "ADMIN") && <a href="/moderation"><Shield /><span><strong>{viewer.role === "ADMIN" ? "Admin console" : "Moderation console"}</strong><small>{viewer.role === "ADMIN" ? "Reports, users, bans, audit & staff" : "Protected Trust & Safety access"}</small></span><ChevronRight /></a>}
      <a href="/privacy"><BookOpen /><span><strong>Data & legal</strong><small>Privacy, terms, and community rules</small></span><ChevronRight /></a>
    </div>
    <div className="v2-status-card" aria-label="MIVO system status">
      <div><span><Zap size={15} /> MIVO {data.capabilities.version}</span><strong>{data.capabilities.transport === "ably" ? "Realtime" : "Adaptive polling"}</strong></div>
      <p>{data.capabilities.realtime ? "Live events are connected through the realtime transport." : "Realtime provider is optional; persistent chat continues through the safe polling fallback."}</p>
      <a href="/api/health" target="_blank" rel="noreferrer">Open deployment health <ChevronRight size={15} /></a>
    </div>
    {data.capabilities.billing && data.entitlement?.plan !== "FREE" && <div className="billing-actions"><button className="secondary-button" onClick={() => billing("manage")}>Manage subscription</button><button className="text-button" onClick={() => billing("restore")}>Restore purchase</button></div>}
    <button className="logout-button" onClick={logout}><LogOut /> Log out</button><button className="delete-link" onClick={() => setDeleteOpen(true)}>Delete account</button>

    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetContent side="bottom" className="mivo-sheet tall-sheet"><SheetHeader><SheetTitle>Profile & privacy</SheetTitle><SheetDescription>These details stay hidden until their Identity Layer is mutually unlocked.</SheetDescription></SheetHeader><form className="settings-form" onSubmit={profile}><label>Short bio<textarea name="bio" defaultValue={viewer.bio} maxLength={180} rows={3} /></label><fieldset className="choice-fieldset vibe-fieldset settings-vibes"><legend>Your vibes <span>{profileVibes.length}/5</span></legend><div className="vibe-grid">{data.vibes.map((vibe) => <button key={vibe.id} type="button" aria-pressed={profileVibes.includes(vibe.id)} onClick={() => setProfileVibes((current) => current.includes(vibe.id) ? current.filter((id) => id !== vibe.id) : current.length < 5 ? [...current, vibe.id] : current)}>{vibe.label}</button>)}</div></fieldset><label>Age shown after reveal<select name="ageVisibility" defaultValue={viewer.ageVisibility}><option value="range">Age range</option><option value="exact">Exact age</option><option value="hidden">Keep hidden</option></select></label><label className="toggle-row"><span><strong>Share general location</strong><small>Only after a mutual Layer 2 reveal</small></span><input name="locationConsent" type="checkbox" defaultChecked={viewer.locationConsent} /></label><div className="field-row"><label>Region<input name="region" defaultValue={viewer.region ?? ""} /></label><label>City<input name="city" defaultValue={viewer.city ?? ""} /></label></div><div className="field-row"><label>Contact type<input name="contactType" defaultValue={viewer.contactType ?? ""} placeholder="Telegram" /></label><label>Contact value<input name="contactValue" defaultValue={viewer.contactValue ?? ""} placeholder="Optional" /></label></div><button className="primary-button" disabled={busy || profileVibes.length === 0}>{busy ? <LoaderCircle className="spin" /> : <Check />} Save privacy</button></form></SheetContent></Sheet>

    <Sheet open={controlsOpen} onOpenChange={setControlsOpen}><SheetContent side="bottom" className="mivo-sheet"><SheetHeader><SheetTitle>Privacy & appearance</SheetTitle><SheetDescription>These controls are enforced from your account, not only on this device.</SheetDescription></SheetHeader><form className="settings-form" onSubmit={preferences}><label className="toggle-row"><span><strong>Read receipts</strong><small>Let the other person see when their messages are read</small></span><input name="readReceipts" type="checkbox" defaultChecked={viewer.readReceipts} /></label><label>Who can send a Second Chance?<select name="reconnectPolicy" defaultValue={viewer.reconnectPolicy}><option value="allow">Anyone I chatted with</option><option value="connections">Connections only</option><option value="nobody">Nobody</option></select></label><label>Appearance<select name="appearance" defaultValue={viewer.appearance}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Use device setting</option></select></label><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Check />} Save controls</button></form></SheetContent></Sheet>

    <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}><DialogContent className="mivo-dialog"><DialogHeader><DialogTitle>Password & recovery</DialogTitle><DialogDescription>Changing your password signs out every other session.</DialogDescription></DialogHeader>{codes.length ? <><div className="recovery-grid">{codes.map((code) => <code key={code}>{code}</code>)}</div><button className="secondary-button" onClick={() => navigator.clipboard.writeText(codes.join("\n"))}><Copy /> Copy codes</button></> : <><form className="settings-form" onSubmit={password}><label>Current password<input name="currentPassword" type="password" required /></label><label>New password<input name="newPassword" type="password" minLength={10} required /></label><label>Confirm new password<input name="confirmPassword" type="password" minLength={10} required /></label><button className="primary-button">Change password</button></form><button className="text-button" onClick={() => { const currentPassword = prompt("Enter your current password to replace all recovery codes:"); if (currentPassword) void requestJson<{ recoveryCodes: string[] }>("/api/account", { method: "PATCH", body: JSON.stringify({ action: "recovery_codes", currentPassword }) }).then((result) => setCodes(result.recoveryCodes)).catch((error) => toast.error(error.message)); }}>Generate new recovery codes</button><div className="session-list"><h3>Active sessions</h3>{security?.sessions.map((session) => <div key={session.sessionId}><span><strong>{session.device_label}</strong><small>{session.current ? "This device" : `Last active ${new Date(session.last_seen_at).toLocaleDateString("en-ID")}`}</small></span>{!session.current && <button className="text-button" onClick={() => requestJson("/api/account", { method: "PATCH", body: JSON.stringify({ action: "revoke_session", sessionId: session.sessionId }) }).then(() => loadSecurity())}>Sign out</button>}</div>)}</div></>}</DialogContent></Dialog>

    <Sheet open={blockedOpen} onOpenChange={setBlockedOpen}><SheetContent side="bottom" className="mivo-sheet"><SheetHeader><SheetTitle>Blocked users</SheetTitle><SheetDescription>Blocked people cannot message you or be matched with you again.</SheetDescription></SheetHeader><div className="blocked-list">{security?.blocks.length ? security.blocks.map((block) => <div key={block.public_id}><Avatar alias={block.alias} size="sm" /><span><strong>{block.alias}</strong><small>Blocked {new Date(block.created_at).toLocaleDateString("en-ID")}</small></span><button className="secondary-button" onClick={() => requestJson("/api/account", { method: "PATCH", body: JSON.stringify({ action: "unblock", userPublicId: block.public_id }) }).then(() => loadSecurity(true))}>Unblock</button></div>) : <EmptyState icon={<Shield />} title="No blocked users" body="Anyone you block will appear here." />}</div></SheetContent></Sheet>

    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent className="mivo-dialog"><DialogHeader><DialogTitle>Delete your MIVO account?</DialogTitle><DialogDescription>This signs you out, ends active rooms, removes credentials, and anonymizes retained safety records. It cannot be undone.</DialogDescription></DialogHeader><form className="settings-form" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { await requestJson("/api/account", { method: "DELETE", body: JSON.stringify({ password: form.get("password"), confirmation: form.get("confirmation") }) }); location.reload(); } catch (error) { toast.error(error instanceof Error ? error.message : "Belum berhasil."); } }}><label>Password<input name="password" type="password" required /></label><label>Type DELETE MIVO<input name="confirmation" required /></label><button className="danger-button"><Trash2 /> Permanently delete</button></form></DialogContent></Dialog>
  </section>;
}

function Paywall({ open, onOpenChange, data, onReload }: { open: boolean; onOpenChange: (open: boolean) => void; data: Bootstrap; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function checkout(plan: "PLUS" | "MAX") { setBusy(plan); try { const result = await requestJson<{ url: string }>("/api/billing", { method: "POST", body: JSON.stringify({ action: "checkout", plan }) }); location.href = result.url; } catch (error) { toast.error(error instanceof Error ? error.message : "Pembayaran belum tersedia."); } finally { setBusy(null); } }
  async function restore() { try { const result = await requestJson<{ restored: boolean }>("/api/billing", { method: "POST", body: JSON.stringify({ action: "restore" }) }); toast.success(result.restored ? "Purchase restored." : "No active purchase found."); await onReload(); } catch (error) { toast.error(error instanceof Error ? error.message : "Belum ada pembelian yang dapat dipulihkan."); } }
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="mivo-sheet paywall-sheet"><SheetHeader><SheetTitle>Choose who you vibe with</SheetTitle><SheetDescription>Random matching stays free. Subscriptions only unlock gender preference.</SheetDescription></SheetHeader><div className="plan-list"><article><div><span>MIVO PLUS</span><strong>Rp20.000 <small>/ month</small></strong><p>20 successful gender-filtered matches per day. Failed searches never use quota.</p></div><button className="secondary-button" disabled={!data.capabilities.billing || busy !== null} onClick={() => checkout("PLUS")}>{busy === "PLUS" ? <LoaderCircle className="spin" /> : "Choose Plus"}</button></article><article className="best-plan"><em>Best value</em><div><span>MIVO MAX</span><strong>Rp30.000 <small>/ month</small></strong><p>Unlimited normal gender filtering, subject to fair-use and anti-abuse limits.</p></div><button className="primary-button" disabled={!data.capabilities.billing || busy !== null} onClick={() => checkout("MAX")}>{busy === "MAX" ? <LoaderCircle className="spin" /> : "Choose Max"}</button></article></div>{!data.capabilities.billing && <p className="provider-note"><CircleAlert /> Payments are not enabled on this deployment. No plan can be activated from the client.</p>}<div className="paywall-links"><button className="text-button" disabled={!data.capabilities.billing} onClick={restore}>Restore purchase</button><Link href="/terms#subscriptions">Renewal & cancellation info</Link></div></SheetContent></Sheet>;
}

export default function MivoApp() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [tab, setTab] = useState<"home" | "connections" | "activity" | "profile">("home");
  const [chatOpen, setChatOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState<"random" | "woman" | "man">("random");
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [lastEndedRoom, setLastEndedRoom] = useState<string | null>(() => typeof window === "undefined" ? null : sessionStorage.getItem("mivo-last-ended-room"));
  const [feedbackRoom, setFeedbackRoom] = useState<string | null>(() => typeof window === "undefined" ? null : sessionStorage.getItem("mivo-feedback-room"));
  const [offline, setOffline] = useState(() => typeof navigator === "undefined" ? false : !navigator.onLine);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latestSequence = useRef(0);

  const reload = useCallback(async () => {
    try {
      setLoadError(null);
      const next = await requestJson<Bootstrap>("/api/bootstrap");
      setData(next);
      if (next.viewer) {
        setSelectedGender((current) => current === "random" ? next.viewer!.desiredGender : current);
        setSelectedVibes((current) => current.length ? current : next.viewer!.vibes.slice(0, 5));
      }
      if (next.room) { latestSequence.current = next.room.latestSequence; setChatOpen(true); }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "MIVO belum dapat dimuat.";
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  // Initial client hydration must fetch private session state; updates happen after the network response resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { const update = () => setOffline(!navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  useEffect(() => {
    const url = new URL(location.href);
    const billing = url.searchParams.get("billing");
    if (!billing) return;
    if (billing === "success") toast.success("Payment received. MIVO is verifying your access.");
    if (billing === "cancelled") toast.message("Checkout closed. Your plan did not change.");
    url.searchParams.delete("billing");
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const action = useCallback(async <T,>(body: ActionBody) => requestJson<T>("/api/action", { method: "POST", body: JSON.stringify(body) }), []);

  const activeRoomPublicId = data?.room?.publicId;
  const currentSearchState = data?.search?.state;

  useEffect(() => {
    if (!data?.authenticated) return;
    const connectionId = sessionStorage.getItem("mivo-connection") ?? crypto.randomUUID(); sessionStorage.setItem("mivo-connection", connectionId);
    const heartbeat = () => void action({ action: "presence", state: document.hidden ? "away" : activeRoomPublicId ? "chatting" : currentSearchState !== "idle" ? "searching" : "online", connectionId });
    heartbeat(); const interval = setInterval(heartbeat, 25_000); document.addEventListener("visibilitychange", heartbeat);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", heartbeat); };
  }, [action, activeRoomPublicId, currentSearchState, data?.authenticated]);

  useEffect(() => {
    if (!data?.authenticated || data.search?.state === "idle" || data.room) return;
    let active = true;
    const check = async () => { try { const result = await action<{ state: string } & Record<string, unknown>>({ action: "match.status" }); if (!active) return; if (result.state === "matched") { await reload(); setChatOpen(true); navigator.vibrate?.(35); } } catch { /* the next interval safely retries */ } };
    void check(); const interval = setInterval(check, data.capabilities.realtime ? 15_000 : 2800); return () => { active = false; clearInterval(interval); };
  }, [action, data?.authenticated, data?.capabilities.realtime, data?.room, data?.search?.state, reload]);

  const realtimeUserPublicId = data?.viewer?.publicId;
  const realtimeRoomPublicId = data?.room?.publicId;
  useEffect(() => {
    if (!data?.capabilities.realtime || !realtimeUserPublicId) return;
    let cancelled = false;
    let client: import("ably").Realtime | null = null;
    void import("ably").then(({ Realtime }) => {
      if (cancelled) return;
      client = new Realtime({ authUrl: "/api/realtime/token", echoMessages: false });
      void client.channels.get(`user:${realtimeUserPublicId}`).subscribe(() => void reload());
      if (realtimeRoomPublicId) void client.channels.get(`room:${realtimeRoomPublicId}`).subscribe(() => void reload());
    }).catch(() => undefined);
    return () => { cancelled = true; client?.close(); };
  }, [data?.capabilities.realtime, realtimeRoomPublicId, realtimeUserPublicId, reload]);

  const appearance = data?.viewer?.appearance;
  useEffect(() => {
    if (!appearance) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = appearance === "system" ? media.matches ? "dark" : "light" : appearance; };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  const syncRoomPublicId = data?.room?.publicId;
  const syncRoomStatus = data?.room?.status;
  const syncUsesRealtime = data?.capabilities.realtime;
  useEffect(() => {
    if (!syncRoomPublicId || syncRoomStatus !== "active") return;
    if (syncUsesRealtime) {
      const safetyRefresh = setInterval(() => void reload(), 30_000);
      return () => clearInterval(safetyRefresh);
    }
    let cancelled = false; let controller: AbortController | null = null;
    async function loop() {
      while (!cancelled) {
        controller = new AbortController();
        try {
          const result = await requestJson<{ messages: Message[]; room: Room }>(`/api/sync?room=${encodeURIComponent(syncRoomPublicId!)}&after=${latestSequence.current}`, { signal: controller.signal });
          if (cancelled) return;
          if (result.messages.length || result.room.latestSequence !== latestSequence.current || result.room.status !== syncRoomStatus) await reload();
          latestSequence.current = Math.max(latestSequence.current, result.room.latestSequence);
        } catch (error) { if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) await new Promise((resolve) => setTimeout(resolve, 1800)); }
      }
    }
    void loop(); return () => { cancelled = true; controller?.abort(); };
  }, [reload, syncRoomPublicId, syncRoomStatus, syncUsesRealtime]);

  async function startSearch() {
    if (offline) return toast.error("You’re offline. Matchmaking needs an internet connection.");
    try { const result = await action<{ state: string; code?: string }>({ action: "match.start", desiredGender: selectedGender, vibes: selectedVibes }); if (result.state === "blocked") return setPaywallOpen(true); await reload(); if (result.state === "matched") { setChatOpen(true); navigator.vibrate?.(35); } } catch (error) { toast.error(error instanceof Error ? error.message : "Search belum dimulai."); }
  }
  function chooseGender(value: "random" | "woman" | "man") { if (value !== "random" && !data?.entitlement?.genderFilter.allowed) { setPaywallOpen(true); return; } setSelectedGender(value); }
  function toggleVibe(value: string) { setSelectedVibes((current) => current.includes(value) ? current.filter((id) => id !== value) : current.length < 5 ? [...current, value] : current); }
  function leaveChat(kind: "end" | "next", roomId: string) {
    setChatOpen(false);
    setFeedbackRoom(roomId);
    sessionStorage.setItem("mivo-feedback-room", roomId);
    if (kind === "next") {
      setLastEndedRoom(roomId);
      sessionStorage.setItem("mivo-last-ended-room", roomId);
      toast.success("Conversation ended. Looking for someone new.");
    } else {
      setLastEndedRoom(null);
      sessionStorage.removeItem("mivo-last-ended-room");
    }
    void reload();
  }
  async function secondChance() { if (!lastEndedRoom) return; try { await action({ action: "second_chance.request", roomPublicId: lastEndedRoom }); toast.success("Second Chance sent privately. You’ll only reconnect if they agree."); setLastEndedRoom(null); sessionStorage.removeItem("mivo-last-ended-room"); } catch (error) { toast.error(error instanceof Error ? error.message : "Second Chance is no longer available."); } }
  async function submitFeedback(rating: "great" | "okay" | "skip") {
    if (!feedbackRoom) return;
    try {
      await action({ action: "room.feedback", roomPublicId: feedbackRoom, rating });
      toast.success(rating === "skip" ? "Saved. MIVO will avoid a quick rematch with that person." : "Private feedback saved.");
      setFeedbackRoom(null);
      sessionStorage.removeItem("mivo-feedback-room");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Feedback belum tersimpan.");
    }
  }

  if (!data) return <LoadingScreen error={loadError} onRetry={() => void reload()} />;
  if (!data.authenticated) return <AuthScreen vibes={data.vibes} onAuthenticated={reload} />;
  if (data.viewer?.status === "suspended") return <SuspendedScreen />;
  if (data.search?.state !== "idle" && !data.room) return <SearchSurface search={data.search!} onCancel={() => void action({ action: "match.cancel" }).then(reload)} onExpand={() => void action({ action: "match.expand" }).then(reload)} />;
  if (chatOpen && data.room) return <ChatScreen key={data.room.publicId} data={data} onAction={action} onReload={reload} onLeave={leaveChat} />;

  const unread = (data.notifications ?? []).filter((note) => !note.read_at).length + (data.secondChances?.length ?? 0);
  return (
    <main className="app-shell">
      {offline && <div className="offline-banner"><WifiOff size={15} /> You’re offline. Chat and matchmaking are paused.</div>}
      <header className="app-header"><Logo compact /><div className="header-actions"><span className="live-status"><i /> Online</span><button className="round-button" onClick={() => setTab("activity")} aria-label={`${unread} unread notifications`}><Bell />{unread > 0 && <b>{Math.min(unread, 9)}</b>}</button><button className="avatar-button" onClick={() => setTab("profile")}><Avatar alias={data.viewer!.alias} hue={data.viewer!.avatarHue} size="sm" /></button></div></header>
      <div className="page-container">{tab === "home" ? <HomeScreen data={data} selectedGender={selectedGender} selectedVibes={selectedVibes} onGender={chooseGender} onVibe={toggleVibe} onSearch={startSearch} lastEndedRoom={lastEndedRoom} feedbackRoom={feedbackRoom} onSecondChance={secondChance} onFeedback={submitFeedback} /> : tab === "connections" ? <ConnectionsScreen data={data} onAction={action} onReload={reload} onOpenChat={() => setChatOpen(true)} /> : tab === "activity" ? <ActivityScreen data={data} onAction={action} onReload={reload} onOpenChat={() => setChatOpen(true)} /> : <ProfileScreen data={data} onReload={reload} onPaywall={() => setPaywallOpen(true)} />}</div>
      <nav className="bottom-nav" aria-label="Main navigation">{[["home", <Home key="home" />, "Home"], ["connections", <UsersRound key="connections" />, "Connections"], ["activity", <Activity key="activity" />, "Activity"], ["profile", <UserRound key="profile" />, "Profile"]].map(([id, icon, label]) => <button key={String(id)} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id as typeof tab)}>{icon}<span>{label}</span>{id === "activity" && unread > 0 && <i />}</button>)}</nav>
      <Paywall open={paywallOpen} onOpenChange={setPaywallOpen} data={data} onReload={reload} />
    </main>
  );
}
