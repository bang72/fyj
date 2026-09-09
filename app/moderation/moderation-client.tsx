"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Ban, BellRing, CheckCircle2, Clock3, FileWarning, Gauge,
  History, LoaderCircle, LogOut, RefreshCw, Search, Shield, StickyNote, UserCog, Users, XCircle,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

type Role = "MODERATOR" | "ADMIN";
type Tab = "overview" | "reports" | "users" | "audit" | "staff";

type Dashboard = {
  users?: { total?: number; active?: number; suspended?: number; banned?: number };
  reports?: { total?: number; open?: number; reviewing?: number; urgent?: number };
  actions?: { today?: number };
  appeals?: { open?: number };
};

type Report = {
  public_id: string; category: string; details: string; status: string; priority: number; created_at: string;
  target_public_id: string; target_alias: string; target_status: string; target_role: string; target_trust_band: string;
  target_trust_score: number; target_warning_count: number; target_suspended_until: string | null; target_moderation_reason: string | null;
  reporter_public_id: string; reporter_alias: string; room_public_id: string | null; message_public_id: string | null;
  evidence_snapshot: string | null; evidence_expires_at: string | null; assigned_public_id: string | null; assigned_alias: string | null;
  internal_note: string | null;
};

type UserRow = {
  public_id: string; username: string; status: string; role: string; trust_score: number; trust_band: string; warning_count: number;
  suspended_until: string | null; moderation_reason: string | null; last_warning_at: string | null; created_at: string; updated_at: string;
  alias: string; bio: string; report_count: number; open_report_count: number; action_count: number; latest_note: string | null; latest_note_at: string | null;
};

type AuditRow = {
  id: string; action: string; reason: string; expires_at: string | null; created_at: string;
  actor_alias: string; actor_role: string; target_alias: string; target_status: string; report_public_id: string | null;
};

type StaffRow = { public_id: string; username: string; role: Role; status: string; updated_at: string; alias: string };

type ActionDraft = {
  kind: "report" | "user" | "staff";
  action: string;
  id: string;
  label: string;
  reason: string;
  publicNotice: string;
  durationHours: number;
  priority: number;
  role: "USER" | "MODERATOR" | "ADMIN";
} | null;

const durationOptions = [
  [1, "1 jam"], [6, "6 jam"], [24, "1 hari"], [72, "3 hari"], [168, "7 hari"], [720, "30 hari"], [2160, "90 hari"],
] as const;

