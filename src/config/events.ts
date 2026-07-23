import { z } from "zod";

export const repoSlugSchema = z
	.string()
	.trim()
	.regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, {
		error: "Repository must be in owner/repo format",
	})
	.transform((value) => {
		const [owner, repo] = value.split("/");
		if (!owner || !repo) {
			throw new Error("Invalid repository slug");
		}
		return { owner, repo, slug: `${owner}/${repo}` };
	});

export type RepoSlug = z.infer<typeof repoSlugSchema>;

export const EVENT_TYPES = [
	"push",
	"pull_request",
	"issues",
	"issue_comment",
	"pull_request_review",
	"release",
	"create",
	"delete",
	"fork",
	"star",
	"workflow_run",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const DEFAULT_ENABLED_EVENTS: EventType[] = [
	"push",
	"pull_request",
	"issues",
	"release",
	"create",
	"delete",
];

export const eventTypeSchema = z.enum(EVENT_TYPES);

export function parseEnabledEvents(raw: unknown): EventType[] {
	if (typeof raw === "string") {
		try {
			return parseEnabledEvents(JSON.parse(raw));
		} catch {
			return [...DEFAULT_ENABLED_EVENTS];
		}
	}
	const parsed = z.array(eventTypeSchema).safeParse(raw);
	return parsed.success ? parsed.data : [...DEFAULT_ENABLED_EVENTS];
}

/** Map GitHub X-GitHub-Event header (+ watch→star) to our EventType. */
export function githubEventToType(event: string): EventType | null {
	if (event === "watch") return "star";
	if ((EVENT_TYPES as readonly string[]).includes(event)) {
		return event as EventType;
	}
	return null;
}
