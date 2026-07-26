import type { EventType } from "../config/events.js";
import type { RepoFilters } from "../db/types.js";

/** Events whose payload carries a branch we can match against. */
const BRANCH_SOURCES: Partial<Record<EventType, (payload: Payload) => string | undefined>> = {
	push: (p) => shortRef(str(p.ref)),
	create: (p) => shortRef(str(p.ref)),
	delete: (p) => shortRef(str(p.ref)),
	pull_request: (p) => str(nested(p, "pull_request", "base")?.ref),
	workflow_run: (p) => str(obj(p.workflow_run)?.head_branch),
	workflow_job: (p) => str(obj(p.workflow_job)?.head_branch),
	check_suite: (p) => str(obj(p.check_suite)?.head_branch),
	check_run: (p) => str(nested(p, "check_run", "check_suite")?.head_branch),
	deployment: (p) => str(obj(p.deployment)?.ref),
	deployment_status: (p) => str(obj(p.deployment)?.ref),
	code_scanning_alert: (p) => shortRef(str(p.ref)),
};

/** Events whose payload carries labels we can match against. */
const LABEL_SOURCES: Partial<Record<EventType, (payload: Payload) => string[]>> = {
	issues: (p) => labelNames(obj(p.issue)?.labels),
	issue_comment: (p) => labelNames(obj(p.issue)?.labels),
	pull_request: (p) => labelNames(obj(p.pull_request)?.labels),
	pull_request_review: (p) => labelNames(obj(p.pull_request)?.labels),
	pull_request_review_comment: (p) => labelNames(obj(p.pull_request)?.labels),
};

type Payload = Record<string, unknown>;

export type FilterReason = "branch" | "label" | "actor";

export interface FilterOutcome {
	deliver: boolean;
	reason?: FilterReason;
}

const PASS: FilterOutcome = { deliver: true };

export function applyFilters(
	filters: RepoFilters,
	eventType: EventType,
	rawPayload: unknown,
): FilterOutcome {
	if (!rawPayload || typeof rawPayload !== "object") return PASS;
	const payload = rawPayload as Payload;

	if (isIgnoredActor(filters.ignoredActors, payload)) {
		return { deliver: false, reason: "actor" };
	}

	const branch = BRANCH_SOURCES[eventType]?.(payload);
	if (branch && !branchAllowed(filters, branch)) {
		return { deliver: false, reason: "branch" };
	}

	if (filters.labels.length > 0) {
		const source = LABEL_SOURCES[eventType];
		// Only gate events that actually carry labels; a label filter should not
		// silence pushes or releases.
		if (source) {
			const labels = source(payload).map((label) => label.toLowerCase());
			const wanted = filters.labels.map((label) => label.toLowerCase());
			if (!labels.some((label) => wanted.includes(label))) {
				return { deliver: false, reason: "label" };
			}
		}
	}

	return PASS;
}

export function branchAllowed(filters: RepoFilters, branch: string): boolean {
	if (filters.branchExclude.some((pattern) => matchesGlob(pattern, branch))) return false;
	if (filters.branchInclude.length === 0) return true;
	return filters.branchInclude.some((pattern) => matchesGlob(pattern, branch));
}

export function isIgnoredActor(ignored: string[], payload: Payload): boolean {
	if (ignored.length === 0) return false;
	const sender = obj(payload.sender);
	const login = str(sender?.login);
	if (!login) return false;

	const lowered = login.toLowerCase();
	const isBot = sender?.type === "Bot" || lowered.endsWith("[bot]");

	for (const entry of ignored) {
		const candidate = entry.trim().toLowerCase();
		if (!candidate) continue;
		if (candidate === "bot" && isBot) return true;
		if (candidate === lowered) return true;
		if (candidate.includes("*") && matchesGlob(candidate, lowered)) return true;
	}
	return false;
}

/** Supports `*` (any run of characters) and `?` (single character). */
export function matchesGlob(pattern: string, value: string): boolean {
	const trimmed = pattern.trim();
	if (!trimmed) return false;
	if (trimmed === "*") return true;

	const escaped = trimmed
		.toLowerCase()
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`).test(value.toLowerCase());
}

/** Splits the comma/newline separated text used by the filters modal. */
export function parseFilterList(raw: string | null | undefined): string[] {
	if (!raw) return [];
	return Array.from(
		new Set(
			raw
				.split(/[,\n]/)
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0),
		),
	).slice(0, 25);
}

function shortRef(ref: string | undefined): string | undefined {
	return ref?.replace(/^refs\/(heads|tags)\//, "");
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function obj(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function nested(
	payload: Payload,
	...path: string[]
): Record<string, unknown> | undefined {
	let current: Record<string, unknown> | undefined = payload;
	for (const key of path) {
		current = obj(current?.[key]);
		if (!current) return undefined;
	}
	return current;
}

function labelNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => str(obj(entry)?.name))
		.filter((name): name is string => Boolean(name));
}
