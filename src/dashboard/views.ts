import { EVENT_CATEGORIES, type EventCategoryId, eventsInCategory } from "../config/events.js";
import type { TrackedRepo } from "../db/types.js";
import type { MetricsSnapshot } from "../metrics.js";
import type { DashboardSession } from "./session.js";

/**
 * Server-rendered so the dashboard needs no build step, no bundler and no CDN —
 * a self-hoster runs the same single process either way. Fonts are the system
 * stack for the same reason: the page must work offline and phone nowhere, which
 * also keeps the CSP free of a font host.
 */
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

/** Days of activity drawn in a repository card's sparkline. */
export const ACTIVITY_DAYS = 7;

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
body { margin: 0; background: #000; color: #ededed; font-family: ${SANS}; -webkit-font-smoothing: antialiased; font-size: 14px; }
a { color: inherit; text-decoration: none; }
.mono { font-family: ${MONO}; }
.dim { color: #6e6e6e; }
.mut { color: #8f8f8f; }
.sec { color: #a1a1a1; }
.green { color: #22c55e; } .red { color: #ef4444; } .amber { color: #f59e0b; }

.nav { border-bottom: 1px solid #1a1a1a; }
.navin { display: flex; align-items: center; gap: 13px; height: 56px; max-width: 1248px; margin: 0 auto; padding: 0 24px; }
.brand { display: flex; align-items: center; gap: 11px; font-size: 14.5px; font-weight: 700; letter-spacing: -0.02em; }
.sep { color: #333; font-size: 16px; font-weight: 300; }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px; background: #0d0d0d; border: 1px solid #1f1f1f; border-radius: 7px; font-size: 13px; font-weight: 500; }
.grow { flex-grow: 1; }
.wrap { max-width: 1248px; margin: 0 auto; padding: 36px 24px 56px; }

.h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.035em; }
.h2 { font-size: 18px; font-weight: 700; letter-spacing: -0.025em; }
.h3 { font-size: 14.5px; font-weight: 700; letter-spacing: -0.02em; }
.klabel { font-size: 11px; font-weight: 600; letter-spacing: 0.07em; color: #8f8f8f; }
.kval { font-family: ${MONO}; font-size: 30px; font-weight: 500; letter-spacing: -0.04em; line-height: 1; }

.card { background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 14px; }
.panel { display: grid; background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 14px; overflow: hidden; }
.cell { padding: 22px 24px; }
.cell + .cell { border-left: 1px solid #161616; }
.count { padding: 2px 8px; background: #141414; border-radius: 100px; font-size: 11.5px; font-weight: 600; color: #8f8f8f; }
.tag { padding: 3px 9px; border-radius: 100px; font-family: ${MONO}; font-size: 11px; }
.tag.inc { background: rgba(34,197,94,0.1); color: #22c55e; }
.tag.exc { background: rgba(239,68,68,0.1); color: #f87171; }
.tag.neu { background: #161616; color: #a1a1a1; }
.badge { padding: 3px 8px; border-radius: 100px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; }
.badge.fail { background: rgba(239,68,68,0.12); color: #f87171; }
.badge.pause { background: rgba(245,158,11,0.12); color: #f59e0b; }

.mono-tile { border-radius: 9px; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #000; flex-shrink: 0; }
.dot { border-radius: 50%; flex-shrink: 0; }
.bar { display: flex; height: 4px; border-radius: 3px; overflow: hidden; gap: 2px; }
.spark { display: flex; align-items: flex-end; gap: 3px; height: 30px; }
.spark > div { flex-grow: 1; border-radius: 2px; min-height: 2px; }

.grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.grid2 { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; }
.repo { padding: 18px; display: flex; flex-direction: column; gap: 15px; }
.repo .foot { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: #6e6e6e; border-top: 1px solid #1a1a1a; padding-top: 13px; margin-top: auto; }
.note { display: flex; align-items: center; gap: 7px; padding: 9px 10px; border-radius: 8px; }

.btn { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 14px; background: #0d0d0d; border: 1px solid #262626; border-radius: 8px; font-size: 13px; font-weight: 500; color: #ededed; cursor: pointer; font-family: inherit; }
.btn:hover { background: #141414; }
.btn.primary { background: #ededed; border-color: #ededed; color: #000; font-weight: 700; }
.btn.primary:hover { background: #fff; }

.rowitem { display: flex; align-items: center; gap: 14px; padding: 11px 0; }
.track { flex-grow: 1; height: 6px; background: #161616; border-radius: 3px; overflow: hidden; display: flex; }
.foot2 { padding: 12px 20px; border-top: 1px solid #161616; font-size: 11.5px; color: #6e6e6e; }
.chead { display: flex; align-items: center; justify-content: space-between; padding: 17px 20px; border-bottom: 1px solid #161616; }

.center { display: flex; flex-direction: column; align-items: center; text-align: center; }
.pre { background: #050505; border: 1px solid #1f1f1f; border-radius: 10px; padding: 16px; font-family: ${MONO}; font-size: 11.5px; color: #a1a1a1; line-height: 1.9; text-align: left; }
.discord { display: flex; align-items: center; justify-content: center; gap: 10px; height: 44px; width: 100%; background: #ededed; border-radius: 10px; color: #000; font-size: 14px; font-weight: 700; }
.discord:hover { background: #fff; }
.banner { display: flex; gap: 13px; padding: 16px 18px; background: rgba(239,68,68,0.05); border: 1px solid #341b1b; border-radius: 12px; }
.banner.ok { background: rgba(34,197,94,0.05); border-color: #16351f; }

@media (max-width: 1100px) {
	.grid3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.grid2 { grid-template-columns: minmax(0, 1fr); }
	.panel { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
	.cell + .cell { border-left: none; }
}
@media (max-width: 680px) {
	.grid3 { grid-template-columns: minmax(0, 1fr); }
	.panel { grid-template-columns: minmax(0, 1fr) !important; }
	.wrap { padding: 24px 16px 40px; }
}
`;

const MARK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ededed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h9a4 4 0 0 1 0 8H9"/><path d="M11.5 11 9 13.5 11.5 16"/><rect x="2.5" y="16.5" width="19" height="5" rx="1.5"/></svg>`;
const WARN = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;
const PAUSE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const SEND = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>`;
const ARROW = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3d3d3d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

export function layout(title: string, body: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

/** GitHuBot's own accent tokens, so a repo's tile matches the product's palette. */
const TILE_COLORS = [
	"#3b82f6",
	"#8b5cf6",
	"#22c55e",
	"#a855f7",
	"#14b8a6",
	"#f59e0b",
	"#ec4899",
	"#0ea5e9",
];

/** Stable per-repository colour: the same repo always gets the same tile. */
function tileColor(slug: string): string {
	let hash = 0;
	for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
	return TILE_COLORS[hash % TILE_COLORS.length] as string;
}

/**
 * Derived from the repository name, not the owner: every repo in a guild usually
 * shares an owner, so owner-initial tiles collide (acme/docs and acme/design-system
 * both render "AD"). Word parts give distinct, recognisable pairs — api-gateway
 * becomes "AG", design-system "DS".
 */
function initials(_owner: string, repo: string): string {
	const parts = repo.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	const letters =
		parts.length > 1
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: (parts[0] ?? repo).slice(0, 2);
	return (letters || "??").toUpperCase();
}

export function relativeTime(date: Date | null, now = Date.now()): string {
	if (!date) return "never";
	const seconds = Math.round((now - date.getTime()) / 1000);
	if (seconds < 60) return seconds <= 1 ? "just now" : `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
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

const DOT: Record<RepoHealth, string> = {
	ok: "#22c55e",
	failing: "#ef4444",
	paused: "#f59e0b",
};

export interface RepoView {
	repo: TrackedRepo;
	channelName: string;
	/** Deliveries per UTC day, oldest first. */
	activity: number[];
}

function navBar(session: DashboardSession, guildId: string | null, trail?: string): string {
	const guild = session.guilds.find((g) => g.id === guildId);
	const chip = guild
		? `<span class="sep">/</span><span class="pill"><span class="mono-tile" style="width:16px;height:16px;border-radius:5px;background:#8b5cf6;font-size:8.5px;color:#fff">${escapeHtml((guild.name[0] ?? "?").toUpperCase())}</span>${escapeHtml(guild.name)}</span>`
		: "";
	const crumb = trail
		? `<span class="sep">/</span><span class="mono sec" style="font-size:13px">${escapeHtml(trail)}</span>`
		: "";
	return `<div class="nav"><div class="navin"><a class="brand" href="/dashboard">${MARK}GitHuBot</a>${chip}${crumb}<div class="grow"></div><span class="sec" style="font-size:13px">${escapeHtml(session.username)}</span><a class="dim" style="font-size:13px" href="/dashboard/logout">Sign out</a></div></div>`;
}

/** Bars are scaled against the busiest day so a quiet repo still shows a shape. */
function sparkline(activity: number[], tone: "green" | "muted"): string {
	const peak = Math.max(1, ...activity);
	const bars = activity
		.map((value, index) => {
			const height = Math.max(8, Math.round((value / peak) * 100));
			const newest = index === activity.length - 1;
			const shade =
				tone === "muted"
					? "#1f1f1f"
					: newest
						? "#22c55e"
						: value / peak > 0.6
							? "#1e4230"
							: "#16241b";
			return `<div style="height:${height}%;background:${shade}"></div>`;
		})
		.join("");
	return `<div class="spark">${bars}</div>`;
}

export function overviewPage(
	session: DashboardSession,
	guildId: string,
	repos: RepoView[],
	metrics: MetricsSnapshot,
): string {
	const attempted = metrics.delivered + metrics.failed;
	const rate = attempted > 0 ? ((metrics.delivered / attempted) * 100).toFixed(1) : "100.0";
	const failingRepos = repos.filter((view) => healthOf(view.repo) === "failing").length;

	// Anything failing sorts first: it is the reason someone opens this page.
	const ordered = [...repos].sort((a, b) => {
		const rank = (v: RepoView) => (healthOf(v.repo) === "failing" ? 0 : 1);
		return rank(a) - rank(b);
	});

	const cards = ordered.map(repoCard).join("") + addCard();

	return layout(
		"GitHuBot",
		`${navBar(session, guildId)}<div class="wrap">
			<div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px;gap:20px;flex-wrap:wrap">
				<div style="display:flex;flex-direction:column;gap:6px">
					<span class="h1">Overview</span>
					<span class="mut" style="font-size:13.5px">Delivery status across ${repos.length} tracked ${repos.length === 1 ? "repository" : "repositories"}</span>
				</div>
				<div class="pill" style="border-radius:100px;padding:7px 12px">
					<span class="dot" style="width:6px;height:6px;background:#22c55e"></span>
					<span class="sec">Online</span><span style="color:#333">·</span>
					<span class="mono">${formatUptime(metrics.uptimeMs)}</span>
				</div>
			</div>

			<div class="panel" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:40px">
				<div class="cell">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="dot" style="width:5px;height:5px;background:#22c55e"></span><span class="klabel">DELIVERED</span></div>
					<div class="kval">${num(metrics.delivered)}</div>
					<div style="display:flex;align-items:center;gap:6px;margin-top:12px">
						<div style="height:3px;flex-grow:1;border-radius:2px;background:#22c55e"></div>
						<span class="mut" style="font-size:11.5px">${rate}%</span>
					</div>
				</div>
				<div class="cell">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="dot" style="width:5px;height:5px;background:${metrics.failed > 0 ? "#ef4444" : "#6e6e6e"}"></span><span class="klabel">FAILED</span></div>
					<div class="kval ${metrics.failed > 0 ? "red" : ""}">${num(metrics.failed)}</div>
					<div style="display:flex;align-items:center;gap:6px;margin-top:12px">
						<div style="height:3px;width:14px;border-radius:2px;background:${metrics.failed > 0 ? "#ef4444" : "#1a1a1a"}"></div>
						<div style="height:3px;flex-grow:1;border-radius:2px;background:#1a1a1a"></div>
						<span class="mut" style="font-size:11.5px">${failingRepos} ${failingRepos === 1 ? "repo" : "repos"}</span>
					</div>
				</div>
				<div class="cell">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="dot" style="width:5px;height:5px;background:#3b82f6"></span><span class="klabel">TODAY</span></div>
					<div class="kval">${num(metrics.deliveredToday)}</div>
					<div class="mut" style="font-size:11.5px;margin-top:13px">delivered since midnight UTC</div>
				</div>
				<div class="cell">
					<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="dot" style="width:5px;height:5px;background:#6e6e6e"></span><span class="klabel">FILTERED</span></div>
					<div class="kval sec">${num(metrics.filtered)}</div>
					<div class="dim" style="display:flex;gap:10px;font-size:11.5px;margin-top:13px">
						<span>${num(metrics.duplicates)} duplicates</span><span style="color:#2a2a2a">·</span><span>${num(metrics.received)} received</span>
					</div>
				</div>
			</div>

			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
				<div style="display:flex;align-items:center;gap:10px"><span class="h2">Repositories</span><span class="count">${repos.length}</span></div>
				<span class="dim" style="font-size:12.5px">Added with <span class="mono sec">/repo</span> in Discord</span>
			</div>
			${repos.length === 0 ? emptyState() : `<div class="grid3">${cards}</div>`}
		</div>`,
	);
}

function repoCard(view: RepoView): string {
	const { repo, channelName, activity } = view;
	const health = healthOf(repo);
	const slug = `${repo.owner}/${repo.repo}`;
	const href = `/dashboard/g/${encodeURIComponent(repo.guildId)}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
	const attempted = repo.deliveredCount + repo.failedCount;

	const marker =
		health === "failing"
			? `<span class="badge fail">FAILING</span>`
			: health === "paused"
				? `<span class="badge pause">PAUSED</span>`
				: `<span class="dot" style="width:7px;height:7px;background:#22c55e;margin-top:4px"></span>`;

	// Two flex-grow segments give the real delivered/failed split without arithmetic in CSS.
	const ratio =
		health === "paused"
			? `<div class="bar"><div style="flex-grow:1;background:#2a2a2a;border-radius:3px"></div></div>`
			: repo.failedCount > 0
				? `<div class="bar"><div style="flex-grow:${repo.deliveredCount};background:#22c55e;border-radius:3px"></div><div style="flex-grow:${repo.failedCount};background:#ef4444;border-radius:3px"></div></div>`
				: `<div class="bar"><div style="flex-grow:1;background:${attempted > 0 ? "#22c55e" : "#1f1f1f"};border-radius:3px"></div></div>`;

	const detail =
		health === "failing" && repo.lastError
			? `<div class="note" style="background:rgba(239,68,68,0.07)">${WARN}<span class="mono" style="font-size:10.5px;color:#f87171;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(repo.lastError)}</span></div>`
			: health === "paused"
				? `<div class="note" style="background:#111"><span class="amber" style="display:flex">${PAUSE}</span><span class="mut" style="font-size:11.5px">Nothing is posted while paused</span></div>`
				: sparkline(activity, "green");

	return `<a class="card repo" href="${href}" style="${health === "failing" ? "border-color:#341b1b;" : ""}${health === "paused" ? "opacity:0.72;" : ""}">
		<div style="display:flex;align-items:flex-start;gap:12px">
			<div class="mono-tile" style="width:34px;height:34px;background:${health === "paused" ? "#2a2a2a" : tileColor(slug)};font-size:12.5px;${health === "paused" ? "color:#8f8f8f;" : ""}">${escapeHtml(initials(repo.owner, repo.repo))}</div>
			<div style="display:flex;flex-direction:column;gap:3px;min-width:0;flex-grow:1">
				<span class="mono" style="font-size:13px;font-weight:500;letter-spacing:-0.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(slug)}</span>
				<span class="dim" style="font-size:12px">#${escapeHtml(channelName)}</span>
			</div>
			${marker}
		</div>
		${ratio}
		<div style="display:flex;align-items:center;justify-content:space-between">
			<span class="mono" style="font-size:12.5px">${num(repo.deliveredCount)}</span>
			<span style="font-size:12px" class="${repo.failedCount > 0 ? "red" : "dim"}">${repo.failedCount > 0 ? `${num(repo.failedCount)} failed` : "no failures"}</span>
		</div>
		${detail}
		<div class="foot">
			<span>${repo.enabledEvents.length} events</span>
			<span class="${health === "failing" ? "red" : ""}">${health === "failing" ? `failed ${relativeTime(repo.lastErrorAt)}` : relativeTime(repo.lastDeliveryAt)}</span>
		</div>
	</a>`;
}

function addCard(): string {
	return `<div style="border:1px dashed #222;border-radius:14px;padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px">
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3d3d3d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
		<span class="dim" style="font-size:12.5px;text-align:center">Track another repository</span>
		<span class="mono" style="font-size:11px;color:#3d3d3d">/repo add</span>
	</div>`;
}

function emptyState(): string {
	return `<div class="card center" style="padding:56px 40px">
		<div style="font-size:20px;font-weight:700;letter-spacing:-0.028em">Nothing tracked here yet</div>
		<div class="sec" style="font-size:13.5px;margin-top:10px;max-width:520px;line-height:1.65">Repositories are added from Discord. This dashboard reads status and can pause or test — it never changes what is tracked.</div>
		<div class="pre" style="margin-top:26px">/repo add repository:owner/repo channel:#changelog</div>
		<div class="dim" style="font-size:12.5px;margin-top:16px">Requires Manage Server.</div>
	</div>`;
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
	meta: "Repository",
};

export function repoDetailPage(
	session: DashboardSession,
	view: RepoView,
	channelNames: Map<string, string>,
	roleNames: Map<string, string>,
	notice: { kind: "ok" | "error"; text: string } | null,
): string {
	const { repo, channelName } = view;
	const health = healthOf(repo);
	const slug = `${repo.owner}/${repo.repo}`;
	const base = `/dashboard/g/${encodeURIComponent(repo.guildId)}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;

	const categories = EVENT_CATEGORIES.map((category) => {
		const all = eventsInCategory(category.id);
		const on = all.filter((event) => repo.enabledEvents.includes(event));
		const pct = Math.round((on.length / all.length) * 100);
		return `<div class="rowitem">
			<span style="font-size:13px;font-weight:500;width:122px;flex-shrink:0${on.length === 0 ? ";color:#6e6e6e" : ""}">${CATEGORY_LABEL[category.id]}</span>
			<div class="track">${on.length > 0 ? `<div style="width:${pct}%;background:${CATEGORY_COLOR[category.id]};border-radius:3px"></div>` : ""}</div>
			<span class="mono" style="font-size:11.5px;width:38px;text-align:right;flex-shrink:0;color:${on.length > 0 ? "#a1a1a1" : "#3d3d3d"}">${on.length}/${all.length}</span>
		</div>`;
	}).join("");

	const routes = Object.entries(repo.eventRoutes);
	const mentions = Object.entries(repo.mentionRules);

	return layout(
		`${slug} · GitHuBot`,
		`${navBar(session, repo.guildId, repo.repo)}<div class="wrap">
			<div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap">
				<div class="mono-tile" style="width:46px;height:46px;border-radius:12px;background:${health === "paused" ? "#2a2a2a" : tileColor(slug)};font-size:16px">${escapeHtml(initials(repo.owner, repo.repo))}</div>
				<div style="display:flex;flex-direction:column;gap:5px;flex-grow:1;min-width:0">
					<div style="display:flex;align-items:center;gap:11px">
						<span class="mono" style="font-size:22px;font-weight:500;letter-spacing:-0.03em">${escapeHtml(slug)}</span>
						${health === "failing" ? '<span class="badge fail">FAILING</span>' : health === "paused" ? '<span class="badge pause">PAUSED</span>' : ""}
					</div>
					<div class="dim" style="display:flex;align-items:center;gap:11px;font-size:12.5px;flex-wrap:wrap">
						<span>#${escapeHtml(channelName)}</span><span style="color:#2a2a2a">·</span>
						<span>${repo.enabledEvents.length} of 48 events</span><span style="color:#2a2a2a">·</span>
						<span class="mono">${escapeHtml(repo.trackingId.slice(0, 12))}…</span>
					</div>
				</div>
				<div style="display:flex;align-items:center;gap:8px">
					<form method="post" action="${base}/${repo.paused ? "resume" : "pause"}" style="margin:0">
						<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
						<button class="btn" type="submit"><span class="sec" style="display:flex">${PAUSE}</span>${repo.paused ? "Resume" : "Pause"}</button>
					</form>
					<form method="post" action="${base}/test" style="margin:0">
						<input type="hidden" name="csrf" value="${escapeHtml(session.csrfToken)}">
						<button class="btn primary" type="submit">${SEND}Send test</button>
					</form>
				</div>
			</div>

			${noticeBanner(notice)}
			${notice ? "" : failureBanner(repo, health, channelName)}

			<div class="panel" style="grid-template-columns:repeat(4,minmax(0,1fr));margin:${notice || health === "failing" ? "28px 0 36px" : "0 0 36px"}">
				<div class="cell" style="padding:20px 24px">
					<div class="klabel" style="margin-bottom:11px">DELIVERED</div>
					<div class="kval green" style="font-size:27px">${num(repo.deliveredCount)}</div>
				</div>
				<div class="cell" style="padding:20px 24px">
					<div class="klabel" style="margin-bottom:11px">FAILED</div>
					<div class="kval ${repo.failedCount > 0 ? "red" : ""}" style="font-size:27px">${num(repo.failedCount)}</div>
				</div>
				<div class="cell" style="padding:20px 24px">
					<div class="klabel" style="margin-bottom:11px">LAST DELIVERY</div>
					<div style="font-size:17px;font-weight:600;letter-spacing:-0.02em" class="${health === "failing" ? "red" : "sec"}">${relativeTime(repo.lastDeliveryAt)}</div>
				</div>
				<div class="cell" style="padding:20px 24px">
					<div class="klabel" style="margin-bottom:11px">LAST SUCCESS</div>
					<div class="sec" style="font-size:17px;font-weight:600;letter-spacing:-0.02em">${relativeTime(repo.lastSuccessAt)}</div>
				</div>
			</div>

			<div class="grid2">
				<div class="card" style="overflow:hidden;display:flex;flex-direction:column">
					<div class="chead"><span class="h3">Events</span><span class="count mono">${repo.enabledEvents.length} / 48</span></div>
					<div style="padding:6px 20px 14px">${categories}</div>
					<div class="foot2" style="margin-top:auto">Change with <span class="mono sec">/repo events ${escapeHtml(slug)}</span></div>
				</div>

				<div style="display:flex;flex-direction:column;gap:20px">
					<div class="card" style="overflow:hidden">
						<div class="chead"><span class="h3">Filters</span></div>
						<div style="padding:16px 20px;display:flex;flex-direction:column;gap:15px">
							${filterRow("Only branches", repo.filters.branchInclude, "inc", "all branches pass")}
							${filterRow("Never branches", repo.filters.branchExclude, "exc", "none")}
							${filterRow("Only labels", repo.filters.labels, "neu", "all labels pass")}
							${filterRow("Ignore authors", repo.filters.ignoredActors, "neu", "none")}
						</div>
						<div class="foot2">Change with <span class="mono sec">/repo filters</span></div>
					</div>

					<div class="card" style="overflow:hidden">
						<div class="chead"><span class="h3">Routing &amp; mentions</span></div>
						<div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px">
							${routes.length === 0 && mentions.length === 0 ? `<span class="dim" style="font-size:12.5px">No overrides or role pings</span>` : ""}
							${routes.map(([key, channelId]) => `<div style="display:flex;align-items:center;gap:10px"><span style="width:8px;height:8px;border-radius:2px;background:${categoryTint(key)};flex-shrink:0"></span><span class="sec" style="font-size:12.5px;flex-grow:1">${escapeHtml(labelFor(key))}</span>${ARROW}<span style="font-size:12.5px">#${escapeHtml(channelNames.get(channelId) ?? channelId)}</span></div>`).join("")}
							${mentions.map(([key, roles]) => `<div style="display:flex;align-items:center;gap:10px${routes.length > 0 ? ";padding-top:13px;border-top:1px solid #161616" : ""}"><span style="width:8px;height:8px;border-radius:2px;background:${categoryTint(key)};flex-shrink:0"></span><span class="sec" style="font-size:12.5px;flex-grow:1">${escapeHtml(labelFor(key))} pings</span><span style="display:flex;gap:6px;flex-wrap:wrap">${roles.map((r) => `<span class="tag" style="background:rgba(139,92,246,0.12);color:#a78bfa;font-family:${SANS}">@${escapeHtml(roleNames.get(r) ?? r)}</span>`).join("")}</span></div>`).join("")}
						</div>
						<div class="foot2">Everything else posts to <span class="sec">#${escapeHtml(channelName)}</span></div>
					</div>

					<div class="card" style="padding:17px 20px;display:flex;align-items:center;gap:24px">
						<div style="display:flex;flex-direction:column;gap:6px">
							<span class="klabel" style="color:#6e6e6e">THEME</span>
							<span class="mono" style="font-size:13px">${escapeHtml(repo.theme ?? "server default")}</span>
						</div>
						<div style="width:1px;height:30px;background:#1f1f1f"></div>
						<div style="display:flex;flex-direction:column;gap:6px">
							<span class="klabel" style="color:#6e6e6e">DENSITY</span>
							<span class="mono" style="font-size:13px">${escapeHtml(repo.displayMode ?? "server default")}</span>
						</div>
					</div>
				</div>
			</div>
		</div>`,
	);
}

/** Routes and mentions are keyed by either a category id or a single event type. */
function categoryTint(key: string): string {
	return CATEGORY_COLOR[key as EventCategoryId] ?? "#6e6e6e";
}

function labelFor(key: string): string {
	return CATEGORY_LABEL[key as EventCategoryId] ?? key;
}

function filterRow(label: string, values: string[], kind: string, empty: string): string {
	const body =
		values.length === 0
			? `<span style="font-size:12px;color:#3d3d3d">${empty}</span>`
			: values.map((v) => `<span class="tag ${kind}">${escapeHtml(v)}</span>`).join("");
	return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="dim" style="font-size:12px;width:96px;flex-shrink:0">${label}</span>${body}</div>`;
}

function noticeBanner(notice: { kind: "ok" | "error"; text: string } | null): string {
	if (!notice) return "";
	return `<div class="banner ${notice.kind === "ok" ? "ok" : ""}"><span style="font-size:13px;color:${notice.kind === "ok" ? "#4ade80" : "#f87171"}">${escapeHtml(notice.text)}</span></div>`;
}

function failureBanner(repo: TrackedRepo, health: RepoHealth, channelName: string): string {
	if (health !== "failing") return "";
	return `<div class="banner">${WARN}<div style="display:flex;flex-direction:column;gap:7px;flex-grow:1">
		<span style="font-size:13.5px;font-weight:700;color:#f87171">Deliveries are failing</span>
		<span class="sec" style="font-size:13px;line-height:1.6">Receiving from GitHub but cannot post to the channel. Grant <span class="mono" style="color:#ededed">View Channel</span> and <span class="mono" style="color:#ededed">Send Messages</span> on <span class="mono" style="color:#ededed">#${escapeHtml(channelName)}</span>, or move it with <span class="mono" style="color:#ededed">/repo channel ${escapeHtml(repo.owner)}/${escapeHtml(repo.repo)}</span>.</span>
		${repo.lastError ? `<div style="display:inline-flex;align-self:flex-start;padding:7px 11px;background:#0d0d0d;border:1px solid #1f1f1f;border-radius:7px;margin-top:3px"><span class="mono" style="font-size:11.5px;color:#f87171">${escapeHtml(repo.lastError)}</span></div>` : ""}
	</div></div>`;
}

export function signInPage(): string {
	return layout(
		"Sign in · GitHuBot",
		`<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px">
			<div class="card center" style="width:420px;border-radius:16px;padding:48px 40px">
				<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ededed" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5h9a4 4 0 0 1 0 8H9"/><path d="M11.5 11 9 13.5 11.5 16"/><rect x="2.5" y="16.5" width="19" height="5" rx="1.5"/></svg>
				<div style="font-size:22px;font-weight:700;letter-spacing:-0.032em;margin-top:20px">Sign in to GitHuBot</div>
				<div class="sec" style="font-size:13.5px;margin-top:8px;line-height:1.6">Delivery status for the servers you manage.</div>
				<a class="discord" style="margin-top:30px" href="/dashboard/login">Continue with Discord</a>
				<div class="dim" style="font-size:12.5px;margin-top:20px;line-height:1.65">Only servers where you have <span class="sec">Manage&nbsp;Server</span> are shown. The dashboard never posts on your behalf.</div>
			</div>
		</div>`,
	);
}

export function notConfiguredPage(missing: string[]): string {
	return layout(
		"Dashboard is off · GitHuBot",
		`<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px">
			<div class="card center" style="width:460px;border-radius:16px;padding:48px 40px">
				<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>
				<div style="font-size:22px;font-weight:700;letter-spacing:-0.032em;margin-top:20px">Dashboard is off</div>
				<div class="sec" style="font-size:13.5px;margin-top:8px;line-height:1.6">The bot is running normally. This is optional and stays disabled until configured.</div>
				<div class="pre" style="width:100%;margin-top:26px">${missing.map((key) => `${escapeHtml(key)}=…`).join("<br>")}</div>
				<div class="dim" style="font-size:12.5px;margin-top:18px;line-height:1.65">Add <span class="mono sec">&lt;DASHBOARD_BASE_URL&gt;/dashboard/auth/callback</span> as a redirect URI, then restart.</div>
			</div>
		</div>`,
	);
}

export function errorPage(status: number, message: string): string {
	return layout(
		`${status} · GitHuBot`,
		`<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px">
			<div class="card center" style="width:420px;border-radius:16px;padding:48px 40px">
				<div class="mono dim" style="font-size:13px">${status}</div>
				<div style="font-size:19px;font-weight:700;letter-spacing:-0.025em;margin-top:10px">${escapeHtml(message)}</div>
				<a class="btn" style="margin-top:24px" href="/dashboard">Back to overview</a>
			</div>
		</div>`,
	);
}
