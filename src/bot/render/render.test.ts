import { describe, expect, it } from "vitest";
import { EVENT_TYPES } from "../../config/events.js";
import { resolveText } from "../../i18n/index.js";
import { buildEventTemplate } from "./events/index.js";
import { type RenderOptions, renderTemplate } from "./render.js";
import { sampleTemplate } from "./samples.js";
import { DISPLAY_MODES, type EventTemplate } from "./template.js";

const repository = {
	full_name: "acme/app",
	html_url: "https://github.com/acme/app",
	name: "app",
	owner: { login: "acme" },
	language: "TypeScript",
};
const sender = {
	login: "octocat",
	avatar_url: "https://avatars.githubusercontent.com/u/1",
	html_url: "https://github.com/octocat",
};

const EN: RenderOptions = { theme: "default", mode: "detailed", locale: "en" };
const ES: RenderOptions = { ...EN, locale: "es" };

/** Every text display in the rendered message, flattened, so tests can read it. */
function renderedText(template: EventTemplate, options: RenderOptions): string {
	const json = JSON.stringify(renderTemplate(template, options).components.map((c) => c.toJSON()));
	const texts: string[] = [];
	JSON.parse(json, (key, value) => {
		if (key === "content" && typeof value === "string") texts.push(value);
		return value;
	});
	return texts.join("\n");
}

function build(event: Parameters<typeof buildEventTemplate>[0], payload: object): EventTemplate {
	const template = buildEventTemplate(event, payload);
	if (!template) throw new Error(`${event} produced no message`);
	return template;
}

