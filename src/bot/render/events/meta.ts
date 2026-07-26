import type {
	DeployKeyPayload,
	GollumPayload,
	MetaPayload,
	PageBuildPayload,
	ProjectsV2ItemPayload,
	RepositoryPayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { TranslationKey } from "../../../i18n/index.js";
import { truncate } from "../blocks.js";
import type { EventTemplate, TemplateField } from "../template.js";
import {
	actorBits,
	code,
	humanizeState,
	links,
	repoBits,
	repositoryLink,
	titleText,
} from "./common.js";

const REPOSITORY_TITLES: Record<string, TranslationKey> = {
	created: "title.repository.created",
	archived: "title.repository.archived",
	unarchived: "title.repository.unarchived",
	renamed: "title.repository.renamed",
	transferred: "title.repository.transferred",
	publicized: "title.repository.publicized",
	privatized: "title.repository.privatized",
	deleted: "title.repository.deleted",
};

export function formatRepository(payload: RepositoryPayload): EventTemplate | null {
	const key = REPOSITORY_TITLES[payload.action];
	if (!key) return null;

	const bits = repoBits(payload.repository);
	const previousName = payload.changes?.repository?.name?.from;

	return {
		accent: payload.action === "deleted" ? "delete" : "repoMeta",
		icon: "repo",
		title: tx(key),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields: previousName
			? [{ label: tx("field.previousName"), value: code(previousName) }]
			: undefined,
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatGollum(payload: GollumPayload): EventTemplate | null {
	const pages = payload.pages ?? [];
	if (pages.length === 0) return null;

	const bits = repoBits(payload.repository);
	const lines = pages.slice(0, 8).map((page) => {
		const name = titleText(page.title ?? page.page_name, 80);
		const action = page.action ? ` _(${page.action})_` : "";
		return page.html_url ? `[${name}](${page.html_url})${action}` : `${name}${action}`;
	});
	if (pages.length > lines.length) {
		lines.push(`_…and ${pages.length - lines.length} more_`);
	}

	return {
		accent: "wiki",
		icon: "wiki",
		title: tx("title.gollum"),
		subtitle: tx(pages.length === 1 ? "count.pages.one" : "count.pages.other", {
			count: pages.length,
		}),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		body: truncate(lines.join("\n"), 900),
		links: links({ label: tx("link.wiki"), url: `${bits.repoUrl}/wiki` }, repositoryLink(bits)),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatProjectsV2Item(payload: ProjectsV2ItemPayload): EventTemplate | null {
	// Projects v2 payloads are organization-scoped and carry no repository for
	// most actions; without one there is nothing to route or label.
	if (!payload.repository) return null;
	if (payload.action === "reordered") return null;

	const bits = repoBits(payload.repository);
	const contentType = payload.projects_v2_item?.content_type;

	return {
		accent: "project",
		icon: "project",
		title: tx("title.projectItem", { action: humanizeState(payload.action).toLowerCase() }),
		subtitle: contentType ? code(contentType) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatDeployKey(payload: DeployKeyPayload): EventTemplate | null {
	const created = payload.action === "created";
	if (!created && payload.action !== "deleted") return null;

	const bits = repoBits(payload.repository);
	const fields: TemplateField[] = [];
	if (payload.key?.title) {
		fields.push({ label: tx("field.keyTitle"), value: code(payload.key.title) });
	}
	if (typeof payload.key?.read_only === "boolean") {
		fields.push({
			label: tx("field.permission"),
			value: tx(payload.key.read_only ? "value.readOnly" : "value.readWrite"),
		});
	}

	return {
		accent: created ? "key" : "delete",
		icon: "key",
		title: tx(created ? "title.deployKey.created" : "title.deployKey.deleted"),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields: fields.length > 0 ? fields : undefined,
		links: links({ label: tx("link.settings"), url: `${bits.repoUrl}/settings/keys` }),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatMeta(payload: MetaPayload): EventTemplate | null {
	const deleted = payload.action === "deleted";
	if (!deleted && payload.action !== "edited") return null;

	const bits = repoBits(payload.repository);
	return {
		accent: deleted ? "delete" : "repoMeta",
		icon: "gear",
		title: tx(deleted ? "title.meta.deleted" : "title.meta.edited"),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links({ label: tx("link.settings"), url: `${bits.repoUrl}/settings/hooks` }),
		timestamp: new Date(),
		importance: deleted ? "high" : "low",
	};
}

export function formatPageBuild(payload: PageBuildPayload): EventTemplate | null {
	const status = payload.build.status;
	const errored = status === "errored" || Boolean(payload.build.error?.message);
	// `building` is transient; only the outcome is worth a message.
	if (!errored && status !== "built") return null;

	const bits = repoBits(payload.repository);
	return {
		accent: errored ? "workflowFailure" : "workflowSuccess",
		icon: errored ? "failure" : "globe",
		title: tx(errored ? "title.pageBuild.errored" : "title.pageBuild.built"),
		subtitle: payload.build.error?.message
			? titleText(payload.build.error.message, 180)
			: undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.build.pusher ?? payload.sender),
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: errored ? "high" : "low",
	};
}
