import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	decryptSecret,
	encryptSecret,
	generateTrackingId,
	generateWebhookSecret,
	parseMasterKey,
} from "../crypto/secrets.js";
import { verifyGitHubSignature } from "../github/verify.js";
import { githubEventToType, repoSlugSchema } from "../config/events.js";
import { formatGitHubEvent } from "../bot/components/index.js";
import { createDb, migrate } from "../db/index.js";
import { DEFAULT_ENABLED_EVENTS } from "../config/events.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("crypto secrets", () => {
	const key = parseMasterKey(randomBytes(32).toString("hex"));

	it("round-trips encrypt/decrypt", () => {
		const secret = generateWebhookSecret();
		const encrypted = encryptSecret(secret, key);
		expect(encrypted).not.toEqual(secret);
		expect(decryptSecret(encrypted, key)).toEqual(secret);
	});

	it("rejects tampered ciphertext", () => {
		const encrypted = encryptSecret("hello", key);
		const buf = Buffer.from(encrypted, "base64");
		buf[buf.length - 1] ^= 0xff;
		expect(() => decryptSecret(buf.toString("base64"), key)).toThrow();
	});

	it("generates unique tracking ids", () => {
		expect(generateTrackingId()).not.toEqual(generateTrackingId());
		expect(generateTrackingId()).toMatch(/^[0-9a-f]{32}$/);
	});

	it("parses base64 master keys", () => {
		const raw = randomBytes(32);
		const parsed = parseMasterKey(raw.toString("base64"));
		expect(parsed.equals(raw)).toBe(true);
	});
});

describe("repo slug validation", () => {
	it("accepts owner/repo", () => {
		const result = repoSlugSchema.parse("octocat/Hello-World");
		expect(result).toEqual({
			owner: "octocat",
			repo: "Hello-World",
			slug: "octocat/Hello-World",
		});
	});

	it("rejects invalid formats", () => {
		expect(() => repoSlugSchema.parse("nonsplash")).toThrow();
		expect(() => repoSlugSchema.parse("a/b/c")).toThrow();
		expect(() => repoSlugSchema.parse("")).toThrow();
	});
});

describe("github event mapping", () => {
	it("maps watch to star", () => {
		expect(githubEventToType("watch")).toBe("star");
		expect(githubEventToType("push")).toBe("push");
		expect(githubEventToType("nonsense")).toBeNull();
	});
});

describe("signature verification", () => {
	it("accepts a valid signature and rejects a bad one", async () => {
		const secret = "test-secret";
		const body = JSON.stringify({ zen: "design for failure" });
		const digest = createHmac("sha256", secret).update(body).digest("hex");
		const signature = `sha256=${digest}`;

		expect(await verifyGitHubSignature(secret, body, signature)).toBe("primary");
		expect(await verifyGitHubSignature(secret, body, "sha256=deadbeef")).toBe(false);
		expect(await verifyGitHubSignature(secret, body, undefined)).toBe(false);
	});

	it("accepts the previous secret during rotation via verifyWithFallback", async () => {
		const current = "new-secret";
		const previous = "old-secret";
		const body = JSON.stringify({ zen: "keep deliveries flowing" });
		const oldSig = `sha256=${createHmac("sha256", previous).update(body).digest("hex")}`;
		const newSig = `sha256=${createHmac("sha256", current).update(body).digest("hex")}`;

		expect(await verifyGitHubSignature(current, body, oldSig, [previous])).toBe("fallback");
		expect(await verifyGitHubSignature(current, body, newSig, [previous])).toBe("primary");
		expect(await verifyGitHubSignature(current, body, oldSig)).toBe(false);
	});
});

