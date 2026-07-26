import type {
	IssueCommentPayload,
	IssuesPayload,
	LabelPayload,
	MilestonePayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { AccentKey, IconKey } from "../../../design/tokens.js";
import type { EventTemplate, TemplateField } from "../template.js";
import {
	actorBits,
	code,
	links,
	numbered,
	parseDate,
	quote,
	repoBits,
	repositoryLink,
	titleText,
} from "./common.js";

export function formatIssues(payload: IssuesPayload): EventTemplate | null {
	const { action, issue } = payload;
	const bits = repoBits(payload.repository);

	let accent: AccentKey;
	let icon: IconKey;
	let title: ReturnType<typeof tx>;

	switch (action) {
		case "opened":
			accent = "issueOpen";
			icon = "issue";
			title = tx("title.issue.opened");
			break;
		case "closed":
			accent = issue.state_reason === "not_planned" ? "issueNotPlanned" : "issueClosed";
			icon = "issueClosed";
			title = tx("title.issue.closed");
			break;
		case "reopened":
			accent = "issueOpen";
			icon = "issue";
			title = tx("title.issue.reopened");
			break;
		case "assigned":
			accent = "issueOpen";
			icon = "person";
			title = tx("title.issue.assigned");
			break;
		default:
			return null;
	}

	const fields: TemplateField[] = [];
	if (action === "closed" && issue.state_reason === "not_planned") {
		fields.push({ label: tx("field.state"), value: tx("value.notPlanned") });
	}
	if (action === "assigned" && payload.assignee?.login) {
		fields.push({ label: tx("field.assignee"), value: code(payload.assignee.login) });
	}
	const labels = (issue.labels ?? []).map((label) => label.name).filter(Boolean);
	if (labels.length > 0) {
		fields.push({
			label: tx("field.labels"),
			value: labels.slice(0, 8).map(code).join(" "),
			secondary: true,
		});
	}

	return {
		accent,
		icon,
		title,
		subtitle: numbered(issue.number, issue.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(issue.user ?? payload.sender),
		body: action === "opened" ? quote(issue.body, 500) : undefined,
		fields: fields.length > 0 ? fields : undefined,
		links: links({ label: tx("link.issue"), url: issue.html_url }, repositoryLink(bits)),
		timestamp: new Date(),
		importance: action === "opened" ? "normal" : "low",
	};
}

export function formatIssueComment(payload: IssueCommentPayload): EventTemplate | null {
	if (payload.action !== "created") return null;
	const bits = repoBits(payload.repository);
	const isPullRequest = Boolean(payload.issue.pull_request);

	return {
		accent: "comment",
		icon: "comment",
		title: tx(isPullRequest ? "title.prComment" : "title.issueComment"),
		subtitle: numbered(payload.issue.number, payload.issue.title),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.comment.user ?? payload.sender),
		body: quote(payload.comment.body, 500),
		links: links(
			{ label: tx("link.comment"), url: payload.comment.html_url },
			{
				label: tx(isPullRequest ? "link.pullRequest" : "link.issue"),
				url: payload.issue.html_url,
			},
		),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatLabel(payload: LabelPayload): EventTemplate | null {
	const key =
		payload.action === "created"
			? "title.label.created"
			: payload.action === "edited"
				? "title.label.edited"
				: payload.action === "deleted"
					? "title.label.deleted"
					: null;
	if (!key) return null;

	const bits = repoBits(payload.repository);

	return {
		accent: "label",
		icon: "label",
		title: tx(key),
		subtitle: code(titleText(payload.label.name, 80)),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		links: links({ label: tx("link.settings"), url: `${bits.repoUrl}/labels` }),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatMilestone(payload: MilestonePayload): EventTemplate | null {
	const key =
		payload.action === "created"
			? "title.milestone.created"
			: payload.action === "closed"
				? "title.milestone.closed"
				: payload.action === "opened"
					? "title.milestone.opened"
					: payload.action === "edited"
						? "title.milestone.edited"
						: payload.action === "deleted"
							? "title.milestone.deleted"
							: null;
	if (!key) return null;

	const bits = repoBits(payload.repository);
	const milestone = payload.milestone;
	const fields: TemplateField[] = [];

	if (
		typeof milestone.open_issues === "number" &&
		typeof milestone.closed_issues === "number"
	) {
		fields.push({
			label: tx("field.progress"),
			value: tx("value.milestoneProgress", {
				closed: milestone.closed_issues,
				open: milestone.open_issues,
			}),
		});
	}
	const due = parseDate(milestone.due_on);
	if (due) {
		fields.push({
			label: tx("field.dueOn"),
			value: `<t:${Math.floor(due.getTime() / 1000)}:D>`,
			secondary: true,
		});
	}

	return {
		accent: payload.action === "closed" ? "issueClosed" : "milestone",
		icon: "milestone",
		title: tx(key),
		subtitle: titleText(milestone.title, 120),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		body: quote(milestone.description, 400),
		fields: fields.length > 0 ? fields : undefined,
		links: links({ label: tx("link.milestone"), url: milestone.html_url }),
		timestamp: new Date(),
		importance: "low",
	};
}
