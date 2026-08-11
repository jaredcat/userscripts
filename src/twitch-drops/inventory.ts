const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH_APPROX = 30;
const MS_PER_DAY =
  MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;
const MS_PER_MONTH_APPROX = MS_PER_DAY * DAYS_PER_MONTH_APPROX;
const HOUR_12 = 12;
const MONTH_ABBREVIATION_LENGTH = 3;
const MONTHS_DIFF_THRESHOLD = 3;
const MONTHS_DIFF_YEAR_BOUNDARY = 6;
const EARLY_YEAR_MONTH_MAX = 3;
const LATE_YEAR_MONTH_MIN = 8;
const RECENT_DAYS_THRESHOLD = 7;
const MUTATION_DEBOUNCE_MS = 500;
const LOAD_MORE_COOLDOWN_MS = 1000;
const HIDDEN_CLASS = 'drops-inventory-hidden';
const CLAIM_NOW_LABEL = 'Claim Now';
const LOAD_MORE_LABEL = 'Load More';
const NO_LONGER_AVAILABLE_TEXT = 'This reward is no longer available';
const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const TZ_OFFSET_HOURS: Record<string, number> = {
  PST: 8,
  PDT: 7,
  EST: 5,
  EDT: 4,
  MST: 7,
  MDT: 6,
  CST: 6,
  CDT: 5,
  AKST: 9,
  AKDT: 8,
  HST: 10,
};
// Format: "Tue, Dec 9, 8:59 AM PST"
const END_DATE_PATTERN =
  /^([A-Z]{3}), ([A-Z]{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM) ([A-Z]{2,4})$/i;

interface ParsedEndDateParts {
  month: number;
  day: number;
  hour24: number;
  minute: number;
  timezone: string;
}

const loadMoreState = { lastClickMs: 0 };

function addStyles(): void {
  if (document.querySelector('#drops-inventory-styles')) return;

  const style = document.createElement('style');
  style.id = 'drops-inventory-styles';
  style.textContent = `
    .${HIDDEN_CLASS} {
      display: none !important;
    }
  `;
  document.head.append(style);
}

function debounce(callback: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      callback();
    }, delayMs);
  };
}

function didHideElement(element: HTMLElement): boolean {
  if (element.classList.contains(HIDDEN_CLASS)) return false;
  element.classList.add(HIDDEN_CLASS);
  return true;
}

function isVisiblyHidden(element: Element): boolean {
  return Boolean(element.closest(`.${HIDDEN_CLASS}`));
}

function isInventoryBoundary(node: Element): boolean {
  return (
    node.classList.contains('inventory-page') ||
    node.classList.contains('inventory-max-width')
  );
}

function closestCardWithDropImage(start: Element): HTMLElement | undefined {
  let node = start.parentElement;
  while (node) {
    if (isInventoryBoundary(node)) return undefined;
    if (node.querySelector(':scope .inventory-drop-image')) {
      return node;
    }
    node = node.parentElement;
  }
  return undefined;
}

function to24Hour(hourText: string, ampm: string): number {
  let hour24 = Math.trunc(Number(hourText));
  const period = ampm.toUpperCase();
  if (hour24 !== HOUR_12 && period === 'PM') {
    hour24 += HOUR_12;
  } else if (hour24 === HOUR_12 && period === 'AM') {
    hour24 = 0;
  }
  return hour24;
}

function parseEndDateParts(dateText: string): ParsedEndDateParts | undefined {
  const match = END_DATE_PATTERN.exec(dateText);
  if (!match) return undefined;

  const monthName = match[2];
  const dayText = match[3];
  const hourText = match[4];
  const minuteText = match[5];
  const ampm = match[6];
  const timezone = match[7];
  if (
    !monthName ||
    !dayText ||
    !hourText ||
    !minuteText ||
    !ampm ||
    !timezone
  ) {
    return undefined;
  }

  const month =
    MONTH_INDEX[monthName.toLowerCase().slice(0, MONTH_ABBREVIATION_LENGTH)];
  if (month === undefined) return undefined;

  return {
    month,
    day: Math.trunc(Number(dayText)),
    hour24: to24Hour(hourText, ampm),
    minute: Math.trunc(Number(minuteText)),
    timezone,
  };
}

function buildUtcDate(
  year: number,
  parts: ParsedEndDateParts,
  offsetHours: number,
): Date {
  const date = new Date(
    Date.UTC(year, parts.month, parts.day, parts.hour24, parts.minute),
  );
  date.setUTCHours(date.getUTCHours() + offsetHours);
  return date;
}

function shouldUsePreviousYear(
  date: Date,
  now: Date,
  currentMonth: number,
  month: number,
): boolean {
  const monthsDiff = (date.getTime() - now.getTime()) / MS_PER_MONTH_APPROX;
  if (monthsDiff <= MONTHS_DIFF_THRESHOLD) return false;

  return (
    monthsDiff > MONTHS_DIFF_YEAR_BOUNDARY ||
    (currentMonth < EARLY_YEAR_MONTH_MAX && month > LATE_YEAR_MONTH_MIN)
  );
}