describe("formatters", () => {
	it("formats a push with commit subjects as the focus", () => {
		const msg = formatGitHubEvent("push", {
			ref: "refs/heads/main",
			compare: "https://github.com/acme/app/compare/abc...def",
			commits: [
				{
					id: "abcdef1234567890",
					message: "feat: add thing\n\nbody",
					url: "https://github.com/acme/app/commit/abcdef1234567890",
					author: { name: "Ada", username: "ada" },
				},
			],
			sender: {
				login: "ada",
				avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
			},
			repository: {
				full_name: "acme/app",
				html_url: "https://github.com/acme/app",
				name: "app",
				owner: { login: "acme" },
			},
		});
		expect(msg).not.toBeNull();
		const serialized = JSON.stringify(msg);
		expect(serialized).toContain("`acme/app`");
		expect(serialized).not.toContain("**acme/app**");
		expect(serialized).toContain("**feat: add thing**");
		expect(msg?.flags).toBeDefined();
	});

	it("suppresses empty-commit pushes", () => {
		const msg = formatGitHubEvent("push", {
			ref: "refs/tags/v1.0.0",
			commits: [],
			head_commit: {
				id: "abcdef1234567890",
				message: "tag",
				url: "https://github.com/acme/app/commit/abcdef1234567890",
			},
			repository: {
				full_name: "acme/app",
				html_url: "https://github.com/acme/app",
				name: "app",
				owner: { login: "acme" },
			},
		});
		expect(msg).toBeNull();
	});

	it("formats a slim release without dumping release notes body", () => {
		const msg = formatGitHubEvent("release", {
			action: "published",
			release: {
				html_url: "https://github.com/acme/app/releases/tag/v1.0.0",
				tag_name: "v1.0.0",
				name: "GitHuBot v1.0.0 — Release Notes",
				body: "# GitHuBot v1.0.0 — Release Notes\n\n## Highlights\n\n- lots of notes",
				author: {
					login: "ada",
					avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
				},
				assets: [],
			},
			repository: {
				full_name: "acme/app",
				html_url: "https://github.com/acme/app",
				name: "app",
				owner: { login: "acme" },
			},
		});
		expect(msg).not.toBeNull();
		const serialized = JSON.stringify(msg);
		expect(serialized).toContain("**v1.0.0**");
		expect(serialized).not.toContain("## Highlights");
		expect(serialized).not.toContain("lots of notes");
	});

	it("formats a merged pull request distinctly", () => {
		const msg = formatGitHubEvent("pull_request", {
			action: "closed",
			number: 42,
			pull_request: {
				html_url: "https://github.com/acme/app/pull/42",
				title: "Ship it",
				body: "Notes",
				merged: true,
				user: {
					login: "ada",
					avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
				},
				base: { ref: "main" },
				head: { ref: "feature" },
			},
			repository: {
				full_name: "acme/app",
				html_url: "https://github.com/acme/app",
				name: "app",
				owner: { login: "acme" },
			},
		});
		expect(msg).not.toBeNull();

		const closed = formatGitHubEvent("pull_request", {
			action: "closed",
			number: 43,
			pull_request: {
				html_url: "https://github.com/acme/app/pull/43",
				title: "Nope",
				merged: false,
				user: { login: "ada" },
			},
			repository: {
				full_name: "acme/app",
				html_url: "https://github.com/acme/app",
				name: "app",
				owner: { login: "acme" },
			},
		});
		expect(closed).not.toBeNull();
		expect(JSON.stringify(msg)).not.toEqual(JSON.stringify(closed));
		expect(JSON.stringify(msg)).toContain("**Ship it**");
		expect(JSON.stringify(msg)).not.toContain("**acme/app**");
	});
});

describe("delivery dedupe", () => {
	it("records a delivery only once", async () => {
		const dir = join(tmpdir(), `githubot-test-${createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 8)}`);
		mkdirSync(dir, { recursive: true });
		const dbPath = join(dir, "test.db");
		const url = `file:${dbPath}`;

		await migrate(url);
		const db = createDb(url);

		await db.repository.ensureGuild("guild-1");
		await db.repository.addRepo({
			guildId: "guild-1",
			owner: "acme",
			repo: "app",
			channelId: "channel-1",
			trackingId: "track-1",
			encryptedSecret: "enc",
			enabledEvents: [...DEFAULT_ENABLED_EVENTS],
		});

		const first = await db.repository.tryRecordDelivery("delivery-1", "track-1");
		const second = await db.repository.tryRecordDelivery("delivery-1", "track-1");
		expect(first).toBe(true);
		expect(second).toBe(false);

		await db.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
