import type { Client } from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sampleTemplate } from "../bot/render/samples.js";
import type { DashboardEnv } from "../config/env.js";
import type { Logger } from "../config/logger.js";
import type { RepoRepository, TrackedRepo } from "../db/types.js";
import { type DispatchContext, deliverTemplate, renderOptionsFor } from "../delivery/dispatch.js";
import { metrics } from "../metrics.js";
import { authorizeUrl, completeSignIn, createOAuthState } from "./oauth.js";
import {
	clearCookie,
	cookieName,
	createCsrfToken,
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
	errorPage,
	overviewPage,
	type RepoView,
	repoDetailPage,
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

/**
 * The page ships zero JavaScript, so `script-src 'none'` is achievable — an HTML
 * escaping mistake still could not execute anything. `style-src 'unsafe-inline'`
 * is required because the markup styles elements inline.
 */
const CSP = [
	"default-src 'none'",
	"script-src 'none'",
	"style-src 'unsafe-inline'",
	"img-src 'self' data:",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"base-uri 'none'",
	"connect-src 'none'",
].join("; ");

export async function registerDashboard(
	app: FastifyInstance,
	ctx: DashboardContext,
): Promise<void> {
	// Cookies are only marked Secure on https, otherwise a local http deployment
	// would silently never receive them back.
	const secure = ctx.env.DASHBOARD_BASE_URL.startsWith("https://");
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
				done(null, Object.fromEntries(new URLSearchParams(String(body))));
			},
		);

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
			// Every dashboard page is per-user data behind a cookie; never let a proxy
			// or the back button hand it to someone else.
			reply.header("cache-control", "no-store, max-age=0");
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

