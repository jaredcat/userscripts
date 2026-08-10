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

function addStyles(): void {
  if (document.querySelector('#drops-inventory-styles')) return;

  const style = document.createElement('style');
  style.id = 'drops-inventory-styles';
  style.textContent = `
    .drops-inventory-hidden {
      display: none !important;
    }
  `;
  document.head.append(style);
}

function hasCheckmarkPath(button: Element): boolean {
  const svg = button.querySelector(':scope svg');
  if (!svg) return false;

  const path = svg.querySelector(':scope path[fill-rule="evenodd"]');
  if (!path) return false;

  const pathD = path.getAttribute('d') || '';
  return pathD.includes('M19.707 8.207');
}

function isAccountConnected(rewardItem: HTMLElement): boolean {
  const tooltip = rewardItem.querySelector(
    ':scope .ScAttachedTooltip-sc-1ems1ts-1.lmsRqx.tw-tooltip',
  );
  if (tooltip?.textContent?.trim() === 'Game account connected') {
    return true;
  }

  const button = rewardItem.querySelector(
    ':scope button[aria-label="Awarded Drop Connect Button"][disabled]',
  );
  return Boolean(button && hasCheckmarkPath(button));
}

function hideConnectedRewards(): void {
  addStyles();

  const allContainers = document.querySelectorAll(
    '.Layout-sc-1xcs6mc-0.fHdBNk',
  );

  let hiddenCount = 0;

  allContainers.forEach((container) => {
    const element = container as HTMLElement;
    const dropImage = element.querySelector(':scope .inventory-drop-image');
    if (!dropImage) return;

    if (isAccountConnected(element)) {
      element.classList.add('drops-inventory-hidden');
      hiddenCount++;
    }
  });

  if (hiddenCount > 0) {
    console.log(
      `[Twitch Drops] Hidden ${hiddenCount} reward(s) with connected accounts`,
    );
  }
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

function hideEndedRewards(): void {
  addStyles();

  const campaignContainers = document.querySelectorAll(
    '.Layout-sc-1xcs6mc-0.jtROCr',
  );

  let hiddenCount = 0;

  campaignContainers.forEach((campaign) => {
    const campaignElement = campaign as HTMLElement;
    const endDateSpan = campaignElement.querySelector(
      ':scope span.CoreText-sc-1txzju1-0.jPfhdt',
    );
    const dateText = endDateSpan?.textContent?.trim();
    if (!dateText) return;

    if (isDateInPast(dateText)) {
      campaignElement.classList.add('drops-inventory-hidden');
      hiddenCount++;
    }
  });

  if (hiddenCount > 0) {
    console.log(`[Twitch Drops] Hidden ${hiddenCount} ended campaign(s)`);
  }
}

function isClaimNowButton(button: HTMLButtonElement): boolean {
  if ('dropsClaimClicked' in button.dataset) return false;
  if (button.disabled) return false;
  if (!button.offsetParent) return false;
  return button.textContent?.trim() === 'Claim Now';
}

function clickClaimNowButtons(): void {
  const allButtons = document.querySelectorAll('button');
  let clickedCount = 0;

  allButtons.forEach((button) => {
    if (!isClaimNowButton(button)) return;

    button.dataset.dropsClaimClicked = 'true';
    button.click();
    clickedCount++;
  });

  if (clickedCount > 0) {
    console.log(`[Twitch Drops] Clicked ${clickedCount} "Claim Now" button(s)`);
  }
}

export function initializeInventory(): void {
  clickClaimNowButtons();
  hideConnectedRewards();
  hideEndedRewards();

  const observer = new MutationObserver(() => {
    clickClaimNowButtons();
    hideConnectedRewards();
    hideEndedRewards();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
