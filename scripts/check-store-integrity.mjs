#!/usr/bin/env node
/**
 * Fails when a package in the pnpm store was modified after extraction, which is
 * what tampering with an installed dependency looks like.
 *
 * `pnpm store status` cannot be used directly: esbuild's postinstall rewrites its
 * own `bin/esbuild`, so it is always reported and the command always exits 1. This
 * allows exactly that case — after confirming the replacement is byte-identical to
 * the binary in the corresponding `@esbuild/<platform>` package, which pnpm does
 * verify — and fails on anything else.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/** esbuild swaps its JS shim for the platform binary; nothing else may mutate. */
const ALLOWED = new Set(["esbuild"]);

function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Confirms the mutated `bin/esbuild` is exactly the binary pnpm already
 * hash-verified in `@esbuild/<platform>`, rather than merely assuming it.
 */
function esbuildSwapIsGenuine(version) {
	const pkg = `node_modules/.pnpm/esbuild@${version}/node_modules/esbuild/bin/esbuild`;
	if (!existsSync(pkg)) return false;

	const platformDirs = readdirSync("node_modules/.pnpm").filter(
		(d) => d.startsWith(`@esbuild+`) && d.endsWith(`@${version}`),
	);
	for (const dir of platformDirs) {
		const name = dir.slice("@esbuild+".length, dir.lastIndexOf("@"));
		const bin = `node_modules/.pnpm/${dir}/node_modules/@esbuild/${name}/bin/esbuild`;
		if (existsSync(bin) && sha256(bin) === sha256(pkg)) return true;
	}
	return false;
}

const { stdout, stderr } = await run("pnpm", ["store", "status"], {
	encoding: "utf8",
}).catch((err) => ({ stdout: err.stdout ?? "", stderr: err.stderr ?? "" }));

const modified = `${stdout}\n${stderr}`
	.split("\n")
	.map((line) => line.trim())
	.filter((line) => /^[@a-z0-9][^\s]*@\d[^\s]*$/i.test(line));

if (modified.length === 0) {
	console.log("Store integrity: OK — no modified packages.");
	process.exit(0);
}

const unexpected = [];
for (const entry of modified) {
	const at = entry.lastIndexOf("@");
	const name = entry.slice(0, at);
	const version = entry.slice(at + 1);

	if (!ALLOWED.has(name)) {
		unexpected.push(`${entry} (not in the allow-list)`);
		continue;
	}
	if (name === "esbuild" && !esbuildSwapIsGenuine(version)) {
		unexpected.push(`${entry} (bin/esbuild does not match any @esbuild/* platform binary)`);
		continue;
	}
	console.log(`Store integrity: ${entry} modified as expected (verified platform binary swap).`);
}

if (unexpected.length > 0) {
	console.error("\nStore integrity: UNEXPECTED modification — a dependency may be tampered with:");
	for (const line of unexpected) console.error(`  - ${line}`);
	console.error("\nRefetch with `pnpm install --force` and investigate if it reappears.");
	process.exit(1);
}
