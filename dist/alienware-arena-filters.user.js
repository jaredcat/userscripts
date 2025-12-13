// ==UserScript==
// @name         Alienware Arena Filters
// @namespace    https://github.com/jaredcat/userscripts
// @version      1.1.2
// @author       jaredcat
// @description  Enhances Alienware Arena website with additional filtering options
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/alienware-arena-filters.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/alienware-arena-filters.user.js
// @match        *://*.alienwarearena.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(async function () {
  'use strict';

  var _GM = (() => typeof GM != "undefined" ? GM : void 0)();
  const defaultSettings = {
    hideClosedGiveaways: true,
    hideTierRestricted: true,
    autoSyncTier: true,
    hideOutOfStock: true,
    hideClaimed: true
  };
  async function getSettings() {
    const savedSettings = await _GM.getValue("filterSettings");
    const settings2 = { ...defaultSettings };
    if (savedSettings) {
      try {
        const parsed = typeof savedSettings === "string" ? JSON.parse(savedSettings) : savedSettings;
        Object.assign(settings2, parsed);
        settings2.userTier = parsed.userTier != null ? Number(parsed.userTier) : void 0;
        if (Number.isNaN(settings2.userTier)) {
          settings2.userTier = void 0;
        }
      } catch (e) {
        console.error("Error parsing saved settings:", e);
        return defaultSettings;
      }
    }
    return settings2;
  }
  async function saveSettings(settings2) {
    const prevSettings = await getSettings();
    const newSettings = {
      ...prevSettings,
      ...settings2
    };
    await _GM.setValue("filterSettings", JSON.stringify(newSettings));
  }
  function extractTier(text) {
    const match = text.match(/Tier\s*(\d+)/i);
    return match ? parseInt(match[1]) : null;
  }
  async function checkAndStoreTier() {
    const tierImg = document.querySelector(
      'img[src*="/images/content/tier-tags/"]'
    );
    if (tierImg) {
      const tierMatch = tierImg.src.match(/tier-tags\/(\d+)\.png/);
      if (tierMatch) {
        const userTier = parseInt(tierMatch[1]);
        await saveSettings({ userTier });
        console.log("Stored user tier:", userTier);
      }
    }
  }
  async function filterGiveaways() {
    const settings2 = await getSettings();
    const userTier = settings2.userTier ?? 99;
    const giveaways = document.querySelectorAll(
      "div.mb-3.community-giveaways__listing__row"
    );
    giveaways.forEach((giveaway) => {
      const text = giveaway.textContent || "";
      if (settings2.hideClosedGiveaways && text.includes("Closed")) {
        giveaway.style.display = "none";
        return;
      }
      if (settings2.hideTierRestricted) {
        const tierNumber = extractTier(text);
        if (tierNumber && tierNumber > userTier) {
          giveaway.style.display = "none";
        }
      }
    });
  }
  async function filterMarketplace() {
    const settings2 = await getSettings();
    const userTier = settings2.userTier ?? 99;
    const items = document.querySelectorAll(
      ".pointer.marketplace-game-small, .pointer.marketplace-game-large, .product-tile, .featured-tile"
    );
    items.forEach((item) => {
      const text = item.textContent || "";
      if (settings2.hideOutOfStock && text.toLowerCase().includes("out of stock")) {
        item.style.display = "none";
        return;
      }
      if (settings2.hideClaimed && text.toLowerCase().includes("claimed")) {
        item.style.display = "none";
        return;
      }
      if (settings2.hideTierRestricted) {
        const tierNumber = extractTier(text);
        if (tierNumber && tierNumber > userTier) {
          item.style.display = "none";
        }
      }
    });
    if ([
      ...document.querySelectorAll(".row.mt-3 .featured-tile")
    ].every((tile) => tile.style.display === "none")) {
      const flashDealsSection = document.querySelector(
        'div[style*="border-style: solid"][class*="row mt-3"]'
      );
      if (flashDealsSection) {
        flashDealsSection.style.display = "none";
      }
    }
  }
  async function createSettingsMenu() {
    const settings2 = await getSettings();
    const menuHTML = `
      <div
        id="alienware-filter-settings"
        role="dialog"
        aria-labelledby="settings-title"
        aria-modal="true">
        <div role="document">
          <!-- Title -->
          <div id="settings-title" role="heading" aria-level="1">Filter Settings</div>

          <!-- Settings Form -->
          <form>
            <!-- Global Settings Section -->
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
                    <input type="checkbox" id="hideTierRestricted" ${settings2.hideTierRestricted ? "checked" : ""}
                    aria-describedby="hideTierDesc"> Hide Higher Tier Content
                  </label>
                  <span id="hideTierDesc" class="sr-only"
                    >If checked, content requiring a higher tier than your current
                    tier will be hidden</span
                  >
                </div>
                <div class="setting">
                  <label class="settingsLabel">
                    <input type="checkbox" id="autoSyncTier" ${!settings2.hideTierRestricted ? "disabled" : ""} ${settings2.autoSyncTier ? "checked" : ""}
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
                    <input id="manualSetTier" type="text" inputmode="numeric" pattern="[0-9]*" size="1" maxlength="2" ${settings2.autoSyncTier ? "disabled" : ""} value="${settings2.userTier ? settings2.userTier : ""}"
                    aria-describedby="manualSetTierDesc">
                  </label>
                  <span id="manualSetTierDesc" class="sr-only">
                    The user tier that is used to filter content on the site</span>
                </div>
              </div>
            </div>

            <!-- Game Vault and Marketplace Section -->
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
                    <input type="checkbox" id="hideOutOfStock" ${settings2.hideOutOfStock ? "checked" : ""}
                    aria-describedby="hideStockDesc"> Hide Out of Stock Items
                  </label>
                  <span id="hideStockDesc" class="sr-only"
                    >If checked, items that are out of stock will be hidden</span
                  >
                </div>
                <div class="setting">
                  <label class="settingsLabel">
                    <input type="checkbox" id="hideClaimed" ${settings2.hideClaimed ? "checked" : ""} aria-describedby="hideClaimedDesc"> Hide Claimed
                    Items
                  </label>
                  <span id="hideClaimedDesc" class="sr-only"
                    >If checked, items that you have claimed will be hidden</span
                  >
                </div>
              </div>
            </div>

            <!-- Community Giveaways Section -->
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
                    <input type="checkbox" id="hideClosedGiveaways" ${settings2.hideClosedGiveaways ? "checked" : ""}
                    aria-describedby="hideClosedDesc"> Hide Closed Giveaways
                  </label>
                  <span id="hideClosedDesc" class="sr-only"
                    >If checked, giveaways that are already closed will be
                    hidden</span
                  >
                </div>
              </div>
            </div>

            <!-- Action Buttons -->
            <div style="text-align: right">
              <button id="saveFilterSettings" type="submit">Save</button>
              <button id="closeFilterSettings" type="button">Close</button>
            </div>
          </form>
        </div>
      </div>

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
    document.body.insertAdjacentHTML("beforeend", menuHTML);
    document.getElementById("saveFilterSettings")?.addEventListener("click", (e) => {
      e.preventDefault();
      const hideClosedGiveaways = document.getElementById("hideClosedGiveaways")?.checked;
      const hideTierRestricted = document.getElementById("hideTierRestricted")?.checked;
      const autoSyncTier = document.getElementById("autoSyncTier")?.checked;
      const hideOutOfStock = document.getElementById("hideOutOfStock")?.checked;
      const hideClaimed = document.getElementById("hideClaimed")?.checked;
      const newSettings = {
        hideClosedGiveaways,
        hideTierRestricted,
        autoSyncTier,
        hideOutOfStock,
        hideClaimed,
        ...!autoSyncTier && {
          userTier: parseInt(
            document.getElementById("manualSetTier")?.value
          )
        }
      };
      saveSettings(newSettings);
      const modal2 = document.getElementById("alienware-filter-settings");
      if (modal2) modal2.style.display = "none";
      location.reload();
    });
    const modal = document.getElementById("alienware-filter-settings");
    document.getElementById("closeFilterSettings")?.addEventListener("click", () => {
      if (modal) modal.style.display = "none";
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal?.style.display === "block") {
        modal.style.display = "none";
      }
    });
    modal?.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        const focusableElements = modal.querySelectorAll(
          'button, input[type="checkbox"]'
        );
        const firstFocusable = focusableElements[0];
        const lastFocusable = focusableElements[focusableElements.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            lastFocusable.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            firstFocusable.focus();
            e.preventDefault();
          }
        }
      }
    });
  }
  function addSettingsButton() {
    const menuList = document.querySelector(
      ".nav-item-mus .dropdown-menu.dropdown-menu-end"
    );
    if (menuList) {
      const settingsItem = document.createElement("a");
      settingsItem.className = "dropdown-item";
      settingsItem.href = "#";
      settingsItem.textContent = "Filter Settings";
      settingsItem.addEventListener("click", (e) => {
        e.preventDefault();
        const modal = document.getElementById("alienware-filter-settings");
        if (modal) modal.style.display = "block";
      });
      menuList.insertBefore(settingsItem, menuList.lastElementChild);
    }
  }
  const currentPath = window.location.pathname;
  await( createSettingsMenu());
  addSettingsButton();
  const settings = await( getSettings());
  if (settings.autoSyncTier && currentPath === "/control-center") {
    await( checkAndStoreTier());
  } else if (currentPath === "/community-giveaways") {
    const observer = new MutationObserver(() => {
      filterGiveaways();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  } else if (currentPath.startsWith("/marketplace")) {
    const observer = new MutationObserver(() => {
      filterMarketplace();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

})();