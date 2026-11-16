import { describe, expect, it } from "vitest";
import { releaseNotes } from "./releases.js";

const unquote = (value: string | undefined) =>
	(value ?? "")
		.split("\n")
		.map((line) => line.replace(/^> ?/, ""))
		.join("\n");

describe("release notes", () => {
	it("turns section headings into bold labels instead of literal hashes", () => {
		const notes = unquote(releaseNotes("### Added\n\n- One\n\n### Fixed\n\n- Two"));
		expect(notes).toBe("**Added**\n- One\n\n**Fixed**\n- Two");
	});

	it("drops a first heading that only repeats the version", () => {
		const body = "## [1.5.0] — 2026-11-16\n\nIntro line.\n\n### Added\n\n- One";
		const notes = unquote(releaseNotes(body, ["v1.5.0"]));
		expect(notes).toBe("Intro line.\n\n**Added**\n- One");
		// Any other first heading is content and stays.
		expect(unquote(releaseNotes("## Highlights\n\n- One", ["v1.5.0"]))).toContain("**Highlights**");
	});

	it("rejoins bullets and paragraphs that were hard-wrapped for a text file", () => {
		const body =
			"- **Sign out everywhere.** A button under\n  Settings ends every\n  sign-in.\n- Next";
		expect(unquote(releaseNotes(body))).toBe(
			"- **Sign out everywhere.** A button under Settings ends every sign-in.\n- Next",
		);
	});

	it("keeps a long bullet to its opening without leaving code or bold open", () => {
		const long = `- **Private mode.** With \`DISCORD_ALLOWED_USER_ID\` set ${"and more words ".repeat(20)}`;
		const [line] = unquote(releaseNotes(long)).split("\n");
		expect(line?.length).toBeLessThanOrEqual(175);
		expect(line?.endsWith("…")).toBe(true);
		expect((line?.match(/`/g) ?? []).length % 2).toBe(0);

		// Cut inside a code span: the open span goes rather than swallowing the rest.
		const inCode = `- ${"word ".repeat(32)}\`${"x".repeat(60)}\` tail`;
		const cut = unquote(releaseNotes(inCode));
		expect(cut).not.toContain("`");

		const inBold = `- **${"bold words ".repeat(30)}** tail`;
		expect((unquote(releaseNotes(inBold)).match(/\*\*/g) ?? []).length % 2).toBe(0);
	});

	it("cuts between lines, marks the cut and leaves no empty section behind", () => {
		const items = Array.from({ length: 30 }, (_, i) => `- Item number ${i} with some text`);
		const body = `### Added\n\n${items.join("\n")}\n\n### Fixed\n\n- Last`;
		const notes = unquote(releaseNotes(body, [], 300));
		const lines = notes.split("\n");
		expect(notes.length).toBeLessThanOrEqual(302);
		expect(lines.at(-1)).toBe("…");
		expect(lines.at(-2)).toMatch(/^- Item number \d+ with some text$/);
		expect(notes).not.toContain("**Fixed**");
	});

	it("still cannot fake a heading, a link or a mention", () => {
		const notes = releaseNotes("Text\n[Verify](https://evil.example) <@&123>\n-# small") ?? "";
		expect(notes).toContain("\\[Verify\\](https://evil.example)");
		expect(notes).toContain("\\<@&123>");
		expect(notes.split("\n").every((line) => line.startsWith(">"))).toBe(true);
	});

	it("drops images and comments, and returns nothing for an empty body", () => {
		expect(unquote(releaseNotes("<!-- note -->\n![shot](https://x.example/a.png)\nHello"))).toBe(
			"Hello",
		);
		expect(releaseNotes("  \n")).toBeUndefined();
		expect(releaseNotes(null)).toBeUndefined();
	});

	it("closes a code block the cut would have left open", () => {
		const body = `Intro\n\n\`\`\`\n${"line of code\n".repeat(40)}\`\`\``;
		const notes = unquote(releaseNotes(body, [], 200));
		expect((notes.match(/```/g) ?? []).length % 2).toBe(0);
	});
});
