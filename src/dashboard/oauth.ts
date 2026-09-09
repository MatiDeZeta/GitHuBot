import { randomBytes } from "node:crypto";
import type { DashboardEnv } from "../config/env.js";

/** Discord's MANAGE_GUILD bit — the same gate `/repo` uses via setDefaultMemberPermissions. */
const MANAGE_GUILD = 1n << 5n;

const DISCORD_API = "https://discord.com/api/v10";

export interface DiscordUser {
	id: string;
	username: string;
	avatarUrl: string | null;
}

export interface ManageableGuild {
	id: string;
	name: string;
}

export function redirectUri(env: DashboardEnv): string {
	return `${env.DASHBOARD_BASE_URL}/dashboard/auth/callback`;
}

export function createOAuthState(): string {
	return randomBytes(24).toString("base64url");
}

export function authorizeUrl(env: DashboardEnv, state: string): string {
	const params = new URLSearchParams({
		client_id: env.DISCORD_CLIENT_ID,
		redirect_uri: redirectUri(env),
		response_type: "code",
		// `identify` names the user, `guilds` lists their servers and permission bits.
		// Neither can read messages, post, or change anything.
		scope: "identify guilds",
		state,
		prompt: "none",
	});
	return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(env: DashboardEnv, code: string): Promise<string> {
	const response = await fetch(`${DISCORD_API}/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.DISCORD_CLIENT_ID,
			client_secret: env.DISCORD_CLIENT_SECRET,
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri(env),
		}),
	});

	if (!response.ok) {
		// The body can echo the client secret back in an error envelope; never log it.
		throw new Error(`Discord token exchange failed with ${response.status}`);
	}

	const body: unknown = await response.json();
	const token = (body as { access_token?: unknown }).access_token;
	if (typeof token !== "string") throw new Error("Discord token exchange returned no access_token");
	return token;
}

async function fetchJson(path: string, accessToken: string): Promise<unknown> {
	const response = await fetch(`${DISCORD_API}${path}`, {
		headers: { authorization: `Bearer ${accessToken}` },
	});
	if (!response.ok) throw new Error(`Discord ${path} failed with ${response.status}`);
	return response.json();
}

function avatarUrl(id: string, hash: unknown): string | null {
	if (typeof hash !== "string" || hash.length === 0) return null;
	return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
}

/**
 * Exchanges the code and resolves who signed in, keeping only the guilds where
 * Discord itself reports MANAGE_GUILD. Everything downstream trusts this list and
 * nothing else, so a user cannot reach a guild by guessing its id.
 */
export async function completeSignIn(
	env: DashboardEnv,
	code: string,
): Promise<{ user: DiscordUser; guilds: ManageableGuild[] }> {
	const accessToken = await exchangeCode(env, code);

	const rawUser = (await fetchJson("/users/@me", accessToken)) as Record<string, unknown>;
	if (typeof rawUser.id !== "string" || typeof rawUser.username !== "string") {
		throw new Error("Discord returned an unexpected user payload");
	}

	const rawGuilds = await fetchJson("/users/@me/guilds", accessToken);
	const guilds: ManageableGuild[] = [];
	if (Array.isArray(rawGuilds)) {
		for (const entry of rawGuilds) {
			const guild = entry as Record<string, unknown>;
			if (typeof guild.id !== "string" || typeof guild.name !== "string") continue;
			if (!hasManageGuild(guild.permissions, guild.owner)) continue;
			guilds.push({ id: guild.id, name: guild.name });
		}
	}

	return {
		user: {
			id: rawUser.id,
			username: rawUser.username,
			avatarUrl: avatarUrl(rawUser.id, rawUser.avatar),
		},
		guilds,
	};
}

/** Permissions arrive as a decimal string that overflows Number, so compare as BigInt. */
function hasManageGuild(permissions: unknown, owner: unknown): boolean {
	if (owner === true) return true;
	if (typeof permissions !== "string") return false;
	try {
		return (BigInt(permissions) & MANAGE_GUILD) === MANAGE_GUILD;
	} catch {
		return false;
	}
}
