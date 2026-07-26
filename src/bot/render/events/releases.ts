import type { PackagePayload, ReleasePayload } from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { EventTemplate, TemplateField, TemplateImage } from "../template.js";
import { actorBits, code, links, repoBits, repositoryLink, titleText, quote } from "./common.js";

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
		body: action === "deleted" ? undefined : quote(release.body, 900),
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
