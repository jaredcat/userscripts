/**
 * Kingshot Troop Calculator — formation % rows, training gap annotations, input persistence.
 * Page: https://www.kingshotguide.org/calculator/troops-calculator
 */

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

const STORAGE_KEY = 'ks-troop-calc-inputs';
const STYLE_ID = 'ks-formation-pct-style';

const pageWindow: Window =
  typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

// ─── Input index map ─────────────────────────────────────────────────────────
// 0: mySquad   1: totalInf   2: totalCav   3: totalArc
// 4: bearInf%  5: bearCav%   6: bearArc%   7: bearSquads
// 8: vikInf%   9: vikCav%    10: vikSquads

const IDX = {
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
  vikSquads: 10,
} as const;

type InputValues = {
  mySquad: number;
  totalInf: number;
  totalCav: number;
  totalArc: number;
  bearInf: number;
  bearCav: number;
  bearArc: number;
  bearSquads: number;
  vikingInf: number;
  vikingCav: number;
  vikSquads: number;
};

type PctTargets = { inf: number; cav: number; arc: number };

// ─── React interop ────────────────────────────────────────────────────────────

function getPageInputs(): HTMLInputElement[] {
  return [...pageWindow.document.querySelectorAll('input')];
}

function setReactValue(pageEl: HTMLInputElement, value: string | number): void {
  const key = Object.keys(pageEl as unknown as Record<string, unknown>).find(
    (k) => k.startsWith('__reactProps'),
  );
  if (!key) return;
  const props = (
    pageEl as unknown as Record<
      string,
      { onChange?: (e: { target: { value: string } }) => void }
    >
  )[key];
  const onChange = props?.onChange;
  if (onChange) onChange({ target: { value: String(value) } });
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x));
  } catch {
    return [];
  }
}

function saveAll(): void {
  const values = getPageInputs().map((el) => el.value);
  if (values.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
}

// ─── One-time restore on page load ───────────────────────────────────────────

let restored = false;

async function restoreOnce(): Promise<void> {
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
    setReactValue(el, saved[i] ?? '');
    await new Promise<void>((r) => setTimeout(r, 80));
  }
}

// ─── Input interception — save only ──────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function onUserInput(e: Event): void {
  if (!e.isTrusted) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, 300);
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCount(text: string | null | undefined): number {
  return parseInt((text ?? '').replace(/[^0-9]/g, ''), 10) || 0;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// Convert per-squad counts to whole-number game %s.
function toGamePcts(counts: number[], mySquad: number): number[] {
  if (mySquad === 0) return counts.map(() => 0);
  const n = counts.length;
  const result: number[] = [];

  let remaining = counts.reduce((a, b) => a + b, 0);

  for (let i = 0; i < n; i++) {
    const squadsLeft = n - i;
    const count = counts[i] ?? 0;
    const exact = (count / mySquad) * 100;

    if (i < n - 1) {
      const floorPct = Math.floor(exact);
      const ceilPct = floorPct + 1;
      const ceilTroops = Math.round((mySquad * ceilPct) / 100);
      const floorTroops = Math.round((mySquad * floorPct) / 100);

      const remainingAfterThis = remaining - ceilTroops;
      const minForRest = (squadsLeft - 1) * floorTroops;

      if (remainingAfterThis >= minForRest) {
        result.push(ceilPct);
        remaining -= ceilTroops;
      } else {
        result.push(floorPct);
        remaining -= floorTroops;
      }
    } else {
      result.push(Math.floor((remaining / mySquad) * 100));
    }
  }

  return result;
}

function getInputValues(): InputValues {
  const inputs = document.querySelectorAll('input');
  const get = (i: number) => parseCount(inputs[i]?.value);
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
    vikSquads: get(IDX.vikSquads),
  };
}

// ─── Bear / Vikings split tables ─────────────────────────────────────────────

