import type {
	CheckRunPayload,
	CheckSuitePayload,
	DeploymentPayload,
	DeploymentStatusPayload,
	StatusPayload,
	WorkflowJobPayload,
	WorkflowRunPayload,
} from "../../../github/payloads.js";
import { tx } from "../../../i18n/index.js";
import type { AccentKey, IconKey } from "../../../design/tokens.js";
import type { EventTemplate, TemplateField } from "../template.js";
import {
	actorBits,
	code,
	humanizeDuration,
	humanizeState,
	links,
	parseDate,
	quote,
	repoBits,
	repositoryLink,
	titleText,
} from "./common.js";

/** Shared mapping of GitHub conclusions onto accent + icon + importance. */
function conclusionStyle(conclusion: string | null | undefined): {
	accent: AccentKey;
	icon: IconKey;
	importance: EventTemplate["importance"];
} {
	switch (conclusion) {
		case "success":
			return { accent: "workflowSuccess", icon: "success", importance: "normal" };
		case "failure":
		case "timed_out":
			return { accent: "workflowFailure", icon: "failure", importance: "high" };
		case "cancelled":
		case "stale":
			return { accent: "workflowCancelled", icon: "cancelled", importance: "low" };
		case "neutral":
		case "skipped":
			return { accent: "neutral", icon: "cancelled", importance: "low" };
		case "action_required":
			return { accent: "workflowFailure", icon: "alert", importance: "high" };
		default:
			return { accent: "workflowRunning", icon: "running", importance: "low" };
	}
}

export function formatWorkflowRun(payload: WorkflowRunPayload): EventTemplate | null {
	const run = payload.workflow_run;
	// `requested` / `in_progress` fire constantly; only report terminal states.
	if (payload.action !== "completed") return null;

	const bits = repoBits(payload.repository);
	const conclusion = run.conclusion ?? undefined;
	const style = conclusionStyle(conclusion);

	const title =
		conclusion === "success"
			? tx("title.workflow.success")
			: conclusion === "failure" || conclusion === "timed_out"
				? tx("title.workflow.failure")
				: conclusion === "cancelled"
					? tx("title.workflow.cancelled")
					: tx("title.workflow.other", { conclusion: humanizeState(conclusion ?? "finished") });

	const fields: TemplateField[] = [];
	if (run.name) fields.push({ label: tx("field.workflow"), value: code(run.name) });
	if (run.head_branch) fields.push({ label: tx("field.branch"), value: code(run.head_branch) });

	const started = parseDate(run.run_started_at);
	const updated = parseDate(run.updated_at);
	if (started && updated) {
		fields.push({
			label: tx("field.duration"),
			value: humanizeDuration(updated.getTime() - started.getTime()),
			secondary: true,
		});
	}
	if (run.event) {
		fields.push({ label: tx("field.trigger"), value: code(run.event), secondary: true });
	}
	if (typeof run.run_attempt === "number" && run.run_attempt > 1) {
		fields.push({ label: tx("field.attempt"), value: String(run.run_attempt), secondary: true });
	}

	return {
		accent: style.accent,
		icon: style.icon,
		title,
		subtitle: run.display_title ? titleText(run.display_title, 150) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(run.actor ?? payload.sender),
		fields,
		links: links({ label: tx("link.run"), url: run.html_url }, repositoryLink(bits)),
		timestamp: new Date(),
		importance: style.importance,
	};
}

export function formatWorkflowJob(payload: WorkflowJobPayload): EventTemplate | null {
	const job = payload.workflow_job;
	if (payload.action !== "completed") return null;
	// Successful jobs are pure noise next to the workflow-level result.
	if (job.conclusion === "success" || job.conclusion === "skipped") return null;

	const bits = repoBits(payload.repository);
	const style = conclusionStyle(job.conclusion);
	const fields: TemplateField[] = [{ label: tx("field.job"), value: code(job.name) }];
	if (job.head_branch) fields.push({ label: tx("field.branch"), value: code(job.head_branch) });
	if (job.runner_name) {
		fields.push({ label: tx("field.runner"), value: code(job.runner_name), secondary: true });
	}

	return {
		accent: style.accent,
		icon: style.icon,
		title: tx("title.job.completed", {
			conclusion: humanizeState(job.conclusion ?? "finished").toLowerCase(),
		}),
		subtitle: titleText(job.name, 120),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links({ label: tx("link.job"), url: job.html_url }),
		timestamp: new Date(),
		importance: style.importance,
	};
}

export function formatCheckRun(payload: CheckRunPayload): EventTemplate | null {
	const check = payload.check_run;
	if (payload.action !== "completed") return null;
	if (check.conclusion === "success" || check.conclusion === "skipped") return null;

	const bits = repoBits(payload.repository);
	const style = conclusionStyle(check.conclusion);
	const fields: TemplateField[] = [{ label: tx("field.check"), value: code(check.name) }];
	if (check.check_suite?.head_branch) {
		fields.push({ label: tx("field.branch"), value: code(check.check_suite.head_branch) });
	}

	return {
		accent: style.accent,
		icon: style.icon,
		title: tx("title.check.completed", {
			conclusion: humanizeState(check.conclusion ?? "finished").toLowerCase(),
		}),
		subtitle: check.output?.title ? titleText(check.output.title, 150) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		body: quote(check.output?.summary, 400),
		fields,
		links: links({ label: tx("link.check"), url: check.html_url }, repositoryLink(bits)),
		timestamp: new Date(),
		importance: style.importance,
	};
}