function fmt(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function StatusPill({ status }: { status: string }) {
  return <span className={`admin-pill admin-pill-${status}`}>{status.replaceAll("_", " ")}</span>;
}

export default function ModerationClient({ role }: { role: Role }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<Dashboard>({});
  const [reports, setReports] = useState<Report[]>([]);
  const [reportStatus, setReportStatus] = useState("open");
  const [mine, setMine] = useState(false);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userStatus, setUserStatus] = useState("all");
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [draft, setDraft] = useState<ActionDraft>(null);
  const [submitting, setSubmitting] = useState(false);

  const tabs = useMemo(() => [
    ["overview", "Overview", Gauge], ["reports", "Reports", FileWarning], ["users", "Users", Users],
    ...(role === "ADMIN" ? [["audit", "Audit", History], ["staff", "Staff", UserCog]] as const : []),
  ] as const, [role]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "overview") {
        const r = await fetch("/api/admin/dashboard", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setDashboard(j);
      } else if (tab === "reports") {
        const r = await fetch(`/api/moderation?status=${reportStatus}&mine=${mine ? "1" : "0"}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setReports(j.reports ?? []);
      } else if (tab === "users") {
        const params = new URLSearchParams(); if (userQuery.trim()) params.set("q", userQuery.trim()); if (userStatus !== "all") params.set("status", userStatus);
        const r = await fetch(`/api/admin/users?${params}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setUsers(j.users ?? []);
      } else if (tab === "audit" && role === "ADMIN") {
        const r = await fetch("/api/admin/audit", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setAudit(j.actions ?? []);
      } else if (tab === "staff" && role === "ADMIN") {
        const r = await fetch("/api/admin/staff", { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setStaff(j.staff ?? []);
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Admin data could not be loaded."); }
    finally { setLoading(false); }
  }, [mine, reportStatus, role, tab, userQuery, userStatus]);

  useEffect(() => { void load(); }, [load]);

  async function submitAction() {
    if (!draft) return;
    if (draft.reason.trim().length < 8) { toast.error("Alasan internal minimal 8 karakter."); return; }
    setSubmitting(true);
    try {
      let url = ""; let body: Record<string, unknown> = {};
      if (draft.kind === "report") {
        url = "/api/moderation";
        body = { action: draft.action, reportPublicId: draft.id, reason: draft.reason, publicNotice: draft.publicNotice || undefined, durationHours: draft.durationHours, priority: draft.priority };
      } else if (draft.kind === "user") {
        url = "/api/admin/users";
        body = { action: draft.action, userPublicId: draft.id, reason: draft.reason, publicNotice: draft.publicNotice || undefined, durationHours: draft.durationHours };
      } else {
        url = "/api/admin/staff";
        body = { userPublicId: draft.id, role: draft.role, reason: draft.reason };
      }
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      toast.success("Tindakan admin berhasil disimpan."); setDraft(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Action failed."); }
    finally { setSubmitting(false); }
  }

  function reportAction(report: Report, action: string, preset = "") {
    setDraft({ kind: "report", action, id: report.public_id, label: `${action} · ${report.target_alias}`, reason: preset, publicNotice: "", durationHours: 24, priority: report.priority, role: "USER" });
  }
  function userAction(user: UserRow, action: string, preset = "") {
    setDraft({ kind: "user", action, id: user.public_id, label: `${action} · ${user.alias}`, reason: preset, publicNotice: "", durationHours: 24, priority: 0, role: "USER" });
  }

  return <main className="moderation-shell admin-console">
    <header><Link href="/"><ArrowLeft /> MIVO</Link><div><span>Trust & Safety Console</span><strong>{role}</strong></div></header>
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-brand"><Shield /><div><strong>MIVO Control</strong><small>V2.1 moderation</small></div></div>
        <nav>{tabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon />{label}</button>)}</nav>
        <button className="admin-refresh" onClick={() => void load()}><RefreshCw /> Refresh data</button>
      </aside>
      <section className="admin-main">
        <div className="admin-title"><div><p>Protected staff workspace</p><h1>{tabs.find(([key]) => key === tab)?.[1]}</h1></div><StatusPill status={role.toLowerCase()} /></div>
        {loading ? <div className="moderation-loading"><LoaderCircle className="spin" /> Memuat data production…</div> : <>
          {tab === "overview" && <Overview dashboard={dashboard} onOpenReports={() => setTab("reports")} onOpenUsers={() => setTab("users")} />}
          {tab === "reports" && <ReportsView reports={reports} status={reportStatus} mine={mine} setStatus={setReportStatus} setMine={setMine} role={role} act={reportAction} />}
          {tab === "users" && <UsersView users={users} query={userQuery} setQuery={setUserQuery} status={userStatus} setStatus={setUserStatus} role={role} act={userAction} reload={load} promote={(user, nextRole) => setDraft({ kind: "staff", action: "role", id: user.public_id, label: `Role ${user.alias} → ${nextRole}`, reason: "", publicNotice: "", durationHours: 24, priority: 0, role: nextRole })} />}
          {tab === "audit" && role === "ADMIN" && <AuditView rows={audit} />}
          {tab === "staff" && role === "ADMIN" && <StaffView rows={staff} onChange={(row, nextRole) => setDraft({ kind: "staff", action: "role", id: row.public_id, label: `Role ${row.alias} → ${nextRole}`, reason: "", publicNotice: "", durationHours: 24, priority: 0, role: nextRole })} />}
        </>}
      </section>
    </div>
    {draft && <ActionModal draft={draft} setDraft={setDraft} submitting={submitting} submit={submitAction} role={role} />}
  </main>;
}

function Overview({ dashboard, onOpenReports, onOpenUsers }: { dashboard: Dashboard; onOpenReports: () => void; onOpenUsers: () => void }) {
  const cards = [
    ["Total users", dashboard.users?.total ?? 0, Users], ["Open reports", dashboard.reports?.open ?? 0, FileWarning],
    ["Urgent reports", dashboard.reports?.urgent ?? 0, AlertTriangle], ["Suspended", dashboard.users?.suspended ?? 0, Clock3],
    ["Permanent bans", dashboard.users?.banned ?? 0, Ban], ["Actions 24h", dashboard.actions?.today ?? 0, History],
  ] as const;
  return <><div className="admin-stats">{cards.map(([label, value, Icon]) => <article key={label}><Icon /><div><span>{label}</span><strong>{Number(value)}</strong></div></article>)}</div>
    <div className="admin-overview-grid"><article><h2>Moderation workflow</h2><p>Review reports, preserve evidence, warn users, issue timed suspensions, or permanently ban severe/repeat offenders.</p><button onClick={onOpenReports}>Open report queue</button></article><article><h2>User control</h2><p>Search any account directly, inspect its moderation footprint, force logout, add notes, suspend, restore, or ban.</p><button onClick={onOpenUsers}>Manage users</button></article></div></>;
}

function ReportsView({ reports, status, mine, setStatus, setMine, role, act }: { reports: Report[]; status: string; mine: boolean; setStatus: (v: string) => void; setMine: (v: boolean) => void; role: Role; act: (r: Report, a: string, p?: string) => void }) {
  return <><div className="admin-toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option><option value="all">All</option></select><label><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label></div>
  {reports.length === 0 ? <div className="moderation-empty"><Shield /><h2>Tidak ada report</h2><p>Queue production tidak memiliki report dengan filter ini.</p></div> : <div className="report-list">{reports.map((report) => {
    let evidence: { message?: { body?: string } | null } = {}; try { evidence = JSON.parse(report.evidence_snapshot ?? "{}"); } catch { evidence = {}; }
    return <article key={report.public_id}><div className="report-top"><span className={report.priority >= 10 ? "urgent" : ""}><AlertTriangle /> {report.category.replaceAll("_", " ")}</span><time>{fmt(report.created_at)}</time></div><div className="admin-card-title"><h2>{report.target_alias}</h2><StatusPill status={report.target_status} /></div><p>{report.details || "Tidak ada detail tambahan."}</p>{evidence.message?.body && <blockquote>{evidence.message.body}</blockquote>}<div className="admin-mini-grid"><span>Trust <b>{report.target_trust_score} · {report.target_trust_band}</b></span><span>Warnings <b>{report.target_warning_count}</b></span><span>Assignee <b>{report.assigned_alias ?? "Unassigned"}</b></span><span>Priority <b>{report.priority}</b></span></div>{report.internal_note && <div className="admin-note"><StickyNote />{report.internal_note}</div>}<dl><div><dt>Report</dt><dd>{report.public_id}</dd></div><div><dt>Room</dt><dd>{report.room_public_id ?? "—"}</dd></div><div><dt>Reporter</dt><dd>{report.reporter_alias}</dd></div></dl><div className="moderation-actions">{report.status === "open" && <button onClick={() => act(report, "review", "Mulai peninjauan laporan dan bukti terkait.")}>Review</button>}<button onClick={() => act(report, report.assigned_alias ? "unassign" : "assign", report.assigned_alias ? "Lepaskan assignment report dari moderator saat ini." : "Ambil report ini untuk ditinjau.")}>{report.assigned_alias ? "Unassign" : "Claim"}</button><button onClick={() => act(report, "note")}>Internal note</button><button onClick={() => act(report, "set_priority", "Perbarui tingkat prioritas berdasarkan risiko kasus.")}>Priority</button><button onClick={() => act(report, "resolve")}>Resolve</button><button onClick={() => act(report, "dismiss")}>Dismiss</button>{report.message_public_id && <button onClick={() => act(report, "remove_content")}>Remove message</button>}{!["banned", "deleted"].includes(report.target_status) && <button className="warning" onClick={() => act(report, "warn")}>Warn</button>}{!["banned", "deleted"].includes(report.target_status) && <button className="warning" onClick={() => act(report, "suspend")}>Suspend</button>}{role === "ADMIN" && <button className="danger" onClick={() => act(report, "ban")}>Permanent ban</button>}{role === "ADMIN" && ["suspended", "banned"].includes(report.target_status) && <button onClick={() => act(report, "restore")}>Restore</button>}</div></article>;
  })}</div>}</>;
}

function UsersView({ users, query, setQuery, status, setStatus, role, act, reload, promote }: { users: UserRow[]; query: string; setQuery: (v: string) => void; status: string; setStatus: (v: string) => void; role: Role; act: (u: UserRow, a: string, p?: string) => void; reload: () => Promise<void>; promote: (u: UserRow, role: "MODERATOR" | "ADMIN") => void }) {
  return <><form className="admin-toolbar admin-search" onSubmit={(e) => { e.preventDefault(); void reload(); }}><div><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Username, alias, atau public ID" /></div><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="banned">Banned</option></select><button type="submit">Search</button></form>
  {users.length === 0 ? <div className="moderation-empty"><Users /><h2>Akun tidak ditemukan</h2></div> : <div className="admin-user-list">{users.map((user) => <article key={user.public_id}><div className="admin-user-head"><div><h2>{user.alias}</h2><p>@{user.username} · {user.role}</p></div><StatusPill status={user.status} /></div><div className="admin-mini-grid"><span>Trust <b>{user.trust_score} · {user.trust_band}</b></span><span>Warnings <b>{user.warning_count}</b></span><span>Reports <b>{user.report_count} ({user.open_report_count} open)</b></span><span>Actions <b>{user.action_count}</b></span></div>{user.suspended_until && <p className="admin-restriction"><Clock3 /> Suspended until {fmt(user.suspended_until)}</p>}{user.moderation_reason && <div className="admin-note"><StickyNote />Current restriction: {user.moderation_reason}</div>}{user.latest_note && <div className="admin-note"><StickyNote />Latest staff note ({fmt(user.latest_note_at)}): {user.latest_note}</div>}<small>Joined {fmt(user.created_at)} · {user.public_id}</small><div className="moderation-actions"><button onClick={() => act(user, "add_note")}>Add note</button>{!["banned", "deleted"].includes(user.status) && <button className="warning" onClick={() => act(user, "warn")}>Warning</button>}{!["banned", "deleted"].includes(user.status) && <button className="warning" onClick={() => act(user, "suspend")}>Suspend</button>}{role === "ADMIN" && <button onClick={() => act(user, "force_logout", "Paksa semua sesi akun keluar untuk tindakan keamanan.")}><LogOut /> Force logout</button>}{role === "ADMIN" && user.warning_count > 0 && <button onClick={() => act(user, "clear_warnings", "Reset penghitung warning setelah tinjauan admin.")}>Clear warnings</button>}{role === "ADMIN" && user.role === "USER" && user.status === "active" && <button onClick={() => promote(user, "MODERATOR")}><UserCog /> Make moderator</button>}{role === "ADMIN" && user.role === "USER" && user.status === "active" && <button onClick={() => promote(user, "ADMIN")}><Shield /> Make admin</button>}{role === "ADMIN" && user.status !== "banned" && user.role !== "ADMIN" && <button className="danger" onClick={() => act(user, "ban")}><Ban /> Permanent ban</button>}{role === "ADMIN" && ["suspended", "banned"].includes(user.status) && <button onClick={() => act(user, "restore")}><CheckCircle2 /> Restore</button>}</div></article>)}</div>}</>;
}

function AuditView({ rows }: { rows: AuditRow[] }) {
  return rows.length === 0 ? <div className="moderation-empty"><History /><h2>Belum ada moderation action</h2></div> : <div className="admin-audit-list">{rows.map((row) => <article key={row.id}><div><strong>{row.action.replaceAll("_", " ")}</strong><StatusPill status={row.target_status} /></div><p><b>{row.actor_alias}</b> ({row.actor_role}) → <b>{row.target_alias}</b></p><blockquote>{row.reason}</blockquote><small>{fmt(row.created_at)}{row.expires_at ? ` · expires ${fmt(row.expires_at)}` : ""}{row.report_public_id ? ` · ${row.report_public_id}` : ""}</small></article>)}</div>;
}

function StaffView({ rows, onChange }: { rows: StaffRow[]; onChange: (row: StaffRow, role: "USER" | "MODERATOR" | "ADMIN") => void }) {
  return <div className="admin-user-list">{rows.map((row) => <article key={row.public_id}><div className="admin-user-head"><div><h2>{row.alias}</h2><p>@{row.username}</p></div><StatusPill status={row.role.toLowerCase()} /></div><small>Updated {fmt(row.updated_at)} · {row.public_id}</small><div className="moderation-actions"><button onClick={() => onChange(row, "MODERATOR")}>Make moderator</button><button onClick={() => onChange(row, "ADMIN")}>Make admin</button><button className="warning" onClick={() => onChange(row, "USER")}>Remove staff role</button></div></article>)}</div>;
}

function ActionModal({ draft, setDraft, submitting, submit, role }: { draft: NonNullable<ActionDraft>; setDraft: (d: ActionDraft) => void; submitting: boolean; submit: () => Promise<void>; role: Role }) {
  const needsDuration = draft.action === "suspend";
  const needsPriority = draft.action === "set_priority";
  return <div className="admin-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) setDraft(null); }}><div className="admin-modal"><div className="admin-modal-head"><div><p>Confirm protected action</p><h2>{draft.label}</h2></div><button onClick={() => setDraft(null)} disabled={submitting}><XCircle /></button></div>{needsDuration && <label>Suspension duration<select value={draft.durationHours} onChange={(e) => setDraft({ ...draft, durationHours: Number(e.target.value) })}>{durationOptions.filter(([hours]) => role === "ADMIN" || hours <= 168).map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}</select></label>}{needsPriority && <label>Priority (0–20)<input type="number" min={0} max={20} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} /></label>}{draft.kind === "staff" && <label>New role<select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as "USER" | "MODERATOR" | "ADMIN" })}><option value="USER">USER</option><option value="MODERATOR">MODERATOR</option><option value="ADMIN">ADMIN</option></select></label>}<label>Internal reason<textarea autoFocus value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="Jelaskan alasan spesifik. Ini masuk audit log dan tidak ditampilkan ke user." rows={5} maxLength={1000} /></label>{["warn", "suspend", "ban", "restore"].includes(draft.action) && <label>Pesan ke user (opsional)<textarea value={draft.publicNotice} onChange={(e) => setDraft({ ...draft, publicNotice: e.target.value })} placeholder="Pesan aman yang boleh dilihat user. Kosongkan untuk memakai pesan default MIVO." rows={3} maxLength={500} /></label>}<p className="admin-modal-help">Tindakan administratif dicatat ke audit trail. Suspend/ban juga memutus sesi, matchmaking, presence, dan chat aktif target.</p><div className="admin-modal-actions"><button onClick={() => setDraft(null)} disabled={submitting}>Cancel</button><button className={draft.action === "ban" ? "danger" : "primary"} onClick={() => void submit()} disabled={submitting}>{submitting ? <LoaderCircle className="spin" /> : draft.action === "warn" ? <BellRing /> : draft.action === "ban" ? <Ban /> : <Shield />} Confirm</button></div></div></div>;
}
