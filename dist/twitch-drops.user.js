// ==UserScript==
// @name         Twitch Drops Page Tools
// @namespace    https://github.com/jaredcat/userscripts
// @version      1.0.0
// @author       jaredcat
// @description  Sort Twitch drops by end date and add filtering checkboxes
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/twitch-drops.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/twitch-drops.user.js
// @match        *://www.twitch.tv/drops/campaigns*
// @match        *://www.twitch.tv/drops/inventory*
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = "twitchDropsFilterState";
  async function saveFilterState() {
    const masterCheckbox = document.getElementById(
      "drops-master-filter"
    );
    const state = {
      masterEnabled: masterCheckbox?.checked ?? true,
      items: {}
    };
    document.querySelectorAll('[id^="drop-filter-"]').forEach((checkbox) => {
      const dropItem = checkbox.closest("div");
      const titleElement = dropItem?.querySelector(
        '.accordion-header [class*="CoreText"]'
      );
      if (titleElement) {
        const title = titleElement.textContent?.trim() ?? "";
        state.items[title] = checkbox.checked;
      }
    });
    await GM.setValue(STORAGE_KEY, JSON.stringify(state));
  }
  async function loadFilterState() {
    try {
      const saved = await GM.getValue(STORAGE_KEY, null);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("[Drops Sorter] Error loading filter state:", e);
    }
    return null;
  }
  function parseEndDate(dateString) {
    const parts = dateString.split(" - ");
    if (parts.length < 2) return null;
    const endDateStr = parts[1].trim();
    const match = endDateStr.match(
      /([A-Za-z]{3}), ([A-Za-z]{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM)/
    );
    if (!match) return null;
    const [, , month, day, hour, minute, ampm] = match;
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const months = {
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
      Dec: 11
    };
    const monthNum = months[month];
    if (monthNum === void 0) return null;
    let year = currentYear;
    if (monthNum < currentMonth) {
      year = currentYear + 1;
    }
    let hours = parseInt(hour, 10);
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return new Date(
      year,
      monthNum,
      parseInt(day, 10),
      hours,
      parseInt(minute, 10)
    );
  }
  function addStyles() {
    if (document.getElementById("drops-sorter-styles")) return;
    const style = document.createElement("style");
    style.id = "drops-sorter-styles";
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
    document.head.appendChild(style);
  }
  async function initializeCampaigns() {
    let initialized = false;
    async function processDrops() {
      if (initialized) return true;
      const savedState = await loadFilterState();
      const allDivs = document.querySelectorAll("div");
      const dropItemElements = [];
      allDivs.forEach((div) => {
        if (div.querySelector(".accordion-header")) {
          const dateElement = div.querySelector('[class*="caYeGJ"]');
          if (dateElement) {
            const accordionHeader = div.querySelector(".accordion-header");
            if (accordionHeader && accordionHeader.parentElement === div) {
              dropItemElements.push(div);
            }
          }
        }
      });
      if (dropItemElements.length === 0) return false;
      const allH4s = document.querySelectorAll("h4");
      let openDropsHeading = null;
      let closedDropsHeading = null;
      allH4s.forEach((h4) => {
        const text = h4.textContent?.trim();
        if (text === "Open Drop Campaigns") {
          openDropsHeading = h4;
        } else if (text === "Closed Drop Campaigns") {
          closedDropsHeading = h4;
        }
      });
      if (!openDropsHeading) return false;
      const openDropItems = [];
      const closedDropItems = [];
      dropItemElements.forEach((item) => {
        const position = openDropsHeading.compareDocumentPosition(item);
        const isAfterOpen = (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        let isBeforeClosed = true;
        let isAfterClosed = false;
        if (closedDropsHeading) {
          const closedPosition = closedDropsHeading.compareDocumentPosition(item);
          isBeforeClosed = (closedPosition & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
          isAfterClosed = (closedPosition & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        }
        if (isAfterOpen && isBeforeClosed) {
          openDropItems.push(item);
        } else if (isAfterClosed) {
          closedDropItems.push(item);
        }
      });
      if (openDropItems.length === 0) return false;
      addStyles();
      const container = openDropItems[0].parentElement;
      if (!container) return false;
      const itemsWithDates = openDropItems.map(
        (item, originalIndex) => {
          const dateElement = item.querySelector('[class*="caYeGJ"]');
          const dateText = dateElement?.textContent ?? "";
          const endDate = parseEndDate(dateText);
          const titleElement = item.querySelector(
            '.accordion-header [class*="CoreText"]'
          );
          const title = titleElement?.textContent.trim() ?? "";
          return {
            element: item,
            dateText,
            endDate,
            timestamp: endDate ? endDate.getTime() : Infinity,
            originalIndex,
            title
          };
        }
      );
      itemsWithDates.sort((a, b) => a.timestamp - b.timestamp);
      const masterFilterDiv = document.createElement("div");
      masterFilterDiv.className = "drops-master-filter";
      masterFilterDiv.innerHTML = `
            <input type="checkbox" id="drops-master-filter" class="drops-filter-checkbox" ${savedState?.masterEnabled !== false ? "checked" : ""}>
            <label for="drops-master-filter">Enable Filtering (uncheck to show all)</label>
        `;
      container.insertBefore(masterFilterDiv, openDropItems[0]);
      const masterCheckbox = document.getElementById(
        "drops-master-filter"
      );
      if (!masterCheckbox) return false;
      itemsWithDates.forEach((item, newIndex) => {
        const button = item.element.querySelector(
          ".accordion-header button"
        );
        if (button) {
          const savedChecked = savedState?.items?.[item.title];
          const isChecked = savedChecked !== void 0 ? savedChecked : true;
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "drops-filter-checkbox";
          checkbox.id = `drop-filter-${newIndex}`;
          checkbox.checked = isChecked;
          checkbox.addEventListener("change", (e) => {
            e.stopPropagation();
            if (masterCheckbox.checked) {
              item.element.classList.toggle("drops-hidden", !checkbox.checked);
            }
            setTimeout(() => saveFilterState(), 100);
          });
          button.insertBefore(checkbox, button.firstChild);
          checkbox.addEventListener("click", (e) => {
            e.stopPropagation();
          });
          if (masterCheckbox.checked && !isChecked) {
            item.element.classList.add("drops-hidden");
          }
        }
        container.appendChild(item.element);
      });
      masterCheckbox.addEventListener("change", () => {
        itemsWithDates.forEach((item, index) => {
          const checkbox = document.getElementById(
            `drop-filter-${index}`
          );
          if (masterCheckbox.checked) {
            item.element.classList.toggle(
              "drops-hidden",
              checkbox ? !checkbox.checked : false
            );
          } else {
            item.element.classList.remove("drops-hidden");
          }
        });
        setTimeout(() => saveFilterState(), 100);
      });
      if (closedDropItems.length > 0) {
        closedDropItems.forEach((item) => {
          item.classList.add("drops-item-hidden");
        });
        if (closedDropsHeading !== null && closedDropsHeading !== void 0) {
          closedDropsHeading.classList.add("drops-item-hidden");
        }
      }
      initialized = true;
      return true;
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          const hasAccordion = Array.from(mutation.addedNodes).some((node) => {
            return node.nodeType === 1 && (node.classList?.contains("accordion-header") || node.querySelector?.(".accordion-header"));
          });
          if (hasAccordion) {
            setTimeout(() => {
              processDrops().then((success) => {
                if (success) {
                  observer.disconnect();
                }
              });
            }, 500);
            break;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      processDrops().then((success) => {
        if (success) {
          observer.disconnect();
        }
      });
    }, 3e3);
  }
  const url = window.location.href;
  if (url.includes("/drops/campaigns")) {
    initializeCampaigns();
  }

})();