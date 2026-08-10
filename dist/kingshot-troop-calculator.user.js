// ==UserScript==
// @name         Kingshot Troop Formation %
// @namespace    https://github.com/jaredcat/userscripts
// @version      1.2.1
// @author       jaredcat
// @description  Bear table: subtractive simulation; Calculated % = composition per march vs preset goal warnings. Vikings: uniform best-fit. Training Focus.
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/kingshot-troop-calculator.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/kingshot-troop-calculator.user.js
// @match        https://www.kingshotguide.org/calculator/troops-calculator*
// @grant        unsafeWindow
// ==/UserScript==

(function() {
	"use strict";
	var STORAGE_KEY = "ks-troop-calc-inputs";
	var STORAGE_KEY_FIELDS = "ks-troop-calc-fields-v3";
	var STYLE_ID = "ks-formation-pct-style";
	var pageWindow = typeof unsafeWindow === "undefined" ? globalThis : unsafeWindow;
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
		const h = [...pageWindow.document.querySelectorAll("h2, h3")].find((element) => rx.test(element.textContent?.trim() ?? ""));
		if (!h) return void 0;
		return h.closest("[class*=\"rounded-lg\"], [class*=\"rounded\"], section, article") ?? h.parentElement;
	}
	function getCalculatorFieldMap() {
		const out = {};
		const inputsRoot = findSectionRootByHeading(/^inputs?$/i) ?? findSectionRootByHeading(/troop inputs/i);
		if (inputsRoot) {
			const inp = [...inputsRoot.querySelectorAll("input")].filter((element) => isNumericLikeInput(element));
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
			const inp = [...bearRoot.querySelectorAll("input")].filter((element) => isNumericLikeInput(element));
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
			const inp = [...vikRoot.querySelectorAll("input")].filter((element) => isNumericLikeInput(element));
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
		return [...pageWindow.document.querySelectorAll("input")].filter((element) => isNumericLikeInput(element));
	}
	function setReactValue(pageElement, value) {
		const key = Object.keys(pageElement).find((k) => k.startsWith("__reactProps"));
		if (!key) return;
		const onChange = pageElement[key]?.onChange;
		if (onChange) onChange({ target: { value: String(value) } });
	}
	function sanitizePastedNumericField(text) {
		const compact = text.replaceAll(/[\s,]/g, "");
		let out = "";
		let hasDot = false;
		for (const ch of compact) if (ch >= "0" && ch <= "9") out += ch;
		else if (ch === "." && !hasDot) {
			hasDot = true;
			out += ch;
		}
		return out;
	}
	function isNumericLikeInput(element) {
		const t = (element.type || "text").toLowerCase();
		if ([
			"checkbox",
			"radio",
			"file",
			"button"
		].includes(t)) return false;
		if ([
			"hidden",
			"submit",
			"reset",
			"image"
		].includes(t)) return false;
		return true;
	}
	function load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.map(String);
		} catch {
			return [];
		}
	}
	function saveAll() {
		const m = getCalculatorFieldMap();
		const fields = {};
		let hasAny = false;
		for (const key of FIELD_ORDER) {
			const element = m[key];
			if (element) {
				fields[key] = element.value;
				hasAny = true;
			}
		}
		if (hasAny) try {
			localStorage.setItem(STORAGE_KEY_FIELDS, JSON.stringify({
				v: 3,
				fields
			}));
		} catch {}
		const values = getCalculatorOrderedInputs().map((element) => element.value);
		if (values.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
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
				for (const [index, key] of FIELD_ORDER.entries()) {
					const v = legacy[index];
					if (v !== void 0) out[key] = v;
				}
				return out;
			}
		} catch {}
	}
	function applySavedFields(fields) {
		const m = getCalculatorFieldMap();
		for (const key of FIELD_ORDER) {
			const value = fields[key];
			if (value === void 0) continue;
			const element = m[key];
			if (element && element.value !== value) setReactValue(element, value);
		}
	}
	var state = {
		isRestored: false,
		saveTimer: void 0,
		runDebounce: void 0
	};
	async function restoreOnce() {
		if (state.isRestored) return;
		state.isRestored = true;
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
	function onUserInput(event) {
		if (!event.isTrusted) return;
		clearTimeout(state.saveTimer);
		state.saveTimer = setTimeout(saveAll, 300);
	}
	function onPasteCapture(event) {
		const target = event.target;
		if (!target || !(target instanceof HTMLInputElement)) return;
		if (!isNumericLikeInput(target)) return;
		const raw = event.clipboardData?.getData("text/plain");
		if (raw === void 0 || raw === "") return;
		const sanitized = sanitizePastedNumericField(raw);
		if (sanitized === raw) return;
		event.preventDefault();
		event.stopPropagation();
		setReactValue(target, sanitized);
		clearTimeout(state.saveTimer);
		state.saveTimer = setTimeout(saveAll, 300);
	}
	function injectStyles() {
		if (document.querySelector(`#${STYLE_ID}`)) return;
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
		document.head.append(style);
	}
	function parseCount(text) {
		return Number((text ?? "").replaceAll(/\D/g, "")) || 0;
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
		];
		order.sort((a, b) => (r[b] ?? 0) - (r[a] ?? 0));
		let o = 0;
		while (delta > 0) {
			const index = order[o % 3] ?? 0;
			floors[index] += 1;
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
			if (slack.length === 0) break;
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
		const [index, c, a] = roundTripletTo100([
			inf,
			cav,
			arc
		], {});
		return {
			inf: index,
			cav: c,
			arc: a
		};
	}
	function hasCompositionWithSum(T, capI, capC, capA) {
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
			if (hasCompositionWithSum(mid, capI, capC, capA)) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
	function infFloatForRemainder(rem, ti, tc) {
		const denom = ti + tc;
		if (denom <= 1e-12) {
			if (ti <= 1e-12 && tc <= 1e-12) return 0;
			return rem / 2;
		}
		return rem * ti / denom;
	}
	function candidateInfValues(indexFloat, indexLow, indexHigh) {
		const candidates = new Set();
		for (const d of [
			-2,
			-1,
			0,
			1,
			2
		]) candidates.add(Math.round(indexFloat) + d);
		candidates.add(indexLow);
		candidates.add(indexHigh);
		return candidates;
	}
	function scoreComposition(index, c, a, T, ti, tc, ta) {
		const si = index / T - ti;
		const sc = c / T - tc;
		const sa = a / T - ta;
		return si * si + sc * sc + sa * sa;
	}
	function evaluateCompositionCandidate(input) {
		const { index, rem, a, bounds, ratios } = input;
		if (index < bounds.indexLow || index > bounds.indexHigh) return void 0;
		const c = rem - index;
		if (c < 0 || c > bounds.capC) return void 0;
		return {
			score: scoreComposition(index, c, a, ratios.T, ratios.ti, ratios.tc, ratios.ta),
			chunk: {
				inf: index,
				cav: c,
				arc: a
			}
		};
	}
	function considerCandidatesForArcher(a, rem, bounds, ratios, best) {
		const indexFloat = infFloatForRemainder(rem, ratios.ti, ratios.tc);
		for (const index of candidateInfValues(indexFloat, bounds.indexLow, bounds.indexHigh)) {
			const evaluated = evaluateCompositionCandidate({
				index,
				rem,
				a,
				bounds,
				ratios
			});
			if (!evaluated) continue;
			if (!(evaluated.score < best.score || evaluated.score === best.score && a > best.tieArcher)) continue;
			best.score = evaluated.score;
			best.tieArcher = a;
			best.chunk = evaluated.chunk;
		}
	}
	function bestCompositionForMarchTotal(T, capI, capC, capA, ti, tc, ta) {
		if (T <= 0) return {
			inf: 0,
			cav: 0,
			arc: 0
		};
		const best = {
			chunk: void 0,
			score: Infinity,
			tieArcher: -1
		};
		const ratios = {
			T,
			ti,
			tc,
			ta
		};
		const maxA = Math.min(capA, T);
		for (let a = 0; a <= maxA; a++) {
			const rem = T - a;
			const indexLow = Math.max(0, rem - capC);
			const indexHigh = Math.min(capI, rem);
			if (indexLow > indexHigh) continue;
			considerCandidatesForArcher(a, rem, {
				indexLow,
				indexHigh,
				capC
			}, ratios, best);
		}
		return best.chunk;
	}
	function findBestUniformMarch(pool, numberMarches, mySquad, ideal) {
		const N = numberMarches;
		const S = mySquad;
		if (N <= 0 || S <= 0) return {
			march: {
				inf: 0,
				cav: 0,
				arc: 0
			},
			marchTotal: 0
		};
		const capI = Math.min(S, Math.floor(pool.inf / N));
		const capC = Math.min(S, Math.floor(pool.cav / N));
		const capA = Math.min(S, Math.floor(pool.arc / N));
		const norm = ideal.inf + ideal.cav + ideal.arc;
		const ti = norm > 0 ? ideal.inf / norm : 1 / 3;
		const tc = norm > 0 ? ideal.cav / norm : 1 / 3;
		const ta = norm > 0 ? ideal.arc / norm : 1 / 3;
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
	function roundTripletTo100(exacts, options) {
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
		const bias = options?.bias ?? [
			0,
			0,
			0
		];
		const preferAddIndex = options?.preferAdd ? troopTypeToIndex(options.preferAdd) : void 0;
		const preferSubIndex = options?.preferSub ? troopTypeToIndex(options.preferSub) : void 0;
		let delta = 100 - (floors[0] + floors[1] + floors[2]);
		while (delta > 0) {
			const index = pickRemainderIndex([
				0,
				1,
				2
			].filter((index_) => floors[index_] < 100), remainders, bias, preferAddIndex, "desc");
			if (index === void 0) break;
			floors[index] += 1;
			delta -= 1;
		}
		while (delta < 0) {
			const index = pickRemainderIndex([
				0,
				1,
				2
			].filter((index_) => floors[index_] > 0), remainders, bias, preferSubIndex, "asc");
			if (index === void 0) break;
			floors[index] -= 1;
			delta += 1;
		}
		return floors;
	}
	function troopTypeToIndex(t) {
		if (t === "inf") return 0;
		if (t === "cav") return 1;
		return 2;
	}
	function pickRemainderIndex(candidates, remainders, bias, preferIndex, direction) {
		const sorted = [...candidates];
		sorted.sort((a, b) => {
			const ra = (remainders[a] ?? 0) + (bias[a] ?? 0);
			const rb = (remainders[b] ?? 0) + (bias[b] ?? 0);
			if (ra !== rb) return direction === "desc" ? rb - ra : ra - rb;
			if (preferIndex !== void 0) {
				if (a === preferIndex && b !== preferIndex) return -1;
				if (b === preferIndex && a !== preferIndex) return 1;
			}
			return a - b;
		});
		return sorted[0];
	}
	function toColumnGamePcts(infCount, cavCount, arcCount, mySquad, options) {
		if (mySquad <= 0) return {
			inf: 0,
			cav: 0,
			arc: 0
		};
		const infExact = infCount / mySquad * 100;
		const cavExact = cavCount / mySquad * 100;
		const arcExact = arcCount / mySquad * 100;
		const preferred = options?.preferType;
		const roundingOptions = { bias: biasForPreferredType(preferred, options?.earlyBias ?? 0) };
		if (preferred) {
			roundingOptions.preferAdd = preferred;
			roundingOptions.preferSub = preferred;
		}
		const [inf, cav, arc] = roundTripletTo100([
			infExact,
			cavExact,
			arcExact
		], roundingOptions);
		return {
			inf,
			cav,
			arc
		};
	}
	function biasForPreferredType(preferred, earlyBias) {
		if (preferred === "inf") return [
			earlyBias,
			0,
			0
		];
		if (preferred === "cav") return [
			0,
			earlyBias,
			0
		];
		if (preferred === "arc") return [
			0,
			0,
			earlyBias
		];
		return [
			0,
			0,
			0
		];
	}
	function getInputValues() {
		const m = getCalculatorFieldMap();
		const legacy = [...pageWindow.document.querySelectorAll("input")].filter((element) => isNumericLikeInput(element));
		const pick = (k, legacyIndex) => {
			const element = m[k];
			if (element) return parseCount(element.value);
			return parseCount(legacy[legacyIndex]?.value);
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
		const h3 = [...document.querySelectorAll("h3")].find((element) => pattern.test(element.textContent?.trim() ?? ""));
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
		for (const [index, value] of values.entries()) {
			const cell = row.cells[index + 1];
			if (cell) cell.textContent = fmt(value ?? 0);
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
		const unusedVals = supplyVals.map((s, index) => s - (usedVals[index] ?? 0));
		if (used) fillTroopDataColumn(used, usedVals);
		if (supply) fillTroopDataColumn(supply, supplyVals);
		if (unused) fillTroopDataColumn(unused, unusedVals);
	}
	function appendBearSplitPctRow(table, mySquad, rally, squadMarch, squadMarchTotal, numberSquads, presetGoal) {
		if (mySquad <= 0) return;
		const arcRow = getTroopRow(table, "archers");
		if (!arcRow) return;
		const pctRow = document.createElement("tr");
		pctRow.classList.add("ks-pct-row");
		const labelCell = document.createElement("td");
		labelCell.textContent = "Calculated %";
		pctRow.append(labelCell);
		const rallySum = rally.inf + rally.cav + rally.arc;
		const rallyDenom = rallySum > 0 ? rallySum : mySquad;
		const rallyCalc = toColumnGamePcts(rally.inf, rally.cav, rally.arc, rallyDenom, {});
		pctRow.append(buildPctCell(rallyCalc, rallyCalc, presetGoal));
		const squadDenom = squadMarchTotal > 0 ? squadMarchTotal : mySquad;
		const squadCalc = toColumnGamePcts(squadMarch.inf, squadMarch.cav, squadMarch.arc, squadDenom, {});
		for (let index = 0; index < numberSquads; index++) pctRow.append(buildPctCell(squadCalc, squadCalc, presetGoal));
		pctRow.append(document.createElement("td"));
		arcRow.after(pctRow);
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
		pctRow.append(labelCell);
		for (let index = 0; index < columnCount; index++) pctRow.append(buildPctCell(display, p, display));
		pctRow.append(document.createElement("td"));
		arcRow.after(pctRow);
	}
	function processBearSplitTable(table, v) {
		for (const row of table.querySelectorAll("tr.ks-pct-row")) row.remove();
		if (v.mySquad <= 0 || v.bearSquads <= 0) return;
		const pool = {
			inf: v.totalInf,
			cav: v.totalCav,
			arc: v.totalArc
		};
		const rally = allocateMarchTowardPreset(pool, v.mySquad, v.bearInf, v.bearCav, v.bearArc);
		const { march, marchTotal } = findBestUniformMarch(subtractChunk(pool, rally), v.bearSquads, v.mySquad, {
			inf: v.bearInf,
			cav: v.bearCav,
			arc: v.bearArc
		});
		ensureBearRallyColumn(table);
		const infRow = getTroopRow(table, "infantry");
		const cavRow = getTroopRow(table, "cavalry");
		const arcRow = getTroopRow(table, "archers");
		if (!infRow || !cavRow || !arcRow) return;
		const n = v.bearSquads;
		const infVals = [rally.inf, ...Array.from({ length: n }, () => march.inf)];
		const cavVals = [rally.cav, ...Array.from({ length: n }, () => march.cav)];
		const arcVals = [rally.arc, ...Array.from({ length: n }, () => march.arc)];
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
		for (const row of table.querySelectorAll("tr.ks-pct-row")) row.remove();
		if (v.mySquad <= 0 || v.vikSquads <= 0) return;
		const n = v.vikSquads;
		const { march, marchTotal } = findBestUniformMarch({
			inf: v.totalInf,
			cav: v.totalCav,
			arc: v.totalArc
		}, n, v.mySquad, {
			inf: v.vikingInf,
			cav: v.vikingCav,
			arc: 0
		});
		const infRow = getTroopRow(table, "infantry");
		const cavRow = getTroopRow(table, "cavalry");
		const arcRow = getTroopRow(table, "archers");
		if (!infRow || !cavRow || !arcRow) return;
		fillTroopDataColumn(infRow, Array.from({ length: n }, () => march.inf));
		fillTroopDataColumn(cavRow, Array.from({ length: n }, () => march.cav));
		fillTroopDataColumn(arcRow, Array.from({ length: n }, () => march.arc));
		fillSummaryRows(table, Array.from({ length: n }, () => ({
			inf: march.inf,
			cav: march.cav,
			arc: march.arc
		})), v.mySquad);
		appendUniformFormationPctRow(table, v.mySquad, n, march, marchTotal);
	}
	function buildTrainingPresets(v) {
		return [
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
	}
	function computeTrainingGaps(preset, v) {
		const mySquad = v.mySquad;
		if (preset.id === "bear") {
			const marches = v.bearSquads + 1;
			const one = splitCountsForPreset(mySquad, v.bearInf, v.bearCav, v.bearArc);
			return [
				Math.max(0, one.inf * marches - v.totalInf),
				Math.max(0, one.cav * marches - v.totalCav),
				Math.max(0, one.arc * marches - v.totalArc)
			];
		}
		const { infR, cavR, arcR, squads } = preset;
		return [
			Math.max(0, Math.round(mySquad * infR * squads) - v.totalInf),
			Math.max(0, Math.round(mySquad * cavR * squads) - v.totalCav),
			Math.max(0, Math.round(mySquad * arcR * squads) - v.totalArc)
		];
	}
	function fillTrainingGapCells(row, gaps) {
		for (const [index, cellIndex] of [
			1,
			2,
			3
		].entries()) {
			const cell = row.cells[cellIndex];
			const gap = gaps[index];
			if (!cell || gap === void 0) continue;
			cell.textContent = fmt(gap);
		}
	}
	function processTrainingTable(v) {
		const h3 = [...document.querySelectorAll("h3")].find((element) => /training focus/i.test(element.textContent ?? ""));
		if (!h3) return;
		const card = h3.closest("[class*=\"bg-white\"], [class*=\"bg-gray-8\"], [class*=\"rounded-lg\"]");
		if (!card) return;
		const table = card.querySelector("table");
		if (!table) return;
		const presets = buildTrainingPresets(v);
		for (const row of table.querySelectorAll("tr")) {
			const label = row.cells[0]?.textContent?.trim();
			if (!label || /^preset$/i.test(label)) continue;
			const preset = presets.find((p) => p.pattern.test(label));
			if (!preset) continue;
			fillTrainingGapCells(row, computeTrainingGaps(preset, v));
		}
	}
	function isExplainerText(text) {
		return /Targets are computed/i.test(text) && text.length < 500;
	}
	function updateTrainingFocusExplainer(v) {
		const h3 = [...document.querySelectorAll("h3")].find((element) => /training focus/i.test(element.textContent ?? ""));
		if (!h3) return;
		const card = h3.closest("[class*=\"bg-white\"], [class*=\"bg-gray-8\"], [class*=\"rounded-lg\"]");
		if (!card) return;
		const bear = v.bearSquads;
		const vik = v.vikSquads;
		const balancedSquads = Math.max(bear, vik);
		const element = [...card.querySelectorAll("p")].find((node) => isExplainerText(node.textContent ?? ""));
		if (!element) return;
		element.textContent = `Targets are computed from ideal march counts (full solo capacity per march). Balanced uses ${balancedSquads} (highest of Bear or Viking). Bear uses ${bear} squads plus 1 rally (${bear + 1} marches at your Bear preset). Vikings uses ${vik}. Gaps are non-negative.`;
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
	document.addEventListener("input", onUserInput, { capture: true });
	document.addEventListener("change", onUserInput, { capture: true });
	document.addEventListener("paste", onPasteCapture, { capture: true });
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
	new MutationObserver(() => {
		clearTimeout(state.runDebounce);
		state.runDebounce = setTimeout(run, 150);
	}).observe(document.body, {
		childList: true,
		subtree: true,
		characterData: true
	});
	run();
	waitForReactThenRestore();
})();