function buildPctCell(
  infPct: number,
  cavPct: number,
  arcPct: number,
  targets: PctTargets,
): HTMLTableCellElement {
  const td = document.createElement('td');
  const warns: string[] = [];
  if (infPct < targets.inf) warns.push('⚠ Low infantry');
  if (cavPct < targets.cav) warns.push('⚠ Low cavalry');
  if (arcPct < targets.arc) warns.push('⚠ Low archers');
  td.innerHTML = `
      <span class="ks-pct-badge ks-pct-inf">I: ${infPct}%</span>
      <span class="ks-pct-badge ks-pct-cav">C: ${cavPct}%</span>
      <span class="ks-pct-badge ks-pct-arc">A: ${arcPct}%</span>
      ${warns.map((w) => `<span class="ks-pct-warn">${w}</span>`).join('')}
    `;
  return td;
}

function processTable(
  table: HTMLTableElement,
  mySquad: number,
  targets: PctTargets,
): void {
  table.querySelectorAll('tr.ks-pct-row').forEach((r) => r.remove());
  if (mySquad === 0) return;

  const rows = [...table.querySelectorAll('tr')];
  if (rows.length < 3) return;

  let infRow: HTMLTableRowElement | undefined;
  let cavRow: HTMLTableRowElement | undefined;
  let arcRow: HTMLTableRowElement | undefined;
  rows.forEach((row) => {
    const label = row.cells[0]?.textContent?.trim().toLowerCase();
    if (label === 'infantry') infRow = row;
    if (label === 'cavalry') cavRow = row;
    if (label === 'archers') arcRow = row;
  });
  if (!infRow || !cavRow || !arcRow) return;

  const totalCells = infRow.cells.length;
  const squadEnd = totalCells - 2;
  if (squadEnd < 1) return;

  const pctRow = document.createElement('tr');
  pctRow.classList.add('ks-pct-row');
  const labelCell = document.createElement('td');

  const infCounts: number[] = [];
  const cavCounts: number[] = [];
  const arcCounts: number[] = [];
  for (let col = 1; col <= squadEnd; col++) {
    infCounts.push(parseCount(infRow.cells[col]?.textContent));
    cavCounts.push(parseCount(cavRow.cells[col]?.textContent));
    arcCounts.push(parseCount(arcRow.cells[col]?.textContent));
  }

  const infPcts = toGamePcts(infCounts, mySquad);
  const cavPcts = toGamePcts(cavCounts, mySquad);
  const arcPcts = toGamePcts(arcCounts, mySquad);

  labelCell.textContent = 'Set in-game %';
  pctRow.appendChild(labelCell);

  for (let i = 0; i < squadEnd; i++) {
    pctRow.appendChild(
      buildPctCell(infPcts[i] ?? 0, cavPcts[i] ?? 0, arcPcts[i] ?? 0, targets),
    );
  }

  pctRow.appendChild(document.createElement('td'));
  arcRow.insertAdjacentElement('afterend', pctRow);
}

function findAndProcessTable(
  pattern: RegExp,
  mySquad: number,
  targets: PctTargets,
): void {
  const h3 = [...document.querySelectorAll('h3')].find((el) =>
    pattern.test(el.textContent?.trim() ?? ''),
  );
  if (!h3) return;
  const card = h3.closest(
    '[class*="bg-white"], [class*="bg-gray-8"], [class*="rounded-lg"]',
  );
  if (card) {
    const table = card.querySelector('table');
    if (table) {
      processTable(table, mySquad, targets);
      return;
    }
  }
  document.querySelectorAll('table').forEach((t) => {
    if (
      /infantry/i.test(t.textContent ?? '') &&
      /archers/i.test(t.textContent ?? '')
    ) {
      processTable(t, mySquad, targets);
    }
  });
}

// ─── Training Focus table ─────────────────────────────────────────────────────