export function formatCheckSuite(payload: CheckSuitePayload): EventTemplate | null {
	const suite = payload.check_suite;
	if (payload.action !== "completed") return null;
	if (suite.conclusion === "success" || suite.conclusion === "skipped") return null;

	const bits = repoBits(payload.repository);
	const style = conclusionStyle(suite.conclusion);
	const fields: TemplateField[] = [];
	if (suite.app?.name) fields.push({ label: tx("field.suite"), value: code(suite.app.name) });
	if (suite.head_branch) fields.push({ label: tx("field.branch"), value: code(suite.head_branch) });
	if (suite.head_sha) {
		fields.push({ label: tx("field.commit"), value: code(suite.head_sha.slice(0, 7)), secondary: true });
	}

	return {
		accent: style.accent,
		icon: style.icon,
		title: tx("title.checkSuite.completed", {
			conclusion: humanizeState(suite.conclusion ?? "finished").toLowerCase(),
		}),
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: style.importance,
	};
}

export function formatStatus(payload: StatusPayload): EventTemplate | null {
	// `pending` fires for every in-flight integration; only terminal states matter.
	if (payload.state !== "failure" && payload.state !== "error") return null;

	const bits = repoBits(payload.repository);
	const fields: TemplateField[] = [
		{ label: tx("field.commit"), value: code(payload.sha.slice(0, 7)) },
	];
	if (payload.context) fields.push({ label: tx("field.context"), value: code(payload.context) });

	return {
		accent: "workflowFailure",
		icon: "failure",
		title: tx("title.status", { state: humanizeState(payload.state).toLowerCase() }),
		subtitle: payload.description ? titleText(payload.description, 150) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(payload.sender),
		fields,
		links: links(
			{ label: tx("link.details"), url: payload.target_url ?? undefined },
			{ label: tx("link.commit"), url: `${bits.repoUrl}/commit/${payload.sha}` },
		),
		timestamp: new Date(),
		importance: "high",
	};
}

export function formatDeployment(payload: DeploymentPayload): EventTemplate | null {
	if (payload.action !== "created") return null;
	const bits = repoBits(payload.repository);
	const deployment = payload.deployment;
	const fields: TemplateField[] = [];
	if (deployment.environment) {
		fields.push({ label: tx("field.environment"), value: code(deployment.environment) });
	}
	if (deployment.ref) fields.push({ label: tx("field.ref"), value: code(deployment.ref) });

	return {
		accent: "deployment",
		icon: "deployment",
		title: tx("title.deployment.created"),
		subtitle: deployment.description ? titleText(deployment.description, 150) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(deployment.creator ?? payload.sender),
		fields,
		links: links(repositoryLink(bits)),
		timestamp: new Date(),
		importance: "low",
	};
}

export function formatDeploymentStatus(
	payload: DeploymentStatusPayload,
): EventTemplate | null {
	const status = payload.deployment_status;
	const state = status.state;
	if (state === "queued") return null;

	const bits = repoBits(payload.repository);
	let accent: AccentKey = "deployment";
	let icon: IconKey = "deployment";
	let title = tx("title.deploymentStatus.other", { state: humanizeState(state).toLowerCase() });
	let importance: EventTemplate["importance"] = "normal";

	if (state === "success") {
		accent = "deploymentSuccess";
		icon = "rocket";
		title = tx("title.deploymentStatus.success");
		importance = "high";
	} else if (state === "failure" || state === "error") {
		accent = "deploymentFailure";
		icon = "failure";
		title = tx("title.deploymentStatus.failure");
		importance = "high";
	} else if (state === "in_progress" || state === "pending") {
		accent = "workflowRunning";
		icon = "running";
		title = tx("title.deploymentStatus.pending");
		importance = "low";
	}

	const fields: TemplateField[] = [];
	if (payload.deployment.environment) {
		fields.push({ label: tx("field.environment"), value: code(payload.deployment.environment) });
	}
	if (payload.deployment.ref) {
		fields.push({ label: tx("field.ref"), value: code(payload.deployment.ref) });
	}

	return {
		accent,
		icon,
		title,
		subtitle: status.description ? titleText(status.description, 150) : undefined,
		repo: bits.repo,
		repoUrl: bits.repoUrl,
		language: bits.language,
		actor: actorBits(status.creator ?? payload.sender),
		fields,
		links: links(
			{ label: tx("link.environment"), url: status.environment_url ?? undefined },
			{ label: tx("link.logs"), url: status.log_url ?? status.target_url ?? undefined },
			repositoryLink(bits),
		),
		timestamp: new Date(),
		importance,
	};
}
