interface FilterState {
  masterEnabled: boolean;
  items: Record<string, boolean>;
}

interface DropItem {
  element: HTMLElement;
  dateText: string;
  endDate: Date | undefined;
  timestamp: number;
  originalIndex: number;
  title: string;
}

interface CampaignHeadings {
  openHeading: HTMLElement;
  closedHeading: HTMLElement | undefined;
}

const STORAGE_KEY = 'twitchDropsFilterState';
const DATE_PARTS_MINIMUM = 2;
const HOUR_12 = 12;
const SAVE_DEBOUNCE_MS = 100;
const MUTATION_PROCESS_DELAY_MS = 500;
const INITIAL_PROCESS_DELAY_MS = 3000;
const MONTH_INDEX: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};
const END_DATE_PATTERN =
  /([A-Za-z]{3}), ([A-Za-z]{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM)/;

async function saveFilterState(): Promise<void> {
  const masterCheckbox = document.querySelector('#drops-master-filter') as
    HTMLInputElement | undefined;
  const state: FilterState = {
    masterEnabled: masterCheckbox?.checked ?? true,
    items: {},
  };

  document.querySelectorAll('[id^="drop-filter-"]').forEach((checkbox) => {
    const dropItem = (checkbox as HTMLElement).closest('div');
    const titleElement = dropItem?.querySelector(
      ':scope .accordion-header [class*="CoreText"]',
    );
    if (titleElement) {
      const title = titleElement.textContent?.trim() ?? '';
      state.items[title] = (checkbox as HTMLInputElement).checked;
    }
  });

  await GM.setValue(STORAGE_KEY, JSON.stringify(state));
}

async function loadFilterState(): Promise<FilterState | undefined> {
  try {
    const saved = await GM.getValue(STORAGE_KEY, undefined);
    if (saved) {
      return JSON.parse(saved as string) as FilterState;
    }
  } catch (error) {
    console.warn('[Drops Sorter] Error loading filter state:', error);
  }
  return undefined;
}

function to12HourClockHours(hourText: string, ampm: string): number {
  let hours = Math.trunc(Number(hourText));
  if (hours !== HOUR_12 && ampm === 'PM') hours += HOUR_12;
  if (hours === HOUR_12 && ampm === 'AM') hours = 0;
  return hours;
}

function parseEndDate(dateString: string): Date | undefined {
  const parts = dateString.split(' - ');
  if (parts.length < DATE_PARTS_MINIMUM) return undefined;

  const endDateString = parts[1]?.trim();
  if (!endDateString) return undefined;

  const match = END_DATE_PATTERN.exec(endDateString);
  if (!match) return undefined;

  const month = match[2];
  const day = match[3];
  const hour = match[4];
  const minute = match[5];
  const ampm = match[6];
  if (month === undefined || ampm === undefined) return undefined;

  const monthNumber = MONTH_INDEX[month];
  if (monthNumber === undefined) return undefined;

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const currentDay = currentDate.getDate();
  const year = monthNumber < currentMonth ? currentYear + 1 : currentYear;
  const dayOfMonth = Math.trunc(Number(day || String(currentDay)));
  const minuteOfHour = Math.trunc(Number(minute ?? '0'));

  return new Date(
    year,
    monthNumber,
    dayOfMonth,
    to12HourClockHours(hour ?? '0', ampm),
    minuteOfHour,
  );
}

function addStyles(): void {
  if (document.querySelector('#drops-sorter-styles')) return;

  const style = document.createElement('style');
  style.id = 'drops-sorter-styles';
  style.textContent = `
            .drops-filter-checkbox {
                margin-right: 10px;
                cursor: pointer;
                width: 18px;
                height: 18px;
                vertical-align: middle;
            }
            .drops-master-filter {
                display: flex;
                align-items: center;
                padding: 15px;
                background: rgba(0, 0, 0, 0.2);
                border-radius: 6px;
                margin-bottom: 20px;
            }
            .drops-master-filter label {
                cursor: pointer;
                font-weight: 500;
                margin-left: 10px;
            }
            .drops-hidden {
                display: none !important;
            }
            .drops-item-hidden {
                display: none !important;
            }
        `;
  document.head.append(style);
}

function collectDropItemElements(): HTMLElement[] {
  const dropItemElements: HTMLElement[] = [];

  document.querySelectorAll('div').forEach((div) => {
    if (!div.querySelector(':scope .accordion-header')) return;

    const dateElement = div.querySelector(':scope [class*="caYeGJ"]');
    if (!dateElement) return;

    const accordionHeader = div.querySelector(':scope .accordion-header');
    if (accordionHeader?.parentElement === div) {
      dropItemElements.push(div as HTMLElement);
    }
  });

  return dropItemElements;
}

function findCampaignHeadings(): CampaignHeadings | undefined {
  let openHeading: HTMLElement | undefined;
  let closedHeading: HTMLElement | undefined;

  document.querySelectorAll('h4').forEach((h4) => {
    const text = h4.textContent?.trim();
    if (text === 'Open Drop Campaigns') {
      openHeading = h4 as HTMLElement;
    } else if (text === 'Closed Drop Campaigns') {
      closedHeading = h4 as HTMLElement;
    }
  });

  if (!openHeading) return undefined;
  return { openHeading, closedHeading };
}

function isFollowing(reference: HTMLElement, item: HTMLElement): boolean {
  const position = reference.compareDocumentPosition(item);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function isPreceding(reference: HTMLElement, item: HTMLElement): boolean {
  const position = reference.compareDocumentPosition(item);
  return (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

function splitOpenAndClosedItems(
  dropItemElements: HTMLElement[],
  headings: CampaignHeadings,
): { openDropItems: HTMLElement[]; closedDropItems: HTMLElement[] } {
  const openDropItems: HTMLElement[] = [];
  const closedDropItems: HTMLElement[] = [];
  const { openHeading, closedHeading } = headings;

  for (const item of dropItemElements) {
    const isAfterOpen = isFollowing(openHeading, item);
    const isBeforeClosed = closedHeading
      ? isPreceding(closedHeading, item)
      : true;
    const isAfterClosed = closedHeading
      ? isFollowing(closedHeading, item)
      : false;

    if (isAfterOpen && isBeforeClosed) {
      openDropItems.push(item);
    } else if (isAfterClosed) {
      closedDropItems.push(item);
    }
  }

  return { openDropItems, closedDropItems };
}

function buildSortedDropItems(openDropItems: HTMLElement[]): DropItem[] {
  const itemsWithDates: DropItem[] = openDropItems.map(
    (item, originalIndex) => {
      const dateElement = item.querySelector(':scope [class*="caYeGJ"]');
      const dateText = dateElement?.textContent ?? '';
      const endDate = parseEndDate(dateText);
      const titleElement = item.querySelector(
        ':scope .accordion-header [class*="CoreText"]',
      );

      return {
        element: item,
        dateText,
        endDate,
        timestamp: endDate ? endDate.getTime() : Infinity,
        originalIndex,
        title: titleElement?.textContent?.trim() ?? '',
      };
    },
  );

  itemsWithDates.sort((a, b) => a.timestamp - b.timestamp);
  return itemsWithDates;
}

function createMasterFilter(
  savedState: FilterState | undefined,
): HTMLInputElement | undefined {
  const masterFilterDiv = document.createElement('div');
  masterFilterDiv.className = 'drops-master-filter';
  masterFilterDiv.innerHTML = `
            <input type="checkbox" id="drops-master-filter" class="drops-filter-checkbox" ${
              savedState?.masterEnabled === false ? '' : 'checked'
            }>
            <label for="drops-master-filter">Enable Filtering (uncheck to show all)</label>
        `;

  return masterFilterDiv.querySelector('#drops-master-filter') as
    HTMLInputElement | undefined;
}

function scheduleSaveFilterState(): void {
  setTimeout(() => {
    void saveFilterState();
  }, SAVE_DEBOUNCE_MS);
}

function insertCheckbox(button: Element, checkbox: HTMLInputElement): void {
  if (button.firstChild) {
    button.insertBefore(checkbox, button.firstChild);
  } else {
    button.append(checkbox);
  }
}

function attachItemCheckbox(
  item: DropItem,
  newIndex: number,
  masterCheckbox: HTMLInputElement,
  savedState: FilterState | undefined,
): void {
  const button = item.element.querySelector(':scope .accordion-header button');
  if (!button) return;

  const isChecked = savedState?.items?.[item.title] ?? true;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'drops-filter-checkbox';
  checkbox.id = `drop-filter-${newIndex}`;
  checkbox.checked = isChecked;

  checkbox.addEventListener('change', (event) => {
    event.stopPropagation();
    if (masterCheckbox.checked) {
      item.element.classList.toggle('drops-hidden', !checkbox.checked);
    }
    scheduleSaveFilterState();
  });

  checkbox.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  if (!isChecked && masterCheckbox.checked) {
    item.element.classList.add('drops-hidden');
  }

  insertCheckbox(button, checkbox);
}

function bindMasterFilterChange(
  masterCheckbox: HTMLInputElement,
  itemsWithDates: DropItem[],
): void {
  masterCheckbox.addEventListener('change', () => {
    for (const [index, item] of itemsWithDates.entries()) {
      const checkbox = document.querySelector(`#drop-filter-${index}`) as
        HTMLInputElement | undefined;

      if (masterCheckbox.checked) {
        item.element.classList.toggle(
          'drops-hidden',
          checkbox ? !checkbox.checked : false,
        );
      } else {
        item.element.classList.remove('drops-hidden');
      }
    }
    scheduleSaveFilterState();
  });
}

function hideClosedCampaigns(
  closedDropItems: HTMLElement[],
  closedHeading: HTMLElement | undefined,
): void {
  if (closedDropItems.length === 0) return;

  for (const item of closedDropItems) {
    item.classList.add('drops-item-hidden');
  }
  closedHeading?.classList.add('drops-item-hidden');
}

async function didProcessDrops(isInitialized: boolean): Promise<boolean> {
  if (isInitialized) return true;

  const dropItemElements = collectDropItemElements();
  if (dropItemElements.length === 0) return false;

  const headings = findCampaignHeadings();
  if (!headings) return false;

  const { openDropItems, closedDropItems } = splitOpenAndClosedItems(
    dropItemElements,
    headings,
  );
  if (openDropItems.length === 0) return false;

  const firstItem = openDropItems[0];
  if (!firstItem) return false;
  const container = firstItem.parentElement;
  if (!container) return false;

  addStyles();
  const savedState = await loadFilterState();
  const itemsWithDates = buildSortedDropItems(openDropItems);
  const masterCheckbox = createMasterFilter(savedState);
  if (!masterCheckbox) return false;

  const masterFilterDiv = masterCheckbox.parentElement;
  if (!masterFilterDiv) return false;
  firstItem.before(masterFilterDiv);

  for (const [newIndex, item] of itemsWithDates.entries()) {
    attachItemCheckbox(item, newIndex, masterCheckbox, savedState);
    container.append(item.element);
  }

  bindMasterFilterChange(masterCheckbox, itemsWithDates);
  hideClosedCampaigns(closedDropItems, headings.closedHeading);
  return true;
}

function hasAccordionInMutation(mutation: MutationRecord): boolean {
  return [...mutation.addedNodes].some((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node as HTMLElement;
    return (
      element.classList?.contains('accordion-header') ||
      Boolean(element.querySelector?.(':scope .accordion-header'))
    );
  });
}

export function initializeCampaigns(): void {
  let isInitialized = false;

  const runProcess = (): void => {
    void didProcessDrops(isInitialized).then((didSucceed) => {
      if (!didSucceed) {
        return;
      }

      isInitialized = true;
      observer.disconnect();
    });
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length === 0) continue;
      if (!hasAccordionInMutation(mutation)) continue;

      setTimeout(runProcess, MUTATION_PROCESS_DELAY_MS);
      break;
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(runProcess, INITIAL_PROCESS_DELAY_MS);
}
