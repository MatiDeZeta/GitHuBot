import { verify, verifyWithFallback } from "@octokit/webhooks-methods";

export type SignatureMatch = "primary" | "fallback" | false;

/**
 * Verify GitHub webhook signature (X-Hub-Signature-256) against the raw body.
 * Uses @octokit/webhooks-methods only — no GitHub API client or token.
 *
 * When `previousSecrets` is provided (e.g. after `/repo regenerate-secret`),
 * accepts either the new or old secret so deliveries keep working while the
 * user updates the secret field on GitHub.
 *
 * Returns which secret matched so callers can clear the rotation fallback
 * once the primary secret is confirmed in use.
 */
export async function verifyGitHubSignature(
	secret: string,
	rawBody: string,
	signatureHeader: string | undefined,
	previousSecrets: string[] = [],
): Promise<SignatureMatch> {
	if (!signatureHeader) return false;
	try {
		if (await verify(secret, rawBody, signatureHeader)) {
			return "primary";
		}
		if (previousSecrets.length === 0) {
			return false;
		}
		// Primary failed; accept any previous secret during rotation grace.
		const ok = await verifyWithFallback(
			secret,
			rawBody,
			signatureHeader,
			previousSecrets,
		);
		return ok ? "fallback" : false;
	} catch {
		return false;
	}
}
