/** Same shape `/repo add` accepts; anything else is not a name worth storing. */
const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Compares the repository a verified delivery names with the one being tracked.
 *
 * - `undefined` — the payload names no repository (nothing to learn from it).
 * - `null` — it matches, case-insensitively as GitHub compares names.
 * - a string — the `owner/repo` GitHub reported, which differs: the repository
 *   was renamed or transferred, or the webhook was added to a different one.
 */
export function repositoryMismatch(
	tracked: { owner: string; repo: string },
	payload: unknown,
): string | null | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const repository = (payload as { repository?: unknown }).repository;
	if (!repository || typeof repository !== "object") return undefined;
	const fullName = (repository as { full_name?: unknown }).full_name;
	if (typeof fullName !== "string" || !FULL_NAME.test(fullName)) return undefined;

	const expected = `${tracked.owner}/${tracked.repo}`;
	return fullName.toLowerCase() === expected.toLowerCase() ? null : fullName;
}
