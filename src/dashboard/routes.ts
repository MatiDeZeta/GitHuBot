import type { Client, GuildMember } from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RenderOptions } from "../bot/render/render.js";
import { sampleTemplate } from "../bot/render/samples.js";
import { isDisplayMode } from "../bot/render/template.js";
import { isThemeId } from "../bot/render/theme.js";
import type { DashboardEnv } from "../config/env.js";
import {
	DEFAULT_ENABLED_EVENTS,
	EVENT_CATEGORIES,
	EVENT_TYPES,
	type EventType,
	eventTypeSchema,
	repoSlugSchema,
} from "../config/events.js";
import type { Logger } from "../config/logger.js";
import {
	encryptSecret,
	generateTrackingId,
	generateWebhookSecret,
	tryDecryptSecret,
} from "../crypto/secrets.js";
import {
	type DeliveryOutcome,
	isDeliveryOutcome,
	type RepoRepository,
	type TrackedRepo,
} from "../db/types.js";
import { type DispatchContext, deliverTemplate, renderOptionsFor } from "../delivery/dispatch.js";
import { parseFilterList } from "../delivery/filters.js";
import { isAppLocale } from "../i18n/index.js";
import { metrics } from "../metrics.js";
import { ASSETS } from "./assets.js";
import { channelInGuild, guildDirectory, roleInGuild, standingOf } from "./directory.js";
import { authorizeUrl, completeSignIn, createOAuthState } from "./oauth.js";
import { previewMessages } from "./preview.js";
import {
	clearCookie,
	cookieName,
	createCsrfToken,
	createSessionId,
	csrfMatches,
	type DashboardSession,
	decodeSession,
	encodeSession,
	fitCookieBudget,
	OAUTH_STATE_COOKIE,
	readCookie,
	SESSION_COOKIE,
	serializeCookie,
} from "./session.js";
import {
	ACTIVITY_DAYS,
	activityPage,
	errorPage,
	guildPath,
	HISTORY_PAGE_SIZE,
	healthOf,
	historyPage,
	isRepoTab,
	LOG_PAGE_SIZE,
	type NavId,
	type Notice,
	newRepoPage,
	noServersPage,
	overviewPage,
	type RepoTab,
	type RepoView,
	repoPage,
	repoPath,
	reposPage,
	type Shell,
	SUMMARY_DAYS,
	settingsPage,
	signInPage,
} from "./views.js";

export interface DashboardContext {
	env: DashboardEnv;
	logger: Logger;
	repository: RepoRepository;
	masterKey: Buffer;
	discord: Client;
	renderDefaults: DispatchContext["defaults"];
}

const HTML = "text/html; charset=utf-8";
const DAY_MS = 86_400_000;

/**
 * Nothing inline is allowed at all: the stylesheet and the one script come from
 * this origin, and the markup carries neither `style` attributes nor handlers. An
 * HTML-escaping mistake therefore still cannot run a script or restyle the page.
 * Avatars are the only cross-origin load, and only from Discord's CDN.
 */
const CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self'",
	"img-src 'self' https://cdn.discordapp.com",
	"connect-src 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"base-uri 'none'",
].join("; ");

/** Why a page is being shown after a redirect. Keys only ever come from this table. */
const NOTICES: Record<string, Notice> = {
	paused: { kind: "ok", text: "Deliveries paused. GitHub keeps sending; nothing is posted." },
	resumed: { kind: "ok", text: "Deliveries resumed." },
	test_ok: { kind: "ok", text: "Test message posted." },
	test_failed: {
		kind: "bad",
		text: "The test message could not be posted. The reason is under Deliveries are failing.",
	},
	events_saved: { kind: "ok", text: "Events saved." },
	filters_saved: { kind: "ok", text: "Filters saved." },
	channel_saved: { kind: "ok", text: "Default channel saved." },
	routing_saved: { kind: "ok", text: "Channels and mentions saved." },
	style_saved: { kind: "ok", text: "Appearance saved." },
	settings_saved: { kind: "ok", text: "Server defaults saved." },
	alerts_saved: { kind: "ok", text: "Failure alerts saved." },
	removed: { kind: "ok", text: "Repository removed. Delete its webhook on GitHub too." },
	bad_channel: {
		kind: "bad",
		text: "That channel is not a text, announcement, forum or thread channel in this server.",
	},
	bad_role: { kind: "bad", text: "That role does not belong to this server." },
	bad_event: { kind: "bad", text: "That is not an event GitHuBot knows." },
	confirm: { kind: "warn", text: "Tick the confirmation box to remove the repository." },
	undecryptable: {
		kind: "bad",
		text: "This secret was stored under a different MASTER_KEY and cannot be read. Rotate it to get a new one.",
	},
};

const PRESETS: Record<string, readonly EventType[]> = {
	minimal: ["push", "release"],
	standard: DEFAULT_ENABLED_EVENTS,
	everything: EVENT_TYPES,
};

