import { DISPLAY_MODES, type DisplayMode } from "../bot/render/template.js";
import { THEME_IDS, type ThemeId } from "../bot/render/theme.js";
import {
	EVENT_CATEGORIES,
	EVENT_TYPES,
	type EventType,
	eventsInCategory,
} from "../config/events.js";
import {
	type AuditEntry,
	DELIVERY_OUTCOMES,
	type DeliveryLogEntry,
	type DeliveryOutcome,
	type GuildSettings,
	type TrackedRepo,
} from "../db/types.js";
import {
	type AppLocale,
	categoryLabel,
	eventDescription,
	eventLabel,
	SUPPORTED_LOCALES,
} from "../i18n/index.js";
import { VERSION } from "../version.js";
import { ASSETS } from "./assets.js";
import type { DirectoryChannel, GuildDirectory } from "./directory.js";
import { escapeHtml } from "./html.js";
import type { DashboardSession } from "./session.js";

export { escapeHtml } from "./html.js";

/**
 * Server-rendered so the dashboard needs no build step, no bundler and no CDN.
 * Nothing here emits a `style` attribute or an inline script: the stylesheet and
 * the one script are separate files, which is what lets the CSP forbid both.
 */

/** Days drawn in the activity charts. */
export const ACTIVITY_DAYS = 30;
/** Days the headline numbers look back over. */
export const SUMMARY_DAYS = 7;
/** Rows per page of the delivery log. */
export const LOG_PAGE_SIZE = 50;

const esc = escapeHtml;

// ------------------------------------------------------------------- icons --

