import { describe, expect, it } from "vitest";
import { resolveText } from "../../i18n/index.js";
import { buildEventTemplate } from "./events/index.js";
import { type RenderOptions, renderTemplate } from "./render.js";
import type { EventTemplate } from "./template.js";

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
