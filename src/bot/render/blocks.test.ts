import { describe, expect, it } from "vitest";
import { envWarnings, loadEnv } from "../../config/env.js";
import { escapeMarkdown, neutralizeBodyMarkdown, plainText, stripInvisible } from "./blocks.js";
import { quote } from "./events/common.js";

describe("untrusted text hardening", () => {
	it("escapes markdown control characters in titles", () => {
		expect(escapeMarkdown("**bold** _em_")).toBe("\\*\\*bold\\*\\* \\_em\\_");
	});

	it("strips zero-width and bidi characters used to spoof identities", () => {
		expect(stripInvisible("ad​min")).toBe("admin");
		expect(stripInvisible("safe‮gnp.exe")).toBe("safegnp.exe");
		expect(escapeMarkdown("oct‍ocat")).toBe("octocat");
	});

	it("neutralizes link syntax so a body cannot relabel a link", () => {
		const body = "[Verify your account](https://evil.example)";
		expect(neutralizeBodyMarkdown(body)).toBe("\\[Verify your account\\](https://evil.example)");
	});

	it("escapes headings so a body cannot impersonate our own heading", () => {
		expect(neutralizeBodyMarkdown("## Highlights")).toBe("\\## Highlights");
		expect(neutralizeBodyMarkdown("# Title\n### Sub")).toBe("\\# Title\n\\### Sub");
	});

	it("leaves ordinary body formatting alone", () => {
		const body = "Fixes a bug in `parse()` — see **notes** below.";
		expect(neutralizeBodyMarkdown(body)).toBe(body);
	});

	it("quotes a body and applies the same hardening per line", () => {
		const quoted = quote("## Heading\n[label](https://evil.example)");
		expect(quoted).toBe("> \\## Heading\n> \\[label\\](https://evil.example)");
	});

	it("escapes masked-link syntax in titles, not just bodies", () => {
		expect(escapeMarkdown("[Click](https://evil.example)")).toBe(
			"\\[Click\\](https://evil.example)",
		);
	});

	it("never lets untrusted text render a role, channel or command pill", () => {
		expect(escapeMarkdown("<@&123> <#456> </deploy:789>")).toBe(
			"\\<@&123\\> \\<#456\\> \\</deploy:789\\>",
		);
		expect(neutralizeBodyMarkdown("ping <@&123>")).toBe("ping \\<@&123>");
	});

	it("escapes subtext so a body cannot pass for our metadata line", () => {
		expect(neutralizeBodyMarkdown("-# by admin")).toBe("\\-# by admin");
	});

	it("turns escaped text back into plain text for thread names", () => {
		const raw = "fix_[x](y) <@&1>";
		expect(plainText(escapeMarkdown(raw))).toBe(raw);
		expect(plainText("Push to `main`")).toBe("Push to main");
	});

	it("returns undefined for an empty body", () => {
		expect(quote("   ")).toBeUndefined();
		expect(quote(null)).toBeUndefined();
	});
});

describe("environment validation", () => {
	it("rejects a numeric TRUST_PROXY hop count", () => {
		// A bare hop count is the shape vulnerable to X-Forwarded-For spoofing.
		expect(() => loadEnv({ TRUST_PROXY: "2" } as NodeJS.ProcessEnv)).toThrow(/TRUST_PROXY/);
	});

	it("accepts booleans and CIDR lists for TRUST_PROXY", () => {
		expect(loadEnv({ TRUST_PROXY: "true" } as NodeJS.ProcessEnv).TRUST_PROXY).toBe(true);
		expect(loadEnv({ TRUST_PROXY: "false" } as NodeJS.ProcessEnv).TRUST_PROXY).toBe(false);
		expect(loadEnv({ TRUST_PROXY: "loopback, 10.0.0.0/8" } as NodeJS.ProcessEnv).TRUST_PROXY).toBe(
			"loopback, 10.0.0.0/8",
		);
	});

	it("caps the webhook body limit at GitHub's own 25 MiB ceiling", () => {
		expect(loadEnv({} as NodeJS.ProcessEnv).WEBHOOK_BODY_LIMIT).toBe(25 * 1024 * 1024);
		expect(() =>
			loadEnv({ WEBHOOK_BODY_LIMIT: String(64 * 1024 * 1024) } as NodeJS.ProcessEnv),
		).toThrow();
	});

	it("warns instead of failing when a JSON env var is malformed", () => {
		const source = { EMOJI_OVERRIDES: "{not json" } as NodeJS.ProcessEnv;
		const env = loadEnv(source);
		expect(env.EMOJI_OVERRIDES).toBeUndefined();
		expect(envWarnings(env, source)).toEqual([
			"EMOJI_OVERRIDES was set but could not be parsed as JSON — ignoring it",
		]);
	});

	it("reports no warning when a JSON env var is valid or absent", () => {
		const source = { EMOJI_OVERRIDES: '{"push":"<:push:1>"}' } as NodeJS.ProcessEnv;
		expect(envWarnings(loadEnv(source), source)).toEqual([]);
		expect(envWarnings(loadEnv({} as NodeJS.ProcessEnv), {} as NodeJS.ProcessEnv)).toEqual([]);
	});
});
