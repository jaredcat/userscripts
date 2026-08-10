import { GM } from '$';

interface FilterSettings {
  hideClosedGiveaways: boolean;
  hideTierRestricted: boolean;
  autoSyncTier: boolean;
  hideOutOfStock: boolean;
  hideClaimed: boolean;
  userTier?: number;
}

const DEFAULT_USER_TIER = 99;

// Settings management
const defaultSettings: FilterSettings = {
  hideClosedGiveaways: true,
  hideTierRestricted: true,
  autoSyncTier: true,
  hideOutOfStock: true,
  hideClaimed: true,
};

function isPartialFilterSettings(
  value: unknown,
): value is Partial<FilterSettings> {
  return typeof value === 'object' && value !== null;
}

async function getSettings(): Promise<FilterSettings> {
  const savedSettings: string | Partial<FilterSettings> | undefined =
    await GM.getValue('filterSettings');
  // Start with default settings as base
  const settings: FilterSettings = { ...defaultSettings };

  if (savedSettings) {
    try {
      const parsedUnknown: unknown =
        typeof savedSettings === 'string'
          ? JSON.parse(savedSettings)
          : savedSettings;
      if (!isPartialFilterSettings(parsedUnknown)) {
        return settings;
      }
      const parsed = parsedUnknown;
      // Merge saved settings with defaults
      Object.assign(settings, parsed);
      // Ensure userTier is a number or undefined
      if (parsed.userTier !== undefined) {
        const tierValue = Number(parsed.userTier);
        if (!Number.isNaN(tierValue)) {
          settings.userTier = tierValue;
        }
      }
    } catch (error) {
      console.error('Error parsing saved settings:', error);
      // On error, return defaults
      return defaultSettings;
    }
  }

  return settings;
}

async function saveSettings(settings: Partial<FilterSettings>): Promise<void> {
  const previousSettings = await getSettings();
  const newSettings = {
    ...previousSettings,
    ...settings,
  };
  await GM.setValue('filterSettings', JSON.stringify(newSettings));
}

// Function to extract tier number from text
function extractTier(text: string): number | undefined {
  const match = /Tier\s*(\d+)/i.exec(text);
  if (match?.[1]) {
    return Number(match[1]);
  }
  return undefined;
}

// Function to check and store user's tier on control center page
async function checkAndStoreTier(): Promise<void> {
  const tierImg = document.querySelector<HTMLImageElement>(
    'img[src*="/images/content/tier-tags/"]',
  );
  if (tierImg) {
    const tierMatch = /tier-tags\/(\d+)\.png/.exec(tierImg.src);
    if (tierMatch?.[1]) {
      const userTier = Number(tierMatch[1]);
      await saveSettings({ userTier });
      console.log('Stored user tier:', userTier);
    }
  }
}

// Function to filter community giveaways
async function filterGiveaways(): Promise<void> {
  const settings = await getSettings();
  const userTier = settings.userTier ?? DEFAULT_USER_TIER;
  const giveaways = document.querySelectorAll<HTMLElement>(
    'div.mb-3.community-giveaways__listing__row',
  );

  giveaways.forEach((giveaway) => {
    const text = giveaway.textContent || '';
    if (settings.hideClosedGiveaways && text.includes('Closed')) {
      giveaway.style.display = 'none';
      return;
    }

    if (settings.hideTierRestricted) {
      const tierNumber = extractTier(text);
      if (tierNumber && tierNumber > userTier) {
        giveaway.style.display = 'none';
      }
    }
  });
}

// Function to filter marketplace items
async function filterMarketplace(): Promise<void> {
  const settings = await getSettings();
  const userTier = settings.userTier ?? DEFAULT_USER_TIER;
  const items = document.querySelectorAll<HTMLElement>(
    '.pointer.marketplace-game-small, .pointer.marketplace-game-large, .product-tile, .featured-tile',
  );

  items.forEach((item) => {
    const text = item.textContent || '';
    if (
      settings.hideOutOfStock &&
      text.toLowerCase().includes('out of stock')
    ) {
      item.style.display = 'none';
      return;
    }

    if (settings.hideClaimed && text.toLowerCase().includes('claimed')) {
      item.style.display = 'none';
      return;
    }

    if (settings.hideTierRestricted) {
      const tierNumber = extractTier(text);
      if (tierNumber && tierNumber > userTier) {
        item.style.display = 'none';
      }
    }
  });

  if (
    [
      ...document.querySelectorAll<HTMLElement>('.row.mt-3 .featured-tile'),
    ].every((tile) => tile.style.display === 'none')
  ) {
    const flashDealsSection = document.querySelector<HTMLElement>(
      'div[style*="border-style: solid"][class*="row mt-3"]',
    );
    if (flashDealsSection) {
      flashDealsSection.style.display = 'none';
    }
  }
}

