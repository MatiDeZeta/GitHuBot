import { createHash } from "node:crypto";

/**
 * The dashboard's stylesheet and script, kept as strings so the compiled output
 * needs no asset pipeline — `tsc` emits nothing but JavaScript, and a self-hoster
 * runs the same single process either way.
 *
 * Both are served from the bot itself, which is what lets the Content-Security-
 * Policy forbid every inline style and script: markup carries classes and SVG
 * presentation attributes only, never a `style=""` or an `onclick=""`.
 */

const SANS =
	"-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

export const STYLESHEET = `
:root {
	color-scheme: dark;
	--bg: #0d1117; --bg-raised: #161b22; --bg-sunken: #010409; --bg-hover: #1c2128;
	--line: #30363d; --line-soft: #21262d;
	--text: #e6edf3; --text-2: #9da7b3; --text-3: #6e7681;
	--accent: #5865f2; --accent-hover: #6d78f5; --accent-soft: rgba(88,101,242,.16); --on-accent: #fff;
	--ok: #3fb950; --ok-soft: rgba(63,185,80,.14);
	--bad: #f85149; --bad-soft: rgba(248,81,73,.13);
	--warn: #d29922; --warn-soft: rgba(210,153,34,.14);
	--info: #58a6ff; --info-soft: rgba(88,166,255,.13);
	--merged: #a371f7;
	--chart: #2f81f7; --chart-dim: #1b3a66;
	--shadow: 0 8px 24px rgba(1,4,9,.6);
	--radius: 10px;
}
@media (prefers-color-scheme: light) {
	:root {
		color-scheme: light;
		--bg: #f6f8fa; --bg-raised: #fff; --bg-sunken: #eef1f4; --bg-hover: #f0f3f6;
		--line: #d0d7de; --line-soft: #e4e8ec;
		--text: #1f2328; --text-2: #59636e; --text-3: #818b98;
		--accent: #4752c4; --accent-hover: #3c45a5; --accent-soft: rgba(71,82,196,.11); --on-accent: #fff;
		--ok: #1a7f37; --ok-soft: rgba(26,127,55,.11);
		--bad: #cf222e; --bad-soft: rgba(207,34,46,.09);
		--warn: #9a6700; --warn-soft: rgba(154,103,0,.11);
		--info: #0969da; --info-soft: rgba(9,105,218,.09);
		--merged: #8250df;
		--chart: #0969da; --chart-dim: #b6d4f7;
		--shadow: 0 8px 24px rgba(140,149,159,.25);
	}
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scrollbar-color: var(--line) transparent; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 ${SANS}; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-decoration: none; }
a.link { color: var(--info); }
a.link:hover { text-decoration: underline; }
h1, h2, h3, p { margin: 0; }
code, .mono { font-family: ${MONO}; font-size: .92em; }
code { padding: 1px 5px; background: var(--bg-sunken); border: 1px solid var(--line-soft); border-radius: 5px; }
svg { flex-shrink: 0; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.muted { color: var(--text-2); }
.faint { color: var(--text-3); }
.ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.grow { flex: 1 1 auto; min-width: 0; }
.row { display: flex; align-items: center; gap: 10px; }
.row.wrap { flex-wrap: wrap; }
.row.top { align-items: flex-start; }
.row.between { justify-content: space-between; }
.stack { display: flex; flex-direction: column; gap: 16px; }
.stack.tight { gap: 6px; }
.stack.loose { gap: 24px; }
.hidden { display: none !important; }

/* ------------------------------------------------------------------ shell */
.app { display: grid; grid-template-columns: 252px minmax(0, 1fr); min-height: 100vh; }
.side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 4px; padding: 16px 12px; background: var(--bg-sunken); border-right: 1px solid var(--line-soft); overflow-y: auto; }
.brand { display: flex; align-items: center; gap: 10px; padding: 6px 8px 14px; font-weight: 700; font-size: 15px; letter-spacing: -.01em; }
.brand .ver { margin-left: auto; font-weight: 500; font-size: 11px; color: var(--text-3); }
.switch { position: relative; margin-bottom: 10px; }
.switch > summary { list-style: none; display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-raised); border: 1px solid var(--line); border-radius: 8px; cursor: pointer; font-weight: 600; }
.switch > summary::-webkit-details-marker { display: none; }
.switch > summary:hover { background: var(--bg-hover); }
.switch[open] > summary { border-color: var(--accent); }
.switch .menu { position: absolute; z-index: 20; left: 0; right: 0; top: calc(100% + 6px); max-height: 320px; overflow-y: auto; padding: 6px; background: var(--bg-raised); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); }
.switch .menu a { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 6px; }
.switch .menu a:hover { background: var(--bg-hover); }
.switch .menu a[aria-current] { background: var(--accent-soft); }
.navlabel { padding: 12px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-3); }
.nav a { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 7px; color: var(--text-2); font-weight: 500; }
.nav a:hover { background: var(--bg-hover); color: var(--text); }
.nav a[aria-current] { background: var(--accent-soft); color: var(--text); }
.nav a[aria-current] svg { color: var(--accent); }
.nav .n { margin-left: auto; padding: 0 7px; border-radius: 20px; background: var(--bg-hover); font-size: 11.5px; font-weight: 600; color: var(--text-2); }
.nav .n.bad { background: var(--bad-soft); color: var(--bad); }
.side .foot { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line-soft); display: flex; align-items: center; gap: 10px; }
.avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--bg-hover); object-fit: cover; }
.tile { width: 24px; height: 24px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 800; color: #fff; flex-shrink: 0; }
.tile.lg { width: 44px; height: 44px; border-radius: 12px; font-size: 16px; }
.tile.t0 { background: #5865f2; } .tile.t1 { background: #8250df; } .tile.t2 { background: #1a7f37; } .tile.t3 { background: #bf3989; }
.tile.t4 { background: #0e8a7d; } .tile.t5 { background: #b35900; } .tile.t6 { background: #cf222e; } .tile.t7 { background: #0969da; }
.tile.off { background: var(--bg-hover); color: var(--text-3); }

.main { min-width: 0; padding: 28px 36px 64px; }
.page { max-width: 1120px; margin: 0 auto; }
.crumbs { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 13px; color: var(--text-3); }
.crumbs a:hover { color: var(--text); }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 22px; }
.head h1 { font-size: 24px; font-weight: 700; letter-spacing: -.02em; line-height: 1.25; }
.head .sub { margin-top: 4px; color: var(--text-2); }
.live { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--text-2); }
.live i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
.live.on i { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }

/* ------------------------------------------------------------- components */
.card { background: var(--bg-raised); border: 1px solid var(--line); border-radius: var(--radius); }
.card > .hd { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--line-soft); }
.card > .hd h2 { font-size: 14px; font-weight: 600; }
.card > .bd { padding: 16px; }
.card > .ft { padding: 12px 16px; border-top: 1px solid var(--line-soft); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.grid { display: grid; gap: 16px; }
.grid.c4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.grid.c2 { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); align-items: start; }
.grid.even { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }

.stat { padding: 16px; }
.stat .k { font-size: 12px; font-weight: 600; color: var(--text-2); }
.stat .v { margin-top: 6px; font-size: 26px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat .d { margin-top: 6px; font-size: 12px; color: var(--text-3); }

.badge { display: inline-flex; align-items: center; gap: 6px; padding: 1px 9px; border: 1px solid transparent; border-radius: 20px; font-size: 12px; font-weight: 600; line-height: 20px; white-space: nowrap; }
.badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.badge.bad { background: var(--bad-soft); color: var(--bad); }
.badge.warn { background: var(--warn-soft); color: var(--warn); }
.badge.info { background: var(--info-soft); color: var(--info); }
.badge.dim { background: var(--bg-hover); color: var(--text-2); }
.chip { display: inline-flex; align-items: center; padding: 1px 8px; border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--text-2); font-family: ${MONO}; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 32px; padding: 0 12px; background: var(--bg-raised); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: 600 13px ${SANS}; cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--bg-hover); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn.danger { color: var(--bad); }
.btn.danger:hover { background: var(--bad); border-color: var(--bad); color: #fff; }
.btn.sm { height: 26px; padding: 0 9px; font-size: 12px; }
.btn.ghost { background: transparent; border-color: transparent; color: var(--text-2); }
.btn.ghost:hover { background: var(--bg-hover); color: var(--text); }
.btn[disabled] { opacity: .5; cursor: not-allowed; }
form.inline { display: inline; margin: 0; }

.tabs { display: flex; gap: 2px; margin-bottom: 20px; border-bottom: 1px solid var(--line); overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.tabs a { display: flex; align-items: center; gap: 7px; padding: 9px 12px; margin-bottom: -1px; border-bottom: 2px solid transparent; color: var(--text-2); font-weight: 500; white-space: nowrap; }
.tabs a:hover { color: var(--text); }
.tabs a[aria-current] { border-bottom-color: var(--accent); color: var(--text); font-weight: 600; }

.table { width: 100%; border-collapse: collapse; }
.table th { padding: 9px 16px; text-align: left; font-size: 12px; font-weight: 600; color: var(--text-2); border-bottom: 1px solid var(--line-soft); white-space: nowrap; }
.table td { padding: 11px 16px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
.table tr:last-child td { border-bottom: 0; }
.table tbody tr:hover { background: var(--bg-hover); }
.table .num { text-align: right; font-variant-numeric: tabular-nums; }
.table .tight { width: 1%; white-space: nowrap; }
.table a.cell { display: flex; align-items: center; gap: 11px; }
.table a.cell:hover .name { color: var(--info); }
.name { font-weight: 600; white-space: nowrap; }
.table td a.link, .table td .mono { white-space: nowrap; }
.scroll { overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.list > a { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--line-soft); }
.list > a:last-child { border-bottom: 0; }
.list > a:hover { background: var(--bg-hover); }

.banner { display: flex; gap: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-raised); }
.banner.ok { border-color: var(--ok); background: var(--ok-soft); }
.banner.bad { border-color: var(--bad); background: var(--bad-soft); }
.banner.warn { border-color: var(--warn); background: var(--warn-soft); }
.banner.info { border-color: var(--info); background: var(--info-soft); }
.banner .t { font-weight: 600; }
.banner svg { margin-top: 2px; }

.empty { padding: 48px 24px; text-align: center; }
.empty h2 { font-size: 17px; }
.empty p { max-width: 460px; margin: 8px auto 18px; color: var(--text-2); }

/* ------------------------------------------------------------------ forms */
label.f, .f { display: flex; flex-direction: column; gap: 6px; }
.f > span, .flabel { font-weight: 600; font-size: 13px; }
.f small, .hint { font-size: 12.5px; color: var(--text-2); font-weight: 400; }
input[type=text], input[type=search], input[type=password], select, textarea {
	width: 100%; height: 34px; padding: 0 10px; background: var(--bg); border: 1px solid var(--line); border-radius: 7px; color: var(--text); font: 14px ${SANS};
}
textarea { height: auto; padding: 8px 10px; resize: vertical; }
input.mono { font-family: ${MONO}; font-size: 13px; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
input[readonly] { background: var(--bg-sunken); color: var(--text-2); }
select { appearance: none; padding-right: 28px; background-image: linear-gradient(45deg, transparent 50%, var(--text-2) 50%), linear-gradient(135deg, var(--text-2) 50%, transparent 50%); background-position: calc(100% - 15px) 14px, calc(100% - 10px) 14px; background-size: 5px 5px; background-repeat: no-repeat; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.copy { display: flex; gap: 8px; }
.copy input { flex: 1 1 auto; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.toolbar input[type=search] { flex: 1 1 220px; }
.toolbar select { width: auto; min-width: 150px; }

.checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 16px; }
.check { display: flex; align-items: flex-start; gap: 10px; padding: 7px 8px; border-radius: 7px; cursor: pointer; }
.check:hover { background: var(--bg-hover); }
.check input { width: 16px; height: 16px; margin: 3px 0 0; accent-color: var(--accent); flex-shrink: 0; }
.check b { display: block; font-weight: 600; }
.check small { display: block; color: var(--text-2); font-size: 12.5px; }
.group { border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg-raised); }
.group > .gh { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); }
.group > .gh h3 { font-size: 14px; font-weight: 600; }
.group > .gb { padding: 8px; }
.dotc { width: 9px; height: 9px; border-radius: 3px; }
.dotc.code { background: #8b949e; } .dotc.pulls { background: #a371f7; } .dotc.issues { background: #d29922; }
.dotc.cicd { background: #3fb950; } .dotc.releases { background: #bc8cff; } .dotc.discussions { background: #6e7bf2; }
.dotc.security { background: #f0883e; } .dotc.community { background: #e3b341; } .dotc.meta { background: #768390; }

/* ----------------------------------------------------------------- charts */
.chart { display: block; width: 100%; height: 120px; }
.chart.mini { width: 84px; height: 24px; }
.chart rect { fill: var(--chart-dim); }
.chart rect.hot { fill: var(--chart); }
.chart rect.zero { fill: var(--line-soft); }
.meter { display: block; width: 100%; height: 6px; }
.meter .trk { fill: var(--line-soft); }
.meter .okf { fill: var(--ok); }
.meter .badf { fill: var(--bad); }
.axis { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11.5px; color: var(--text-3); }

/* ---------------------------------------------------------------- preview */
.msgs { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: #313338; border-radius: var(--radius); color: #dbdee1; }
.msg { display: flex; background: #2b2d31; border: 1px solid #1e1f22; border-radius: 8px; overflow: hidden; }
.msg .bar { width: 4px; height: auto; align-self: stretch; }
.msg .in { padding: 11px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 13.5px; line-height: 1.45; }
.msg .ti { font-weight: 700; color: #f2f3f5; font-size: 15px; }
.msg .mt { color: #b5bac1; font-size: 12.5px; }
.msg code { background: #1e1f22; border: 0; color: #dbdee1; }
.msg .fl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; font-size: 12.5px; }
.msg .fl b { display: block; color: #b5bac1; font-weight: 600; font-size: 11.5px; }
.msg .bt { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.msg .bt span { padding: 3px 10px; background: #4e5058; border-radius: 4px; font-size: 12.5px; font-weight: 600; color: #fff; }

/* ------------------------------------------------------------ auth pages */
.center { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
.center .card { width: 100%; max-width: 420px; padding: 36px 32px; text-align: center; }
.center h1 { margin-top: 16px; font-size: 21px; letter-spacing: -.02em; }
.center p { margin-top: 8px; color: var(--text-2); }
.center .btn { margin-top: 24px; height: 40px; width: 100%; font-size: 14px; }
.center pre { margin: 20px 0 0; padding: 12px; background: var(--bg-sunken); border: 1px solid var(--line); border-radius: 8px; font: 12.5px/1.8 ${MONO}; text-align: left; overflow-x: auto; }
.steps { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }

@media (max-width: 980px) {
	.app { grid-template-columns: minmax(0, 1fr); }
	.side { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line-soft); }
	.side .nav { display: flex; gap: 4px; overflow-x: auto; }
	.side .navlabel { display: none; }
	.side .foot { margin-top: 10px; }
	.main { padding: 20px 16px 48px; }
	.grid.c4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.grid.c2, .grid.even, .fields, .checks { grid-template-columns: minmax(0, 1fr); }
}
`;

