import type {
	ForkPayload,
	MemberPayload,
	PublicPayload,
	SponsorshipPayload,
	StarPayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { EventTemplate, TemplateField } from "../template.js";
import { actorBits, code, links, repoBits, repositoryLink } from "./common.js";

export function formatFork(payload: ForkPayload): EventTemplate | null {
	const bits = repoBits(payload.repository);
	return {
		accent: "fork",
		icon: "fork",
		title: tx("title.fork"),
		subtitle: code(payload.forkee.full_name),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links(
			{ label: tx("link.fork"), url: payload.forkee.html_url },
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatStar(payload: StarPayload): EventTemplate | null {
	if (payload.action !== "created" && payload.action !== "deleted") return null;
	const bits = repoBits(payload.repository);

	return {
		accent: payload.action === "created" ? "star" : "neutral",
		icon: "star",
		title: tx(payload.action === "created" ? "title.star.created" : "title.star.deleted"),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatSponsorship(payload: SponsorshipPayload): EventTemplate | null {
	const title =
		payload.action === "created"
			? tx("title.sponsorship.created")
			: payload.action === "cancelled"
				? tx("title.sponsorship.cancelled")
				: payload.action === "edited" || payload.action === "tier_changed"
					? tx("title.sponsorship.edited")
					: null;
	if (!title) return null;

	const bits = repoBits(payload.repository);
	const tier = payload.sponsorship.tier;
	const fields: TemplateField[] = [];
	if (tier?.name) {
		fields.push({ label: tx("field.tier"), value: code(tier.name) });
	}
	if (tier?.is_one_time) {
		fields.push({ label: tx("field.state"), value: tx("value.oneTime"), secondary: true });
	} else if (typeof tier?.monthly_price_in_dollars === "number") {
		fields.push({
			label: tx("field.state"),
			value: tx("value.monthly", { amount: tier.monthly_price_in_dollars }),
			secondary: true,
		});
	}

	return {
		accent: payload.action === "cancelled" ? "neutral" : "sponsor",
		icon: "sponsor",
		title,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sponsorship.sponsor ?? payload.sender),
		fields: fields.length > 0 ? fields : undefined,
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: payload.action === "created" ? "high" : "low",
	};
}

export function formatMember(payload: MemberPayload): EventTemplate | null {
	const title =
		payload.action === "added"
			? tx("title.member.added")
			: payload.action === "removed"
				? tx("title.member.removed")
				: payload.action === "edited"
					? tx("title.member.edited")
					: null;
	if (!title) return null;

	const bits = repoBits(payload.repository);
	const permission = payload.changes?.permission?.to;

	return {
		accent: payload.action === "removed" ? "delete" : "member",
		icon: "person",
		title,
		subtitle: code(payload.member.login),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.member),
		fields: permission
			? [{ label: tx("field.permission"), value: code(permission) }]
			: undefined,
		links: links(
			{ label: tx("link.settings"), url: `${bits.repoUrl}/settings/access` },
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatPublic(payload: PublicPayload): EventTemplate | null {
	const bits = repoBits(payload.repository);
	return {
		accent: "member",
		icon: "globe",
		title: tx("title.public"),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: "high",
	};
}