function buildSettingsMenuStyles(): string {
  return `
      <style>
        #alienware-filter-settings {
          display: none;
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #1a1a1a;
          padding: 20px;
          border-radius: 8px;
          z-index: 10000;
          min-width: 300px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        }
        #settings-title {
          color: #fff;
          font-size: 1.5em;
          font-weight: bold;
          margin-bottom: 15px;
        }
        #manualSetTier {
          color: white;
          padding: 2px;
          text-align: center;
        }
        #manualSetTier:disabled {
          color: grey;
        }
        .section-heading {
          color: #00bc8c;
          font-size: 1.1em;
          margin-bottom: 10px;
          font-weight: bold;
        }
        .setting {
          margin-bottom: 10px;
          margin-left: 15px;
        }
        .settingsLabel {
          color: #fff;
          display: block;
          margin-bottom: 5px;
        }
        #saveFilterSettings {
          background: #00bc8c;
          color: #fff;
          border: none;
          padding: 5px 15px;
          border-radius: 4px;
          cursor: pointer;
        }
        #closeFilterSettings {
          background: #e74c3c;
          color: #fff;
          border: none;
          padding: 5px 15px;
          border-radius: 4px;
          margin-left: 10px;
          cursor: pointer;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }
      </style>
    `;
}

function buildGlobalSettingsSection(settings: FilterSettings): string {
  return `
            <div class="settings-section" style="margin-bottom: 20px">
              <div role="heading" aria-level="2" class="section-heading">
                Global Settings
              </div>
              <div
                class="settings-group"
                role="group"
                aria-label="Global Filter Options">
                <div class="setting">
                  <label class="settingsLabel">
                    <input type="checkbox" id="hideTierRestricted" ${
                      settings.hideTierRestricted ? 'checked' : ''
                    }
                    aria-describedby="hideTierDesc"> Hide Higher Tier Content
                  </label>
                  <span id="hideTierDesc" class="sr-only"
                    >If checked, content requiring a higher tier than your current
                    tier will be hidden</span
                  >
                </div>
                <div class="setting">
                  <label class="settingsLabel">
                    <input type="checkbox" id="autoSyncTier" ${
                      settings.hideTierRestricted ? '' : 'disabled'
                    } ${settings.autoSyncTier ? 'checked' : ''}
                    aria-describedby="autoSyncTierDesc"> Auto Sync Tier
                  </label>
                  <span id="hideTierDesc" class="sr-only"
                    >If checked, tier restrictions will be automatically synced from
                    your profile</span
                  >
                </div>
                <div class="setting">
                  <label class="settingsLabel">
                    User tier:
                    <input id="manualSetTier" type="text" inputmode="numeric" pattern="[0-9]*" size="1" maxlength="2" ${
                      settings.autoSyncTier ? 'disabled' : ''
                    } value="${settings.userTier || ''}"
                    aria-describedby="manualSetTierDesc">
                  </label>
                  <span id="manualSetTierDesc" class="sr-only">
                    The user tier that is used to filter content on the site</span>
                </div>
              </div>
            </div>`;
}

function buildMarketplaceSettingsSection(settings: FilterSettings): string {
  return `
            <div class="settings-section" style="margin-bottom: 20px">
              <div role="heading" aria-level="2" class="section-heading">
                Marketplace &amp; Game Vault
              </div>
              <div
                class="settings-group"
                role="group"
                aria-label="Marketplace Options">
                <div class="setting">
                  <label class="settingsLabel">
                    <input type="checkbox" id="hideOutOfStock" ${
                      settings.hideOutOfStock ? 'checked' : ''
                    }
                    aria-describedby="hideStockDesc"> Hide Out of Stock Items
                  </label>
                  <span id="hideStockDesc" class="sr-only"
                    >If checked, items that are out of stock will be hidden</span
                  >
                </div>
                <div class="setting">
                  <label class="settingsLabel">
                    <input type="checkbox" id="hideClaimed" ${
                      settings.hideClaimed ? 'checked' : ''
                    } aria-describedby="hideClaimedDesc"> Hide Claimed
                    Items
                  </label>
                  <span id="hideClaimedDesc" class="sr-only"
                    >If checked, items that you have claimed will be hidden</span
                  >
                </div>
              </div>
            </div>`;
}

function buildGiveawaysSettingsSection(settings: FilterSettings): string {
  return `
            <div class="settings-section" style="margin-bottom: 20px">
              <div role="heading" aria-level="2" class="section-heading">
                Community Giveaways
              </div>
              <div
                class="settings-group"
                role="group"
                aria-label="Community Giveaway Options">
                <div class="setting">
                  <label class="settingsLabel">
                    <input type="checkbox" id="hideClosedGiveaways" ${
                      settings.hideClosedGiveaways ? 'checked' : ''
                    }
                    aria-describedby="hideClosedDesc"> Hide Closed Giveaways
                  </label>
                  <span id="hideClosedDesc" class="sr-only"
                    >If checked, giveaways that are already closed will be
                    hidden</span
                  >
                </div>
              </div>
            </div>`;
}

