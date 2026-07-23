/** Accent colors for ContainerBuilder (RGB integers). */
export const Accents = {
	push: 0x6b7280,
	prOpen: 0x3b82f6,
	prMerged: 0x22c55e,
	prClosed: 0xef4444,
	issueOpen: 0xf59e0b,
	issueClosed: 0xef4444,
	release: 0xa855f7,
	create: 0x14b8a6,
	delete: 0xf97316,
	fork: 0x6366f1,
	star: 0xeab308,
	workflowSuccess: 0x22c55e,
	workflowFailure: 0xef4444,
	comment: 0x64748b,
	review: 0x0ea5e9,
} as const;

export const MAX_COMMITS_SHOWN = 10;
export const MAX_BODY_PREVIEW = 280;

export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

export function firstLine(message: string): string {
	return message.split("\n")[0]?.trim() ?? "";
}

export function truncate(text: string, max = MAX_BODY_PREVIEW): string {
	const cleaned = text.replace(/\r\n/g, "\n").trim();
	if (cleaned.length <= max) return cleaned;
	return `${cleaned.slice(0, max - 1)}…`;
}

/** Plain short blurb from release notes — strip headings/lists so Discord doesn't look cut mid-markdown. */
export function shortReleaseDescription(body: string, max = MAX_BODY_PREVIEW): string {
	const plain = body
		.replace(/\r\n/g, "\n")
		.replace(/^#{1,6}\s+.+$/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+\.\s+/gm, "")
		.replace(/\n{2,}/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return truncate(plain, max);
}

export function branchFromRef(ref: string): string {
	return ref.replace(/^refs\/(heads|tags)\//, "");
}
