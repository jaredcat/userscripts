// ==UserScript==
// @name         Kingshot Troop Formation %
// @namespace    https://github.com/jaredcat/userscripts
// @version      1.2.0
// @author       jaredcat
// @description  Bear table: subtractive simulation; Calculated % = composition per march vs preset goal warnings. Vikings: uniform best-fit. Training Focus.
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/kingshot-troop-calculator.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/kingshot-troop-calculator.user.js
// @match        https://www.kingshotguide.org/calculator/troops-calculator*
// @grant        unsafeWindow
// ==/UserScript==

(function() {
var STORAGE_KEY = "ks-troop-calc-inputs";
var STORAGE_KEY_FIELDS = "ks-troop-calc-fields-v3";
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
var FIELD_ORDER = [
		"mySquad",
		"totalInf",
		"totalCav",
		"totalArc",
		"bearInf",
		"bearCav",
		"bearArc",
		"bearSquads",
		"vikingInf",
		"vikingCav",
		"vikSquads"
	];
	function getPageInputs() {
		return [...pageWindow.document.querySelectorAll("input")];
	}
function findSectionRootByHeading(rx) {
		const h = [...pageWindow.document.querySelectorAll("h2, h3")].find((el) => rx.test(el.textContent?.trim() ?? ""));
		if (!h) return null;
		return h.closest("[class*=\"rounded-lg\"], [class*=\"rounded\"], section, article") ?? h.parentElement;
	}
function getCalculatorFieldMap() {
		const out = {};
		const inputsRoot = findSectionRootByHeading(/^inputs?$/i) ?? findSectionRootByHeading(/troop inputs/i);
		if (inputsRoot) {
			const inp = [...inputsRoot.querySelectorAll("input")].filter(isNumericLikeInput);
			const a = inp[0];
			const b = inp[1];
			const c = inp[2];
			const d = inp[3];
			if (a && b && c && d) {
				out.mySquad = a;
				out.totalInf = b;
				out.totalCav = c;
				out.totalArc = d;
			}
		}
		const bearRoot = findSectionRootByHeading(/bear preset/i) ?? findSectionRootByHeading(/bear\s*\(/i);
		if (bearRoot) {
			const inp = [...bearRoot.querySelectorAll("input")].filter(isNumericLikeInput);
			const a = inp[0];
			const b = inp[1];
			const c = inp[2];
			const d = inp[3];
			if (a && b && c && d) {
				out.bearInf = a;
				out.bearCav = b;
				out.bearArc = c;
				out.bearSquads = d;
			}
		}
		const vikRoot = findSectionRootByHeading(/vikings? preset/i);
		if (vikRoot) {
			const inp = [...vikRoot.querySelectorAll("input")].filter(isNumericLikeInput);
			const a = inp[0];
			const b = inp[1];
			const c = inp[2];
			if (a && b && c) {
				out.vikingInf = a;
				out.vikingCav = b;
				out.vikSquads = c;
			}
		}
		return out;
	}
function getCalculatorOrderedInputs() {
		const m = getCalculatorFieldMap();
		const resolved = FIELD_ORDER.map((k) => m[k]).filter(Boolean);
		if (resolved.length === 11) return resolved;
		return [...pageWindow.document.querySelectorAll("input")].filter(isNumericLikeInput);
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
		const m = getCalculatorFieldMap();
		const fields = {};
		let hasAny = false;
		for (const key of FIELD_ORDER) {
			const el = m[key];
			if (el) {
				fields[key] = el.value;
				hasAny = true;
			}
		}
		if (hasAny) try {
			localStorage.setItem(STORAGE_KEY_FIELDS, JSON.stringify({
				v: 3,
				fields
			}));
		} catch {}
		const values = getCalculatorOrderedInputs().map((el) => el.value);
		if (values.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
	}
	function loadFieldsFromStorage() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY_FIELDS);
			if (raw) {
				const p = JSON.parse(raw);
				if (p?.fields && typeof p.fields === "object") return p.fields;
			}
			const legacy = load();
			if (legacy.length >= FIELD_ORDER.length) {
				const out = {};
				for (let i = 0; i < FIELD_ORDER.length; i++) {
					const key = FIELD_ORDER[i];
					if (key === void 0) continue;
					const v = legacy[i];
					if (v !== void 0) out[key] = String(v);
				}
				return out;
			}
		} catch {}
		return null;
	}
	function applySavedFields(fields) {
		const m = getCalculatorFieldMap();
		for (const key of FIELD_ORDER) {
			const val = fields[key];
			if (val === void 0) continue;
			const el = m[key];
			if (el && String(el.value) !== String(val)) setReactValue(el, val);
		}
	}
	var restored = false;
	async function restoreOnce() {
		if (restored) return;
		restored = true;
		const fields = loadFieldsFromStorage();
		if (!fields || Object.keys(fields).length === 0) return;
		applySavedFields(fields);
		await new Promise((r) => setTimeout(r, 120));
		applySavedFields(fields);
		const again = () => {
			applySavedFields(fields);
		};
		setTimeout(again, 1e3);
		setTimeout(again, 2800);
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
	function roundCountTripletToSum(exacts, targetSum) {
		const floors = [
			Math.floor(exacts[0]),
			Math.floor(exacts[1]),
			Math.floor(exacts[2])
		];
		let delta = targetSum - (floors[0] + floors[1] + floors[2]);
		const r = [
			exacts[0] - floors[0],
			exacts[1] - floors[1],
			exacts[2] - floors[2]
		];
		const order = [
			0,
			1,
			2
		].sort((a, b) => (r[b] ?? 0) - (r[a] ?? 0));
		let o = 0;
		while (delta > 0) {
			const idx = order[o % 3] ?? 0;
			floors[idx] += 1;
			delta -= 1;
			o += 1;
		}
		return floors;
	}
	function splitCountsForPreset(mySquad, infPct, cavPct, arcPct) {
		if (mySquad <= 0) return {
			inf: 0,
			cav: 0,
			arc: 0
		};
		const [inf, cav, arc] = roundCountTripletToSum([
			mySquad * infPct / 100,
			mySquad * cavPct / 100,
			mySquad * arcPct / 100
		], mySquad);
		return {
			inf,
			cav,
			arc
		};
	}
	function subtractChunk(pool, chunk) {
		return {
			inf: pool.inf - chunk.inf,
			cav: pool.cav - chunk.cav,
			arc: pool.arc - chunk.arc
		};
	}
function allocateMarchTowardPreset(rem, mySquad, infPct, cavPct, arcPct) {
		if (mySquad <= 0) return {
			inf: 0,
			cav: 0,
			arc: 0
		};
		const ideal = splitCountsForPreset(mySquad, infPct, cavPct, arcPct);
		let inf = Math.min(ideal.inf, rem.inf);
		let cav = Math.min(ideal.cav, rem.cav);
		let arc = Math.min(ideal.arc, rem.arc);
		let total = inf + cav + arc;
		while (total < mySquad) {
			const slack = [
				{
					k: "inf",
					short: ideal.inf - inf,
					avail: rem.inf - inf
				},
				{
					k: "cav",
					short: ideal.cav - cav,
					avail: rem.cav - cav
				},
				{
					k: "arc",
					short: ideal.arc - arc,
					avail: rem.arc - arc
				}
			].filter((x) => x.avail > 0);
			if (!slack.length) break;
			slack.sort((a, b) => b.short - a.short);
			const pick = slack[0];
			if (pick === void 0) break;
			if (pick.k === "inf") inf++;
			else if (pick.k === "cav") cav++;
			else arc++;
			total++;
		}
		return {
			inf,
			cav,
			arc
		};
	}
	function bearSliderRoundedPcts(inf, cav, arc) {
		const [i, c, a] = roundTripletTo100([
			inf,
			cav,
			arc
		], {});
		return {
			inf: i,
			cav: c,
			arc: a
		};
	}
function existsCompositionWithSum(T, capI, capC, capA) {
		const aMax = Math.min(capA, T);
		for (let a = 0; a <= aMax; a++) {
			const rem = T - a;
			if (Math.max(0, rem - capC) <= Math.min(capI, rem)) return true;
		}
		return false;
	}
function maxFeasibleMarchTotal(soloCap, capI, capC, capA) {
		const upper = Math.min(soloCap, capI + capC + capA);
		let lo = 0;
		let hi = upper;
		while (lo < hi) {
			const mid = Math.ceil((lo + hi + 1) / 2);
			if (existsCompositionWithSum(mid, capI, capC, capA)) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
function bestCompositionForMarchTotal(T, capI, capC, capA, ti, tc, ta) {
		if (T <= 0) return {
			inf: 0,
			cav: 0,
			arc: 0
		};
		let best;
		let bestScore = Infinity;
		let bestTieArcher = -1;
		const maxA = Math.min(capA, T);
		for (let a = 0; a <= maxA; a++) {
			const rem = T - a;
			const iLow = Math.max(0, rem - capC);
			const iHigh = Math.min(capI, rem);
			if (iLow > iHigh) continue;
			const denom = ti + tc;
			let iFloat;
			if (denom <= 1e-12) iFloat = ti <= 1e-12 && tc <= 1e-12 ? 0 : rem / 2;
			else iFloat = rem * ti / denom;
			const candidates = new Set();
			for (const d of [
				-2,
				-1,
				0,
				1,
				2
			]) candidates.add(Math.round(iFloat) + d);
			candidates.add(iLow);
			candidates.add(iHigh);
			for (const i of candidates) {
				if (i < iLow || i > iHigh) continue;
				const c = rem - i;
				if (c < 0 || c > capC) continue;
				const si = i / T - ti;
				const sc = c / T - tc;
				const sa = a / T - ta;
				const score = si * si + sc * sc + sa * sa;
				if (score < bestScore || score === bestScore && a > bestTieArcher) {
					bestScore = score;
					bestTieArcher = a;
					best = {
						inf: i,
						cav: c,
						arc: a
					};
				}
			}
		}
		return best;
	}
function findBestUniformMarch(totalInf, totalCav, totalArc, numMarches, mySquad, idealInf, idealCav, idealArc) {
		const N = numMarches;
		const S = mySquad;
		if (N <= 0 || S <= 0) return {
			march: {
				inf: 0,
				cav: 0,
				arc: 0
			},
			marchTotal: 0
		};
		const capI = Math.min(S, Math.floor(totalInf / N));
		const capC = Math.min(S, Math.floor(totalCav / N));
		const capA = Math.min(S, Math.floor(totalArc / N));
		const norm = idealInf + idealCav + idealArc;
		const ti = norm > 0 ? idealInf / norm : 1 / 3;
		const tc = norm > 0 ? idealCav / norm : 1 / 3;
		const ta = norm > 0 ? idealArc / norm : 1 / 3;
		const T = maxFeasibleMarchTotal(S, capI, capC, capA);
		if (T <= 0) return {
			march: {
				inf: 0,
				cav: 0,
				arc: 0
			},
			marchTotal: 0
		};
		const march = bestCompositionForMarchTotal(T, capI, capC, capA, ti, tc, ta);
		if (!march) return {
			march: {
				inf: 0,
				cav: 0,
				arc: 0
			},
			marchTotal: 0
		};
		return {
			march,
			marchTotal: T
		};
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
		const m = getCalculatorFieldMap();
		const legacy = [...pageWindow.document.querySelectorAll("input")].filter(isNumericLikeInput);
		const pick = (k, legacyIdx) => {
			const el = m[k];
			if (el) return parseCount(el.value);
			return parseCount(legacy[legacyIdx]?.value);
		};
		return {
			mySquad: pick("mySquad", IDX.mySquad),
			totalInf: pick("totalInf", IDX.totalInf),
			totalCav: pick("totalCav", IDX.totalCav),
			totalArc: pick("totalArc", IDX.totalArc),
			bearInf: pick("bearInf", IDX.bearInf),
			bearCav: pick("bearCav", IDX.bearCav),
			bearArc: pick("bearArc", IDX.bearArc),
			bearSquads: pick("bearSquads", IDX.bearSquads),
			vikingInf: pick("vikingInf", IDX.vikingInf),
			vikingCav: pick("vikingCav", IDX.vikingCav),
			vikSquads: pick("vikSquads", IDX.vikSquads)
		};
	}
	function buildPctCell(display, actual, warnAgainst) {
		const td = document.createElement("td");
		const warns = [];
		if (actual.inf < warnAgainst.inf) warns.push("⚠ Low infantry");
		if (actual.cav < warnAgainst.cav) warns.push("⚠ Low cavalry");
		if (actual.arc < warnAgainst.arc) warns.push("⚠ Low archers");
		td.innerHTML = `
      <span class="ks-pct-badge ks-pct-inf">I: ${display.inf}%</span>
      <span class="ks-pct-badge ks-pct-cav">C: ${display.cav}%</span>
      <span class="ks-pct-badge ks-pct-arc">A: ${display.arc}%</span>
      ${warns.map((w) => `<span class="ks-pct-warn">${w}</span>`).join("")}
    `;
		return td;
	}
	function findSplitTable(pattern) {
		const h3 = [...document.querySelectorAll("h3")].find((el) => pattern.test(el.textContent?.trim() ?? ""));
		if (!h3) return void 0;
		const card = h3.closest("[class*=\"bg-white\"], [class*=\"bg-gray-8\"], [class*=\"rounded-lg\"]");
		if (card) {
			const table = card.querySelector("table");
			if (table) return table;
		}
		return [...document.querySelectorAll("table")].find((t) => /infantry/i.test(t.textContent ?? "") && /archers/i.test(t.textContent ?? ""));
	}
	function getTroopRow(table, label) {
		for (const row of table.querySelectorAll("tr")) {
			if (row.classList.contains("ks-pct-row")) continue;
			if ((row.cells[0]?.textContent?.trim().toLowerCase() ?? "") === label) return row;
		}
	}
	function getTroopRowLoose(table, includes) {
		for (const row of table.querySelectorAll("tr")) {
			if (row.classList.contains("ks-pct-row")) continue;
			if ((row.cells[0]?.textContent?.trim().toLowerCase() ?? "").includes(includes)) return row;
		}
	}
function ensureBearRallyColumn(table) {
		const headerRow = table.querySelector("tr");
		if (!headerRow || headerRow.cells.length < 3) return;
		if (headerRow.cells[1]?.textContent?.trim() === "Rally") return;
		for (const row of table.querySelectorAll("tr")) {
			if (row.classList.contains("ks-pct-row")) continue;
			const cell = row.insertCell(1);
			cell.textContent = "";
		}
		const rallyHeader = headerRow.cells[1];
		if (rallyHeader) rallyHeader.textContent = "Rally";
	}
	function fillTroopDataColumn(row, values) {
		const last = row.cells.length - 1;
		for (let i = 0; i < values.length; i++) {
			const cell = row.cells[i + 1];
			if (cell) cell.textContent = fmt(values[i] ?? 0);
		}
		const totalCell = row.cells[last];
		if (totalCell) totalCell.textContent = fmt(values.reduce((a, b) => a + b, 0));
	}
	function fillSummaryRows(table, chunks, mySquad) {
		const used = getTroopRowLoose(table, "used");
		const supply = getTroopRow(table, "supply");
		const unused = getTroopRowLoose(table, "unused");
		const usedVals = chunks.map((ch) => ch.inf + ch.cav + ch.arc);
		const supplyVals = chunks.map(() => mySquad);
		const unusedVals = supplyVals.map((s, i) => s - (usedVals[i] ?? 0));
		if (used) fillTroopDataColumn(used, usedVals);
		if (supply) fillTroopDataColumn(supply, supplyVals);
		if (unused) fillTroopDataColumn(unused, unusedVals);
	}
function appendBearSplitPctRow(table, mySquad, rally, squadMarch, squadMarchTotal, numSquads, presetGoal) {
		if (mySquad <= 0) return;
		const arcRow = getTroopRow(table, "archers");
		if (!arcRow) return;
		const pctRow = document.createElement("tr");
		pctRow.classList.add("ks-pct-row");
		const labelCell = document.createElement("td");
		labelCell.textContent = "Calculated %";
		pctRow.appendChild(labelCell);
		const rallySum = rally.inf + rally.cav + rally.arc;
		const rallyDenom = rallySum > 0 ? rallySum : mySquad;
		const rallyCalc = toColumnGamePcts(rally.inf, rally.cav, rally.arc, rallyDenom, {});
		pctRow.appendChild(buildPctCell(rallyCalc, rallyCalc, presetGoal));
		const squadDenom = squadMarchTotal > 0 ? squadMarchTotal : mySquad;
		const squadCalc = toColumnGamePcts(squadMarch.inf, squadMarch.cav, squadMarch.arc, squadDenom, {});
		for (let i = 0; i < numSquads; i++) pctRow.appendChild(buildPctCell(squadCalc, squadCalc, presetGoal));
		pctRow.appendChild(document.createElement("td"));
		arcRow.insertAdjacentElement("afterend", pctRow);
	}
function appendUniformFormationPctRow(table, mySquad, columnCount, march, marchTotal) {
		if (mySquad <= 0 || columnCount <= 0) return;
		const arcRow = getTroopRow(table, "archers");
		if (!arcRow) return;
		const denom = marchTotal > 0 ? marchTotal : mySquad;
		const p = toColumnGamePcts(march.inf, march.cav, march.arc, denom, {});
		const display = {
			inf: p.inf,
			cav: p.cav,
			arc: p.arc
		};
		const pctRow = document.createElement("tr");
		pctRow.classList.add("ks-pct-row");
		const labelCell = document.createElement("td");
		labelCell.textContent = "Calculated %";
		pctRow.appendChild(labelCell);
		for (let i = 0; i < columnCount; i++) pctRow.appendChild(buildPctCell(display, p, display));
		pctRow.appendChild(document.createElement("td"));
		arcRow.insertAdjacentElement("afterend", pctRow);
	}
	function processBearSplitTable(table, v) {
		table.querySelectorAll("tr.ks-pct-row").forEach((r) => r.remove());
		if (v.mySquad <= 0 || v.bearSquads <= 0) return;
		const pool = {
			inf: v.totalInf,
			cav: v.totalCav,
			arc: v.totalArc
		};
		const rally = allocateMarchTowardPreset(pool, v.mySquad, v.bearInf, v.bearCav, v.bearArc);
		const rem = subtractChunk(pool, rally);
		const { march, marchTotal } = findBestUniformMarch(rem.inf, rem.cav, rem.arc, v.bearSquads, v.mySquad, v.bearInf, v.bearCav, v.bearArc);
		ensureBearRallyColumn(table);
		const infRow = getTroopRow(table, "infantry");
		const cavRow = getTroopRow(table, "cavalry");
		const arcRow = getTroopRow(table, "archers");
		if (!infRow || !cavRow || !arcRow) return;
		const n = v.bearSquads;
		const infVals = [rally.inf, ...new Array(n).fill(march.inf)];
		const cavVals = [rally.cav, ...new Array(n).fill(march.cav)];
		const arcVals = [rally.arc, ...new Array(n).fill(march.arc)];
		fillTroopDataColumn(infRow, infVals);
		fillTroopDataColumn(cavRow, cavVals);
		fillTroopDataColumn(arcRow, arcVals);
		fillSummaryRows(table, [{
			inf: rally.inf,
			cav: rally.cav,
			arc: rally.arc
		}, ...Array.from({ length: n }, () => ({
			inf: march.inf,
			cav: march.cav,
			arc: march.arc
		}))], v.mySquad);
		appendBearSplitPctRow(table, v.mySquad, rally, march, marchTotal, n, bearSliderRoundedPcts(v.bearInf, v.bearCav, v.bearArc));
	}
	function processVikingsSplitTable(table, v) {
		table.querySelectorAll("tr.ks-pct-row").forEach((r) => r.remove());
		if (v.mySquad <= 0 || v.vikSquads <= 0) return;
		const n = v.vikSquads;
		const { march, marchTotal } = findBestUniformMarch(v.totalInf, v.totalCav, v.totalArc, n, v.mySquad, v.vikingInf, v.vikingCav, 0);
		const infRow = getTroopRow(table, "infantry");
		const cavRow = getTroopRow(table, "cavalry");
		const arcRow = getTroopRow(table, "archers");
		if (!infRow || !cavRow || !arcRow) return;
		fillTroopDataColumn(infRow, new Array(n).fill(march.inf));
		fillTroopDataColumn(cavRow, new Array(n).fill(march.cav));
		fillTroopDataColumn(arcRow, new Array(n).fill(march.arc));
		fillSummaryRows(table, Array.from({ length: n }, () => ({
			inf: march.inf,
			cav: march.cav,
			arc: march.arc
		})), v.mySquad);
		appendUniformFormationPctRow(table, v.mySquad, n, march, marchTotal);
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
				id: "balanced",
				pattern: /balanced/i,
				infR: .5,
				cavR: .2,
				arcR: .3,
				squads: Math.max(v.bearSquads, v.vikSquads)
			},
			{
				id: "bear",
				pattern: /bear/i,
				infR: v.bearInf / 100,
				cavR: v.bearCav / 100,
				arcR: v.bearArc / 100,
				squads: v.bearSquads
			},
			{
				id: "viking",
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
			let infGap;
			let cavGap;
			let arcGap;
			if (preset.id === "bear") {
				const marches = v.bearSquads + 1;
				const one = splitCountsForPreset(mySquad, v.bearInf, v.bearCav, v.bearArc);
				infGap = Math.max(0, one.inf * marches - v.totalInf);
				cavGap = Math.max(0, one.cav * marches - v.totalCav);
				arcGap = Math.max(0, one.arc * marches - v.totalArc);
			} else {
				infGap = Math.max(0, Math.round(mySquad * infR * squads) - v.totalInf);
				cavGap = Math.max(0, Math.round(mySquad * cavR * squads) - v.totalCav);
				arcGap = Math.max(0, Math.round(mySquad * arcR * squads) - v.totalArc);
			}
			const gaps = [
				infGap,
				cavGap,
				arcGap
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
		el.textContent = `Targets are computed from ideal march counts (full solo capacity per march). Balanced uses ${balancedSquads} (highest of Bear or Viking). Bear uses ${bear} squads plus 1 rally (${bear + 1} marches at your Bear preset). Vikings uses ${vik}. Gaps are non-negative.`;
	}
	function run() {
		injectStyles();
		const v = getInputValues();
		const bearTable = findSplitTable(/^bear split$/i);
		if (bearTable) processBearSplitTable(bearTable, v);
		const vikingsTable = findSplitTable(/^vikings split$/i);
		if (vikingsTable) processVikingsSplitTable(vikingsTable, v);
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