function registerRoutes(app: FastifyInstance, ctx: DashboardContext, opts: RouteOptions): void {
	const { secure, sessionSeconds, sessionCookie, stateCookie } = opts;

	function sessionOf(request: FastifyRequest): DashboardSession | null {
		return decodeSession(readCookie(request.headers.cookie, sessionCookie), ctx.masterKey);
	}

	function html(reply: FastifyReply, status: number, body: string): FastifyReply {
		return reply.code(status).header("content-type", HTML).send(body);
	}

	app.get("/dashboard", async (request, reply) => {
		const session = sessionOf(request);
		if (!session) return html(reply, 200, signInPage());
		const first = session.guilds[0];
		if (!first) {
			return html(
				reply,
				200,
				errorPage(200, "You do not have Manage Server on any server GitHuBot is in."),
			);
		}
		return reply.redirect(`/dashboard/g/${encodeURIComponent(first.id)}`);
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

	app.get("/dashboard/logout", async (_request, reply) => {
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

	app.get<{ Params: { guildId: string } }>("/dashboard/g/:guildId", async (request, reply) => {
		const session = sessionOf(request);
		if (!session) return reply.redirect("/dashboard");

		const { guildId } = request.params;
		if (!session.guildIds.includes(guildId)) {
			return html(reply, 403, errorPage(403, "You do not manage that server."));
		}

		const repos = await ctx.repository.listRepos(guildId);
		const activity = await ctx.repository.activityByDay(
			repos.map((repo) => repo.trackingId),
			ACTIVITY_DAYS,
		);
		const views = await Promise.all(
			repos.map((repo) => toView(ctx, repo, activity.get(repo.trackingId))),
		);
		return html(reply, 200, overviewPage(session, guildId, views, metrics.snapshot()));
	});

	app.get<{ Params: RepoParams }>(
		"/dashboard/g/:guildId/r/:owner/:repo",
		async (request, reply) => {
			const found = await requireRepo(ctx, request, reply, sessionOf(request));
			if (!found) return reply;
			const { session, repo } = found;

			const view = await toView(ctx, repo);
			const channelNames = await resolveRouteNames(ctx, repo);
			const roleNames = await resolveRoleNames(ctx, repo);
			const notice = noticeFrom(request.query as Record<string, unknown>);
			return html(reply, 200, repoDetailPage(session, view, channelNames, roleNames, notice));
		},
	);

	app.post<{ Params: RepoParams; Body: Record<string, string> }>(
		"/dashboard/g/:guildId/r/:owner/:repo/pause",
		async (request, reply) => setPaused(ctx, request, reply, sessionOf(request), true),
	);

	app.post<{ Params: RepoParams; Body: Record<string, string> }>(
		"/dashboard/g/:guildId/r/:owner/:repo/resume",
		async (request, reply) => setPaused(ctx, request, reply, sessionOf(request), false),
	);

	app.post<{ Params: RepoParams; Body: Record<string, string> }>(
		"/dashboard/g/:guildId/r/:owner/:repo/test",
		async (request, reply) => {
			const found = await requireRepo(ctx, request, reply, sessionOf(request));
			if (!found) return reply;
			const { session, repo } = found;
			if (!csrfMatches(session.csrfToken, request.body?.csrf)) {
				return reply
					.code(403)
					.header("content-type", HTML)
					.send(errorPage(403, "Invalid form token."));
			}

			const guild = await ctx.repository.getGuildSettings(repo.guildId);
			const options = renderOptionsFor(repo, guild, ctx.renderDefaults);
			const template = sampleTemplate(
				repo.enabledEvents[0] ?? "push",
				`${repo.owner}/${repo.repo}`,
				`https://github.com/${repo.owner}/${repo.repo}`,
				{ login: session.username },
			);

			const outcome = await deliverTemplate(
				{
					client: ctx.discord,
					repository: ctx.repository,
					logger: ctx.logger,
					defaults: ctx.renderDefaults,
				},
				repo,
				repo.enabledEvents[0] ?? "push",
				template,
				options,
			);

			ctx.logger.info(
				{ userId: session.userId, repo: `${repo.owner}/${repo.repo}`, outcome: outcome.status },
				"Dashboard test message",
			);
			return reply.redirect(
				`${repoPath(repo)}?notice=${outcome.status === "delivered" ? "test_ok" : "test_failed"}`,
			);
		},
	);
}

interface RepoParams {
	guildId: string;
	owner: string;
	repo: string;
}

function repoPath(repo: TrackedRepo): string {
	return `/dashboard/g/${encodeURIComponent(repo.guildId)}/r/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
}

/**
 * Every repo-scoped route funnels through here: it re-checks that the signed-in
 * user manages the guild in the URL, so a valid session for one server can never
 * read or act on another.
 */
async function requireRepo(
	ctx: DashboardContext,
	request: FastifyRequest<{ Params: RepoParams }>,
	reply: FastifyReply,
	session: DashboardSession | null,
): Promise<{ session: DashboardSession; repo: TrackedRepo } | null> {
	if (!session) {
		await reply.redirect("/dashboard");
		return null;
	}
	const { guildId, owner, repo } = request.params;
	if (!session.guildIds.includes(guildId)) {
		await reply
			.code(403)
			.header("content-type", HTML)
			.send(errorPage(403, "You do not manage that server."));
		return null;
	}
	const tracked = await ctx.repository.getRepo(guildId, owner, repo);
	if (!tracked) {
		await reply
			.code(404)
			.header("content-type", HTML)
			.send(errorPage(404, "That repository is not tracked here."));
		return null;
	}
	return { session, repo: tracked };
}

async function setPaused(
	ctx: DashboardContext,
	request: FastifyRequest<{ Params: RepoParams; Body: Record<string, string> }>,
	reply: FastifyReply,
	session: DashboardSession | null,
	paused: boolean,
): Promise<FastifyReply> {
	const found = await requireRepo(ctx, request, reply, session);
	if (!found) return reply;
	if (!csrfMatches(found.session.csrfToken, request.body?.csrf)) {
		return reply.code(403).header("content-type", HTML).send(errorPage(403, "Invalid form token."));
	}

	await ctx.repository.setPaused(found.repo.guildId, found.repo.owner, found.repo.repo, paused);
	ctx.logger.info(
		{ userId: found.session.userId, repo: `${found.repo.owner}/${found.repo.repo}`, paused },
		"Dashboard pause toggled",
	);
	return reply.redirect(`${repoPath(found.repo)}?notice=${paused ? "paused" : "resumed"}`);
}

async function channelName(ctx: DashboardContext, channelId: string): Promise<string> {
	const channel = await ctx.discord.channels.fetch(channelId).catch(() => null);
	if (channel && "name" in channel && typeof channel.name === "string") return channel.name;
	return channelId;
}

async function toView(
	ctx: DashboardContext,
	repo: TrackedRepo,
	activity?: number[],
): Promise<RepoView> {
	return {
		repo,
		channelName: await channelName(ctx, repo.channelId),
		activity: activity ?? new Array<number>(ACTIVITY_DAYS).fill(0),
	};
}

async function resolveRouteNames(
	ctx: DashboardContext,
	repo: TrackedRepo,
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	for (const channelId of Object.values(repo.eventRoutes)) {
		if (!names.has(channelId)) names.set(channelId, await channelName(ctx, channelId));
	}
	return names;
}

/** Role ids are meaningless to a human; show the name where Discord will give it. */
async function resolveRoleNames(
	ctx: DashboardContext,
	repo: TrackedRepo,
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	const ids = [...new Set(Object.values(repo.mentionRules).flat())];
	if (ids.length === 0) return names;

	const guild = await ctx.discord.guilds.fetch(repo.guildId).catch(() => null);
	if (!guild) return names;

	for (const id of ids) {
		const role = await guild.roles.fetch(id).catch(() => null);
		if (role) names.set(id, role.name);
	}
	return names;
}

const NOTICES: Record<string, { kind: "ok" | "error"; text: string }> = {
	paused: { kind: "ok", text: "Deliveries paused. GitHub keeps sending; nothing is posted." },
	resumed: { kind: "ok", text: "Deliveries resumed." },
	test_ok: { kind: "ok", text: "Test message posted to the target channel." },
	test_failed: {
		kind: "error",
		text: "Test message could not be posted — see the last error below.",
	},
};

function noticeFrom(query: Record<string, unknown>): { kind: "ok" | "error"; text: string } | null {
	const notice = query.notice;
	return typeof notice === "string" ? (NOTICES[notice] ?? null) : null;
}