export async function registerDashboard(
	app: FastifyInstance,
	ctx: DashboardContext,
	/** False while the database or Discord client is still starting (or failed to). */
	isReady: () => boolean = () => true,
): Promise<void> {
	// Cookies are only marked Secure on https, otherwise a local http deployment
	// would silently never receive them back.
	const secure = ctx.env.DASHBOARD_BASE_URL.startsWith("https://");
	const ownOrigin = new URL(ctx.env.DASHBOARD_BASE_URL).origin;
	const sessionSeconds = ctx.env.DASHBOARD_SESSION_HOURS * 3600;
	const sessionCookie = cookieName(SESSION_COOKIE, secure);
	const stateCookie = cookieName(OAUTH_STATE_COOKIE, secure);

	// Registered as an encapsulated plugin so these hooks and the urlencoded parser
	// apply to dashboard routes only — the webhook endpoint must not accept forms.
	await app.register(async (dash: FastifyInstance) => {
		dash.addContentTypeParser(
			"application/x-www-form-urlencoded",
			{ parseAs: "string" },
			(_req, body, done) => {
				// Kept as URLSearchParams: checkbox groups repeat a name, which a plain
				// object would collapse to its last value.
				done(null, new URLSearchParams(String(body)));
			},
		);

		// Before anything touches `ctx`: during boot, or after a failed Discord login,
		// there is nothing to show and no session key to verify a cookie with.
		dash.addHook("onRequest", async (_request, reply) => {
			if (isReady()) return;
			return reply
				.code(503)
				.header("content-type", HTML)
				.header("retry-after", "15")
				.send(errorPage(503, "GitHuBot is still starting. Try again in a moment."));
		});

		// The form token already stops cross-site posts; this refuses them one step
		// earlier, on the browser's own word about where the request came from, so a
		// leaked token alone is not enough. Requests without these headers (old
		// browsers, non-browser clients) fall through to the token check.
		//
		// `Sec-Fetch-Site` decides when it is present. `Origin` is only a fallback,
		// and `null` in it means nothing: these pages are served with
		// `Referrer-Policy: no-referrer`, under which a browser sends `Origin: null`
		// on the dashboard's own form posts. Treating that as foreign refused every
		// form in a real browser.
		dash.addHook("onRequest", async (request, reply) => {
			if (request.method !== "POST") return;
			const origin = request.headers.origin;
			const site = request.headers["sec-fetch-site"];
			const foreign =
				typeof site === "string"
					? site !== "same-origin" && site !== "none"
					: typeof origin === "string" && origin !== "null" && origin !== ownOrigin;
			if (!foreign) return;
			ctx.logger.warn({ origin, site }, "Dashboard POST refused: cross-site request");
			return reply
				.code(403)
				.header("content-type", HTML)
				.send(errorPage(403, "That request did not come from this dashboard."));
		});

		dash.addHook("onSend", async (_request, reply, payload) => {
			reply.header("content-security-policy", CSP);
			reply.header("x-content-type-options", "nosniff");
			reply.header("x-frame-options", "DENY");
			reply.header("referrer-policy", "no-referrer");
			reply.header(
				"permissions-policy",
				"camera=(), microphone=(), geolocation=(), interest-cohort=()",
			);
			reply.header("cross-origin-opener-policy", "same-origin");
			reply.header("cross-origin-resource-policy", "same-origin");
			// Every page is per-user data behind a cookie; never let a proxy or the back
			// button hand it to someone else. The two static assets opt out below.
			if (!reply.hasHeader("cache-control")) {
				reply.header("cache-control", "no-store, max-age=0");
			}
			if (secure) {
				reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
			}
			return payload;
		});

		registerRoutes(dash, ctx, { secure, sessionSeconds, sessionCookie, stateCookie });
	});
}

interface RouteOptions {
	secure: boolean;
	sessionSeconds: number;
	sessionCookie: string;
	stateCookie: string;
}

interface GuildParams {
	guildId: string;
}

interface RepoParams extends GuildParams {
	owner: string;
	repo: string;
}

type Query = Record<string, string | string[] | undefined>;

function one(value: unknown): string {
	return typeof value === "string" ? value : "";
}

/** The parsed form, or an empty one for a POST that was not a form at all. */
function formOf(request: FastifyRequest): URLSearchParams {
	return request.body instanceof URLSearchParams ? request.body : new URLSearchParams();
}

function noticeFrom(query: Query): Notice | null {
	return NOTICES[one(query.notice)] ?? null;
}

