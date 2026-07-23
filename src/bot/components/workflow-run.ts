import type { WorkflowRunPayload } from "../../github/payloads.js";
import { Accents } from "./design.js";
import {
	authorSection,
	buildMessage,
	container,
	linkButton,
	linkRow,
	type FormattedMessage,
} from "./shared.js";

export function formatWorkflowRun(payload: WorkflowRunPayload): FormattedMessage | null {
	if (payload.action !== "completed") return null;

	const run = payload.workflow_run;
	const conclusion = run.conclusion ?? "unknown";
	const success = conclusion === "success";
	const accent = success ? Accents.workflowSuccess : Accents.workflowFailure;
	const name = run.display_title || run.name || "Workflow";
	const branch = run.head_branch ? ` · \`${run.head_branch}\`` : "";

	const c = container(accent);
	c.addSectionComponents(
		authorSection(
			[
				`**${payload.repository.full_name}**`,
				`CI ${conclusion}${branch}`,
				`**${name}**`,
			],
			run.actor?.avatar_url ?? payload.sender?.avatar_url,
		),
	);
	c.addActionRowComponents(linkRow(linkButton("View Run", run.html_url)));
	return buildMessage([c]);
}