function svg(paths: string, size = 16): string {
	return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const ICON = {
	mark: (size = 20) =>
		svg(
			'<path d="M4 5.5h9a4 4 0 0 1 0 8H9"/><path d="M11.5 11 9 13.5 11.5 16"/><rect x="2.5" y="16.5" width="19" height="5" rx="1.5"/>',
			size,
		),
	home: svg('<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/>'),
	repo: svg('<path d="M5 4h13a1 1 0 0 1 1 1v15H6a2 2 0 0 1 0-4h13"/><path d="M5 4v14"/>'),
	pulse: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
	gear: svg(
		'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
	),
	plus: svg('<path d="M12 5v14M5 12h14"/>'),
	pause: svg(
		'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
	),
	play: svg('<path d="m7 4 13 8-13 8z"/>'),
	send: svg('<path d="m22 2-7 20-4-9-9-4z"/>'),
	alert: svg(
		'<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
	),
	check: svg('<path d="m5 12 5 5L20 7"/>'),
	info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
	chevron: svg('<path d="m6 9 6 6 6-6"/>', 14),
	out: svg('<path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9"/>'),
	clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
	hash: svg('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>', 14),
};

// ----------------------------------------------------------------- helpers --

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

function plural(count: number, one: string, many = `${one}s`): string {
	return `${num(count)} ${count === 1 ? one : many}`;
}

/** Relative for reading, exact on hover and for assistive technology. */
function when(date: Date | null): string {
	if (!date) return '<span class="faint">never</span>';
	const iso = date.toISOString();
	return `<time datetime="${iso}" title="${iso.replace("T", " ").slice(0, 19)} UTC">${relativeTime(date)}</time>`;
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

function healthBadge(health: RepoHealth): string {
	if (health === "failing") return '<span class="badge bad"><i></i>Failing</span>';
	if (health === "paused") return '<span class="badge warn"><i></i>Paused</span>';
	return '<span class="badge ok"><i></i>Healthy</span>';
}

/** Stable per-name colour: the same repository or server always gets the same tile. */
function tileClass(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
	return `t${hash % 8}`;
}

/**
 * From the repository name, not the owner: every repo in a server usually shares
 * an owner, so owner initials collide. `api-gateway` becomes "AG".
 */
function initials(name: string): string {
	const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	const letters =
		parts.length > 1
			? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
			: (parts[0] ?? name).slice(0, 2);
	return (letters || "?").toUpperCase();
}

function tile(name: string, options: { large?: boolean; off?: boolean } = {}): string {
	const classes = ["tile", options.off ? "off" : tileClass(name), options.large ? "lg" : ""];
	return `<span class="${classes.filter(Boolean).join(" ")}" aria-hidden="true">${esc(initials(name))}</span>`;
}

export function guildPath(guildId: string, rest = ""): string {
	return `/dashboard/g/${encodeURIComponent(guildId)}${rest}`;
}

export function repoPath(repo: Pick<TrackedRepo, "guildId" | "owner" | "repo">, rest = ""): string {
	return `${guildPath(repo.guildId)}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}${rest}`;
}

function slugOf(repo: TrackedRepo): string {
	return `${repo.owner}/${repo.repo}`;
}

function csrfField(session: DashboardSession): string {
	return `<input type="hidden" name="csrf" value="${esc(session.csrfToken)}">`;
}

function options<T extends string>(
	entries: readonly { value: T | ""; label: string }[],
	selected: string | null | undefined,
): string {
	return entries
		.map(
			(entry) =>
				`<option value="${esc(entry.value)}"${entry.value === (selected ?? "") ? " selected" : ""}>${esc(entry.label)}</option>`,
		)
		.join("");
}

// ------------------------------------------------------------------ charts --

/** Bars scaled against the busiest day, so a quiet repository still shows a shape. */
function barChart(values: number[], mini = false): string {
	const peak = Math.max(1, ...values);
	const height = mini ? 24 : 120;
	const step = 10;
	const bars = values
		.map((value, index) => {
			const bar = value === 0 ? 2 : Math.max(3, Math.round((value / peak) * height));
			const cls = value === 0 ? "zero" : index === values.length - 1 ? "hot" : "";
			const daysAgo = values.length - 1 - index;
			const label = `${num(value)} ${value === 1 ? "delivery" : "deliveries"}, ${daysAgo === 0 ? "today" : `${daysAgo}d ago`}`;
			return `<rect${cls ? ` class="${cls}"` : ""} x="${index * step + 1}" y="${height - bar}" width="${step - 2}" height="${bar}" rx="1.5"><title>${label}</title></rect>`;
		})
		.join("");
	const total = values.reduce((sum, value) => sum + value, 0);
	return `<svg class="chart${mini ? " mini" : ""}" viewBox="0 0 ${values.length * step} ${height}" preserveAspectRatio="none" role="img" aria-label="${num(total)} deliveries over ${values.length} days">${bars}</svg>`;
}

/** Delivered against failed, as one bar. */
function meter(delivered: number, failed: number): string {
	const total = delivered + failed;
	const ok = total === 0 ? 0 : Math.round((delivered / total) * 100);
	return `<svg class="meter" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="trk" width="100" height="6" rx="3"/>${total > 0 ? `<rect class="okf" width="${ok}" height="6" rx="3"/>${failed > 0 ? `<rect class="badf" x="${ok}" width="${100 - ok}" height="6" rx="3"/>` : ""}` : ""}</svg>`;
}

// ------------------------------------------------------------------- shell --

export type NavId = "overview" | "repos" | "activity" | "history" | "settings";

export interface Shell {
	session: DashboardSession;
	guildId: string;
	active: NavId;
	/** Counts for the sidebar badges. */
	repoCount: number;
	failingCount: number;
}

export interface Notice {
	kind: "ok" | "bad" | "warn" | "info";
	text: string;
}

function document_(title: string, body: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="dark light"><title>${esc(title)}</title><link rel="stylesheet" href="${ASSETS.css.path}"></head><body>${body}<script src="${ASSETS.js.path}" defer></script></body></html>`;
}

function sidebar(shell: Shell): string {
	const { session, guildId, active } = shell;
	const current = session.guilds.find((guild) => guild.id === guildId);
	const name = current?.name ?? "Unknown server";

	const servers = session.guilds
		.map(
			(guild) =>
				`<a href="${guildPath(guild.id)}"${guild.id === guildId ? ' aria-current="true"' : ""}>${tile(guild.name)}<span class="truncate">${esc(guild.name)}</span></a>`,
		)
		.join("");

	const link = (id: NavId, href: string, icon: string, label: string, badge = "") =>
		`<a href="${href}"${active === id ? ' aria-current="page"' : ""}>${icon}<span>${label}</span>${badge}</a>`;

	const avatar = session.avatarUrl
		? `<img class="avatar" src="${esc(session.avatarUrl)}" alt="" width="28" height="28" referrerpolicy="no-referrer">`
		: tile(session.username);

	return `<aside class="side">
		<a class="brand" href="/dashboard">${ICON.mark()}<span>GitHuBot</span><span class="ver">v${esc(VERSION)}</span></a>
		<details class="switch">
			<summary>${tile(name)}<span class="truncate grow">${esc(name)}</span>${ICON.chevron}</summary>
			<div class="menu">${servers}</div>
		</details>
		<nav class="nav" aria-label="Server">
			<div class="navlabel">Server</div>
			${link("overview", guildPath(guildId), ICON.home, "Overview")}
			${link(
				"repos",
				guildPath(guildId, "/repos"),
				ICON.repo,
				"Repositories",
				shell.failingCount > 0
					? `<span class="n bad" title="${plural(shell.failingCount, "repository", "repositories")} failing">${shell.failingCount}</span>`
					: `<span class="n">${shell.repoCount}</span>`,
			)}
			${link("activity", guildPath(guildId, "/activity"), ICON.pulse, "Deliveries")}
			${link("history", guildPath(guildId, "/history"), ICON.clock, "History")}
			${link("settings", guildPath(guildId, "/settings"), ICON.gear, "Settings")}
		</nav>
		<div class="foot">
			${avatar}
			<span class="truncate grow">${esc(session.username)}</span>
			<form class="inline" method="post" action="/dashboard/logout">${csrfField(session)}<button class="btn ghost sm" type="submit" title="Sign out">${ICON.out}<span class="sr">Sign out</span></button></form>
		</div>
	</aside>`;
}

function page(shell: Shell, title: string, body: string): string {
	return document_(
		`${title} · GitHuBot`,
		`<div class="app">${sidebar(shell)}<main class="main"><div class="page">${body}</div></main></div>`,
	);
}

function banner(notice: Notice | null, title?: string): string {
	if (!notice) return "";
	const icon = notice.kind === "ok" ? ICON.check : notice.kind === "info" ? ICON.info : ICON.alert;
	return `<div class="banner ${notice.kind}" role="status"><span class="${notice.kind === "info" ? "" : notice.kind}">${icon}</span><div>${title ? `<div class="t">${esc(title)}</div>` : ""}<div>${esc(notice.text)}</div></div></div>`;
}

function header(title: string, sub: string, actions = ""): string {
	return `<div class="head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${actions ? `<div class="row wrap">${actions}</div>` : ""}</div>`;
}

const LIVE_PILL = '<span class="live" title="Status refreshes every 20 seconds"><i></i>Live</span>';

// --------------------------------------------------------------- log table --

const OUTCOME: Record<DeliveryOutcome, { label: string; tone: string }> = {
	delivered: { label: "Delivered", tone: "ok" },
	filtered: { label: "Filtered", tone: "dim" },
	disabled: { label: "Event off", tone: "dim" },
	paused: { label: "Paused", tone: "warn" },
	no_message: { label: "Nothing to post", tone: "dim" },
	unsupported: { label: "Unsupported", tone: "dim" },
	ping: { label: "Ping", tone: "info" },
	bad_channel: { label: "Channel unusable", tone: "bad" },
	failed: { label: "Failed", tone: "bad" },
};

const OUTCOME_HELP: Partial<Record<DeliveryOutcome, string>> = {
	disabled: "This event type is switched off for the repository.",
	no_message:
		"The event carried nothing worth a message, such as an action GitHuBot does not announce.",
	unsupported: "GitHuBot has no message for this GitHub event.",
	ping: "GitHub's handshake when a webhook is created. It confirms the secret matches.",
	paused: "The repository was paused, so nothing was posted.",
};

const FILTER_DETAIL: Record<string, string> = {
	branch: "branch filter",
	label: "label filter",
	actor: "ignored author",
};

function logTable(
	rows: DeliveryLogEntry[],
	repos: Map<string, TrackedRepo> | null,
	emptyText: string,
): string {
	if (rows.length === 0) {
		return `<div class="empty"><p>${esc(emptyText)}</p></div>`;
	}
	const body = rows
		.map((row) => {
			const outcome = OUTCOME[row.outcome];
			const repo = repos?.get(row.trackingId);
			const detail =
				row.outcome === "filtered" && row.detail
					? (FILTER_DETAIL[row.detail] ?? row.detail)
					: (row.detail ?? OUTCOME_HELP[row.outcome] ?? "");
			return `<tr>
				<td class="tight muted">${when(row.createdAt)}</td>
				${repos ? `<td>${repo ? `<a class="link" href="${repoPath(repo)}">${esc(slugOf(repo))}</a>` : '<span class="faint">removed</span>'}</td>` : ""}
				<td><span class="mono">${esc(row.event)}</span>${row.action ? `<span class="faint mono">.${esc(row.action)}</span>` : ""}</td>
				<td class="tight"><span class="badge ${outcome.tone}">${outcome.label}</span></td>
				<td class="muted">${esc(detail)}</td>
			</tr>`;
		})
		.join("");
	return `<div class="scroll"><table class="table"><thead><tr><th>When</th>${repos ? "<th>Repository</th>" : ""}<th>Event</th><th>Outcome</th><th>Detail</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

const OUTCOME_OPTIONS = [
	{ value: "" as const, label: "All outcomes" },
	...DELIVERY_OUTCOMES.map((value) => ({ value, label: OUTCOME[value].label })),
];

// ---------------------------------------------------------------- overview --

export interface RepoView {
	repo: TrackedRepo;
	channelName: string;
	/** Deliveries per UTC day, oldest first. */
	activity: number[];
}

export interface OverviewData {
	repos: RepoView[];
	/** Outcome totals over the last `SUMMARY_DAYS` days. */
	counts: Partial<Record<DeliveryOutcome, number>>;
	recent: DeliveryLogEntry[];
	uptimeMs: number;
	notice: Notice | null;
}

export function summarize(counts: Partial<Record<DeliveryOutcome, number>>) {
	const delivered = counts.delivered ?? 0;
	const failed = (counts.failed ?? 0) + (counts.bad_channel ?? 0);
	const skipped =
		(counts.filtered ?? 0) +
		(counts.disabled ?? 0) +
		(counts.paused ?? 0) +
		(counts.no_message ?? 0) +
		(counts.unsupported ?? 0);
	const attempted = delivered + failed;
	return {
		delivered,
		failed,
		skipped,
		rate: attempted === 0 ? null : (delivered / attempted) * 100,
	};
}

function sumActivity(repos: RepoView[]): number[] {
	const total = new Array<number>(ACTIVITY_DAYS).fill(0);
	for (const view of repos) {
		view.activity.forEach((value, index) => {
			total[index] = (total[index] ?? 0) + value;
		});
	}
	return total;
}

function chartAxis(): string {
	return `<div class="axis"><span>${ACTIVITY_DAYS} days ago</span><span>today</span></div>`;
}

export function overviewPage(shell: Shell, data: OverviewData): string {
	const { repos } = data;
	const summary = summarize(data.counts);
	const byTracking = new Map(repos.map((view) => [view.repo.trackingId, view.repo]));
	const attention = repos.filter(
		(view) => healthOf(view.repo) !== "ok" || view.repo.observedFullName,
	);
	const activity = sumActivity(repos);

	const stats = `<div class="grid c4" id="stats" data-live>
		<div class="card stat"><div class="k">Repositories</div><div class="v">${num(repos.length)}</div><div class="d">${shell.failingCount > 0 ? `<span class="bad">${shell.failingCount} failing</span>` : "none failing"}</div></div>
		<div class="card stat"><div class="k">Delivered · ${SUMMARY_DAYS}d</div><div class="v ok">${num(summary.delivered)}</div><div class="d">${summary.rate === null ? "no attempts yet" : `${summary.rate.toFixed(1)}% success`}</div></div>
		<div class="card stat"><div class="k">Failed · ${SUMMARY_DAYS}d</div><div class="v${summary.failed > 0 ? " bad" : ""}">${num(summary.failed)}</div><div class="d">could not reach the channel</div></div>
		<div class="card stat"><div class="k">Skipped · ${SUMMARY_DAYS}d</div><div class="v">${num(summary.skipped)}</div><div class="d">filtered, paused or switched off</div></div>
	</div>`;

	const needs =
		attention.length === 0
			? ""
			: `<div class="card"><div class="hd"><h2>Needs attention</h2><span class="badge warn">${attention.length}</span></div><div class="list">${attention
					.map(({ repo }) => {
						const health = healthOf(repo);
						const why =
							health === "failing"
								? esc(repo.lastError ?? "The last delivery failed")
								: health === "paused"
									? "Paused — GitHub keeps sending, nothing is posted"
									: `GitHub reports this webhook as <span class="mono">${esc(repo.observedFullName ?? "")}</span>`;
						return `<a href="${repoPath(repo)}">${tile(repo.repo, { off: health === "paused" })}<span class="stack tight grow"><span class="name mono truncate">${esc(slugOf(repo))}</span><span class="muted">${why}</span></span>${health === "ok" ? '<span class="badge warn"><i></i>Renamed</span>' : healthBadge(health)}</a>`;
					})
					.join("")}</div></div>`;

	const body =
		repos.length === 0
			? emptyRepos(shell)
			: `${stats}
			<div class="grid c2">
				<div class="stack">
					<div class="card"><div class="hd"><h2>Deliveries received</h2><span class="muted">${num(activity.reduce((a, b) => a + b, 0))} in ${ACTIVITY_DAYS} days</span></div><div class="bd" id="chart" data-live>${barChart(activity)}${chartAxis()}</div></div>
					<div class="card"><div class="hd"><h2>Recent deliveries</h2><a class="link" href="${guildPath(shell.guildId, "/activity")}">View all</a></div><div id="recent" data-live>${logTable(data.recent, byTracking, "Nothing has arrived yet. Deliveries appear here as GitHub sends them.")}</div></div>
				</div>
				<div class="stack">
					<div id="attention" data-live>${needs}</div>
					<div class="card"><div class="hd"><h2>Busiest repositories</h2></div><div class="scroll"><table class="table"><tbody>${[
						...repos,
					]
						.sort((a, b) => total(b.activity) - total(a.activity))
						.slice(0, 6)
						.map(
							(view) =>
								`<tr><td><a class="cell" href="${repoPath(view.repo)}">${tile(view.repo.repo)}<span class="name mono truncate">${esc(slugOf(view.repo))}</span></a></td><td class="tight">${barChart(view.activity.slice(-14), true)}</td><td class="num tight muted">${num(total(view.activity))}</td></tr>`,
						)
						.join("")}</tbody></table></div></div>
					<div class="card"><div class="bd stack tight"><div class="row between"><span class="muted">Bot uptime</span><span class="mono">${formatUptime(data.uptimeMs)}</span></div><div class="row between"><span class="muted">Version</span><span class="mono">${esc(VERSION)}</span></div><div class="row between"><span class="muted">Delivery log kept for</span><span class="mono">30 days</span></div></div></div>
				</div>
			</div>`;

	return page(
		shell,
		"Overview",
		`${header("Overview", `Delivery status across ${plural(repos.length, "tracked repository", "tracked repositories")}`, `${LIVE_PILL}<a class="btn primary" href="${guildPath(shell.guildId, "/repos/new")}">${ICON.plus}Add repository</a>`)}
		<div class="stack">${banner(data.notice)}${body}</div>`,
	);
}

function total(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

function emptyRepos(shell: Shell): string {
	return `<div class="card empty"><h2>Nothing tracked here yet</h2><p>Add a repository, paste the webhook URL and secret into its GitHub settings, and its activity starts arriving in the channel you pick.</p><a class="btn primary" href="${guildPath(shell.guildId, "/repos/new")}">${ICON.plus}Add repository</a></div>`;
}

// ------------------------------------------------------------ repositories --

const STATUS_OPTIONS = [
	{ value: "" as const, label: "All statuses" },
	{ value: "ok" as const, label: "Healthy" },
	{ value: "failing" as const, label: "Failing" },
	{ value: "paused" as const, label: "Paused" },
];

export function reposPage(
	shell: Shell,
	repos: RepoView[],
	filter: { q: string; status: string },
	notice: Notice | null,
): string {
	const needle = filter.q.trim().toLowerCase();
	// Failing first: it is the reason someone opens this page.
	const rank: Record<RepoHealth, number> = { failing: 0, paused: 1, ok: 2 };
	const ordered = [...repos].sort(
		(a, b) =>
			rank[healthOf(a.repo)] - rank[healthOf(b.repo)] ||
			slugOf(a.repo).localeCompare(slugOf(b.repo)),
	);
	const visible = (view: RepoView) =>
		(!needle || `${slugOf(view.repo)} ${view.channelName}`.toLowerCase().includes(needle)) &&
		(!filter.status || healthOf(view.repo) === filter.status);
	const shown = ordered.filter(visible).length;

	const rows = ordered
		.map((view) => {
			const { repo } = view;
			const health = healthOf(repo);
			return `<tr data-row data-search="${esc(`${slugOf(repo)} ${view.channelName}`.toLowerCase())}" data-status="${health}"${visible(view) ? "" : ' class="hidden"'}>
				<td><a class="cell" href="${repoPath(repo)}">${tile(repo.repo, { off: health === "paused" })}<span class="stack tight"><span class="name mono">${esc(slugOf(repo))}</span><span class="faint">#${esc(view.channelName)} · ${plural(repo.enabledEvents.length, "event")}</span></span></a></td>
				<td class="tight">${healthBadge(health)}</td>
				<td class="tight">${barChart(view.activity.slice(-14), true)}</td>
				<td class="num tight">${num(repo.deliveredCount)}</td>
				<td class="num tight${repo.failedCount > 0 ? " bad" : " faint"}">${num(repo.failedCount)}</td>
				<td class="tight muted">${when(repo.lastDeliveryAt)}</td>
			</tr>`;
		})
		.join("");

	const table =
		repos.length === 0
			? emptyRepos(shell)
			: `<form class="toolbar" method="get" action="${guildPath(shell.guildId, "/repos")}" data-filter role="search">
				<input type="search" name="q" value="${esc(filter.q)}" placeholder="Filter by name or channel" aria-label="Filter repositories">
				<select name="status" aria-label="Status">${options(STATUS_OPTIONS, filter.status)}</select>
				<button class="btn" type="submit">Filter</button>
			</form>
			<div class="card"><div class="scroll" id="repos" data-live><table class="table"><thead><tr><th>Repository</th><th>Status</th><th>14 days</th><th class="num">Delivered</th><th class="num">Failed</th><th>Last delivery</th></tr></thead><tbody>${rows}</tbody></table></div>
			<div class="empty${shown === 0 ? "" : " hidden"}" data-none><p>No repository matches that filter.</p></div></div>`;

	return page(
		shell,
		"Repositories",
		`${header("Repositories", `<span data-count>${shown}</span> of ${num(repos.length)} shown`, `${LIVE_PILL}<a class="btn primary" href="${guildPath(shell.guildId, "/repos/new")}">${ICON.plus}Add repository</a>`)}
		<div class="stack">${banner(notice)}${table}</div>`,
	);
}

// ------------------------------------------------------------ channel pick --

const KIND_LABEL: Record<DirectoryChannel["kind"], string> = {
	text: "#",
	announcement: "📣 ",
	forum: "🗂 ",
	thread: "↳ ",
};

/**
 * A picker when the bot can see the server's channels; otherwise a plain id field,
 * so the form still works while Discord's cache is warming up.
 */
function channelSelect(
	name: string,
	directory: GuildDirectory,
	selected: string | null,
	empty: string | null,
): string {
	if (!directory.available || directory.channels.length === 0) {
		return `<input class="mono" type="text" name="${name}" value="${esc(selected ?? "")}" inputmode="numeric" pattern="\\d{17,20}" placeholder="Channel ID"${empty === null ? " required" : ""}>`;
	}
	const known = directory.channels.some((channel) => channel.id === selected);
	const entries = [
		...(empty === null ? [] : [{ value: "" as const, label: empty }]),
		// Keep a saved channel the bot can no longer see selectable, rather than
		// silently switching the setting to the first option on the next save.
		...(selected && !known ? [{ value: selected, label: `Unknown channel (${selected})` }] : []),
		...directory.channels.map((channel) => ({
			value: channel.id,
			label: `${KIND_LABEL[channel.kind]}${channel.name}`,
		})),
	];
	return `<select name="${name}"${empty === null ? " required" : ""}>${options(entries, selected)}</select>`;
}

// ------------------------------------------------------------- new repo ----

export function newRepoPage(
	shell: Shell,
	directory: GuildDirectory,
	values: { repository: string; channel: string },
	error: string | null,
): string {
	return page(
		shell,
		"Add repository",
		`<div class="crumbs"><a href="${guildPath(shell.guildId, "/repos")}">Repositories</a><span>/</span><span>Add</span></div>
		${header("Add a repository", "GitHuBot never signs in to GitHub. You add a webhook on the repository and it sends events here.")}
		<div class="stack">
			${error ? banner({ kind: "bad", text: error }) : ""}
			<form class="card" method="post" action="${guildPath(shell.guildId, "/repos/new")}">
				${csrfField(shell.session)}
				<div class="bd fields">
					<label class="f"><span>Repository</span><input class="mono" type="text" name="repository" value="${esc(values.repository)}" placeholder="owner/repo" pattern="[A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+" required autofocus autocomplete="off" spellcheck="false"><small>Exactly as it appears in the GitHub URL.</small></label>
					<label class="f"><span>Channel</span>${channelSelect("channel", directory, values.channel || null, null)}<small>Where its messages are posted. Categories can be routed elsewhere later.</small></label>
				</div>
				<div class="ft"><span class="hint">Starts with pushes, branches, pull requests, issues and releases switched on.</span><div class="row"><a class="btn" href="${guildPath(shell.guildId, "/repos")}">Cancel</a><button class="btn primary" type="submit">Add repository</button></div></div>
			</form>
		</div>`,
	);
}

// --------------------------------------------------------------- repo page --

export const REPO_TABS = [
	"overview",
	"events",
	"filters",
	"routing",
	"appearance",
	"webhook",
	"deliveries",
] as const;
export type RepoTab = (typeof REPO_TABS)[number];

export function isRepoTab(value: unknown): value is RepoTab {
	return typeof value === "string" && (REPO_TABS as readonly string[]).includes(value);
}

const TAB_LABEL: Record<RepoTab, string> = {
	overview: "Overview",
	events: "Events",
	filters: "Filters",
	routing: "Channels & mentions",
	appearance: "Appearance",
	webhook: "Webhook",
	deliveries: "Deliveries",
};

export interface RepoPageData {
	view: RepoView;
	tab: RepoTab;
	directory: GuildDirectory;
	settings: GuildSettings | null;
	/** What the repository's messages currently look like, after inheritance. */
	effective: { theme: ThemeId; mode: DisplayMode; locale: AppLocale };
	log: DeliveryLogEntry[];
	logFilter: { outcome: string; nextBefore: number | null };
	webhookUrl: string;
	/** Present only on the response to an explicit reveal, add or rotation. */
	secret: string | null;
	previewHtml: string;
	notice: Notice | null;
}

export function repoPage(shell: Shell, data: RepoPageData): string {
	const { view, tab } = data;
	const { repo } = view;
	const health = healthOf(repo);
	const slug = slugOf(repo);

	const tabs = REPO_TABS.map(
		(id) =>
			`<a href="${repoPath(repo, id === "overview" ? "" : `?tab=${id}`)}"${id === tab ? ' aria-current="page"' : ""}>${TAB_LABEL[id]}</a>`,
	).join("");

	const actions = `<form class="inline" method="post" action="${repoPath(repo, repo.paused ? "/resume" : "/pause")}">${csrfField(shell.session)}<button class="btn" type="submit">${repo.paused ? `${ICON.play}Resume` : `${ICON.pause}Pause`}</button></form>
		<a class="btn" href="https://github.com/${esc(slug)}" rel="noreferrer noopener" target="_blank">Open on GitHub</a>`;

	const content = {
		overview: () => overviewTab(shell, data),
		events: () => eventsTab(shell, repo),
		filters: () => filtersTab(shell, repo),
		routing: () => routingTab(shell, data),
		appearance: () => appearanceTab(shell, data),
		webhook: () => webhookTab(shell, data),
		deliveries: () => deliveriesTab(data),
	}[tab]();

	return page(
		shell,
		slug,
		`<div class="crumbs"><a href="${guildPath(repo.guildId, "/repos")}">Repositories</a><span>/</span><span class="mono">${esc(slug)}</span></div>
		<div class="head">
			<div class="row top">${tile(repo.repo, { large: true, off: health === "paused" })}<div><h1 class="mono">${esc(slug)}</h1><div class="sub row wrap" id="status" data-live>${healthBadge(health)}<span>#${esc(view.channelName)}</span><span class="faint">·</span><span>${repo.enabledEvents.length} of ${EVENT_TYPES.length} events</span><span class="faint">·</span><span>last delivery ${when(repo.lastDeliveryAt)}</span></div></div></div>
			<div class="row wrap">${tab === "overview" || tab === "deliveries" ? LIVE_PILL : ""}${actions}</div>
		</div>
		<nav class="tabs" aria-label="Repository">${tabs}</nav>
		<div class="stack">${banner(data.notice)}${content}</div>`,
	);
}

function failureBanner(view: RepoView): string {
	const { repo } = view;
	if (healthOf(repo) !== "failing") return "";
	return `<div class="banner bad"><span class="bad">${ICON.alert}</span><div class="stack tight"><div class="t">Deliveries are failing</div><div>GitHub is sending, but the message cannot be posted. Give the bot <b>View Channel</b> and <b>Send Messages</b> in <b>#${esc(view.channelName)}</b>, or pick another channel under <a class="link" href="${repoPath(repo, "?tab=routing")}">Channels &amp; mentions</a>. Then use <b>Redeliver</b> on GitHub to post what was missed.</div>${repo.lastError ? `<div><code>${esc(repo.lastError)}</code></div>` : ""}</div></div>`;
}

/** GitHub named a different repository in a verified delivery; see `observedFullName`. */
function renameBanner(repo: TrackedRepo): string {
	if (!repo.observedFullName) return "";
	return `<div class="banner warn"><span class="warn">${ICON.alert}</span><div class="stack tight"><div class="t">GitHub reports a different repository</div><div>Deliveries arrive as <code>${esc(repo.observedFullName)}</code>, not <code>${esc(slugOf(repo))}</code>. If the repository was renamed or transferred, messages still post normally and only the name here is out of date. If the webhook was added to the wrong repository, delete it there.</div></div></div>`;
}

const EVENT_OPTIONS = EVENT_TYPES.map((event) => ({ value: event, label: event }));

function overviewTab(shell: Shell, data: RepoPageData): string {
	const { view } = data;
	const { repo } = view;
	const routes = Object.keys(repo.eventRoutes).length;
	const mentions = Object.keys(repo.mentionRules).length;
	const filters =
		repo.filters.branchInclude.length +
		repo.filters.branchExclude.length +
		repo.filters.labels.length +
		repo.filters.ignoredActors.length;

	const summaryRow = (label: string, value: string, tab: RepoTab) =>
		`<tr><td class="muted">${label}</td><td>${value}</td><td class="tight"><a class="link" href="${repoPath(repo, `?tab=${tab}`)}">Edit</a></td></tr>`;

	return `${failureBanner(view)}${renameBanner(repo)}
	<div class="grid c4" id="stats" data-live>
		<div class="card stat"><div class="k">Delivered</div><div class="v ok">${num(repo.deliveredCount)}</div><div class="d">${meter(repo.deliveredCount, repo.failedCount)}</div></div>
		<div class="card stat"><div class="k">Failed</div><div class="v${repo.failedCount > 0 ? " bad" : ""}">${num(repo.failedCount)}</div><div class="d">since it was added</div></div>
		<div class="card stat"><div class="k">Last success</div><div class="v">${when(repo.lastSuccessAt)}</div><div class="d">last message posted</div></div>
		<div class="card stat"><div class="k">Received · ${ACTIVITY_DAYS}d</div><div class="v">${num(total(view.activity))}</div><div class="d">deliveries from GitHub</div></div>
	</div>
	<div class="grid c2">
		<div class="stack">
			<div class="card"><div class="hd"><h2>Deliveries received</h2></div><div class="bd" id="chart" data-live>${barChart(view.activity)}${chartAxis()}</div></div>
			<div class="card"><div class="hd"><h2>Recent deliveries</h2><a class="link" href="${repoPath(repo, "?tab=deliveries")}">View all</a></div><div id="recent" data-live>${logTable(data.log.slice(0, 8), null, "Nothing has arrived yet. Add the webhook on GitHub and its ping shows up here.")}</div></div>
		</div>
		<div class="stack">
			<form class="card" method="post" action="${repoPath(repo, "/test")}">
				${csrfField(shell.session)}
				<div class="hd"><h2>Send a test message</h2></div>
				<div class="bd stack tight"><label class="f"><span class="sr">Event</span><select name="event">${options(EVENT_OPTIONS, repo.enabledEvents[0] ?? "push")}</select></label><span class="hint">Posts a sample, marked as a test, to the channel that event is routed to.</span></div>
				<div class="ft"><span></span><button class="btn primary" type="submit">${ICON.send}Send test</button></div>
			</form>
			<div class="card"><div class="hd"><h2>Configuration</h2></div><div class="scroll"><table class="table"><tbody>
				${summaryRow("Channel", `#${esc(view.channelName)}`, "routing")}
				${summaryRow("Events", `${repo.enabledEvents.length} of ${EVENT_TYPES.length} on`, "events")}
				${summaryRow("Filters", filters === 0 ? '<span class="faint">none</span>' : plural(filters, "rule"), "filters")}
				${summaryRow("Routes & pings", routes + mentions === 0 ? '<span class="faint">none</span>' : `${plural(routes, "route")}, ${plural(mentions, "ping")}`, "routing")}
				${summaryRow("Look", `${esc(THEME_LABEL[data.effective.theme])}, ${esc(data.effective.mode)}${repo.theme || repo.displayMode ? "" : ' <span class="faint">(inherited)</span>'}`, "appearance")}
			</tbody></table></div></div>
		</div>
	</div>`;
}

function eventsTab(shell: Shell, repo: TrackedRepo): string {
	const enabled = new Set<string>(repo.enabledEvents);
	const groups = EVENT_CATEGORIES.map((category) => {
		const events = eventsInCategory(category.id);
		const on = events.filter((event) => enabled.has(event)).length;
		return `<section class="group" data-group>
			<div class="gh"><span class="dotc ${category.id}"></span><h3>${esc(categoryLabel("en", category.id))}</h3><span class="muted"><span data-group-count>${on}</span> of ${events.length}</span><span class="grow"></span><button class="btn ghost sm" type="button" data-set="all">All</button><button class="btn ghost sm" type="button" data-set="none">None</button></div>
			<div class="gb checks">${events.map((event) => eventCheck(event, enabled.has(event))).join("")}</div>
		</section>`;
	}).join("");

	return `<form class="stack" method="post" action="${repoPath(repo, "/events")}">
		${csrfField(shell.session)}
		<div class="card"><div class="ft"><span><b data-total>${repo.enabledEvents.length}</b> of ${EVENT_TYPES.length} events switched on. An event that is off is received and ignored.</span><div class="row wrap"><button class="btn" type="submit" name="preset" value="minimal">Minimal</button><button class="btn" type="submit" name="preset" value="standard">Standard</button><button class="btn" type="submit" name="preset" value="everything">Everything</button><button class="btn primary" type="submit">Save events</button></div></div></div>
		${groups}
		<div class="row"><button class="btn primary" type="submit">Save events</button><span class="hint">GitHub only sends the events selected on the webhook itself. "Send me everything" there covers all of these.</span></div>
	</form>`;
}

function eventCheck(event: EventType, checked: boolean): string {
	return `<label class="check"><input type="checkbox" name="events" value="${event}"${checked ? " checked" : ""}><span><b>${esc(eventLabel("en", event))}</b><small>${esc(eventDescription("en", event))}</small></span></label>`;
}

function filtersTab(shell: Shell, repo: TrackedRepo): string {
	const field = (name: string, label: string, hint: string, placeholder: string, value: string[]) =>
		`<label class="f"><span>${label}</span><input class="mono" type="text" name="${name}" value="${esc(value.join(", "))}" placeholder="${esc(placeholder)}" maxlength="600" autocomplete="off" spellcheck="false"><small>${hint}</small></label>`;
	return `<form class="card" method="post" action="${repoPath(repo, "/filters")}">
		${csrfField(shell.session)}
		<div class="hd"><h2>Filters</h2><span class="muted">Comma-separated. <code>*</code> matches any run of characters, <code>?</code> one.</span></div>
		<div class="bd fields">
			${field("branchInclude", "Only these branches", "Leave empty to let every branch through.", "main, release/*", repo.filters.branchInclude)}
			${field("branchExclude", "Never these branches", "Wins over the list above.", "dependabot/*, *-wip", repo.filters.branchExclude)}
			${field("labels", "Only these labels", "Applies to issues and pull requests only; pushes and releases are unaffected.", "bug, security", repo.filters.labels)}
			${field("ignoredActors", "Ignore these authors", "GitHub logins. The word <code>bot</code> matches every bot account.", "bot, renovate*", repo.filters.ignoredActors)}
		</div>
		<div class="ft"><span class="hint">Up to 25 entries per field. A filtered delivery is recorded in the log and not posted.</span><button class="btn primary" type="submit">Save filters</button></div>
	</form>`;
}

function routingTab(shell: Shell, data: RepoPageData): string {
	const { repo } = data.view;
	const roleOptions = (selected: string | undefined) => {
		const known = data.directory.roles.some((role) => role.id === selected);
		return options(
			[
				{ value: "", label: "No ping" },
				...(selected && !known ? [{ value: selected, label: `Unknown role (${selected})` }] : []),
				...data.directory.roles.map((role) => ({ value: role.id, label: `@${role.name}` })),
			],
			selected,
		);
	};

	const rows = EVENT_CATEGORIES.map((category) => {
		const role = repo.mentionRules[category.id]?.[0];
		return `<tr>
			<td><span class="row"><span class="dotc ${category.id}"></span><b>${esc(categoryLabel("en", category.id))}</b></span></td>
			<td>${channelSelect(`route.${category.id}`, data.directory, repo.eventRoutes[category.id] ?? null, "Default channel")}</td>
			<td>${
				data.directory.available
					? `<select name="mention.${category.id}">${roleOptions(role)}</select>`
					: `<input class="mono" type="text" name="mention.${category.id}" value="${esc(role ?? "")}" inputmode="numeric" pattern="\\d{17,20}" placeholder="Role ID">`
			}</td>
		</tr>`;
	}).join("");

	// Rules keyed by a single event type come from older versions or direct edits;
	// they keep working, so say so rather than hide them.
	const categoryIds = new Set<string>(EVENT_CATEGORIES.map((category) => category.id));
	const extra = [...Object.keys(repo.eventRoutes), ...Object.keys(repo.mentionRules)].filter(
		(key) => !categoryIds.has(key),
	);

	return `<form class="card" method="post" action="${repoPath(repo, "/channel")}">
		${csrfField(shell.session)}
		<div class="hd"><h2>Default channel</h2></div>
		<div class="bd"><label class="f"><span class="sr">Default channel</span>${channelSelect("channel", data.directory, repo.channelId, null)}<small>Everything posts here unless a category below says otherwise. Forum and media channels get one post per event.</small></label></div>
		<div class="ft"><span></span><button class="btn primary" type="submit">Save channel</button></div>
	</form>
	<form class="card" method="post" action="${repoPath(repo, "/routing")}">
		${csrfField(shell.session)}
		<div class="hd"><h2>Per-category channels and mentions</h2></div>
		<div class="scroll"><table class="table"><thead><tr><th>Category</th><th>Post to</th><th>Ping role</th></tr></thead><tbody>${rows}</tbody></table></div>
		<div class="ft"><span class="hint">${extra.length > 0 ? `${plural(new Set(extra).size, "per-event rule")} set elsewhere (${esc([...new Set(extra)].join(", "))}) stay as they are. ` : ""}A ping is sent only for the role chosen here; message text can never mention anyone.</span><button class="btn primary" type="submit">Save routing</button></div>
	</form>`;
}

const THEME_LABEL: Record<ThemeId, string> = {
	default: "Classic",
	github: "GitHub",
	neon: "Neon",
	catppuccin: "Catppuccin",
	nord: "Nord",
	accessible: "Accessible (colour-blind safe)",
	mono: "Monochrome",
	language: "By language",
};

const LOCALE_LABEL: Record<AppLocale, string> = { en: "English", es: "Español" };

function styleFields(
	inherit: string,
	current: { theme: string | null; mode: string | null; locale: string | null },
): string {
	return `<label class="f"><span>Theme</span><select name="theme">${options(
		[
			{ value: "", label: inherit },
			...THEME_IDS.map((value) => ({ value, label: THEME_LABEL[value] })),
		],
		current.theme,
	)}</select><small>The accent colour each kind of event gets.</small></label>
	<label class="f"><span>Density</span><select name="mode">${options(
		[
			{ value: "", label: inherit },
			...DISPLAY_MODES.map((value) => ({
				value,
				label: value === "detailed" ? "Detailed" : "Compact",
			})),
		],
		current.mode,
	)}</select><small>Compact drops the body and secondary fields.</small></label>
	<label class="f"><span>Language</span><select name="locale">${options(
		[
			{ value: "", label: inherit },
			...SUPPORTED_LOCALES.map((value) => ({ value, label: LOCALE_LABEL[value] })),
		],
		current.locale,
	)}</select><small>The language messages are written in.</small></label>`;
}

function previewCard(html: string): string {
	return `<div class="card"><div class="hd"><h2>Preview</h2><span class="muted">sample events, drawn as Discord shows them</span></div><div class="bd" id="preview">${html}</div></div>`;
}

function appearanceTab(shell: Shell, data: RepoPageData): string {
	const { repo } = data.view;
	return `<div class="grid even">
		<form class="card" method="post" action="${repoPath(repo, "/style")}" data-preview="${guildPath(repo.guildId, "/preview")}">
			${csrfField(shell.session)}
			<input type="hidden" name="repo" value="${esc(slugOf(repo))}">
			<div class="hd"><h2>Appearance</h2></div>
			<div class="bd stack">${styleFields("Use the server default", { theme: repo.theme, mode: repo.displayMode, locale: repo.locale })}</div>
			<div class="ft"><a class="link" href="${guildPath(repo.guildId, "/settings")}">Server defaults</a><button class="btn primary" type="submit">Save appearance</button></div>
		</form>
		${previewCard(data.previewHtml)}
	</div>`;
}

function webhookTab(shell: Shell, data: RepoPageData): string {
	const { repo } = data.view;
	const slug = slugOf(repo);
	const secret = data.secret
		? `<div class="banner info"><span>${ICON.info}</span><div class="stack tight grow"><div class="t">Webhook secret</div><div class="copy"><input class="mono" id="secret" type="password" value="${esc(data.secret)}" readonly autocomplete="off"><button class="btn" type="button" data-reveal="secret">Show</button><button class="btn" type="button" data-copy="secret">Copy</button></div><div class="hint">Shown for this page view only. Paste it into the webhook's <b>Secret</b> field on GitHub.</div></div></div>`
		: "";

	return `${secret}
	<div class="grid c2">
		<div class="card">
			<div class="hd"><h2>Connect on GitHub</h2><a class="btn sm" href="https://github.com/${esc(slug)}/settings/hooks" rel="noreferrer noopener" target="_blank">Open webhook settings</a></div>
			<div class="bd stack">
				<label class="f"><span>Payload URL</span><span class="copy"><input class="mono" id="payload" type="text" value="${esc(data.webhookUrl)}" readonly><button class="btn" type="button" data-copy="payload">Copy</button></span></label>
				<ol class="steps muted">
					<li>On the repository, open <b>Settings → Webhooks → Add webhook</b>.</li>
					<li>Paste the payload URL. Either content type works; <code>application/json</code> is the tidier one.</li>
					<li>Paste the secret. Reveal it below if you no longer have it.</li>
					<li>Choose <b>Send me everything</b>, or pick individual events to match the Events tab.</li>
					<li>Save. GitHub sends a ping straight away, which appears under Deliveries.</li>
				</ol>
			</div>
			<div class="ft">
				<span class="hint">${repo.encryptedPreviousSecret ? "A rotation is in progress: the previous secret still works until GitHub first uses the new one." : "The secret is stored encrypted and never leaves this server except on this page."}</span>
				<div class="row wrap">
					<form class="inline" method="post" action="${repoPath(repo, "/secret/reveal")}">${csrfField(shell.session)}<button class="btn" type="submit">Reveal secret</button></form>
					<form class="inline" method="post" action="${repoPath(repo, "/secret/rotate")}" data-confirm="Generate a new secret? The current one keeps working until GitHub first uses the new one.">${csrfField(shell.session)}<button class="btn" type="submit">Rotate secret</button></form>
				</div>
			</div>
		</div>
		<div class="stack">
			<div class="card"><div class="hd"><h2>Details</h2></div><div class="bd stack tight">
				<div class="row between"><span class="muted">Tracking ID</span><span class="mono">${esc(repo.trackingId.slice(0, 8))}…</span></div>
				<div class="row between"><span class="muted">Added</span><span>${when(repo.createdAt)}</span></div>
				<div class="row between"><span class="muted">Last delivery</span><span>${when(repo.lastDeliveryAt)}</span></div>
				<div class="row between"><span class="muted">Last error</span><span>${when(repo.lastErrorAt)}</span></div>
			</div></div>
			<form class="card" method="post" action="${repoPath(repo, "/remove")}" data-confirm="Stop tracking ${esc(slug)}? Its settings and delivery log are deleted. This cannot be undone.">
				${csrfField(shell.session)}
				<div class="hd"><h2 class="bad">Stop tracking</h2></div>
				<div class="bd stack tight"><span>Deletes this repository's settings, secret and delivery log from GitHuBot at once. The webhook on GitHub is yours to delete; until then its deliveries are answered with 404.</span><label class="check"><input type="checkbox" name="confirm" value="yes" required><span><b>I understand this cannot be undone</b></span></label></div>
				<div class="ft"><span></span><button class="btn danger" type="submit">Remove ${esc(slug)}</button></div>
			</form>
		</div>
	</div>`;
}

function logFilterForm(action: string, outcome: string, hidden = ""): string {
	return `<form class="toolbar" method="get" action="${action}">${hidden}<select name="outcome" aria-label="Outcome">${options(OUTCOME_OPTIONS, outcome)}</select><button class="btn" type="submit">Filter</button></form>`;
}

function pager(href: string | null): string {
	return href
		? `<div class="ft"><span class="hint">Showing ${LOG_PAGE_SIZE} per page</span><a class="btn" href="${esc(href)}">Older</a></div>`
		: "";
}

function deliveriesTab(data: RepoPageData): string {
	const { repo } = data.view;
	const { outcome, nextBefore } = data.logFilter;
	const older =
		nextBefore === null
			? null
			: repoPath(
					repo,
					`?tab=deliveries&before=${nextBefore}${outcome ? `&outcome=${encodeURIComponent(outcome)}` : ""}`,
				);
	return `${logFilterForm(repoPath(repo), outcome, '<input type="hidden" name="tab" value="deliveries">')}
	<div class="card"><div id="log" data-live>${logTable(data.log, null, outcome ? "No delivery with that outcome in the last 30 days." : "Nothing has arrived yet.")}</div>${pager(older)}</div>
	<p class="hint">The log records what kind of event arrived and what became of it — never its contents — and is kept for 30 days.</p>`;
}

// ---------------------------------------------------------------- activity --

export function activityPage(
	shell: Shell,
	data: {
		rows: DeliveryLogEntry[];
		repos: TrackedRepo[];
		outcome: string;
		nextBefore: number | null;
	},
): string {
	const byTracking = new Map(data.repos.map((repo) => [repo.trackingId, repo]));
	const older =
		data.nextBefore === null
			? null
			: guildPath(
					shell.guildId,
					`/activity?before=${data.nextBefore}${data.outcome ? `&outcome=${encodeURIComponent(data.outcome)}` : ""}`,
				);
	return page(
		shell,
		"Deliveries",
		`${header("Deliveries", "Everything GitHub sent to this server's repositories, newest first", LIVE_PILL)}
		${logFilterForm(guildPath(shell.guildId, "/activity"), data.outcome)}
		<div class="card"><div id="log" data-live>${logTable(data.rows, byTracking, data.outcome ? "No delivery with that outcome in the last 30 days." : "Nothing has arrived yet. Deliveries appear here as GitHub sends them.")}</div>${pager(older)}</div>
		<p class="hint">The log records what kind of event arrived and what became of it — never its contents — and is kept for 30 days.</p>`,
	);
}

// ----------------------------------------------------------------- history --

/** Rows per page of the change history. */
export const HISTORY_PAGE_SIZE = 50;

const AUDIT_LABEL: Record<string, string> = {
	"repo.added": "Added the repository",
	"repo.removed": "Removed the repository",
	"repo.paused": "Paused deliveries",
	"repo.resumed": "Resumed deliveries",
	"repo.events": "Changed which events are posted",
	"repo.filters": "Changed filters",
	"repo.channel": "Changed the default channel",
	"repo.routing": "Changed channel routing",
	"repo.mentions": "Changed role mentions",
	"repo.appearance": "Changed appearance",
	"repo.test": "Sent a test message",
	"secret.revealed": "Revealed the webhook secret",
	"secret.rotated": "Rotated the webhook secret",
	"server.appearance": "Changed the server's default appearance",
	"server.language": "Changed the server's language",
	"server.alerts": "Changed failure alerts",
};

export function historyPage(
	shell: Shell,
	data: { rows: AuditEntry[]; repos: TrackedRepo[]; nextBefore: number | null },
): string {
	const bySlug = new Map(data.repos.map((repo) => [slugOf(repo).toLowerCase(), repo]));
	const body = data.rows
		.map((row) => {
			const repo = row.target ? bySlug.get(row.target.toLowerCase()) : undefined;
			const target = !row.target
				? '<span class="faint">Server</span>'
				: repo
					? `<a class="link mono" href="${repoPath(repo)}">${esc(row.target)}</a>`
					: `<span class="mono">${esc(row.target)}</span>`;
			return `<tr>
				<td class="tight muted">${when(row.createdAt)}</td>
				<td>${esc(row.username ?? row.userId)}</td>
				<td>${esc(AUDIT_LABEL[row.action] ?? row.action)}${row.detail ? ` <span class="faint">· ${esc(row.detail)}</span>` : ""}</td>
				<td>${target}</td>
				<td class="tight"><span class="badge dim">${row.source === "command" ? "/repo" : "Dashboard"}</span></td>
			</tr>`;
		})
		.join("");
	const table =
		data.rows.length === 0
			? '<div class="empty"><p>No changes recorded yet. Changes made here or with <code>/repo</code> appear as they happen.</p></div>'
			: `<div class="scroll"><table class="table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Repository</th><th>Where</th></tr></thead><tbody>${body}</tbody></table></div>`;
	const older =
		data.nextBefore === null
			? null
			: guildPath(shell.guildId, `/history?before=${data.nextBefore}`);
	return page(
		shell,
		"History",
		`${header("History", "Who changed what in this server, newest first")}
		<div class="card">${table}${pager(older)}</div>
		<p class="hint">Records the person, the change and the repository — never a secret or a setting's contents — and is kept for 90 days.</p>`,
	);
}

// ---------------------------------------------------------------- settings --

export function settingsPage(
	shell: Shell,
	data: {
		settings: GuildSettings | null;
		directory: GuildDirectory;
		previewHtml: string;
		notice: Notice | null;
	},
): string {
	const settings = data.settings;
	return page(
		shell,
		"Settings",
		`${header("Server settings", "Defaults for every repository in this server. A repository can override its look.")}
		<div class="stack">
			${banner(data.notice)}
			<div class="grid even">
				<div class="stack">
					<form class="card" method="post" action="${guildPath(shell.guildId, "/settings/style")}" data-preview="${guildPath(shell.guildId, "/preview")}">
						${csrfField(shell.session)}
						<div class="hd"><h2>Default appearance</h2></div>
						<div class="bd stack">${styleFields("Use the bot's default", { theme: settings?.defaultTheme ?? null, mode: settings?.defaultDisplayMode ?? null, locale: settings?.locale ?? null })}</div>
						<div class="ft"><span class="hint">Language also sets the language of <code>/repo</code> replies.</span><button class="btn primary" type="submit">Save defaults</button></div>
					</form>
					<form class="card" method="post" action="${guildPath(shell.guildId, "/settings/alerts")}">
						${csrfField(shell.session)}
						<div class="hd"><h2>Failure alerts</h2></div>
						<div class="bd"><label class="f"><span class="sr">Alert channel</span>${channelSelect("channel", data.directory, settings?.alertChannelId ?? null, "Off")}<small>Posts once when a repository's deliveries start failing, and once when they recover. Never per event, and it pings nobody.</small></label></div>
						<div class="ft"><span></span><button class="btn primary" type="submit">Save alerts</button></div>
					</form>
					<form class="card" method="post" action="/dashboard/logout/all">
						${csrfField(shell.session)}
						<div class="hd"><h2>Your sign-in</h2></div>
						<div class="bd"><p class="muted">Signed in as <b>${esc(shell.session.username)}</b>. Signing out everywhere ends this sign-in and every other one of yours, on any browser or device, at once.</p></div>
						<div class="ft"><span class="hint">Use it if you signed in on a computer that is not yours.</span><button class="btn" type="submit">Sign out everywhere</button></div>
					</form>
				</div>
				${previewCard(data.previewHtml)}
			</div>
		</div>`,
	);
}

// -------------------------------------------------------------- standalone --

function centered(title: string, inner: string): string {
	return document_(title, `<div class="center"><div class="card">${inner}</div></div>`);
}

/** `privateInstance`: the operator locked this bot to one Discord account. */
export function signInPage(privateInstance = false): string {
	return centered(
		"Sign in · GitHuBot",
		`${ICON.mark(32)}<h1>Sign in to GitHuBot</h1><p>Manage the repositories your servers track, and see what was delivered.</p>
		<a class="btn primary" href="/dashboard/login">Continue with Discord</a>
		${
			privateInstance
				? '<p class="hint">This is a private instance: only its owner can sign in. GitHuBot is open source, so you can <a class="link" href="https://github.com/MatiDeZeta/GitHuBot" rel="noreferrer">run your own</a>.</p>'
				: '<p class="hint">Only servers where you have <b>Manage Server</b> are shown. GitHuBot asks Discord for your name and server list, nothing else.</p>'
		}`,
	);
}

export function noServersPage(session: DashboardSession): string {
	return centered(
		"No servers · GitHuBot",
		`${ICON.mark(32)}<h1>No servers to manage</h1><p>You are signed in as <b>${esc(session.username)}</b>, but you do not have <b>Manage Server</b> on any server GitHuBot is in.</p>
		<form method="post" action="/dashboard/logout">${csrfField(session)}<button class="btn" type="submit">Sign out</button></form>`,
	);
}

export function notConfiguredPage(missing: string[]): string {
	return centered(
		"Dashboard is off · GitHuBot",
		`<span class="warn">${svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/>', 32)}</span><h1>Dashboard is off</h1><p>The bot is running normally. The dashboard is optional and stays disabled until it is configured.</p>
		<pre>${missing.map((key) => `${esc(key)}=…`).join("\n")}</pre>
		<p class="hint">Add <code>&lt;DASHBOARD_BASE_URL&gt;/dashboard/auth/callback</code> as a redirect URI in the Discord Developer Portal, then restart.</p>`,
	);
}

export function errorPage(status: number, message: string): string {
	return centered(
		`${status} · GitHuBot`,
		`<div class="mono faint">${status}</div><h1>${esc(message)}</h1><a class="btn" href="/dashboard">Back to the dashboard</a>`,
	);
}