function buildSettingsMenuHTML(settings: FilterSettings): string {
  return `
      <div
        id="alienware-filter-settings"
        role="dialog"
        aria-labelledby="settings-title"
        aria-modal="true">
        <div role="document">
          <div id="settings-title" role="heading" aria-level="1">Filter Settings</div>
          <form>
            ${buildGlobalSettingsSection(settings)}
            ${buildMarketplaceSettingsSection(settings)}
            ${buildGiveawaysSettingsSection(settings)}
            <div style="text-align: right">
              <button id="saveFilterSettings" type="submit">Save</button>
              <button id="closeFilterSettings" type="button">Close</button>
            </div>
          </form>
        </div>
      </div>
      ${buildSettingsMenuStyles()}
    `;
}

function isCheckboxChecked(id: string): boolean {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false;
}

function setModalDisplay(
  modal: HTMLElement | undefined,
  display: string,
): void {
  if (modal) {
    modal.style.display = display;
  }
}

function readSettingsFromForm(): FilterSettings {
  const isHideClosedGiveaways = isCheckboxChecked('hideClosedGiveaways');
  const isHideTierRestricted = isCheckboxChecked('hideTierRestricted');
  const isAutoSyncTier = isCheckboxChecked('autoSyncTier');
  const isHideOutOfStock = isCheckboxChecked('hideOutOfStock');
  const isHideClaimed = isCheckboxChecked('hideClaimed');

  return {
    hideClosedGiveaways: isHideClosedGiveaways,
    hideTierRestricted: isHideTierRestricted,
    autoSyncTier: isAutoSyncTier,
    hideOutOfStock: isHideOutOfStock,
    hideClaimed: isHideClaimed,
    ...(!isAutoSyncTier && {
      userTier: Number(
        document.querySelector<HTMLInputElement>('#manualSetTier')?.value,
      ),
    }),
  };
}

function bindSettingsMenuFocusTrap(modal: HTMLElement): void {
  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements: HTMLElement[] = [
      ...modal.querySelectorAll<HTMLElement>('button, input[type="checkbox"]'),
    ];
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements.at(-1);
    if (firstFocusable === undefined || lastFocusable === undefined) {
      return;
    }

    if (event.shiftKey) {
      if (document.activeElement === firstFocusable) {
        lastFocusable.focus();
        event.preventDefault();
      }
    } else if (document.activeElement === lastFocusable) {
      firstFocusable.focus();
      event.preventDefault();
    }
  });
}

function bindSettingsMenuEvents(modal: HTMLElement): void {
  document
    .querySelector('#saveFilterSettings')
    ?.addEventListener('click', (event) => {
      event.preventDefault();
      void saveSettings(readSettingsFromForm());
      setModalDisplay(modal, 'none');
      location.reload(); // Reload to apply new settings
    });

  document
    .querySelector('#closeFilterSettings')
    ?.addEventListener('click', () => {
      setModalDisplay(modal, 'none');
    });

  // Handle ESC key to close modal
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.style.display === 'block') {
      modal.style.display = 'none';
    }
  });

  bindSettingsMenuFocusTrap(modal);
}

// Function to create settings menu
async function createSettingsMenu(): Promise<void> {
  const settings = await getSettings();
  document.body.insertAdjacentHTML(
    'beforeend',
    buildSettingsMenuHTML(settings),
  );

  const modal = document.querySelector<HTMLElement>(
    '#alienware-filter-settings',
  );
  if (!modal) {
    return;
  }

  bindSettingsMenuEvents(modal);
}

// Function to add settings button to menu
function addSettingsButton(): void {
  const menuList = document.querySelector<HTMLElement>(
    '.nav-item-mus .dropdown-menu.dropdown-menu-end',
  );
  if (menuList) {
    const settingsItem = document.createElement('a');
    settingsItem.className = 'dropdown-item';
    settingsItem.href = '#';
    settingsItem.textContent = 'Filter Settings';
    settingsItem.addEventListener('click', (event) => {
      event.preventDefault();
      const modal = document.querySelector<HTMLElement>(
        '#alienware-filter-settings',
      );
      setModalDisplay(modal ?? undefined, 'block');
    });
    menuList.insertBefore(settingsItem, menuList.lastElementChild);
  }
}

// Initialize everything based on current page
const currentPath = location.pathname;

// Add settings menu to all pages
await createSettingsMenu();
addSettingsButton();

const settings = await getSettings();
if (currentPath === '/control-center' && settings.autoSyncTier) {
  await checkAndStoreTier();
} else if (currentPath === '/community-giveaways') {
  // Add mutation observer for dynamic content loading
  const observer = new MutationObserver(() => {
    void filterGiveaways();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
} else if (currentPath.startsWith('/marketplace')) {
  // Add mutation observer for dynamic content loading
  const observer = new MutationObserver(() => {
    void filterMarketplace();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
