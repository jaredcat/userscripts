// ==UserScript==
// @name         Twitch Drops Page Tools
// @namespace    https://github.com/jaredcat/userscripts
// @version      1.1.4
// @author       jaredcat
// @description  Sort Twitch drops by end date, auto-claim inventory, and hide ended in-progress campaigns
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/twitch-drops.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/twitch-drops.user.js
// @match        *://www.twitch.tv/*
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(function() {
	"use strict";
	var STORAGE_KEY = "twitchDropsFilterState";
	var DATE_PARTS_MINIMUM = 2;
	var HOUR_12$1 = 12;
	var SAVE_DEBOUNCE_MS = 100;
	var MUTATION_PROCESS_DELAY_MS = 500;
	var INITIAL_PROCESS_DELAY_MS = 3e3;
	var MONTH_INDEX$1 = {
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
	var END_DATE_PATTERN$1 = /([A-Za-z]{3}), ([A-Za-z]{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM)/;
	var DATE_STAMP_PATTERN = /^[A-Za-z]{3}, [A-Za-z]{3} \d{1,2}, \d{1,2}:\d{2} (?:AM|PM)(?: [A-Z]{2,4})?$/;
	async function saveFilterState() {
		const state = {
			masterEnabled: document.querySelector("#drops-master-filter")?.checked ?? true,
			items: {}
		};
		document.querySelectorAll("[id^=\"drop-filter-\"]").forEach((checkbox) => {
			const titleElement = checkbox.closest("div")?.querySelector(":scope .accordion-header [class*=\"CoreText\"]");
			if (titleElement) {
				const title = titleElement.textContent?.trim() ?? "";
				state.items[title] = checkbox.checked;
			}
		});
		await GM.setValue(STORAGE_KEY, JSON.stringify(state));
	}
	async function loadFilterState() {
		try {
			const saved = await GM.getValue(STORAGE_KEY, void 0);
			if (saved) return JSON.parse(saved);
		} catch (error) {
			console.warn("[Drops Sorter] Error loading filter state:", error);
		}
	}
	function to12HourClockHours(hourText, ampm) {
		let hours = Math.trunc(Number(hourText));
		if (hours !== HOUR_12$1 && ampm === "PM") hours += HOUR_12$1;
		if (hours === HOUR_12$1 && ampm === "AM") hours = 0;
		return hours;
	}
	function parseEndDate$1(dateString) {
		const parts = dateString.split(" - ");
		if (parts.length < DATE_PARTS_MINIMUM) return void 0;
		const endDateString = parts[1]?.trim();
		if (!endDateString) return void 0;
		const match = END_DATE_PATTERN$1.exec(endDateString);
		if (!match) return void 0;
		const month = match[2];
		const day = match[3];
		const hour = match[4];
		const minute = match[5];
		const ampm = match[6];
		if (month === void 0 || ampm === void 0) return void 0;
		const monthNumber = MONTH_INDEX$1[month];
		if (monthNumber === void 0) return void 0;
		const currentDate = new Date();
		const currentYear = currentDate.getFullYear();
		const currentMonth = currentDate.getMonth();
		const currentDay = currentDate.getDate();
		const year = monthNumber < currentMonth ? currentYear + 1 : currentYear;
		const dayOfMonth = Math.trunc(Number(day || String(currentDay)));
		const minuteOfHour = Math.trunc(Number(minute ?? "0"));
		return new Date(year, monthNumber, dayOfMonth, to12HourClockHours(hour ?? "0", ampm), minuteOfHour);
	}
	function addStyles$1() {
		if (document.querySelector("#drops-sorter-styles")) return;
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
		document.head.append(style);
	}
	function isDateRangeText(text) {
		const parts = text.split(" - ");
		if (parts.length !== DATE_PARTS_MINIMUM) return false;
		const start = parts[0];
		const end = parts[1];
		return Boolean(start && end && DATE_STAMP_PATTERN.test(start) && DATE_STAMP_PATTERN.test(end));
	}
	function findDateElement(root) {
		for (const element of root.querySelectorAll("div, span, p")) {
			if (element.children.length > 0) continue;
			if (isDateRangeText(element.textContent?.trim() ?? "")) return element;
		}
	}
	function collectDropItemElements() {
		const dropItemElements = [];
		for (const header of document.querySelectorAll(".accordion-header")) {
			const item = header.parentElement;
			if (!item) continue;
			if (item.querySelector(":scope > .accordion-header") !== header) continue;
			if (!findDateElement(header)) continue;
			dropItemElements.push(item);
		}
		return dropItemElements;
	}
	function findCampaignHeadings() {
		let openHeading;
		let closedHeading;
		document.querySelectorAll("h4").forEach((h4) => {
			const text = h4.textContent?.trim();
			if (text === "Open Drop Campaigns") openHeading = h4;
			else if (text === "Closed Drop Campaigns") closedHeading = h4;
		});
		if (!openHeading) return void 0;
		return {
			openHeading,
			closedHeading
		};
	}
	function isFollowing(reference, item) {
		return (reference.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
	}
	function isPreceding(reference, item) {
		return (reference.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
	}
	function splitOpenAndClosedItems(dropItemElements, headings) {
		const openDropItems = [];
		const closedDropItems = [];
		const { openHeading, closedHeading } = headings;
		for (const item of dropItemElements) {
			const isAfterOpen = isFollowing(openHeading, item);
			const isBeforeClosed = closedHeading ? isPreceding(closedHeading, item) : true;
			const isAfterClosed = closedHeading ? isFollowing(closedHeading, item) : false;
			if (isAfterOpen && isBeforeClosed) openDropItems.push(item);
			else if (isAfterClosed) closedDropItems.push(item);
		}
		return {
			openDropItems,
			closedDropItems
		};
	}
	function buildSortedDropItems(openDropItems) {
		const itemsWithDates = openDropItems.map((item, originalIndex) => {
			const dateText = findDateElement(item)?.textContent?.trim() ?? "";
			const endDate = parseEndDate$1(dateText);
			const titleElement = item.querySelector(":scope .accordion-header [class*=\"CoreText\"]");
			return {
				element: item,
				dateText,
				endDate,
				timestamp: endDate ? endDate.getTime() : Number.POSITIVE_INFINITY,
				originalIndex,
				title: titleElement?.textContent?.trim() ?? ""
			};
		});
		itemsWithDates.sort((a, b) => a.timestamp - b.timestamp);
		return itemsWithDates;
	}
	function createMasterFilter(savedState) {
		const masterFilterDiv = document.createElement("div");
		masterFilterDiv.className = "drops-master-filter";
		masterFilterDiv.innerHTML = `
            <input type="checkbox" id="drops-master-filter" class="drops-filter-checkbox" ${savedState?.masterEnabled === false ? "" : "checked"}>
            <label for="drops-master-filter">Enable Filtering (uncheck to show all)</label>
        `;
		return masterFilterDiv.querySelector("#drops-master-filter");
	}
	function scheduleSaveFilterState() {
		setTimeout(() => {
			saveFilterState();
		}, SAVE_DEBOUNCE_MS);
	}
	function insertCheckbox(button, checkbox) {
		if (button.firstChild) button.insertBefore(checkbox, button.firstChild);
		else button.append(checkbox);
	}
	function attachItemCheckbox(item, newIndex, masterCheckbox, savedState) {
		const button = item.element.querySelector(":scope .accordion-header button");
		if (!button) return;
		const isChecked = savedState?.items?.[item.title] ?? true;
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.className = "drops-filter-checkbox";
		checkbox.id = `drop-filter-${newIndex}`;
		checkbox.checked = isChecked;
		checkbox.addEventListener("change", (event) => {
			event.stopPropagation();
			if (masterCheckbox.checked) item.element.classList.toggle("drops-hidden", !checkbox.checked);
			scheduleSaveFilterState();
		});
		checkbox.addEventListener("click", (event) => {
			event.stopPropagation();
		});
		if (!isChecked && masterCheckbox.checked) item.element.classList.add("drops-hidden");
		insertCheckbox(button, checkbox);
	}
	function bindMasterFilterChange(masterCheckbox, itemsWithDates) {
		masterCheckbox.addEventListener("change", () => {
			for (const [index, item] of itemsWithDates.entries()) {
				const checkbox = document.querySelector(`#drop-filter-${index}`);
				if (masterCheckbox.checked) item.element.classList.toggle("drops-hidden", checkbox ? !checkbox.checked : false);
				else item.element.classList.remove("drops-hidden");
			}
			scheduleSaveFilterState();
		});
	}
	function hideClosedCampaigns(closedDropItems, closedHeading) {
		if (closedDropItems.length === 0) return;
		for (const item of closedDropItems) item.classList.add("drops-item-hidden");
		closedHeading?.classList.add("drops-item-hidden");
	}
	function isCampaignsPath() {
		return location.pathname.includes("/drops/campaigns");
	}
	async function didProcessDrops(isInitialized) {
		if (isInitialized) return true;
		if (!isCampaignsPath()) return false;
		const dropItemElements = collectDropItemElements();
		if (dropItemElements.length === 0) return false;
		const headings = findCampaignHeadings();
		if (!headings) return false;
		const { openDropItems, closedDropItems } = splitOpenAndClosedItems(dropItemElements, headings);
		if (openDropItems.length === 0) return false;
		const firstItem = openDropItems[0];
		if (!firstItem) return false;
		const container = firstItem.parentElement;
		if (!container) return false;
		addStyles$1();
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
	function hasAccordionInMutation(mutation) {
		return [...mutation.addedNodes].some((node) => {
			if (node.nodeType !== Node.ELEMENT_NODE) return false;
			const element = node;
			return element.classList?.contains("accordion-header") || Boolean(element.querySelector?.(":scope .accordion-header"));
		});
	}
	function initializeCampaigns() {
		let isInitialized = false;
		let isStopped = false;
		let mutationTimer;
		const runProcess = () => {
			if (isStopped) return;
			didProcessDrops(isInitialized).then((didSucceed) => {
				if (isStopped || !didSucceed) return;
				isInitialized = true;
				observer.disconnect();
			});
		};
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length === 0) continue;
				if (!hasAccordionInMutation(mutation)) continue;
				mutationTimer = setTimeout(runProcess, MUTATION_PROCESS_DELAY_MS);
				break;
			}
		});
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		const initialTimer = setTimeout(runProcess, INITIAL_PROCESS_DELAY_MS);
		return () => {
			isStopped = true;
			observer.disconnect();
			clearTimeout(mutationTimer);
			clearTimeout(initialTimer);
		};
	}
	var MS_PER_SECOND = 1e3;
	var SECONDS_PER_MINUTE = 60;
	var MINUTES_PER_HOUR = 60;
	var HOURS_PER_DAY = 24;
	var DAYS_PER_MONTH_APPROX = 30;
	var MS_PER_DAY = MS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY;
	var MS_PER_MONTH_APPROX = MS_PER_DAY * DAYS_PER_MONTH_APPROX;
	var HOUR_12 = 12;
	var MONTH_ABBREVIATION_LENGTH = 3;
	var MONTHS_DIFF_THRESHOLD = 3;
	var MONTHS_DIFF_YEAR_BOUNDARY = 6;
	var EARLY_YEAR_MONTH_MAX = 3;
	var LATE_YEAR_MONTH_MIN = 8;
	var RECENT_DAYS_THRESHOLD = 7;
	var MUTATION_DEBOUNCE_MS = 500;
	var LOAD_MORE_COOLDOWN_MS = 1e3;
	var HIDDEN_CLASS = "drops-inventory-hidden";
	var CLAIM_NOW_LABEL = "Claim Now";
	var LOAD_MORE_LABEL = "Load More";
	var NO_LONGER_AVAILABLE_TEXT = "This reward is no longer available";
	var MONTH_INDEX = {
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
		dec: 11
	};
	var TZ_OFFSET_HOURS = {
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
		HST: 10
	};
	var END_DATE_PATTERN = /^([A-Z]{3}), ([A-Z]{3}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM) ([A-Z]{2,4})$/i;
	var loadMoreState = { lastClickMs: 0 };
	function addStyles() {
		if (document.querySelector("#drops-inventory-styles")) return;
		const style = document.createElement("style");
		style.id = "drops-inventory-styles";
		style.textContent = `
    .${HIDDEN_CLASS} {
      display: none !important;
    }
  `;
		document.head.append(style);
	}
	function debounce(callback, delayMs) {
		let timer;
		return () => {
			if (timer !== void 0) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = void 0;
				callback();
			}, delayMs);
		};
	}
	function didHideElement(element) {
		if (element.classList.contains(HIDDEN_CLASS)) return false;
		element.classList.add(HIDDEN_CLASS);
		return true;
	}
	function isVisiblyHidden(element) {
		return Boolean(element.closest(`.${HIDDEN_CLASS}`));
	}
	function isInventoryBoundary(node) {
		return node.classList.contains("inventory-page") || node.classList.contains("inventory-max-width");
	}
	function closestCardWithDropImage(start) {
		let node = start.parentElement;
		while (node) {
			if (isInventoryBoundary(node)) return void 0;
			if (node.querySelector(":scope .inventory-drop-image")) return node;
			node = node.parentElement;
		}
	}
	function to24Hour(hourText, ampm) {
		let hour24 = Math.trunc(Number(hourText));
		const period = ampm.toUpperCase();
		if (hour24 !== HOUR_12 && period === "PM") hour24 += HOUR_12;
		else if (hour24 === HOUR_12 && period === "AM") hour24 = 0;
		return hour24;
	}
	function parseEndDateParts(dateText) {
		const match = END_DATE_PATTERN.exec(dateText);
		if (!match) return void 0;
		const monthName = match[2];
		const dayText = match[3];
		const hourText = match[4];
		const minuteText = match[5];
		const ampm = match[6];
		const timezone = match[7];
		if (!monthName || !dayText || !hourText || !minuteText || !ampm || !timezone) return;
		const month = MONTH_INDEX[monthName.toLowerCase().slice(0, MONTH_ABBREVIATION_LENGTH)];
		if (month === void 0) return void 0;
		return {
			month,
			day: Math.trunc(Number(dayText)),
			hour24: to24Hour(hourText, ampm),
			minute: Math.trunc(Number(minuteText)),
			timezone
		};
	}
	function buildUtcDate(year, parts, offsetHours) {
		const date = new Date(Date.UTC(year, parts.month, parts.day, parts.hour24, parts.minute));
		date.setUTCHours(date.getUTCHours() + offsetHours);
		return date;
	}
	function shouldUsePreviousYear(date, now, currentMonth, month) {
		const monthsDiff = (date.getTime() - now.getTime()) / MS_PER_MONTH_APPROX;
		if (monthsDiff <= MONTHS_DIFF_THRESHOLD) return false;
		return monthsDiff > MONTHS_DIFF_YEAR_BOUNDARY || currentMonth < EARLY_YEAR_MONTH_MAX && month > LATE_YEAR_MONTH_MIN;
	}
	function resolveYearAdjustedDate(parts, offsetHours) {
		const currentYear = new Date().getFullYear();
		const currentMonth = new Date().getMonth();
		const now = new Date();
		let date = buildUtcDate(currentYear, parts, offsetHours);
		if (!shouldUsePreviousYear(date, now, currentMonth, parts.month)) return date;
		const adjustedDate = buildUtcDate(currentYear - 1, parts, offsetHours);
		const recentThresholdMs = RECENT_DAYS_THRESHOLD * MS_PER_DAY;
		if (adjustedDate.getTime() <= now.getTime() + recentThresholdMs) date = adjustedDate;
		return date;
	}
	function parseEndDate(dateText) {
		try {
			const parts = parseEndDateParts(dateText);
			if (!parts) return void 0;
			return resolveYearAdjustedDate(parts, TZ_OFFSET_HOURS[parts.timezone.toUpperCase()] ?? 0);
		} catch {
			return;
		}
	}
	function isDateInPast(dateText) {
		const endDate = parseEndDate(dateText);
		if (!endDate) return false;
		return endDate < new Date();
	}
	function findEndDateText(root) {
		for (const element of root.querySelectorAll("span, p")) {
			const text = element.textContent?.trim() ?? "";
			if (END_DATE_PATTERN.test(text)) return text;
		}
	}
	function isEndedCampaign(card, info) {
		if (card.textContent?.includes(NO_LONGER_AVAILABLE_TEXT)) return true;
		const dateText = findEndDateText(info);
		return Boolean(dateText && isDateInPast(dateText));
	}
	function hideEndedRewards() {
		addStyles();
		let hiddenCount = 0;
		const campaignInfos = document.querySelectorAll(".inventory-campaign-info");
		for (const info of campaignInfos) {
			const card = closestCardWithDropImage(info);
			if (!card) continue;
			if (!isEndedCampaign(card, info)) continue;
			if (didHideElement(card)) hiddenCount++;
		}
		if (hiddenCount > 0) console.log(`[Twitch Drops] Hidden ${hiddenCount} ended campaign(s)`);
	}
	function isVisibleActionButton(button, label) {
		if (button.disabled) return false;
		if (!button.offsetParent) return false;
		return button.textContent?.trim() === label;
	}
	function clickClaimNowButtons() {
		let clickedCount = 0;
		for (const button of document.querySelectorAll("button")) {
			if (!isVisibleActionButton(button, CLAIM_NOW_LABEL)) continue;
			if ("dropsClaimClicked" in button.dataset) continue;
			button.dataset.dropsClaimClicked = "true";
			button.click();
			clickedCount++;
		}
		if (clickedCount > 0) console.log(`[Twitch Drops] Clicked ${clickedCount} "Claim Now" button(s)`);
	}
	function hasClaimNowButton() {
		for (const button of document.querySelectorAll("button")) if (isVisibleActionButton(button, CLAIM_NOW_LABEL)) return true;
		return false;
	}
	function clickLoadMoreButton() {
		if (!hasClaimNowButton()) return;
		const now = Date.now();
		if (now - loadMoreState.lastClickMs < LOAD_MORE_COOLDOWN_MS) return;
		for (const button of document.querySelectorAll("button")) {
			if (!isVisibleActionButton(button, LOAD_MORE_LABEL)) continue;
			loadMoreState.lastClickMs = now;
			button.click();
			console.log("[Twitch Drops] Clicked \"Load More\"");
			return;
		}
	}
	function hideEmptyInProgressSection() {
		const root = document.querySelector(".inventory-max-width");
		if (!(root instanceof HTMLElement)) return;
		const infos = root.querySelectorAll(".inventory-campaign-info");
		if (infos.length === 0) return;
		for (const info of infos) if (!isVisiblyHidden(info)) return;
		didHideElement(root);
	}
	function isInventoryPath() {
		return location.pathname.includes("/drops/inventory");
	}
	function processInventory() {
		if (!isInventoryPath()) return;
		clickLoadMoreButton();
		clickClaimNowButtons();
		hideEndedRewards();
		hideEmptyInProgressSection();
	}
	function initializeInventory() {
		let isStopped = false;
		const runProcess = debounce(() => {
			if (isStopped) return;
			processInventory();
		}, MUTATION_DEBOUNCE_MS);
		runProcess();
		const observer = new MutationObserver(runProcess);
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		return () => {
			isStopped = true;
			observer.disconnect();
		};
	}
	function dropsRouteFromLocation() {
		const { pathname } = location;
		if (pathname.includes("/drops/campaigns")) return "campaigns";
		if (pathname.includes("/drops/inventory")) return "inventory";
	}
	function watchLocation(onChange) {
		let lastHref = location.href;
		const notify = () => {
			if (location.href === lastHref) return;
			lastHref = location.href;
			onChange();
		};
		addEventListener("popstate", notify);
		const navigation = globalThis.navigation;
		if (navigation) {
			navigation.addEventListener("currententrychange", notify);
			return;
		}
		const { pushState, replaceState } = history;
		history.pushState = function(...stateArguments) {
			Reflect.apply(pushState, history, stateArguments);
			notify();
		};
		history.replaceState = function(...stateArguments) {
			Reflect.apply(replaceState, history, stateArguments);
			notify();
		};
	}
	function start() {
		let activeRoute;
		let stopActive;
		const syncRoute = () => {
			const route = dropsRouteFromLocation();
			if (route === activeRoute) return;
			stopActive?.();
			stopActive = void 0;
			activeRoute = route;
			if (route === "campaigns") stopActive = initializeCampaigns();
			else if (route === "inventory") stopActive = initializeInventory();
		};
		watchLocation(syncRoute);
		syncRoute();
	}
	start();
})();
