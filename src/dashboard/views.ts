import { EVENT_CATEGORIES, type EventCategoryId, eventsInCategory } from "../config/events.js";
import type { TrackedRepo } from "../db/types.js";
import type { MetricsSnapshot } from "../metrics.js";
import type { DashboardSession } from "./session.js";

/**
 * Server-rendered so the dashboard needs no build step, no bundler and no CDN —
 * a self-hoster runs the same single process either way. Fonts are the system
 * stack for the same reason: the page must work offline and phone nowhere.
 */
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0b0d11; color: #e6e9ef; font-family: ${SANS}; -webkit-font-smoothing: antialiased; font-size: 14px; }
a { color: inherit; text-decoration: none; }
.mono { font-family: ${MONO}; }
.bar { display: flex; align-items: center; gap: 16px; height: 56px; padding: 0 24px; border-bottom: 1px solid #1b202a; }
.brand { display: flex; align-items: center; gap: 9px; font-weight: 600; letter-spacing: -0.01em; }
.rule { width: 1px; height: 20px; background: #222834; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 5px 9px; background: #161a21; border: 1px solid #222834; border-radius: 6px; font-size: 13px; }
.spacer { flex-grow: 1; }
.muted { color: #9aa4b2; }
.dim { color: #6b7280; }
.wrap { padding: 28px 40px 44px; max-width: 1520px; margin: 0 auto; }
.h2 { font-size: 15px; font-weight: 600; }
.panel { background: #11141a; border: 1px solid #222834; border-radius: 8px; overflow: hidden; }
.strip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.cell { padding: 15px 20px; }
.cell + .cell { border-left: 1px solid #1b202a; }
.klabel { font-size: 10.5px; font-weight: 500; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 7px; }
.kval { font-family: ${MONO}; font-size: 21px; font-weight: 500; }
.green { color: #22c55e; } .red { color: #ef4444; } .amber { color: #fbbf24; }
.row { display: grid; grid-template-columns: 12px minmax(0, 1fr) 118px 138px 150px 16px; gap: 18px; align-items: center; padding: 15px 20px; }
.row + .row { border-top: 1px solid #1b202a; }
.row.bad { background: rgba(239,68,68,0.06); align-items: start; }
.head { padding: 9px 20px; background: #0f1217; border-bottom: 1px solid #222834; font-size: 10.5px; font-weight: 500; letter-spacing: 0.05em; color: #6b7280; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.slug { font-family: ${MONO}; font-size: 13.5px; font-weight: 500; }
.badge { padding: 2px 7px; border-radius: 4px; font-size: 10.5px; font-weight: 500; letter-spacing: 0.04em; }
.badge.fail { background: rgba(239,68,68,0.14); border: 1px solid rgba(239,68,68,0.28); color: #f87171; }
.badge.pause { background: rgba(245,158,11,0.13); border: 1px solid rgba(245,158,11,0.28); color: #fbbf24; }
.btn { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; background: #161a21; border: 1px solid #2f3644; border-radius: 6px; font-size: 12.5px; font-weight: 500; color: #e6e9ef; cursor: pointer; font-family: inherit; }
.btn:hover { background: #1b2029; }
.btn.quiet { border-color: #222834; color: #9aa4b2; }
.card { background: #11141a; border: 1px solid #222834; border-radius: 12px; padding: 44px 40px; }
.center { display: flex; flex-direction: column; align-items: center; text-align: center; }
.discord { display: flex; align-items: center; justify-content: center; gap: 10px; height: 44px; width: 100%; background: #5865f2; border-radius: 8px; color: #fff; font-weight: 500; font-size: 14px; }
.discord:hover { background: #4752c4; }
.pre { background: #0f1217; border: 1px solid #1b202a; border-radius: 8px; padding: 14px 16px; font-family: ${MONO}; font-size: 12px; color: #c3cad6; line-height: 1.8; text-align: left; }
.grid2 { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 24px; }
.item { display: flex; align-items: center; gap: 14px; padding: 13px 18px; }
.item + .item { border-top: 1px solid #1b202a; }
.key { width: 3px; height: 26px; border-radius: 2px; }
.foot { padding: 11px 18px; border-top: 1px solid #1b202a; background: #0f1217; font-size: 11.5px; color: #6b7280; }
.tag { padding: 3px 8px; border-radius: 4px; font-family: ${MONO}; font-size: 11.5px; }
.tag.inc { background: rgba(34,197,94,0.11); border: 1px solid rgba(34,197,94,0.24); color: #4ade80; }
.tag.exc { background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.24); color: #f87171; }
.tag.neu { background: #171b22; border: 1px solid #2a3140; color: #9aa4b2; }
.banner { display: flex; gap: 13px; padding: 15px 18px; background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.22); border-radius: 8px; }
.ok { background: rgba(34,197,94,0.07); border-color: rgba(34,197,94,0.22); }
.flex { display: flex; align-items: center; }
.col { display: flex; flex-direction: column; }
@media (max-width: 1100px) { .strip { grid-template-columns: repeat(3, minmax(0,1fr)); } .grid2 { grid-template-columns: minmax(0,1fr); } .row { grid-template-columns: 12px minmax(0,1fr); } .row > :nth-child(n+3) { display: none; } }
`;

const MARK = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h9a4 4 0 0 1 0 8H9"/><path d="M11.5 11 9 13.5 11.5 16"/><rect x="2.5" y="16.5" width="19" height="5" rx="1.5"/></svg>`;
const HASH = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>`;
const WARN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;
const SEND = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>`;

export function layout(title: string, body: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function topBar(session: DashboardSession, guildId: string | null): string {
	const active = session.guilds.find((g) => g.id === guildId);
	const switcher =
		session.guilds.length > 0 && active
			? `<span class="chip">${escapeHtml(active.name)}</span>`
			: "";
	return `<div class="bar"><a class="brand" href="/dashboard">${MARK}<span>GitHuBot</span></a><div class="rule"></div>${switcher}<div class="spacer"></div><span class="dim" style="font-size:12px">Read-only · managed with <span class="mono muted">/repo</span> in Discord</span><div class="rule"></div><span class="muted" style="font-size:13px">${escapeHtml(session.username)}</span><a class="dim" style="font-size:12px" href="/dashboard/logout">Sign out</a></div>`;
}

export function relativeTime(date: Date | null, now = Date.now()): string {
	if (!date) return "never";
	const seconds = Math.round((now - date.getTime()) / 1000);
	if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds} seconds ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function formatUptime(ms: number): string {
	const minutes = Math.floor(ms / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	return `${minutes}m`;
}

function num(value: number): string {
	return value.toLocaleString("en-US");
}

export type RepoHealth = "ok" | "failing" | "paused";

/** A repo counts as failing while its last delivery attempt is the one that errored. */
export function healthOf(repo: TrackedRepo): RepoHealth {
	if (repo.paused) return "paused";
	const failing =
		repo.lastErrorAt !== null &&
		(repo.lastSuccessAt === null || repo.lastErrorAt.getTime() > repo.lastSuccessAt.getTime());
	return failing ? "failing" : "ok";
}

const DOT_COLOR: Record<RepoHealth, string> = {
	ok: "#22c55e",
	failing: "#ef4444",
	paused: "#f59e0b",
};

export interface RepoView {
	repo: TrackedRepo;
	channelName: string;
}

export function overviewPage(
	session: DashboardSession,
	guildId: string,
	repos: RepoView[],
	metrics: MetricsSnapshot,
): string {
	const strip = [
		["UPTIME", formatUptime(metrics.uptimeMs), ""],
		["RECEIVED", num(metrics.received), ""],
		["DELIVERED", num(metrics.delivered), "green"],
		["FAILED", num(metrics.failed), metrics.failed > 0 ? "red" : ""],
		["FILTERED", num(metrics.filtered), "muted"],
		["DUPLICATES", num(metrics.duplicates), "muted"],
		["TODAY", num(metrics.deliveredToday), ""],
	]
		.map(
			([label, value, cls]) =>
				`<div class="cell"><div class="klabel">${label}</div><div class="kval ${cls}">${value}</div></div>`,
		)
		.join("");

	const rows = repos.length === 0 ? emptyRepos() : repos.map(repoRow).join("");

	return layout(
		"GitHuBot",
		`${topBar(session, guildId)}<div class="wrap">
			<div class="flex" style="gap:10px;margin-bottom:12px"><span class="h2">Instance health</span><span class="dim" style="font-size:12px">since last restart</span></div>
			<div class="panel strip" style="margin-bottom:32px">${strip}</div>
			<div class="flex" style="gap:10px;margin-bottom:12px"><span class="h2">Tracked repositories</span><span class="dim" style="font-size:12px">${repos.length} in ${escapeHtml(session.guilds.find((g) => g.id === guildId)?.name ?? "this server")}</span></div>
			<div class="panel">${repos.length > 0 ? `<div class="row head"><div></div><div>REPOSITORY</div><div>EVENTS</div><div>DELIVERED / FAILED</div><div>LAST DELIVERY</div><div></div></div>` : ""}${rows}</div>
		</div>`,
	);
}

function emptyRepos(): string {
	return `<div style="padding:48px 40px" class="center">
		<div style="font-size:17px;font-weight:600;margin-bottom:8px">Nothing tracked here yet</div>
		<div class="muted" style="max-width:520px;line-height:1.6;margin-bottom:22px">Repositories are added from Discord, not here — this dashboard reads status and can pause or test, but it never changes what is tracked.</div>
		<div class="pre">/repo add repository:owner/repo channel:#changelog</div>
	</div>`;
}

function repoRow(view: RepoView): string {
	const { repo, channelName } = view;
	const health = healthOf(repo);
	const slug = `${repo.owner}/${repo.repo}`;
	const href = `/dashboard/g/${encodeURIComponent(repo.guildId)}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;

	const badge =
		health === "failing"
			? `<span class="badge fail">FAILING</span>`
			: health === "paused"
				? `<span class="badge pause">PAUSED</span>`
				: "";

	const error =
		health === "failing" && repo.lastError
			? `<div class="flex" style="gap:7px;margin-top:7px">${WARN}<span class="mono" style="font-size:12px;color:#f87171">${escapeHtml(repo.lastError)}</span></div>`
			: "";

	const when =
		health === "failing"
			? `<div class="col" style="gap:3px"><span style="font-size:12.5px;color:#f87171">failed ${relativeTime(repo.lastErrorAt)}</span><span class="dim" style="font-size:11.5px">last ok ${relativeTime(repo.lastSuccessAt)}</span></div>`
			: `<span style="font-size:12.5px" class="muted">${relativeTime(repo.lastDeliveryAt)}</span>`;

	return `<a class="row${health === "failing" ? " bad" : ""}" href="${href}">
		<div class="dot" style="background:${DOT_COLOR[health]};${health === "failing" ? "margin-top:5px" : ""}"></div>
		<div class="col" style="min-width:0">
			<div class="flex" style="gap:10px"><span class="slug">${escapeHtml(slug)}</span><span class="flex muted" style="gap:4px;font-size:12.5px">${HASH}${escapeHtml(channelName)}</span>${badge}</div>
			${error}
		</div>
		<div class="muted" style="font-size:12.5px">${repo.enabledEvents.length} enabled</div>
		<div class="mono" style="font-size:12.5px"><span class="green">${num(repo.deliveredCount)}</span><span style="color:#3a4150"> / </span><span class="${repo.failedCount > 0 ? "red" : "dim"}">${num(repo.failedCount)}</span></div>
		${when}
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3a4150" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
	</a>`;
}

const CATEGORY_COLOR: Record<EventCategoryId, string> = {
	code: "#6b7280",
	pulls: "#8b5cf6",
	issues: "#f59e0b",
	cicd: "#22c55e",
	releases: "#a855f7",
	discussions: "#6366f1",
	security: "#f97316",
	community: "#eab308",
	meta: "#64748b",
};

const CATEGORY_LABEL: Record<EventCategoryId, string> = {
	code: "Code",
	pulls: "Pull requests",
	issues: "Issues",
	cicd: "CI / CD",
	releases: "Releases",
	discussions: "Discussions",
	security: "Security",
	community: "Community",
	meta: "Repository & meta",
};

export function repoDetailPage(
	session: DashboardSession,
	view: RepoView,
	channelNames: Map<string, string>,
	notice: { kind: "ok" | "error"; text: string } | null,
): string {
	const { repo, channelName } = view;
	const health = healthOf(repo);
	const slug = `${repo.owner}/${repo.repo}`;
	const base = `/dashboard/g/${encodeURIComponent(repo.guildId)}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;

	const banner = noticeBanner(notice) || failureBanner(repo, health, channelName);

	const categories = EVENT_CATEGORIES.map((category) => {
		const all = eventsInCategory(category.id);
		const on = all.filter((event) => repo.enabledEvents.includes(event));
		const color = on.length > 0 ? CATEGORY_COLOR[category.id] : "#2a3140";
		const names =
			on.length > 0
				? on.slice(0, 4).join(" · ") + (on.length > 4 ? ` · +${on.length - 4}` : "")
				: "none enabled";
		return `<div class="item"><div class="key" style="background:${color}"></div>
			<div class="col" style="gap:5px;flex-grow:1;min-width:0"><span style="font-size:13px;font-weight:500${on.length === 0 ? ";color:#9aa4b2" : ""}">${CATEGORY_LABEL[category.id]}</span><span class="mono dim" style="font-size:11.5px">${escapeHtml(names)}</span></div>
			<span class="mono ${on.length > 0 ? "muted" : "dim"}" style="font-size:12px">${on.length} / ${all.length}</span></div>`;
	}).join("");

	const routes = Object.entries(repo.eventRoutes);
	const mentions = Object.entries(repo.mentionRules);

	return layout(
		`${slug} · GitHuBot`,
		`${topBar(session, repo.guildId)}<div class="wrap">
			<a class="dim flex" style="gap:8px;font-size:12.5px;margin-bottom:16px" href="/dashboard/g/${encodeURIComponent(repo.guildId)}">← Overview</a>

			<div class="flex" style="gap:20px;align-items:flex-start;margin-bottom:22px">
				<div class="col" style="gap:9px;flex-grow:1">
					<div class="flex" style="gap:12px"><div class="dot" style="width:9px;height:9px;background:${DOT_COLOR[health]}"></div><span class="mono" style="font-size:22px;font-weight:500">${escapeHtml(slug)}</span>${health === "failing" ? '<span class="badge fail">FAILING</span>' : health === "paused" ? '<span class="badge pause">PAUSED</span>' : ""}</div>
					<div class="flex muted" style="gap:16px;font-size:12.5px"><span class="flex" style="gap:5px">${HASH}${escapeHtml(channelName)}</span><span style="color:#3a4150">·</span><span>tracking id <span class="mono dim">${escapeHtml(repo.trackingId.slice(0, 12))}…</span></span></div>
				</div>
				<form method="post" action="${base}/${repo.paused ? "resume" : "pause"}" style="display:flex;gap:10px;margin:0">
					<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
					<button class="btn quiet" type="submit">${repo.paused ? "Resume deliveries" : "Pause deliveries"}</button>
				</form>
				<form method="post" action="${base}/test" style="margin:0">
					<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
					<button class="btn" type="submit">${SEND}Send test message</button>
				</form>
			</div>

			${banner}

			<div class="h2" style="margin:26px 0 12px">Delivery health</div>
			<div class="panel" style="margin-bottom:30px">
				<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr))">
					<div class="cell"><div class="klabel">DELIVERED</div><div class="kval green">${num(repo.deliveredCount)}</div></div>
					<div class="cell"><div class="klabel">FAILED</div><div class="kval ${repo.failedCount > 0 ? "red" : ""}">${num(repo.failedCount)}</div></div>
					<div class="cell"><div class="klabel">LAST DELIVERY</div><div style="font-size:14px;margin-top:3px" class="${health === "failing" ? "red" : "muted"}">${relativeTime(repo.lastDeliveryAt)}</div></div>
					<div class="cell"><div class="klabel">LAST SUCCESS</div><div style="font-size:14px;margin-top:3px" class="muted">${relativeTime(repo.lastSuccessAt)}</div></div>
				</div>
				${repo.lastError ? `<div style="padding:14px 20px;border-top:1px solid #1b202a;background:#0f1217"><div class="klabel">LAST ERROR</div><div class="mono" style="font-size:12.5px;color:#f87171;line-height:1.6">${escapeHtml(repo.lastError)}</div></div>` : ""}
			</div>

			<div class="grid2">
				<div>
					<div class="flex" style="gap:10px;margin-bottom:12px"><span class="h2">Enabled events</span><span class="dim" style="font-size:12px">${repo.enabledEvents.length} of 48</span></div>
					<div class="panel">${categories}<div class="foot">Change with <span class="mono muted">/repo events ${escapeHtml(slug)}</span></div></div>
				</div>
				<div class="col" style="gap:24px">
					<div>
						<div class="h2" style="margin-bottom:12px">Filters</div>
						<div class="panel">
							${filterRow("Only these branches", repo.filters.branchInclude, "inc", "none — all branches pass")}
							${filterRow("Never these branches", repo.filters.branchExclude, "exc", "none")}
							${filterRow("Only these labels", repo.filters.labels, "neu", "none — all labels pass")}
							${filterRow("Ignored authors", repo.filters.ignoredActors, "neu", "none")}
							<div class="foot">Change with <span class="mono muted">/repo filters ${escapeHtml(slug)}</span></div>
						</div>
					</div>
					<div>
						<div class="h2" style="margin-bottom:12px">Routing</div>
						<div class="panel">
							${routes.length === 0 ? `<div class="item"><span class="dim" style="font-size:12.5px">No overrides</span></div>` : routes.map(([event, channelId]) => `<div class="item"><span style="font-size:12.5px;flex-grow:1" class="mono">${escapeHtml(event)}</span><span class="flex muted" style="gap:4px;font-size:12.5px">${HASH}${escapeHtml(channelNames.get(channelId) ?? channelId)}</span></div>`).join("")}
							<div class="foot">Everything else posts to <span class="mono muted">#${escapeHtml(channelName)}</span></div>
						</div>
					</div>
					<div>
						<div class="h2" style="margin-bottom:12px">Mentions</div>
						<div class="panel">
							${mentions.length === 0 ? `<div class="item"><span class="dim" style="font-size:12.5px">No role pings</span></div>` : mentions.map(([event, roles]) => `<div class="item"><span style="font-size:12.5px;flex-grow:1" class="mono">${escapeHtml(event)}</span><span class="tag neu">${roles.map((r) => `&lt;@&amp;${escapeHtml(r)}&gt;`).join(" ")}</span></div>`).join("")}
							<div class="foot">Pings are scoped so repository text cannot trigger one</div>
						</div>
					</div>
					<div>
						<div class="h2" style="margin-bottom:12px">Appearance</div>
						<div class="panel">
							<div class="item"><span style="font-size:12.5px;flex-grow:1">Theme</span><span class="tag neu">${escapeHtml(repo.theme ?? "server default")}</span></div>
							<div class="item"><span style="font-size:12.5px;flex-grow:1">Density</span><span class="tag neu">${escapeHtml(repo.displayMode ?? "server default")}</span></div>
						</div>
					</div>
				</div>
			</div>
		</div>`,
	);
}

function filterRow(label: string, values: string[], kind: string, empty: string): string {
	const body =
		values.length === 0
			? `<span class="dim" style="font-size:12px">${empty}</span>`
			: `<div style="display:flex;flex-wrap:wrap;gap:6px">${values.map((v) => `<span class="tag ${kind}">${escapeHtml(v)}</span>`).join("")}</div>`;
	return `<div class="col" style="gap:8px;padding:14px 18px;border-top:1px solid #1b202a"><span class="muted" style="font-size:12px">${label}</span>${body}</div>`;
}

function noticeBanner(notice: { kind: "ok" | "error"; text: string } | null): string {
	if (!notice) return "";
	return `<div class="banner ${notice.kind === "ok" ? "ok" : ""}"><span style="font-size:13px;color:${notice.kind === "ok" ? "#4ade80" : "#f87171"}">${escapeHtml(notice.text)}</span></div>`;
}

function failureBanner(repo: TrackedRepo, health: RepoHealth, channelName: string): string {
	if (health !== "failing") return "";
	return `<div class="banner">${WARN}<div class="col" style="gap:7px">
		<span style="font-size:13.5px;font-weight:600;color:#f87171">Deliveries are failing</span>
		<span style="font-size:13px;color:#c3cad6;line-height:1.55">GitHuBot is receiving from GitHub but cannot post to the target channel. Grant the bot <span class="mono">View Channel</span> and <span class="mono">Send Messages</span> on <span class="mono">#${escapeHtml(channelName)}</span>, or move the destination with <span class="mono">/repo channel ${escapeHtml(repo.owner)}/${escapeHtml(repo.repo)}</span>.</span>
	</div></div>`;
}

export function signInPage(): string {
	return layout(
		"Sign in · GitHuBot",
		`<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px">
			<div class="card center" style="width:460px">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h9a4 4 0 0 1 0 8H9"/><path d="M11.5 11 9 13.5 11.5 16"/><rect x="2.5" y="16.5" width="19" height="5" rx="1.5"/></svg>
				<div style="font-size:21px;font-weight:600;margin-top:18px">GitHuBot</div>
				<div class="muted" style="font-size:13.5px;margin-top:8px;line-height:1.55">Delivery status for the servers you manage.</div>
				<a class="discord" style="margin-top:28px" href="/dashboard/login">Continue with Discord</a>
				<div class="dim" style="font-size:12.5px;margin-top:18px;line-height:1.6">Only servers where you have <span class="muted">Manage&nbsp;Server</span> are shown. The dashboard never posts on your behalf.</div>
			</div>
		</div>`,
	);
}

export function notConfiguredPage(missing: string[]): string {
	return layout(
		"Dashboard is off · GitHuBot",
		`<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px">
			<div class="card center" style="width:520px">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>
				<div style="font-size:21px;font-weight:600;margin-top:18px">Dashboard is off</div>
				<div class="muted" style="font-size:13.5px;margin-top:8px;line-height:1.55">The bot is running normally. This optional dashboard stays disabled until it is configured.</div>
				<div class="pre" style="width:100%;margin-top:24px">${missing.map((key) => `${escapeHtml(key)}=…`).join("<br>")}</div>
				<div class="dim" style="font-size:12.5px;margin-top:16px;line-height:1.6">Add <span class="mono muted">&lt;DASHBOARD_BASE_URL&gt;/dashboard/auth/callback</span> as a redirect URI in the Discord Developer Portal, then restart.</div>
			</div>
		</div>`,
	);
}

export function errorPage(status: number, message: string): string {
	return layout(
		`${status} · GitHuBot`,
		`<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px">
			<div class="card center" style="width:420px">
				<div class="mono dim" style="font-size:13px">${status}</div>
				<div style="font-size:17px;font-weight:600;margin-top:10px">${escapeHtml(message)}</div>
				<a class="btn quiet" style="margin-top:22px" href="/dashboard">Back to overview</a>
			</div>
		</div>`,
	);
}