function registerRoutes(app: FastifyInstance, ctx: DashboardContext, opts: RouteOptions): void {
	const { secure, sessionSeconds, sessionCookie, stateCookie } = opts;

	async function sessionOf(request: FastifyRequest): Promise<DashboardSession | null> {
		const session = decodeSession(readCookie(request.headers.cookie, sessionCookie), ctx.masterKey);
		if (!session) return null;
		// Re-checked on every request, so tightening DISCORD_ALLOWED_USER_ID and
		// restarting shuts out sessions issued before the change.
		if (ctx.env.DISCORD_ALLOWED_USER_ID && ctx.env.DISCORD_ALLOWED_USER_ID !== session.userId) {
			return null;
		}
		// The signature only proves the cookie was issued here, not that it is still
		// wanted: signing out, here or everywhere, has to hold for a copy of it too.
		if (await ctx.repository.isSessionRevoked(session)) return null;
		return session;
	}

	function html(reply: FastifyReply, status: number, body: string): FastifyReply {
		return reply.code(status).header("content-type", HTML).send(body);
	}

	const dispatchContext = (): DispatchContext => ({
		client: ctx.discord,
		repository: ctx.repository,
		logger: ctx.logger,
		defaults: ctx.renderDefaults,
	});

	// ------------------------------------------------------------- guards --

	interface Access {
		session: DashboardSession;
		guildId: string;
		/** Who is looking, as Discord knows them now: decides which channels they see. */
		viewer: GuildMember | null;
	}

	/**
	 * Signed in, the server in the URL is one this person managed at sign-in, and
	 * Discord still says they have Manage Server. The session only remembers that
	 * it was true hours ago; someone demoted or removed since must lose the pages
	 * as well as the buttons, because the pages show channels, filters and logs.
	 */
	async function guildAccess(
		request: FastifyRequest<{ Params: GuildParams }>,
		reply: FastifyReply,
	): Promise<Access | null> {
		const session = await sessionOf(request);
		if (!session) {
			await reply.redirect("/dashboard");
			return null;
		}
		const { guildId } = request.params;
		if (!session.guildIds.includes(guildId)) {
			await html(reply, 403, errorPage(403, "You do not manage that server."));
			return null;
		}
		const standing = await standingOf(ctx.discord, guildId, session.userId);
		if (!standing.allowed) {
			ctx.logger.warn(
				{ userId: session.userId, guildId },
				"Dashboard access refused: Manage Server no longer held",
			);
			await html(
				reply,
				403,
				errorPage(403, "You no longer have Manage Server on that server. Sign in again."),
			);
			return null;
		}
		return { session, guildId, viewer: standing.member };
	}

	/** Everything that changes state passes through here: the form token must match too. */
	async function writeAccess(
		request: FastifyRequest<{ Params: GuildParams }>,
		reply: FastifyReply,
	): Promise<(Access & { form: URLSearchParams }) | null> {
		const access = await guildAccess(request, reply);
		if (!access) return null;
		const form = formOf(request);
		if (!csrfMatches(access.session.csrfToken, form.get("csrf") ?? undefined)) {
			await html(reply, 403, errorPage(403, "Invalid form token. Go back, reload and try again."));
			return null;
		}
		return { ...access, form };
	}

	async function repoOr404(
		guildId: string,
		params: RepoParams,
		reply: FastifyReply,
	): Promise<TrackedRepo | null> {
		const tracked = await ctx.repository.getRepo(guildId, params.owner, params.repo);
		if (!tracked) {
			await html(reply, 404, errorPage(404, "That repository is not tracked here."));
		}
		return tracked;
	}

	async function repoWrite(
		request: FastifyRequest<{ Params: RepoParams }>,
		reply: FastifyReply,
	): Promise<{
		session: DashboardSession;
		repo: TrackedRepo;
		form: URLSearchParams;
		viewer: GuildMember | null;
	} | null> {
		const access = await writeAccess(request, reply);
		if (!access) return null;
		const repo = await repoOr404(access.guildId, request.params, reply);
		return repo
			? { session: access.session, repo, form: access.form, viewer: access.viewer }
			: null;
	}

	/**
	 * Every change is written to the log and to the server's history page. `where`
	 * is the repository it applied to, or the server id for a server-wide setting.
	 * The history is a record, not a gate: failing to write it never undoes or
	 * blocks the change that was just made.
	 */
	async function audit(
		session: DashboardSession,
		where: TrackedRepo | string,
		action: string,
		detail: string | null = null,
	): Promise<void> {
		const guildId = typeof where === "string" ? where : where.guildId;
		const target = typeof where === "string" ? null : `${where.owner}/${where.repo}`;
		ctx.logger.info(
			{ userId: session.userId, guildId, target, action, detail },
			"Dashboard change",
		);
		try {
			await ctx.repository.recordAudit({
				guildId,
				userId: session.userId,
				username: session.username,
				source: "dashboard",
				action,
				target,
				detail,
			});
		} catch (err) {
			ctx.logger.error({ err, guildId, action }, "Failed to record a dashboard change");
		}
	}

	// -------------------------------------------------------------- loaders --

	async function channelName(channelId: string): Promise<string> {
		const cached = ctx.discord.channels.cache?.get(channelId);
		const channel = cached ?? (await ctx.discord.channels.fetch(channelId).catch(() => null));
		if (channel && "name" in channel && typeof channel.name === "string") return channel.name;
		return channelId;
	}

	async function loadViews(guildId: string): Promise<RepoView[]> {
		const repos = await ctx.repository.listRepos(guildId);
		const activity = await ctx.repository.activityByDay(
			repos.map((repo) => repo.trackingId),
			ACTIVITY_DAYS,
		);
		return Promise.all(
			repos.map(async (repo) => ({
				repo,
				channelName: await channelName(repo.channelId),
				activity: activity.get(repo.trackingId) ?? new Array<number>(ACTIVITY_DAYS).fill(0),
			})),
		);
	}

	function shellFor(
		session: DashboardSession,
		guildId: string,
		active: NavId,
		repos: TrackedRepo[],
	): Shell {
		return {
			session,
			guildId,
			active,
			repoCount: repos.length,
			failingCount: repos.filter((repo) => healthOf(repo) === "failing").length,
		};
	}

	function logQuery(query: Query): { outcome: DeliveryOutcome | undefined; before?: number } {
		const outcome = isDeliveryOutcome(query.outcome) ? query.outcome : undefined;
		const before = Number.parseInt(one(query.before), 10);
		return Number.isSafeInteger(before) && before > 0 ? { outcome, before } : { outcome };
	}

	/** One extra row is fetched to learn whether an older page exists. */
	async function loadLog(trackingIds: string[], query: Query) {
		const { outcome, before } = logQuery(query);
		const rows = await ctx.repository.listDeliveryLog(trackingIds, {
			limit: LOG_PAGE_SIZE + 1,
			outcome,
			before,
		});
		const page = rows.slice(0, LOG_PAGE_SIZE);
		return {
			rows: page,
			outcome: outcome ?? "",
			nextBefore: rows.length > LOG_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
		};
	}

	// --------------------------------------------------------------- assets --

	// Public and identical for everyone, with the content hash in the name, so they
	// can be cached for good. Unknown names fall through to a 404.
	for (const [asset, type] of [
		[ASSETS.css, "text/css; charset=utf-8"],
		[ASSETS.js, "text/javascript; charset=utf-8"],
	] as const) {
		app.get(asset.path, async (_request, reply) =>
			reply
				.header("content-type", type)
				.header("cache-control", "public, max-age=31536000, immutable")
				.send(asset.body),
		);
	}

	// ------------------------------------------------------------- sign-in --

	// Typed or bookmarked with a trailing slash, which the router treats as a
	// different path and would answer with a bare JSON 404.
	app.get("/dashboard/", async (_request, reply) => reply.redirect("/dashboard"));

	app.get("/dashboard", async (request, reply) => {
		const session = await sessionOf(request);
		if (!session) {
			return html(reply, 200, signInPage(Boolean(ctx.env.DISCORD_ALLOWED_USER_ID)));
		}
		const first = session.guilds[0];
		if (!first) return html(reply, 200, noServersPage(session));
		return reply.redirect(guildPath(first.id));
	});

	// Unauthenticated and each one costs a Discord round-trip, so limit them well
	// below the global allowance.
	const authLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

	app.get("/dashboard/login", authLimit, async (_request, reply) => {
		const state = createOAuthState();
		return reply
			.header("set-cookie", serializeCookie(stateCookie, state, { maxAgeSeconds: 600, secure }))
			.redirect(authorizeUrl(ctx.env, state));
	});

	// A POST with the form token: a GET could be triggered by any page embedding
	// the URL as an image, signing people out at will. The session's id is recorded
	// as ended, so a copy of the cookie taken earlier stops working as well.
	app.post("/dashboard/logout", async (request, reply) => {
		const session = await sessionOf(request);
		if (session) {
			if (!csrfMatches(session.csrfToken, formOf(request).get("csrf") ?? undefined)) {
				return html(reply, 403, errorPage(403, "Invalid form token."));
			}
			await ctx.repository.revokeSession(session.sid, new Date(session.expiresAt));
		}
		return reply.header("set-cookie", clearCookie(sessionCookie, secure)).redirect("/dashboard");
	});

	// Ends every sign-in of this person issued up to now, on any browser. Kept
	// until the longest-lived of them would have expired on its own.
	app.post("/dashboard/logout/all", async (request, reply) => {
		const session = await sessionOf(request);
		if (!session) return reply.redirect("/dashboard");
		if (!csrfMatches(session.csrfToken, formOf(request).get("csrf") ?? undefined)) {
			return html(reply, 403, errorPage(403, "Invalid form token."));
		}
		const now = Date.now();
		await ctx.repository.revokeUserSessions(
			session.userId,
			new Date(now),
			new Date(now + sessionSeconds * 1000),
		);
		ctx.logger.info({ userId: session.userId }, "Dashboard: signed out everywhere");
		return reply.header("set-cookie", clearCookie(sessionCookie, secure)).redirect("/dashboard");
	});

	app.get<{ Querystring: { code?: string; state?: string } }>(
		"/dashboard/auth/callback",
		authLimit,
		async (request, reply) => {
			const { code, state } = request.query;
			const expected = readCookie(request.headers.cookie, stateCookie);

			// Without this check an attacker could complete a sign-in in the victim's
			// browser using their own Discord account (login CSRF).
			if (!code || !state || !expected || !csrfMatches(expected, state)) {
				return html(reply, 400, errorPage(400, "Sign-in could not be verified. Try again."));
			}

			try {
				const { user, guilds } = await completeSignIn(ctx.env, code);

				// An operator who locked /repo to one Discord user means the whole bot,
				// not just the slash commands — the dashboard shows the same data.
				if (ctx.env.DISCORD_ALLOWED_USER_ID && ctx.env.DISCORD_ALLOWED_USER_ID !== user.id) {
					ctx.logger.warn(
						{ userId: user.id },
						"Dashboard sign-in refused by DISCORD_ALLOWED_USER_ID",
					);
					return html(
						reply,
						403,
						errorPage(403, "This instance is restricted to a single Discord account."),
					);
				}

				// A server the bot is not in has nothing to show, and every entry costs
				// cookie space: keeping them all pushed people who manage many servers
				// past the browser's cookie limit, so sign-in silently never stuck.
				const reachable = guilds.filter((guild) => ctx.discord.guilds.cache.has(guild.id));
				const session = fitCookieBudget(
					{
						sid: createSessionId(),
						issuedAt: Date.now(),
						userId: user.id,
						username: user.username,
						avatarUrl: user.avatarUrl,
						guildIds: reachable.map((g) => g.id),
						guilds: reachable,
						csrfToken: createCsrfToken(),
						expiresAt: Date.now() + sessionSeconds * 1000,
					},
					ctx.masterKey,
				);
				if (session.guilds.length < reachable.length) {
					ctx.logger.warn(
						{ userId: user.id, kept: session.guilds.length, reachable: reachable.length },
						"Dashboard session trimmed to fit the cookie size limit",
					);
				}
				ctx.logger.info({ userId: user.id, guilds: session.guilds.length }, "Dashboard sign-in");
				return reply
					.header("set-cookie", [
						serializeCookie(sessionCookie, encodeSession(session, ctx.masterKey), {
							maxAgeSeconds: sessionSeconds,
							secure,
						}),
						clearCookie(stateCookie, secure),
					])
					.redirect("/dashboard");
			} catch (err) {
				ctx.logger.error({ err }, "Dashboard sign-in failed");
				return html(reply, 502, errorPage(502, "Discord rejected the sign-in."));
			}
		},
	);

	// ------------------------------------------------------- server pages --

	app.get<{ Params: GuildParams; Querystring: Query }>(
		"/dashboard/g/:guildId",
		async (request, reply) => {
			const access = await guildAccess(request, reply);
			if (!access) return reply;
			const views = await loadViews(access.guildId);
			const trackingIds = views.map((view) => view.repo.trackingId);
			const [counts, recent] = await Promise.all([
				ctx.repository.deliveryOutcomeCounts(
					trackingIds,
					new Date(Date.now() - SUMMARY_DAYS * DAY_MS),
				),
				ctx.repository.listDeliveryLog(trackingIds, { limit: 8 }),
			]);
			const repos = views.map((view) => view.repo);
			return html(
				reply,
				200,
				overviewPage(shellFor(access.session, access.guildId, "overview", repos), {
					repos: views,
					counts,
					recent,
					uptimeMs: metrics.snapshot().uptimeMs,
					notice: noticeFrom(request.query),
				}),
			);
		},
	);

	app.get<{ Params: GuildParams; Querystring: Query }>(
		"/dashboard/g/:guildId/repos",
		async (request, reply) => {
			const access = await guildAccess(request, reply);
			if (!access) return reply;
			const views = await loadViews(access.guildId);
			return html(
				reply,
				200,
				reposPage(
					shellFor(
						access.session,
						access.guildId,
						"repos",
						views.map((view) => view.repo),
					),
					views,
					{ q: one(request.query.q).slice(0, 100), status: one(request.query.status) },
					noticeFrom(request.query),
				),
			);
		},
	);

	app.get<{ Params: GuildParams; Querystring: Query }>(
		"/dashboard/g/:guildId/activity",
		async (request, reply) => {
			const access = await guildAccess(request, reply);
			if (!access) return reply;
			const repos = await ctx.repository.listRepos(access.guildId);
			const log = await loadLog(
				repos.map((repo) => repo.trackingId),
				request.query,
			);
			return html(
				reply,
				200,
				activityPage(shellFor(access.session, access.guildId, "activity", repos), {
					rows: log.rows,
					repos,
					outcome: log.outcome,
					nextBefore: log.nextBefore,
				}),
			);
		},
	);

	app.get<{ Params: GuildParams; Querystring: Query }>(
		"/dashboard/g/:guildId/history",
		async (request, reply) => {
			const access = await guildAccess(request, reply);
			if (!access) return reply;
			const before = Number.parseInt(one(request.query.before), 10);
			const [repos, rows] = await Promise.all([
				ctx.repository.listRepos(access.guildId),
				// One extra row is fetched to learn whether an older page exists.
				ctx.repository.listAudit(access.guildId, {
					limit: HISTORY_PAGE_SIZE + 1,
					...(Number.isSafeInteger(before) && before > 0 ? { before } : {}),
				}),
			]);
			const page = rows.slice(0, HISTORY_PAGE_SIZE);
			return html(
				reply,
				200,
				historyPage(shellFor(access.session, access.guildId, "history", repos), {
					rows: page,
					repos,
					nextBefore: rows.length > HISTORY_PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
				}),
			);
		},
	);

	app.get<{ Params: GuildParams; Querystring: Query }>(
		"/dashboard/g/:guildId/settings",
		async (request, reply) => {
			const access = await guildAccess(request, reply);
			if (!access) return reply;
			const [repos, settings] = await Promise.all([
				ctx.repository.listRepos(access.guildId),
				ctx.repository.getGuildSettings(access.guildId),
			]);
			return html(
				reply,
				200,
				settingsPage(shellFor(access.session, access.guildId, "settings", repos), {
					settings,
					directory: guildDirectory(ctx.discord, access.guildId, access.viewer),
					previewHtml: previewMessages(
						renderOptionsFor(null, settings, ctx.renderDefaults),
						"your-org/your-repo",
						access.session.username,
					),
					notice: noticeFrom(request.query),
				}),
			);
		},
	);

	/**
	 * The fragment the appearance forms swap in as their selects change. An empty
	 * choice means "inherit", resolved the same way a real delivery resolves it.
	 */
	app.get<{ Params: GuildParams; Querystring: Query }>(
		"/dashboard/g/:guildId/preview",
		async (request, reply) => {
			const access = await guildAccess(request, reply);
			if (!access) return reply;
			const { theme, mode, locale } = request.query;
			const settings = await ctx.repository.getGuildSettings(access.guildId);
			const slug = repoSlugSchema.safeParse(one(request.query.repo));
			// With a repository named, an empty choice falls back to the server's
			// defaults; without one, this is the server form and falls back to the bot's.
			const inherited = renderOptionsFor(null, slug.success ? settings : null, ctx.renderDefaults);
			const options: RenderOptions = {
				theme: isThemeId(theme) ? theme : inherited.theme,
				mode: isDisplayMode(mode) ? mode : inherited.mode,
				locale: isAppLocale(locale) ? locale : inherited.locale,
			};
			return html(
				reply,
				200,
				previewMessages(
					options,
					slug.success ? slug.data.slug : "your-org/your-repo",
					access.session.username,
				),
			);
		},
	);

	app.post<{ Params: GuildParams }>(
		"/dashboard/g/:guildId/settings/style",
		async (request, reply) => {
			const access = await writeAccess(request, reply);
			if (!access) return reply;
			const theme = access.form.get("theme");
			const mode = access.form.get("mode");
			const locale = access.form.get("locale");
			await ctx.repository.updateGuildSettings(access.guildId, {
				defaultTheme: isThemeId(theme) ? theme : null,
				defaultDisplayMode: isDisplayMode(mode) ? mode : null,
				locale: isAppLocale(locale) ? locale : null,
			});
			await audit(access.session, access.guildId, "server.appearance");
			return reply.redirect(guildPath(access.guildId, "/settings?notice=settings_saved"));
		},
	);

	app.post<{ Params: GuildParams }>(
		"/dashboard/g/:guildId/settings/alerts",
		async (request, reply) => {
			const access = await writeAccess(request, reply);
			if (!access) return reply;
			const channel = (access.form.get("channel") ?? "").trim();
			if (channel && !(await channelInGuild(ctx.discord, access.guildId, channel, access.viewer))) {
				return reply.redirect(guildPath(access.guildId, "/settings?notice=bad_channel"));
			}
			await ctx.repository.updateGuildSettings(access.guildId, {
				alertChannelId: channel || null,
			});
			await audit(access.session, access.guildId, "server.alerts");
			return reply.redirect(guildPath(access.guildId, "/settings?notice=alerts_saved"));
		},
	);

	// ------------------------------------------------------ add repository --

	app.get<{ Params: GuildParams }>("/dashboard/g/:guildId/repos/new", async (request, reply) => {
		const access = await guildAccess(request, reply);
		if (!access) return reply;
		const repos = await ctx.repository.listRepos(access.guildId);
		return html(
			reply,
			200,
			newRepoPage(
				shellFor(access.session, access.guildId, "repos", repos),
				guildDirectory(ctx.discord, access.guildId, access.viewer),
				{ repository: "", channel: "" },
				null,
			),
		);
	});

	app.post<{ Params: GuildParams }>("/dashboard/g/:guildId/repos/new", async (request, reply) => {
		const access = await writeAccess(request, reply);
		if (!access) return reply;
		const { session, guildId, form, viewer } = access;
		const values = {
			repository: (form.get("repository") ?? "").trim().slice(0, 200),
			channel: (form.get("channel") ?? "").trim(),
		};
		const again = async (status: number, error: string) =>
			html(
				reply,
				status,
				newRepoPage(
					shellFor(session, guildId, "repos", await ctx.repository.listRepos(guildId)),
					guildDirectory(ctx.discord, guildId, viewer),
					values,
					error,
				),
			);

		const slug = repoSlugSchema.safeParse(values.repository);
		if (!slug.success) return again(400, "Enter the repository as owner/repo.");
		if (!(await channelInGuild(ctx.discord, guildId, values.channel, viewer))) {
			return again(400, "Pick a text, announcement, forum or thread channel in this server.");
		}
		const { owner, repo } = slug.data;
		if (await ctx.repository.getRepo(guildId, owner, repo)) {
			return again(409, `${slug.data.slug} is already tracked in this server.`);
		}
		const limit = ctx.env.MAX_REPOS_PER_SERVER;
		if ((await ctx.repository.listRepos(guildId)).length >= limit) {
			return again(
				409,
				`This server already tracks ${limit} repositories, the most this instance allows. Remove one first.`,
			);
		}

		const secret = generateWebhookSecret();
		const tracked = await ctx.repository.addRepo({
			guildId,
			owner,
			repo,
			channelId: values.channel,
			trackingId: generateTrackingId(),
			encryptedSecret: encryptSecret(secret, ctx.masterKey),
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});
		await audit(session, tracked, "repo.added");
		// Rendered straight from the POST rather than after a redirect: the secret is
		// shown once and must never travel in a URL.
		return renderRepo(reply, session, viewer, tracked, "webhook", {}, secret, {
			kind: "ok",
			text: "Repository added. Finish by creating the webhook on GitHub with the URL and secret below.",
		});
	});

	// --------------------------------------------------------- repository --

	async function renderRepo(
		reply: FastifyReply,
		session: DashboardSession,
		viewer: GuildMember | null,
		repo: TrackedRepo,
		tab: RepoTab,
		query: Query,
		secret: string | null,
		notice: Notice | null,
	): Promise<FastifyReply> {
		const [repos, settings, activity, log] = await Promise.all([
			ctx.repository.listRepos(repo.guildId),
			ctx.repository.getGuildSettings(repo.guildId),
			ctx.repository.activityByDay([repo.trackingId], ACTIVITY_DAYS),
			tab === "deliveries"
				? loadLog([repo.trackingId], query)
				: tab === "overview"
					? ctx.repository
							.listDeliveryLog([repo.trackingId], { limit: 8 })
							.then((rows) => ({ rows, outcome: "", nextBefore: null }))
					: { rows: [], outcome: "", nextBefore: null },
		]);
		const effective = renderOptionsFor(repo, settings, ctx.renderDefaults);
		return html(
			reply,
			200,
			repoPage(shellFor(session, repo.guildId, "repos", repos), {
				view: {
					repo,
					channelName: await channelName(repo.channelId),
					activity: activity.get(repo.trackingId) ?? new Array<number>(ACTIVITY_DAYS).fill(0),
				},
				tab,
				directory: guildDirectory(ctx.discord, repo.guildId, viewer),
				settings,
				effective,
				log: log.rows,
				logFilter: { outcome: log.outcome, nextBefore: log.nextBefore },
				webhookUrl: `${ctx.env.PUBLIC_WEBHOOK_URL ?? ctx.env.DASHBOARD_BASE_URL}/webhooks/github/${repo.trackingId}`,
				secret,
				previewHtml:
					tab === "appearance"
						? previewMessages(effective, `${repo.owner}/${repo.repo}`, session.username)
						: "",
				notice,
			}),
		);
	}

	app.get<{ Params: RepoParams; Querystring: Query }>(
		"/dashboard/g/:guildId/r/:owner/:repo",
		async (request, reply) => {
			const access = await guildAccess(request, reply);
			if (!access) return reply;
			const repo = await repoOr404(access.guildId, request.params, reply);
			if (!repo) return reply;
			const tab = isRepoTab(request.query.tab) ? request.query.tab : "overview";
			return renderRepo(
				reply,
				access.session,
				access.viewer,
				repo,
				tab,
				request.query,
				null,
				noticeFrom(request.query),
			);
		},
	);

	const back = (repo: TrackedRepo, tab: RepoTab, notice: string) =>
		repoPath(repo, `?${tab === "overview" ? "" : `tab=${tab}&`}notice=${notice}`);

	for (const [action, paused] of [
		["pause", true],
		["resume", false],
	] as const) {
		app.post<{ Params: RepoParams }>(
			`/dashboard/g/:guildId/r/:owner/:repo/${action}`,
			async (request, reply) => {
				const found = await repoWrite(request, reply);
				if (!found) return reply;
				await ctx.repository.setPaused(
					found.repo.guildId,
					found.repo.owner,
					found.repo.repo,
					paused,
				);
				await audit(found.session, found.repo, paused ? "repo.paused" : "repo.resumed");
				return reply.redirect(back(found.repo, "overview", paused ? "paused" : "resumed"));
			},
		);
	}

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/test",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { session, repo, form } = found;
			const event = eventTypeSchema.safeParse(form.get("event") ?? repo.enabledEvents[0] ?? "push");
			if (!event.success) return reply.redirect(back(repo, "overview", "bad_event"));

			const slug = `${repo.owner}/${repo.repo}`;
			const guild = await ctx.repository.getGuildSettings(repo.guildId);
			const outcome = await deliverTemplate(
				dispatchContext(),
				repo,
				event.data,
				sampleTemplate(event.data, slug, `https://github.com/${slug}`, {
					login: session.username,
					...(session.avatarUrl ? { avatarUrl: session.avatarUrl } : {}),
				}),
				renderOptionsFor(repo, guild, ctx.renderDefaults),
			);
			await audit(session, repo, "repo.test", `${event.data}: ${outcome.status}`);
			return reply.redirect(
				back(repo, "overview", outcome.status === "delivered" ? "test_ok" : "test_failed"),
			);
		},
	);

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/events",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { repo, form } = found;
			const preset = PRESETS[form.get("preset") ?? ""];
			const chosen = new Set(form.getAll("events"));
			// Filtered against the known list, in its order: a posted name that is not
			// an event is dropped rather than stored.
			const events = preset ? [...preset] : EVENT_TYPES.filter((event) => chosen.has(event));
			await ctx.repository.updateEvents(repo.guildId, repo.owner, repo.repo, events);
			await audit(found.session, repo, "repo.events", `${events.length} enabled`);
			return reply.redirect(back(repo, "events", "events_saved"));
		},
	);

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/filters",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { repo, form } = found;
			const list = (name: string) =>
				parseFilterList(form.get(name)).map((entry) => entry.slice(0, 100));
			await ctx.repository.updateFilters(repo.guildId, repo.owner, repo.repo, {
				branchInclude: list("branchInclude"),
				branchExclude: list("branchExclude"),
				labels: list("labels"),
				ignoredActors: list("ignoredActors"),
			});
			await audit(found.session, repo, "repo.filters");
			return reply.redirect(back(repo, "filters", "filters_saved"));
		},
	);

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/channel",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { repo, form } = found;
			const channel = (form.get("channel") ?? "").trim();
			if (!(await channelInGuild(ctx.discord, repo.guildId, channel, found.viewer))) {
				return reply.redirect(back(repo, "routing", "bad_channel"));
			}
			await ctx.repository.updateChannel(repo.guildId, repo.owner, repo.repo, channel);
			await audit(found.session, repo, "repo.channel");
			return reply.redirect(back(repo, "routing", "channel_saved"));
		},
	);

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/routing",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { repo, form } = found;
			// Start from what is stored so rules keyed by a single event type, which
			// this form does not show, are carried over untouched.
			const routes = { ...repo.eventRoutes };
			const mentions = { ...repo.mentionRules };
			for (const { id } of EVENT_CATEGORIES) {
				const channel = (form.get(`route.${id}`) ?? "").trim();
				const role = (form.get(`mention.${id}`) ?? "").trim();
				// Unchanged values are kept as they are: a channel deleted since, or one
				// the bot can no longer see, must not block saving the rest of the form.
				if (channel && channel !== repo.eventRoutes[id]) {
					if (!(await channelInGuild(ctx.discord, repo.guildId, channel, found.viewer))) {
						return reply.redirect(back(repo, "routing", "bad_channel"));
					}
				}
				if (role && role !== repo.mentionRules[id]?.[0]) {
					if (!roleInGuild(ctx.discord, repo.guildId, role)) {
						return reply.redirect(back(repo, "routing", "bad_role"));
					}
				}
				if (channel) routes[id] = channel;
				else delete routes[id];
				if (role) mentions[id] = [role];
				else delete mentions[id];
			}
			await ctx.repository.updateRoutes(repo.guildId, repo.owner, repo.repo, routes);
			await ctx.repository.updateMentions(repo.guildId, repo.owner, repo.repo, mentions);
			await audit(found.session, repo, "repo.routing");
			return reply.redirect(back(repo, "routing", "routing_saved"));
		},
	);

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/style",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { repo, form } = found;
			const theme = form.get("theme");
			const mode = form.get("mode");
			const locale = form.get("locale");
			await ctx.repository.updateStyle(repo.guildId, repo.owner, repo.repo, {
				theme: isThemeId(theme) ? theme : null,
				displayMode: isDisplayMode(mode) ? mode : null,
				locale: isAppLocale(locale) ? locale : null,
			});
			await audit(found.session, repo, "repo.appearance");
			return reply.redirect(back(repo, "appearance", "style_saved"));
		},
	);

	// A POST, so the secret is only ever sent in answer to a request that carried
	// the form token — never to a link, a prefetch or a history entry.
	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/secret/reveal",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const secret = tryDecryptSecret(found.repo.encryptedSecret, ctx.masterKey);
			await audit(found.session, found.repo, "secret.revealed");
			return renderRepo(
				reply,
				found.session,
				found.viewer,
				found.repo,
				"webhook",
				{},
				secret,
				secret === null ? (NOTICES.undecryptable ?? null) : null,
			);
		},
	);

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/secret/rotate",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { repo } = found;
			const secret = generateWebhookSecret();
			const updated = await ctx.repository.rotateSecret({
				guildId: repo.guildId,
				owner: repo.owner,
				repo: repo.repo,
				encryptedSecret: encryptSecret(secret, ctx.masterKey),
				// A secret stored under an earlier MASTER_KEY cannot bridge anything, so
				// only keep the old one as a fallback while it still decrypts.
				encryptedPreviousSecret:
					tryDecryptSecret(repo.encryptedSecret, ctx.masterKey) === null
						? null
						: repo.encryptedSecret,
			});
			await audit(found.session, repo, "secret.rotated");
			return renderRepo(
				reply,
				found.session,
				found.viewer,
				updated ?? repo,
				"webhook",
				{},
				secret,
				{
					kind: "ok",
					text: "New secret generated. Update the webhook on GitHub; the previous secret keeps working until GitHub first uses this one.",
				},
			);
		},
	);

	app.post<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo/remove",
		async (request, reply) => {
			const found = await repoWrite(request, reply);
			if (!found) return reply;
			const { repo, form } = found;
			if (form.get("confirm") !== "yes") {
				return reply.redirect(back(repo, "webhook", "confirm"));
			}
			await ctx.repository.removeRepo(repo.guildId, repo.owner, repo.repo);
			await audit(found.session, repo, "repo.removed");
			return reply.redirect(guildPath(repo.guildId, "/repos?notice=removed"));
		},
	);
}
