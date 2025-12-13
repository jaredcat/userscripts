function addStyles(): void {
  if (document.getElementById('drops-inventory-styles')) return;

  const style = document.createElement('style');
  style.id = 'drops-inventory-styles';
  style.textContent = `
    .drops-inventory-hidden {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function isAccountConnected(rewardItem: HTMLElement): boolean {
  // Look for the tooltip that says "Game account connected"
  const tooltip = rewardItem.querySelector(
    '.ScAttachedTooltip-sc-1ems1ts-1.lmsRqx.tw-tooltip',
  );
  if (tooltip && tooltip.textContent?.trim() === 'Game account connected') {
    return true;
  }

  // Alternative: check for disabled button with checkmark icon
  const button = rewardItem.querySelector(
    'button[aria-label="Awarded Drop Connect Button"][disabled]',
  );
  if (button) {
    // Check if it has a checkmark SVG (connected state)
    const svg = button.querySelector('svg');
    if (svg) {
      const path = svg.querySelector('path[fill-rule="evenodd"]');
      if (path) {
        // The checkmark path contains "M19.707 8.207" which is characteristic
        const pathD = path.getAttribute('d') || '';
        if (pathD.includes('M19.707 8.207')) {
          return true;
        }
      }
    }
  }

  return false;
}

function hideConnectedRewards(): void {
  addStyles();

  // Find all reward items in the inventory
  // Reward items are typically in containers with the structure shown in the HTML
  const allContainers = document.querySelectorAll(
    '.Layout-sc-1xcs6mc-0.fHdBNk',
  );

  let hiddenCount = 0;

  allContainers.forEach((container) => {
    const element = container as HTMLElement;

    // Check if this container has an inventory drop image (identifies it as a reward item)
    const hasDropImage = element.querySelector('.inventory-drop-image');
    if (!hasDropImage) return;

    // Check if account is connected
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

function parseEndDate(dateText: string): Date | null {
  // Date format: "Tue, Dec 9, 8:59 AM PST"
  try {
    // Try parsing directly - modern browsers can handle this format
    const parsed = new Date(dateText);
    if (!isNaN(parsed.getTime())) {
      // Check if the parsed date is likely from the previous year
      // This happens when we're early in the year (Jan-Mar) and see dates from late last year (Oct-Dec)
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth(); // 0-11
      const parsedYear = parsed.getFullYear();
      const parsedMonth = parsed.getMonth(); // 0-11

      // If parsed year is current year but date is far in the future (more than 3 months),
      // or if we're early in the year (Jan-Mar) and the date is from late last year (Oct-Dec),
      // try previous year
      const monthsDiff =
        (parsed.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);

      if (
        parsedYear === currentYear &&
        monthsDiff > 3 &&
        (monthsDiff > 6 || (currentMonth < 3 && parsedMonth > 8))
      ) {
        // Try adjusting to previous year
        const adjusted = new Date(parsed);
        adjusted.setFullYear(parsedYear - 1);
        // Use adjusted date if it's now in the past or very recent (within 7 days)
        if (adjusted.getTime() <= now.getTime() + 7 * 24 * 60 * 60 * 1000) {
          return adjusted;
        }
      }

      return parsed;
    }

    // Fallback: manually parse the date
    // Format: "Day, Month Day, Time AM/PM Timezone"
    // Example: "Tue, Dec 9, 8:59 AM PST"
    const match = dateText.match(
      /(\w+),\s+(\w+)\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)\s+(\w+)/i,
    );
    if (match) {
      const [, , monthName, day, hour, minute, ampm, tz] = match;
      const monthMap: Record<string, number> = {
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

      const month = monthMap[monthName.toLowerCase().substring(0, 3)];
      if (month !== undefined) {
        let hour24 = parseInt(hour, 10);
        if (ampm.toUpperCase() === 'PM' && hour24 !== 12) {
          hour24 += 12;
        } else if (ampm.toUpperCase() === 'AM' && hour24 === 12) {
          hour24 = 0;
        }

        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth();

        // Try current year first
        let date = new Date(
          Date.UTC(
            currentYear,
            month,
            parseInt(day, 10),
            hour24,
            parseInt(minute, 10),
          ),
        );

        // Adjust for timezone offset (hours to subtract from UTC)
        const tzOffsetMap: Record<string, number> = {
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

        const offset = tzOffsetMap[tz.toUpperCase()] || 0;
        date.setUTCHours(date.getUTCHours() - offset);

        // If the date with current year is likely from the previous year,
        // adjust it (e.g., we're in Jan 2026, but date is Dec 2025)
        const now = new Date();
        const monthsDiff =
          (date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);

        if (
          monthsDiff > 3 &&
          (monthsDiff > 6 || (currentMonth < 3 && month > 8))
        ) {
          // Try previous year
          const adjustedDate = new Date(
            Date.UTC(
              currentYear - 1,
              month,
              parseInt(day, 10),
              hour24,
              parseInt(minute, 10),
            ),
          );
          adjustedDate.setUTCHours(adjustedDate.getUTCHours() - offset);

          // Use adjusted date if it's now in the past or very recent (within 7 days)
          if (
            adjustedDate.getTime() <=
            now.getTime() + 7 * 24 * 60 * 60 * 1000
          ) {
            date = adjustedDate;
          }
        }

        return date;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // Ignore parsing errors
  }

  return null;
}

function isDateInPast(dateText: string): boolean {
  const endDate = parseEndDate(dateText);
  if (!endDate) return false;

  const now = new Date();
  return endDate < now;
}

function hideEndedRewards(): void {
  addStyles();

  // Find all campaign containers
  const campaignContainers = document.querySelectorAll(
    '.Layout-sc-1xcs6mc-0.jtROCr',
  );

  let hiddenCount = 0;

  campaignContainers.forEach((campaign) => {
    const campaignElement = campaign as HTMLElement;

    // Find the "End Date" text
    // Look for the span with class "jPfhdt" that contains the date
    const endDateSpan = campaignElement.querySelector(
      'span.CoreText-sc-1txzju1-0.jPfhdt',
    );

    if (endDateSpan && endDateSpan.textContent) {
      const dateText = endDateSpan.textContent.trim();

      // Check if the date is in the past
      if (isDateInPast(dateText)) {
        // Hide the entire campaign
        campaignElement.classList.add('drops-inventory-hidden');
        hiddenCount++;
      }
    }
  });

  if (hiddenCount > 0) {
    console.log(`[Twitch Drops] Hidden ${hiddenCount} ended campaign(s)`);
  }
}

function clickClaimNowButtons(): void {
  // Find all buttons on the page
  const allButtons = document.querySelectorAll('button');

  let clickedCount = 0;

  allButtons.forEach((button) => {
    // Skip if already marked as clicked
    if (button.hasAttribute('data-drops-claim-clicked')) return;

    // Check if button contains "Claim Now" text
    const buttonText = button.textContent?.trim();
    if (buttonText === 'Claim Now') {
      // Check if button is visible and not disabled
      const htmlButton = button as HTMLButtonElement;
      if (htmlButton.offsetParent !== null && !htmlButton.disabled) {
        // Mark as clicked before clicking to avoid duplicate clicks
        button.setAttribute('data-drops-claim-clicked', 'true');
        htmlButton.click();
        clickedCount++;
      }
    }
  });

  if (clickedCount > 0) {
    console.log(`[Twitch Drops] Clicked ${clickedCount} "Claim Now" button(s)`);
  }
}

export async function initializeInventory(): Promise<void> {
  // Click "Claim Now" buttons on initial load
  clickClaimNowButtons();

  // Hide connected rewards on initial load
  hideConnectedRewards();

  // Hide ended rewards on initial load
  hideEndedRewards();

  // Watch for dynamically loaded rewards
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
