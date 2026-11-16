import type { PackagePayload, ReleasePayload } from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import { neutralizeBodyMarkdown } from "../blocks.js";
import type { EventTemplate, TemplateField, TemplateImage } from "../template.js";
import { actorBits, code, links, repoBits, repositoryLink, titleText } from "./common.js";

const IMAGE_PATTERN = /!\[[^\]]*\]\((https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp))\)/gi;

/** Pulls inline markdown images out of a release body for the media gallery. */
function extractImages(body: string | null | undefined): TemplateImage[] {
	if (!body) return [];
	const out: TemplateImage[] = [];
	for (const match of body.matchAll(IMAGE_PATTERN)) {
		const url = match[1];
		if (url) out.push({ url });
		if (out.length >= 4) break;
	}
	return out;
}

const NOTES_MAX = 1100;
/** A changelog bullet is a headline plus an explanation; the headline is what fits. */
const ITEM_MAX = 170;

/** Cuts at a word, and never leaves a code span or bold run open behind it. */
function clipText(value: string, max: number): string {
	if (value.length <= max) return value;
	let cut = value.slice(0, max - 1);
	const space = cut.lastIndexOf(" ");
	if (space > max * 0.6) cut = cut.slice(0, space);
	// An odd backtick means the cut landed inside inline code: drop the open span,
	// or everything after it would render as code.
	if ((cut.match(/`/g)?.length ?? 0) % 2 === 1) cut = cut.slice(0, cut.lastIndexOf("`"));
	cut = cut.replace(/[\s,;:—–-]+$/, "");
	if ((cut.match(/\*\*/g)?.length ?? 0) % 2 === 1) cut += "**";
	return `${cut}…`;
}

/**
 * Release notes are written for a web page: `##` headings, bullets hard-wrapped at
 * 80 columns, a first heading repeating the version. Pasted into Discord as they
 * are, the headings show as literal `##` (untrusted headings are escaped on
 * purpose), every wrapped line breaks mid-sentence, and a cut at a fixed length
 * can land inside a code span.
 *
 * This reshapes them for a chat message: section headings become bold labels,
 * wrapped lines are rejoined, each bullet is kept to its opening, and the whole is
 * cut between lines rather than through one. The result is still quoted and still
 * neutralized, so a release body cannot fake the bot's own header or a link.
 */
export function releaseNotes(
	body: string | null | undefined,
	/** Version labels (tag, release name) whose heading would only repeat the title. */
	redundant: string[] = [],
	max = NOTES_MAX,
): string | undefined {
	if (!body?.trim()) return undefined;
	const source = body
		.replace(/\r/g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		// Images go to the gallery; their markdown would show as a bare link.
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
	const versions = redundant
		.map((label) => label.trim().replace(/^v/i, "").toLowerCase())
		.filter((label) => label.length > 0);

	type Block = { kind: "heading" | "item" | "text" | "code"; text: string };
	const blocks: Block[] = [];
	let open: Block | null = null;
	let fenced = false;
	for (const raw of source.split("\n")) {
		if (/^\s*```/.test(raw)) {
			fenced = !fenced;
			open = null;
			blocks.push({ kind: "code", text: raw.trim() });
			continue;
		}
		if (fenced) {
			blocks.push({ kind: "code", text: raw });
			continue;
		}
		const line = raw.trim();
		if (!line) {
			open = null;
			continue;
		}
		const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
		if (heading) {
			open = null;
			const text = (heading[1] ?? "").replace(/\*\*/g, "");
			const lower = text.toLowerCase();
			// "## [1.5.0] — 2026-11-16" above notes already titled v1.5.0.
			if (blocks.length === 0 && versions.some((version) => lower.includes(version))) continue;
			blocks.push({ kind: "heading", text });
			continue;
		}
		const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
		if (item) {
			open = { kind: "item", text: item[1] ?? "" };
			blocks.push(open);
			continue;
		}
		// A wrapped continuation of the bullet or paragraph above it.
		if (open) {
			open.text += ` ${line}`;
			continue;
		}
		open = { kind: "text", text: line };
		blocks.push(open);
	}

	const lines: string[] = [];
	let used = 0;
	let dropped = false;
	for (const block of blocks) {
		const text =
			block.kind === "heading"
				? `**${block.text}**`
				: block.kind === "item"
					? `- ${clipText(block.text, ITEM_MAX)}`
					: block.kind === "text"
						? clipText(block.text, ITEM_MAX * 2)
						: block.text;
		// A blank line sets a section apart from whatever came before it.
		const gap = block.kind === "heading" && lines.length > 0 ? 1 : 0;
		// A heading with nothing under it says nothing, so it needs room for a line too.
		const reserve = block.kind === "heading" ? 40 : 0;
		if (used + gap + text.length + 1 + reserve > max) {
			dropped = true;
			break;
		}
		if (gap) lines.push("");
		lines.push(text);
		used += gap + text.length + 1;
	}
	// An unclosed fence would swallow the rest of the message.
	if (lines.filter((line) => line.startsWith("```")).length % 2 === 1) lines.push("```");
	if (dropped) {
		// A section label with nothing left under it promises content that is not there.
		while (
			lines.length > 0 &&
			(lines.at(-1) === "" || /^\*\*[^*]+\*\*$/.test(lines.at(-1) ?? ""))
		) {
			lines.pop();
		}
	}
	if (lines.length === 0) return undefined;
	if (dropped) lines.push("…");

	return neutralizeBodyMarkdown(lines.join("\n"))
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

export function formatRelease(payload: ReleasePayload): EventTemplate | null {
	const release = payload.release;
	const action = payload.action;

	if (action === "published" || action === "released") {
		// Draft releases are private until published.
		if (release.draft) return null;
	} else if (action !== "edited" && action !== "deleted") {
		return null;
	}

	const bits = repoBits(payload.repository);
	const prerelease = Boolean(release.prerelease);
	const title =
		action === "deleted"
			? tx("title.release.deleted")
			: action === "edited"
				? tx("title.release.edited")
				: prerelease
					? tx("title.release.prereleased")
					: tx("title.release.published");

	const fields: TemplateField[] = [{ label: tx("field.tag"), value: code(release.tag_name) }];
	const assets = release.assets ?? [];
	if (assets.length > 0) {
		fields.push({
			label: tx("field.assets"),
			value: tx(assets.length === 1 ? "count.assets.one" : "count.assets.other", {
				count: assets.length,
			}),
			secondary: true,
		});
	}

	return {
		accent: prerelease ? "prerelease" : "release",
		icon: "release",
		title,
		subtitle: titleText(release.name || release.tag_name, 150),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(release.author ?? payload.sender),
		body:
			action === "deleted"
				? undefined
				: releaseNotes(release.body, [release.tag_name, release.name ?? ""]),
		fields,
		images: action === "deleted" ? undefined : extractImages(release.body),
		links: links({ label: tx("link.release"), url: release.html_url }, repositoryLink(bits)),
		timestamp: new Date(),
		importance: action === "deleted" ? "low" : "high",
	};
}

export function formatPackage(payload: PackagePayload): EventTemplate | null {
	const pkg = payload.package ?? payload.registry_package;
	if (!pkg) return null;
	if (payload.action !== "published" && payload.action !== "updated") return null;

	const bits = payload.repository
		? repoBits(payload.repository)
		: { repo: pkg.name, repoUrl: pkg.html_url ?? "", language: null };

	const version = pkg.package_version?.version;
	const fields: TemplateField[] = [];
	if (version) fields.push({ label: tx("field.version"), value: code(version) });
	if (pkg.package_type) {
		fields.push({ label: tx("field.packageType"), value: code(pkg.package_type), secondary: true });
	}

	return {
		accent: "packageAccent",
		icon: "packageIcon",
		title: tx(payload.action === "published" ? "title.package.published" : "title.package.updated"),
		subtitle: titleText(pkg.name, 120),
		repo: bits.repo,
		repoUrl: bits.repoUrl || undefined,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links({
			label: tx("link.package"),
			url: pkg.package_version?.html_url ?? pkg.html_url,
		}),
		timestamp: new Date(),
		importance: "normal",
	};
}