function resolveYearAdjustedDate(
  parts: ParsedEndDateParts,
  offsetHours: number,
): Date {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const now = new Date();
  let date = buildUtcDate(currentYear, parts, offsetHours);

  if (!shouldUsePreviousYear(date, now, currentMonth, parts.month)) {
    return date;
  }

  const adjustedDate = buildUtcDate(currentYear - 1, parts, offsetHours);
  const recentThresholdMs = RECENT_DAYS_THRESHOLD * MS_PER_DAY;
  if (adjustedDate.getTime() <= now.getTime() + recentThresholdMs) {
    date = adjustedDate;
  }

  return date;
}

function parseEndDate(dateText: string): Date | undefined {
  try {
    const parts = parseEndDateParts(dateText);
    if (!parts) return undefined;

    const offsetHours = TZ_OFFSET_HOURS[parts.timezone.toUpperCase()] ?? 0;
    return resolveYearAdjustedDate(parts, offsetHours);
  } catch {
    return undefined;
  }
}

function isDateInPast(dateText: string): boolean {
  const endDate = parseEndDate(dateText);
  if (!endDate) return false;
  return endDate < new Date();
}

function findEndDateText(root: Element): string | undefined {
  for (const element of root.querySelectorAll('span, p')) {
    const text = element.textContent?.trim() ?? '';
    if (END_DATE_PATTERN.test(text)) return text;
  }
  return undefined;
}

function isEndedCampaign(card: HTMLElement, info: Element): boolean {
  if (card.textContent?.includes(NO_LONGER_AVAILABLE_TEXT)) return true;
  const dateText = findEndDateText(info);
  return Boolean(dateText && isDateInPast(dateText));
}

function hideEndedRewards(): void {
  addStyles();

  let hiddenCount = 0;
  const campaignInfos = document.querySelectorAll('.inventory-campaign-info');

  for (const info of campaignInfos) {
    const card = closestCardWithDropImage(info);
    if (!card) continue;
    if (!isEndedCampaign(card, info)) continue;
    if (didHideElement(card)) {
      hiddenCount++;
    }
  }

  if (hiddenCount > 0) {
    console.log(`[Twitch Drops] Hidden ${hiddenCount} ended campaign(s)`);
  }
}

function isVisibleActionButton(
  button: HTMLButtonElement,
  label: string,
): boolean {
  if (button.disabled) return false;
  if (!button.offsetParent) return false;
  return button.textContent?.trim() === label;
}

function clickClaimNowButtons(): void {
  let clickedCount = 0;

  for (const button of document.querySelectorAll('button')) {
    if (!isVisibleActionButton(button, CLAIM_NOW_LABEL)) continue;
    if ('dropsClaimClicked' in button.dataset) continue;

    button.dataset.dropsClaimClicked = 'true';
    button.click();
    clickedCount++;
  }

  if (clickedCount > 0) {
    console.log(`[Twitch Drops] Clicked ${clickedCount} "Claim Now" button(s)`);
  }
}

function hasClaimNowButton(): boolean {
  for (const button of document.querySelectorAll('button')) {
    if (isVisibleActionButton(button, CLAIM_NOW_LABEL)) return true;
  }
  return false;
}

function clickLoadMoreButton(): void {
  if (!hasClaimNowButton()) return;

  const now = Date.now();
  if (now - loadMoreState.lastClickMs < LOAD_MORE_COOLDOWN_MS) return;

  for (const button of document.querySelectorAll('button')) {
    if (!isVisibleActionButton(button, LOAD_MORE_LABEL)) continue;
    loadMoreState.lastClickMs = now;
    button.click();
    console.log('[Twitch Drops] Clicked "Load More"');
    return;
  }
}

function hideEmptyInProgressSection(): void {
  const root = document.querySelector('.inventory-max-width');
  if (!(root instanceof HTMLElement)) return;

  const infos = root.querySelectorAll('.inventory-campaign-info');
  if (infos.length === 0) return;
  for (const info of infos) {
    if (!isVisiblyHidden(info)) return;
  }
  didHideElement(root);
}

function isInventoryPath(): boolean {
  return location.pathname.includes('/drops/inventory');
}

function processInventory(): void {
  if (!isInventoryPath()) return;
  clickLoadMoreButton();
  clickClaimNowButtons();
  hideEndedRewards();
  hideEmptyInProgressSection();
}

export function initializeInventory(): () => void {
  let isStopped = false;
  const runProcess = debounce(() => {
    if (isStopped) return;
    processInventory();
  }, MUTATION_DEBOUNCE_MS);
  runProcess();

  const observer = new MutationObserver(runProcess);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    isStopped = true;
    observer.disconnect();
  };
}
