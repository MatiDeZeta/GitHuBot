import type {
	CommitCommentPayload,
	CreateDeletePayload,
	PushPayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import { truncate } from "../blocks.js";
import type { EventTemplate } from "../template.js";
import { actorBits, code, links, quote, repoBits, repositoryLink, shortRef, titleText } from "./common.js";

const MAX_COMMIT_LINES = 8;

export function formatPush(payload: PushPayload): EventTemplate | null {
	const commits = payload.commits ?? [];
	// Branch/tag creation and deletion arrive separately as `create`/`delete`.
	if (commits.length === 0) return null;

	const bits = repoBits(payload.repository);
	const branch = shortRef(payload.ref);
	const shown = commits.slice(0, MAX_COMMIT_LINES);

	const commitLines = shown.map((commit) => {
		const sha = commit.id.slice(0, 7);
		const message = truncate(commit.message.split(/\r?\n/)[0] ?? "", 90);
		const author = commit.author?.username ?? commit.author?.name;
		const suffix = author ? ` — ${author}` : "";
		return `[\`${sha}\`](${commit.url}) ${message}${suffix}`;
	});

	if (commits.length > shown.length) {
		commitLines.push(`_…and ${commits.length - shown.length} more_`);
	}

	return {
		accent: "push",
		icon: payload.forced ? "alert" : "push",
		title: tx(payload.forced ? "title.push.forced" : "title.push", { branch }),
		subtitle: tx(commits.length === 1 ? "count.commits.one" : "count.commits.other", {
			count: commits.length,
		}),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		body: commitLines.join("\n"),
		links: links(
			{ label: tx("link.compare"), url: payload.compare },
			{ label: tx("link.branch"), url: `${bits.repoUrl}/tree/${encodeURIComponent(branch)}` },
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance: "normal",
	};
}

export function formatCreate(payload: CreateDeletePayload): EventTemplate | null {
	const bits = repoBits(payload.repository);
	const ref = shortRef(payload.ref);
	const isTag = payload.ref_type === "tag";
	const title =
		payload.ref_type === "branch"
			? tx("title.create.branch")
			: isTag
				? tx("title.create.tag")
				: tx("title.create.other", { refType: payload.ref_type });

	return {
		accent: isTag ? "tagRef" : "branch",
		icon: isTag ? "tagRef" : "branch",
		title,
		subtitle: code(ref),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links(
			{
				label: tx(isTag ? "field.tag" : "link.branch"),
				url: `${bits.repoUrl}/tree/${encodeURIComponent(ref)}`,
			},
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatDelete(payload: CreateDeletePayload): EventTemplate | null {
	const bits = repoBits(payload.repository);
	const ref = shortRef(payload.ref);
	const isTag = payload.ref_type === "tag";
	const title =
		payload.ref_type === "branch"
			? tx("title.delete.branch")
			: isTag
				? tx("title.delete.tag")
				: tx("title.delete.other", { refType: payload.ref_type });

	return {
		accent: "delete",
		icon: "trash",
		title,
		subtitle: code(ref),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatCommitComment(payload: CommitCommentPayload): EventTemplate | null {
	if (payload.action !== "created") return null;
	const bits = repoBits(payload.repository);
	const sha = payload.comment.commit_id?.slice(0, 7);

	return {
		accent: "comment",
		icon: "comment",
		title: tx("title.commitComment"),
		subtitle: sha ? code(sha) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.comment.user ?? payload.sender),
		body: quote(payload.comment.body),
		fields: payload.comment.path
			? [{ label: tx("field.path"), value: code(titleText(payload.comment.path, 120)) }]
			: undefined,
		links: links(
			{ label: tx("link.comment"), url: payload.comment.html_url },
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance: "low",
	};
}