function processTrainingTable(v: InputValues): void {
  const h3 = [...document.querySelectorAll('h3')].find((el) =>
    /training focus/i.test(el.textContent ?? ''),
  );
  if (!h3) return;
  const card = h3.closest(
    '[class*="bg-white"], [class*="bg-gray-8"], [class*="rounded-lg"]',
  );
  if (!card) return;
  const table = card.querySelector('table');
  if (!table) return;

  const rows = [...table.querySelectorAll('tr')];

  const presets: {
    pattern: RegExp;
    infR: number;
    cavR: number;
    arcR: number;
    squads: number;
  }[] = [
    {
      pattern: /balanced/i,
      infR: 0.5,
      cavR: 0.2,
      arcR: 0.3,
      squads: Math.max(v.bearSquads, v.vikSquads),
    },
    {
      pattern: /bear/i,
      infR: v.bearInf / 100,
      cavR: v.bearCav / 100,
      arcR: v.bearArc / 100,
      squads: v.bearSquads,
    },
    {
      pattern: /viking/i,
      infR: v.vikingInf / 100,
      cavR: v.vikingCav / 100,
      arcR: 0,
      squads: v.vikSquads,
    },
  ];

  rows.forEach((row) => {
    const label = row.cells[0]?.textContent?.trim();
    if (!label) return;
    if (/^preset$/i.test(label)) return;

    const preset = presets.find((p) => p.pattern.test(label));
    if (!preset) return;

    const { infR, cavR, arcR, squads } = preset;
    const mySquad = v.mySquad;

    const infGap = Math.max(
      0,
      Math.round(mySquad * infR * squads) - v.totalInf,
    );
    const cavGap = Math.max(
      0,
      Math.round(mySquad * cavR * squads) - v.totalCav,
    );
    const arcGap = Math.max(
      0,
      Math.round(mySquad * arcR * squads) - v.totalArc,
    );

    const gaps = [infGap, cavGap, arcGap];

    [1, 2, 3].forEach((cellIdx, i) => {
      const cell = row.cells[cellIdx];
      if (!cell) return;
      const gap = gaps[i];
      if (gap === undefined) return;
      cell.textContent = fmt(gap);
    });
  });
}

// ─── Training Focus: dynamic “targets” explainer ─────────────────────────────
// Replaces the site’s fixed “× 4” copy with squads from the Bear / Vikings sliders.

function updateTrainingFocusExplainer(v: InputValues): void {
  const h3 = [...document.querySelectorAll('h3')].find((el) =>
    /training focus/i.test(el.textContent ?? ''),
  );
  if (!h3) return;
  const card = h3.closest(
    '[class*="bg-white"], [class*="bg-gray-8"], [class*="rounded-lg"]',
  );
  if (!card) return;

  const bear = v.bearSquads;
  const vik = v.vikSquads;
  const balancedSquads = Math.max(bear, vik);

  const isExplainerText = (text: string) =>
    /Targets are computed/i.test(text) && text.length < 500;

  // Only match a <p> so we never replace a wrapper div and drop the table.
  const el = [...card.querySelectorAll('p')].find((node) =>
    isExplainerText(node.textContent ?? ''),
  );
  if (!el) return;

  el.textContent =
    `Targets are computed as (mySquad × ratio × squads). ` +
    `Balanced uses ${balancedSquads} (highest of Bear or Viking). ` +
    `Bear uses ${bear}. Vikings uses ${vik}. ` +
    `Gaps are non-negative.`;
}

// ─── Main run ─────────────────────────────────────────────────────────────────

function run(): void {
  injectStyles();
  const v = getInputValues();

  findAndProcessTable(/^bear split$/i, v.mySquad, {
    inf: v.bearInf,
    cav: v.bearCav,
    arc: v.bearArc,
  });

  findAndProcessTable(/^vikings split$/i, v.mySquad, {
    inf: v.vikingInf,
    cav: v.vikingCav,
    arc: 0,
  });

  processTrainingTable(v);
  updateTrainingFocusExplainer(v);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('input', onUserInput, true);
document.addEventListener('change', onUserInput, true);

function waitForReactThenRestore(maxMs = 10000): void {
  const start = Date.now();
  const poll = setInterval(() => {
    const pageInputs = getPageInputs();
    const hasReact =
      pageInputs.length > 0 &&
      Object.keys(pageInputs[0] as unknown as Record<string, unknown>).some(
        (k) => k.startsWith('__reactProps'),
      );
    if (hasReact) {
      clearInterval(poll);
      setTimeout(() => void restoreOnce(), 200);
    } else if (Date.now() - start > maxMs) {
      clearInterval(poll);
      console.warn('[KS] Timed out waiting for React — restore skipped');
    }
  }, 100);
}

let runDebounce: ReturnType<typeof setTimeout> | undefined;
const domObserver = new MutationObserver(() => {
  clearTimeout(runDebounce);
  runDebounce = setTimeout(run, 150);
});
domObserver.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

run();
waitForReactThenRestore();
