// ==UserScript==
// @name         Kingshot Troop Formation %
// @namespace    https://github.com/jaredcat/userscripts
// @version      1.0.4
// @author       jaredcat
// @description  Injects per-squad in-game formation preset percentages into the Bear and Vikings Split tables. Warns when any troop type falls below its preset target. Persists inputs to localStorage across sessions. Sanitizes pasted numbers (commas, spaces) in calculator inputs.
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/kingshot-troop-calculator.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/kingshot-troop-calculator.user.js
// @match        https://www.kingshotguide.org/calculator/troops-calculator*
// @grant        unsafeWindow
// ==/UserScript==

(function() {
var STORAGE_KEY = "ks-troop-calc-inputs";
	var STYLE_ID = "ks-formation-pct-style";
	var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
	var IDX = {
		mySquad: 0,
		totalInf: 1,
		totalCav: 2,
		totalArc: 3,
		bearInf: 4,
		bearCav: 5,
		bearArc: 6,
		bearSquads: 7,
		vikingInf: 8,
		vikingCav: 9,
		vikSquads: 10
	};
	function getPageInputs() {
		return [...pageWindow.document.querySelectorAll("input")];
	}
	function setReactValue(pageEl, value) {
		const key = Object.keys(pageEl).find((k) => k.startsWith("__reactProps"));
		if (!key) return;
		const onChange = pageEl[key]?.onChange;
		if (onChange) onChange({ target: { value: String(value) } });
	}
function sanitizePastedNumericField(text) {
		const compact = text.replace(/[\s,]/g, "");
		let out = "";
		let hasDot = false;
		for (const ch of compact) if (ch >= "0" && ch <= "9") out += ch;
		else if (ch === "." && !hasDot) {
			hasDot = true;
			out += ch;
		}
		return out;
	}
	function isNumericLikeInput(el) {
		const t = (el.type || "text").toLowerCase();
		if (t === "checkbox" || t === "radio" || t === "file" || t === "button") return false;
		if (t === "hidden" || t === "submit" || t === "reset" || t === "image") return false;
		return true;
	}
	function load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.map((x) => String(x));
		} catch {
			return [];
		}
	}
	function saveAll() {
		const values = getPageInputs().map((el) => el.value);
		if (values.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
	}
	var restored = false;
	async function restoreOnce() {
		if (restored) return;
		restored = true;
		const saved = load();
		if (!saved.length) return;
		const pageInputs = getPageInputs();
		if (!pageInputs.length) return;
		for (let i = 0; i < saved.length && i < pageInputs.length; i++) {
			const el = pageInputs[i];
			if (!el) continue;
			if (el.value === String(saved[i])) continue;
			setReactValue(el, saved[i] ?? "");
			await new Promise((r) => setTimeout(r, 80));
		}
	}
	var saveTimer;
	function onUserInput(e) {
		if (!e.isTrusted) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(saveAll, 300);
	}
	function onPasteCapture(e) {
		const target = e.target;
		if (!target || !(target instanceof HTMLInputElement)) return;
		if (!isNumericLikeInput(target)) return;
		const raw = e.clipboardData?.getData("text/plain");
		if (raw === void 0 || raw === "") return;
		const sanitized = sanitizePastedNumericField(raw);
		if (sanitized === raw) return;
		e.preventDefault();
		e.stopPropagation();
		setReactValue(target, sanitized);
		clearTimeout(saveTimer);
		saveTimer = setTimeout(saveAll, 300);
	}
	function injectStyles() {
		if (document.getElementById(STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = `
      .ks-pct-row td {
        font-size: 0.85em;
        border-top: 2px solid rgba(100,160,255,0.3);
        vertical-align: top;
        padding: 6px 4px;
      }
      .ks-pct-row td:first-child { font-weight: 700; white-space: nowrap; }
      .ks-pct-badge { display: block; line-height: 1.6; }
      .ks-pct-inf   { color: #4da6ff; }
      .ks-pct-cav   { color: #f06292; }
      .ks-pct-arc   { color: #4caf82; }
      .ks-pct-warn  { color: #ffab40; font-size: 0.8em; display: block; margin-top: 2px; }
    `;
		document.head.appendChild(style);
	}
	function parseCount(text) {
		return parseInt((text ?? "").replace(/[^0-9]/g, ""), 10) || 0;
	}
	function fmt(n) {
		return n.toLocaleString();
	}
	function roundTripletTo100(exacts, opts) {
		const floors = [
			Math.floor(exacts[0]),
			Math.floor(exacts[1]),
			Math.floor(exacts[2])
		];
		const remainders = [
			exacts[0] - floors[0],
			exacts[1] - floors[1],
			exacts[2] - floors[2]
		];
		const bias = opts?.bias ?? [
			0,
			0,
			0
		];
		const typeToIdx = (t) => t === "inf" ? 0 : t === "cav" ? 1 : 2;
		const preferAddIdx = opts?.preferAdd ? typeToIdx(opts.preferAdd) : void 0;
		const preferSubIdx = opts?.preferSub ? typeToIdx(opts.preferSub) : void 0;
		let delta = 100 - (floors[0] + floors[1] + floors[2]);
		while (delta > 0) {
			const idx = [
				0,
				1,
				2
			].filter((i) => floors[i] < 100).sort((a, b) => {
				const ra = remainders[a] + bias[a];
				const rb = remainders[b] + bias[b];
				if (rb !== ra) return rb - ra;
				if (preferAddIdx !== void 0) {
					if (a === preferAddIdx && b !== preferAddIdx) return -1;
					if (b === preferAddIdx && a !== preferAddIdx) return 1;
				}
				return a - b;
			})[0];
			if (idx === void 0) break;
			floors[idx] += 1;
			delta -= 1;
		}
		while (delta < 0) {
			const idx = [
				0,
				1,
				2
			].filter((i) => floors[i] > 0).sort((a, b) => {
				const ra = remainders[a] + bias[a];
				const rb = remainders[b] + bias[b];
				if (ra !== rb) return ra - rb;
				if (preferSubIdx !== void 0) {
					if (a === preferSubIdx && b !== preferSubIdx) return -1;
					if (b === preferSubIdx && a !== preferSubIdx) return 1;
				}
				return a - b;
			})[0];
			if (idx === void 0) break;
			floors[idx] -= 1;
			delta += 1;
		}
		return floors;
	}
	function toColumnGamePcts(infCount, cavCount, arcCount, mySquad, opts) {
		if (mySquad <= 0) return {
			inf: 0,
			cav: 0,
			arc: 0
		};
		const infExact = infCount / mySquad * 100;
		const cavExact = cavCount / mySquad * 100;
		const arcExact = arcCount / mySquad * 100;
		const preferred = opts?.preferType;
		const earlyBias = opts?.earlyBias ?? 0;
		const roundingOpts = { bias: preferred === "inf" ? [
			earlyBias,
			0,
			0
		] : preferred === "cav" ? [
			0,
			earlyBias,
			0
		] : preferred === "arc" ? [
			0,
			0,
			earlyBias
		] : [
			0,
			0,
			0
		] };
		if (preferred) {
			roundingOpts.preferAdd = preferred;
			roundingOpts.preferSub = preferred;
		}
		const [inf, cav, arc] = roundTripletTo100([
			infExact,
			cavExact,
			arcExact
		], roundingOpts);
		return {
			inf,
			cav,
			arc
		};
	}
	function getInputValues() {
		const inputs = document.querySelectorAll("input");
		const get = (i) => parseCount(inputs[i]?.value);
		return {
			mySquad: get(IDX.mySquad),
			totalInf: get(IDX.totalInf),
			totalCav: get(IDX.totalCav),
			totalArc: get(IDX.totalArc),
			bearInf: get(IDX.bearInf),
			bearCav: get(IDX.bearCav),
			bearArc: get(IDX.bearArc),
			bearSquads: get(IDX.bearSquads),
			vikingInf: get(IDX.vikingInf),
			vikingCav: get(IDX.vikingCav),
			vikSquads: get(IDX.vikSquads)
		};
	}
	function buildPctCell(infPct, cavPct, arcPct, targets) {
		const td = document.createElement("td");
		const warns = [];
		if (infPct < targets.inf) warns.push("⚠ Low infantry");
		if (cavPct < targets.cav) warns.push("⚠ Low cavalry");
		if (arcPct < targets.arc) warns.push("⚠ Low archers");
		td.innerHTML = `
      <span class="ks-pct-badge ks-pct-inf">I: ${infPct}%</span>
      <span class="ks-pct-badge ks-pct-cav">C: ${cavPct}%</span>
      <span class="ks-pct-badge ks-pct-arc">A: ${arcPct}%</span>
      ${warns.map((w) => `<span class="ks-pct-warn">${w}</span>`).join("")}
    `;
		return td;
	}
	function processTable(table, mySquad, targets, opts) {
		table.querySelectorAll("tr.ks-pct-row").forEach((r) => r.remove());
		if (mySquad === 0) return;
		const rows = [...table.querySelectorAll("tr")];
		if (rows.length < 3) return;
		let infRow;
		let cavRow;
		let arcRow;
		rows.forEach((row) => {
			const label = row.cells[0]?.textContent?.trim().toLowerCase();
			if (label === "infantry") infRow = row;
			if (label === "cavalry") cavRow = row;
			if (label === "archers") arcRow = row;
		});
		if (!infRow || !cavRow || !arcRow) return;
		const squadEnd = infRow.cells.length - 2;
		if (squadEnd < 1) return;
		const pctRow = document.createElement("tr");
		pctRow.classList.add("ks-pct-row");
		const labelCell = document.createElement("td");
		const infCounts = [];
		const cavCounts = [];
		const arcCounts = [];
		for (let col = 1; col <= squadEnd; col++) {
			infCounts.push(parseCount(infRow.cells[col]?.textContent));
			cavCounts.push(parseCount(cavRow.cells[col]?.textContent));
			arcCounts.push(parseCount(arcRow.cells[col]?.textContent));
		}
		labelCell.textContent = "Set in-game %";
		pctRow.appendChild(labelCell);
		for (let i = 0; i < squadEnd; i++) {
			const columnOpts = { earlyBias: (squadEnd - i) * .001 };
			if (opts?.preferType) columnOpts.preferType = opts.preferType;
			const pcts = toColumnGamePcts(infCounts[i] ?? 0, cavCounts[i] ?? 0, arcCounts[i] ?? 0, mySquad, columnOpts);
			pctRow.appendChild(buildPctCell(pcts.inf, pcts.cav, pcts.arc, targets));
		}
		pctRow.appendChild(document.createElement("td"));
		arcRow.insertAdjacentElement("afterend", pctRow);
	}
	function findAndProcessTable(pattern, mySquad, targets, opts) {
		const h3 = [...document.querySelectorAll("h3")].find((el) => pattern.test(el.textContent?.trim() ?? ""));
		if (!h3) return;
		const card = h3.closest("[class*=\"bg-white\"], [class*=\"bg-gray-8\"], [class*=\"rounded-lg\"]");
		if (card) {
			const table = card.querySelector("table");
			if (table) {
				processTable(table, mySquad, targets, opts);
				return;
			}
		}
		document.querySelectorAll("table").forEach((t) => {
			if (/infantry/i.test(t.textContent ?? "") && /archers/i.test(t.textContent ?? "")) processTable(t, mySquad, targets, opts);
		});
	}
	function processTrainingTable(v) {
		const h3 = [...document.querySelectorAll("h3")].find((el) => /training focus/i.test(el.textContent ?? ""));
		if (!h3) return;
		const card = h3.closest("[class*=\"bg-white\"], [class*=\"bg-gray-8\"], [class*=\"rounded-lg\"]");
		if (!card) return;
		const table = card.querySelector("table");
		if (!table) return;
		const rows = [...table.querySelectorAll("tr")];
		const presets = [
			{
				pattern: /balanced/i,
				infR: .5,
				cavR: .2,
				arcR: .3,
				squads: Math.max(v.bearSquads, v.vikSquads)
			},
			{
				pattern: /bear/i,
				infR: v.bearInf / 100,
				cavR: v.bearCav / 100,
				arcR: v.bearArc / 100,
				squads: v.bearSquads
			},
			{
				pattern: /viking/i,
				infR: v.vikingInf / 100,
				cavR: v.vikingCav / 100,
				arcR: 0,
				squads: v.vikSquads
			}
		];
		rows.forEach((row) => {
			const label = row.cells[0]?.textContent?.trim();
			if (!label) return;
			if (/^preset$/i.test(label)) return;
			const preset = presets.find((p) => p.pattern.test(label));
			if (!preset) return;
			const { infR, cavR, arcR, squads } = preset;
			const mySquad = v.mySquad;
			const gaps = [
				Math.max(0, Math.round(mySquad * infR * squads) - v.totalInf),
				Math.max(0, Math.round(mySquad * cavR * squads) - v.totalCav),
				Math.max(0, Math.round(mySquad * arcR * squads) - v.totalArc)
			];
			[
				1,
				2,
				3
			].forEach((cellIdx, i) => {
				const cell = row.cells[cellIdx];
				if (!cell) return;
				const gap = gaps[i];
				if (gap === void 0) return;
				cell.textContent = fmt(gap);
			});
		});
	}
	function updateTrainingFocusExplainer(v) {
		const h3 = [...document.querySelectorAll("h3")].find((el) => /training focus/i.test(el.textContent ?? ""));
		if (!h3) return;
		const card = h3.closest("[class*=\"bg-white\"], [class*=\"bg-gray-8\"], [class*=\"rounded-lg\"]");
		if (!card) return;
		const bear = v.bearSquads;
		const vik = v.vikSquads;
		const balancedSquads = Math.max(bear, vik);
		const isExplainerText = (text) => /Targets are computed/i.test(text) && text.length < 500;
		const el = [...card.querySelectorAll("p")].find((node) => isExplainerText(node.textContent ?? ""));
		if (!el) return;
		el.textContent = `Targets are computed as (mySquad × ratio × squads). Balanced uses ${balancedSquads} (highest of Bear or Viking). Bear uses ${bear}. Vikings uses ${vik}. Gaps are non-negative.`;
	}
	function run() {
		injectStyles();
		const v = getInputValues();
		findAndProcessTable(/^bear split$/i, v.mySquad, {
			inf: v.bearInf,
			cav: v.bearCav,
			arc: v.bearArc
		}, { preferType: "arc" });
		findAndProcessTable(/^vikings split$/i, v.mySquad, {
			inf: v.vikingInf,
			cav: v.vikingCav,
			arc: 0
		}, { preferType: "inf" });
		processTrainingTable(v);
		updateTrainingFocusExplainer(v);
	}
	document.addEventListener("input", onUserInput, true);
	document.addEventListener("change", onUserInput, true);
	document.addEventListener("paste", onPasteCapture, true);
	function waitForReactThenRestore(maxMs = 1e4) {
		const start = Date.now();
		const poll = setInterval(() => {
			const pageInputs = getPageInputs();
			if (pageInputs.length > 0 && Object.keys(pageInputs[0]).some((k) => k.startsWith("__reactProps"))) {
				clearInterval(poll);
				setTimeout(() => void restoreOnce(), 200);
			} else if (Date.now() - start > maxMs) {
				clearInterval(poll);
				console.warn("[KS] Timed out waiting for React — restore skipped");
			}
		}, 100);
	}
	var runDebounce;
	new MutationObserver(() => {
		clearTimeout(runDebounce);
		runDebounce = setTimeout(run, 150);
	}).observe(document.body, {
		childList: true,
		subtree: true,
		characterData: true
	});
	run();
	waitForReactThenRestore();
})();