import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "./version.js";

/**
 * The version, the Node major and the pnpm version are each written down in
 * several places by hand. These checks fail CI when a release bumps one copy
 * and forgets another, instead of shipping a README or image that disagrees.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const pkg = JSON.parse(read("package.json")) as {
	version: string;
	packageManager: string;
	engines: { node: string };
	devDependencies: Record<string, string>;
};
const readme = read("README.md");
const changelog = read("CHANGELOG.md");
const dockerfile = read("docker/Dockerfile");
const ci = read(".github/workflows/ci.yml");

describe("release metadata", () => {
	it("keeps src/version.ts in step with package.json", () => {
		expect(VERSION).toBe(pkg.version);
	});

	it("shows the current version on the README badge", () => {
		expect(readme).toContain(`badge/version-${pkg.version}-`);
	});

	it("has a CHANGELOG section and release link for the current version", () => {
		expect(changelog).toMatch(
			new RegExp(`^## \\[${escapeRegExp(pkg.version)}\\] — \\d{4}-\\d{2}-\\d{2}$`, "m"),
		);
		expect(changelog).toContain(
			`[${pkg.version}]: https://github.com/MatiDeZeta/GitHuBot/releases/tag/v${pkg.version}`,
		);
	});

	it("gives every CHANGELOG version heading a link reference", () => {
		const headings = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1]);
		for (const heading of headings) {
			expect(changelog, `missing link for [${heading}]`).toMatch(
				new RegExp(`^\\[${escapeRegExp(heading ?? "")}\\]: https://`, "m"),
			);
		}
	});
});

describe("toolchain versions", () => {
	const nodeMajor = /^>=(\d+)$/.exec(pkg.engines.node)?.[1];

	it("declares a single Node major in engines", () => {
		expect(nodeMajor).toBeDefined();
	});

	it("builds the Docker image on that Node major", () => {
		const bases = [...dockerfile.matchAll(/^FROM node:(\d+)-alpine@sha256:[0-9a-f]{64}/gm)];
		expect(bases.length).toBe(2);
		for (const base of bases) expect(base[1]).toBe(nodeMajor);
	});

	it("runs CI on that Node major", () => {
		const versions = [...ci.matchAll(/node-version: (\d+)/g)].map((match) => match[1]);
		expect(versions.length).toBeGreaterThan(0);
		for (const version of versions) expect(version).toBe(nodeMajor);
	});

	it("types against that Node major", () => {
		expect(pkg.devDependencies["@types/node"]).toMatch(new RegExp(`^\\^${nodeMajor}\\.`));
	});

	it("pins that Node major in .nvmrc for local development", () => {
		expect(read(".nvmrc").trim()).toBe(nodeMajor);
	});

	it("shows that Node major on the README badge", () => {
		expect(readme).toContain(`badge/node-${nodeMajor}_LTS-`);
	});

	it("uses one pnpm version in package.json, CI and the Dockerfile", () => {
		const pnpm = pkg.packageManager.replace(/^pnpm@/, "");
		const ciVersions = [...ci.matchAll(/^\s+version: (\S+)$/gm)].map((match) => match[1]);
		expect(ciVersions.length).toBeGreaterThan(0);
		for (const version of ciVersions) expect(version).toBe(pnpm);
		expect(dockerfile).toContain(`pnpm@${pnpm}`);
	});
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