describe("push rendering", () => {
	const commit = (message: string, name = "Ada") => ({
		id: "abcdef1234567890",
		message,
		url: "https://github.com/acme/app/commit/abcdef1234567890",
		author: { name },
	});

	it("escapes commit messages and author names so they cannot plant a disguised link", () => {
		const text = renderedText(
			build("push", {
				ref: "refs/heads/main",
				repository,
				sender,
				commits: [
					commit("[Verify your account](https://evil.example)", "[Bot](https://evil.example)"),
				],
			}),
			EN,
		);
		expect(text).not.toMatch(/(?<!\\)\[Verify your account\]\(/);
		expect(text).not.toMatch(/(?<!\\)\[Bot\]\(/);
		expect(text).toContain("\\[Verify your account\\]");
	});

	it("cannot render a fake role mention from a commit message", () => {
		const text = renderedText(
			build("push", {
				ref: "refs/heads/main",
				repository,
				sender,
				commits: [commit("<@&123> urgent")],
			}),
			EN,
		);
		expect(text).toContain("\\<@&123");
	});

	it("translates the overflow line", () => {
		const commits = Array.from({ length: 10 }, (_, i) => commit(`change ${i}`));
		const template = build("push", { ref: "refs/heads/main", repository, sender, commits });
		expect(renderedText(template, EN)).toContain("…and 2 more");
		expect(renderedText(template, ES)).toContain("…y 2 más");
	});
});

describe("state translation", () => {
	it("translates CI conclusions inside titles", () => {
		const template = build("workflow_job", {
			action: "completed",
			repository,
			sender,
			workflow_job: {
				html_url: "https://github.com/acme/app/actions/runs/1/job/2",
				name: "test",
				conclusion: "timed_out",
			},
		});
		expect(resolveText("en", template.title)).toBe("Job timed out");
		expect(resolveText("es", template.title)).toBe("Job tiempo agotado");
	});

	it("still reads well for a state GitHub adds later", () => {
		const template = build("workflow_job", {
			action: "completed",
			repository,
			sender,
			workflow_job: {
				html_url: "https://github.com/acme/app/actions/runs/1/job/2",
				name: "test",
				conclusion: "brand_new_state",
			},
		});
		expect(resolveText("es", template.title)).toBe("Job brand new state");
	});
});

describe("rendered message", () => {
	it("gives the actor's avatar alt text", () => {
		const template = build("push", {
			ref: "refs/heads/main",
			repository,
			sender,
			commits: [{ id: "abc1234", message: "x", url: "https://github.com/acme/app/commit/abc1234" }],
		});
		const json = JSON.stringify(renderTemplate(template, EN).components.map((c) => c.toJSON()));
		expect(json).toContain('"description":"Avatar of octocat"');
	});
});

describe("security alerts", () => {
	const dependabot = (overrides: Record<string, unknown> = {}) => ({
		action: "created",
		repository,
		sender: { login: "dependabot[bot]", type: "Bot" },
		alert: {
			number: 42,
			html_url: "https://github.com/acme/app/security/dependabot/42",
			dependency: { package: { name: "lodash", ecosystem: "npm" }, manifest_path: "package.json" },
			security_advisory: {
				ghsa_id: "GHSA-p6mc-m468-83gw",
				cve_id: "CVE-2020-8203",
				summary: "Prototype pollution in lodash",
				severity: "high",
				cvss_severities: { cvss_v3: { score: 7.4 }, cvss_v4: { score: 0 } },
				epss: [{ percentage: 0.0123, percentile: 0.8 }],
			},
			security_vulnerability: {
				severity: "high",
				vulnerable_version_range: "< 4.17.19",
				first_patched_version: { identifier: "4.17.19" },
			},
			...overrides,
		},
	});

	it("leads with severity, CVSS and EPSS, and says how to fix it", () => {
		const text = renderedText(build("dependabot_alert", dependabot()), EN);
		expect(text).toContain("🟠 **high** · CVSS 7.4 · EPSS 1.2%");
		expect(text).toContain("#42 · Prototype pollution in lodash");
		expect(text).toContain("**Affected:** `< 4.17.19`");
		expect(text).toContain("**Fix:** upgrade to `4.17.19`");
		expect(text).toContain(
			"[GHSA-p6mc-m468-83gw](https://github.com/advisories/GHSA-p6mc-m468-83gw)",
		);
		expect(text).toContain("[CVE-2020-8203](https://nvd.nist.gov/vuln/detail/CVE-2020-8203)");
	});

	it("gives each severity its own colour", () => {
		const accent = (severity: string) =>
			build(
				"dependabot_alert",
				dependabot({ security_vulnerability: { severity }, security_advisory: { severity } }),
			).accent;
		expect(new Set(["critical", "high", "moderate", "low"].map(accent)).size).toBe(4);
	});

	it("says when no patched version exists, in the reader's language", () => {
		const template = build(
			"dependabot_alert",
			dependabot({ security_vulnerability: { severity: "high", first_patched_version: null } }),
		);
		expect(renderedText(template, EN)).toContain("no patched version yet");
		expect(renderedText(template, ES)).toContain("aún no hay versión corregida");
	});

	it("does not link an advisory id that is not one", () => {
		const text = renderedText(
			build(
				"dependabot_alert",
				dependabot({ security_advisory: { severity: "low", ghsa_id: "GHSA-evil](https://x" } }),
			),
			EN,
		);
		expect(text).not.toContain("https://x");
	});

	it("keeps the severity visible in compact mode", () => {
		const text = renderedText(build("dependabot_alert", dependabot()), { ...EN, mode: "compact" });
		expect(text).toContain("🟠 **high**");
	});

	it("flags a leaked secret that still works, and never shows the secret itself", () => {
		const text = renderedText(
			build("secret_scanning_alert", {
				action: "created",
				repository,
				sender,
				alert: {
					number: 7,
					html_url: "https://github.com/acme/app/security/secret-scanning/7",
					secret_type_display_name: "GitHub Personal Access Token",
					secret: "ghp_ThisMustNeverReachDiscord0000000000",
					validity: "active",
					publicly_leaked: true,
				},
			}),
			EN,
		);
		expect(text).toContain("still valid");
		expect(text).toContain("also found in public sources");
		expect(text).not.toContain("ghp_ThisMustNeverReachDiscord");
	});

	it("points a code scanning alert at the exact line", () => {
		const template = build("code_scanning_alert", {
			action: "created",
			repository,
			sender,
			ref: "refs/heads/main",
			alert: {
				number: 3,
				html_url: "https://github.com/acme/app/security/code-scanning/3",
				tool: { name: "CodeQL" },
				rule: {
					id: "js/xss",
					description: "Cross-site scripting",
					security_severity_level: "critical",
				},
				most_recent_instance: {
					commit_sha: "abc123",
					message: { text: "User input flows into innerHTML." },
					location: { path: "src/view.ts", start_line: 12 },
				},
			},
		});
		const text = renderedText(template, EN);
		expect(text).toContain("🔴 **critical**");
		expect(text).toContain("`src/view.ts:12`");
		expect(text).toContain("> User input flows into innerHTML.");
		expect(template.links?.map((link) => link.url)).toContain(
			"https://github.com/acme/app/blob/abc123/src/view.ts#L12",
		);
	});
});

describe("Discord limits", () => {
	/** Discord counts nested components too; every object carrying a numeric `type` is one. */
	function measure(components: { toJSON(): unknown }[]) {
		let count = 0;
		let chars = 0;
		let widestContainer = 0;
		const walk = (node: unknown) => {
			if (Array.isArray(node)) return node.forEach(walk);
			if (!node || typeof node !== "object") return;
			const record = node as Record<string, unknown>;
			if (typeof record.type === "number") count += 1;
			if (typeof record.content === "string") chars += record.content.length;
			if (record.type === 17 && Array.isArray(record.components)) {
				widestContainer = Math.max(widestContainer, record.components.length);
			}
			Object.values(record).forEach(walk);
		};
		walk(components.map((component) => component.toJSON()));
		return { count, chars, widestContainer };
	}

	const actor = { login: "ada", avatarUrl: "https://avatars.githubusercontent.com/u/1" };

	it("keeps every sample event within the per-message limits, in every mode and language", () => {
		for (const event of EVENT_TYPES) {
			for (const mode of DISPLAY_MODES) {
				for (const locale of ["en", "es"] as const) {
					const template = sampleTemplate(event, "acme/app", "https://github.com/acme/app", actor);
					const { count, chars, widestContainer } = measure(
						renderTemplate(template, { theme: "default", mode, locale }).components,
					);
					const where = `${event} ${mode} ${locale}`;
					expect(count, where).toBeLessThanOrEqual(40);
					expect(chars, where).toBeLessThanOrEqual(4000);
					expect(widestContainer, where).toBeLessThanOrEqual(10);
				}
			}
		}
	});

	it("fits the two-event style preview in one reply", () => {
		const components = ["pull_request", "workflow_run"].flatMap(
			(event) =>
				renderTemplate(
					sampleTemplate(event as "pull_request", "acme/app", "https://github.com/acme/app", actor),
					{ theme: "catppuccin", mode: "detailed", locale: "es" },
				).components,
		);
		const { count, chars } = measure(components);
		expect(count).toBeLessThanOrEqual(39);
		expect(chars).toBeLessThanOrEqual(3700);
	});
});