/**
 * Progressive enhancement only: every control it touches is a real link or form
 * that works with scripting off. Written without template literals so it can
 * live inside one.
 */
export const SCRIPT = String.raw`(function () {
	"use strict";
	var doc = document;
	function all(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }

	// Copy buttons: data-copy names the id of an input (or element) to copy.
	doc.addEventListener("click", function (event) {
		var button = event.target.closest && event.target.closest("[data-copy]");
		if (!button) return;
		var source = doc.getElementById(button.getAttribute("data-copy"));
		if (!source || !navigator.clipboard) return;
		var text = "value" in source ? source.value : source.textContent;
		navigator.clipboard.writeText(text).then(function () {
			var label = button.textContent;
			button.textContent = "Copied";
			setTimeout(function () { button.textContent = label; }, 1400);
		});
	});

	// Show / hide a secret held in a password field.
	doc.addEventListener("click", function (event) {
		var button = event.target.closest && event.target.closest("[data-reveal]");
		if (!button) return;
		var field = doc.getElementById(button.getAttribute("data-reveal"));
		if (!field) return;
		var hidden = field.type === "password";
		field.type = hidden ? "text" : "password";
		button.textContent = hidden ? "Hide" : "Show";
	});

	// Destructive forms ask first.
	doc.addEventListener("submit", function (event) {
		var message = event.target.getAttribute && event.target.getAttribute("data-confirm");
		if (message && !window.confirm(message)) event.preventDefault();
	});

	// Live filtering of the repository table.
	all("[data-filter]").forEach(function (form) {
		var query = form.querySelector("input[type=search]");
		var status = form.querySelector("select");
		var rows = all("[data-row]");
		var count = doc.querySelector("[data-count]");
		var none = doc.querySelector("[data-none]");
		function apply() {
			var needle = (query ? query.value : "").trim().toLowerCase();
			var wanted = status ? status.value : "";
			var shown = 0;
			rows.forEach(function (row) {
				var match = (!needle || row.getAttribute("data-search").indexOf(needle) !== -1) &&
					(!wanted || row.getAttribute("data-status") === wanted);
				row.classList.toggle("hidden", !match);
				if (match) shown += 1;
			});
			if (count) count.textContent = String(shown);
			if (none) none.classList.toggle("hidden", shown !== 0);
		}
		if (query) query.addEventListener("input", apply);
		if (status) status.addEventListener("change", apply);
		form.addEventListener("submit", function (event) { event.preventDefault(); apply(); });
	});

	// Event checklists: per-category all / none, and a running total.
	function countChecks() {
		all("[data-total]").forEach(function (out) {
			out.textContent = String(all("input[name=events]:checked").length);
		});
		all("[data-group]").forEach(function (group) {
			var out = group.querySelector("[data-group-count]");
			if (out) out.textContent = String(all("input[name=events]:checked", group).length);
		});
	}
	doc.addEventListener("click", function (event) {
		var button = event.target.closest && event.target.closest("[data-set]");
		if (!button) return;
		var scope = button.closest("[data-group]") || doc;
		var on = button.getAttribute("data-set") === "all";
		all("input[name=events]", scope).forEach(function (box) { box.checked = on; });
		countChecks();
	});
	doc.addEventListener("change", function (event) {
		if (event.target.name === "events") countChecks();
	});

	// Appearance forms redraw their sample messages as the selects change.
	all("[data-preview]").forEach(function (form) {
		var target = doc.getElementById("preview");
		if (!target) return;
		form.addEventListener("change", function () {
			var params = new URLSearchParams();
			all("select", form).forEach(function (select) { params.set(select.name, select.value); });
			fetch(form.getAttribute("data-preview") + "?" + params.toString(), { credentials: "same-origin" })
				.then(function (response) { return response.ok ? response.text() : null; })
				.then(function (html) { if (html !== null) target.innerHTML = html; })
				.catch(function () {});
		});
	});

	// Status refresh: re-fetch this page and swap the regions marked data-live.
	var regions = all("[data-live]");
	var indicator = doc.querySelector(".live");
	if (regions.length > 0) {
		if (indicator) indicator.classList.add("on");
		setInterval(function () {
			if (doc.hidden) return;
			fetch(location.href, { credentials: "same-origin", headers: { accept: "text/html" } })
				.then(function (response) { return response.ok ? response.text() : null; })
				.then(function (html) {
					if (html === null) return;
					var next = new DOMParser().parseFromString(html, "text/html");
					regions.forEach(function (region) {
						var fresh = next.getElementById(region.id);
						if (fresh && fresh.innerHTML !== region.innerHTML) region.innerHTML = fresh.innerHTML;
					});
				})
				.catch(function () { if (indicator) indicator.classList.remove("on"); });
		}, 20000);
	}

	// Close the server switcher when clicking elsewhere.
	doc.addEventListener("click", function (event) {
		all("details.switch[open]").forEach(function (menu) {
			if (!menu.contains(event.target)) menu.removeAttribute("open");
		});
	});
})();
`;

function fingerprint(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/** Content-addressed, so a new release can never be served a stale cached asset. */
export const ASSETS = {
	css: { path: `/dashboard/assets/app.${fingerprint(STYLESHEET)}.css`, body: STYLESHEET },
	js: { path: `/dashboard/assets/app.${fingerprint(SCRIPT)}.js`, body: SCRIPT },
} as const;
