// ==UserScript==
// @name         Humble Bundle Key Sort
// @namespace    jaredcat/humblebundle-key-sort
// @version      2.0.0
// @author       jaredcat
// @description  Steam redeem links with keys filled in; hide DRM-free in library filters
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/humblebundle-key-sort.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/humblebundle-key-sort.user.js
// @match        *://www.humblebundle.com/home/library
// @match        *://www.humblebundle.com/home/library/*
// @grant        none
// ==/UserScript==

(function() {
	"use strict";
	var STEAM_REGISTER_URL = "https://store.steampowered.com/account/registerkey";
	var CONTENT_PATH_PREFIX = "/home/library/content/";
	var LIBRARY_PATH = "/home/library";
	var FILTER_USER_LIBRARY_ACTION = "6079bbb226aa7e8fee3b907cb491f8919534afb7d2";
	var PLATFORMS_WITHOUT_DOWNLOAD = [
		"steam",
		"gog",
		"uplay",
		"blizzard"
	];
	var DRM_FREE_ARIA_LABEL = "DRM-free download";
	var HIDE_DRM_FREE_STORAGE_KEY = "hb-library-hide-drm-free";
	var HIDE_DRM_FREE_SWITCH_ID = "library-hide-drm-free";
	var SHOW_REDEEMED_SWITCH_ID = "library-show-redeemed";
	var STEAM_KEY_PATTERN = /^[A-Z0-9]{4,5}(?:-[A-Z0-9]{4,5}){2,5}$/i;
	var DOM_HIDE_ATTR = "data-hb-hide-drm-free";
	var FILTER_BADGE_ATTR = "data-hb-filter-badge";
	var OBSERVER_DEBOUNCE_MS = 150;
	var state = {
		shouldHideDrmFree: shouldHideDrmFreeFromStorage(),
		observerTimer: void 0,
		isApplying: false
	};
	init();
	function init() {
		document.addEventListener("click", onDocumentClick, { capture: true });
		patchLibraryFilterFetch();
		observeLibraryDom();
		runLibraryEnhancements();
	}
	function shouldHideDrmFreeFromStorage() {
		try {
			return (localStorage.getItem(HIDE_DRM_FREE_STORAGE_KEY) ?? "true") === "true";
		} catch {
			return true;
		}
	}
	function writeShouldHideDrmFree(shouldHide) {
		state.shouldHideDrmFree = shouldHide;
		try {
			localStorage.setItem(HIDE_DRM_FREE_STORAGE_KEY, String(shouldHide));
		} catch {}
	}
	function isLibraryPath() {
		return location.pathname === LIBRARY_PATH || location.pathname.startsWith(`${LIBRARY_PATH}/`);
	}
	function isContentPath() {
		return location.pathname.startsWith(CONTENT_PATH_PREFIX);
	}
	function onDocumentClick(event) {
		if (isContentPath()) handleSteamRedeemClick(event);
	}
	function handleSteamRedeemClick(event) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const button = target.closest("button");
		if (!button) return;
		if (button.querySelector("span")?.textContent.trim() !== "Steam") return;
		const key = findSiblingSteamKey(button);
		if (!key) return;
		event.preventDefault();
		event.stopPropagation();
		open(`${STEAM_REGISTER_URL}?key=${encodeURIComponent(key)}`, "_blank", "noopener,noreferrer");
	}
	function findSiblingSteamKey(steamButton) {
		const group = steamButton.parentElement;
		if (!group) return void 0;
		for (const sibling of group.querySelectorAll("button")) {
			if (sibling === steamButton) continue;
			const text = sibling.querySelector("span")?.textContent.trim();
			if (text && STEAM_KEY_PATTERN.test(text)) return text;
		}
	}
	function patchLibraryFilterFetch() {
		const originalFetch = fetch.bind(globalThis);
		globalThis.fetch = async (input, init) => {
			if (state.shouldHideDrmFree && init?.body instanceof FormData) {
				if (getNextActionHeader(init.headers) === FILTER_USER_LIBRARY_ACTION) applyPlatformFilterToFormData(init.body);
			}
			return originalFetch(input, init);
		};
	}
	function getNextActionHeader(headers) {
		if (!headers) return void 0;
		if (headers instanceof Headers) return headers.get("Next-Action") ?? void 0;
		if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === "next-action")?.[1];
		for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === "next-action") return value;
	}
	function applyPlatformFilterToFormData(body) {
		const existing = body.getAll("platform[]").map(String);
		body.delete("platform[]");
		const base = existing.length > 0 ? existing : [...PLATFORMS_WITHOUT_DOWNLOAD];
		for (const platform of base) if (platform !== "download") body.append("platform[]", platform);
	}
	function observeLibraryDom() {
		new MutationObserver((mutations) => {
			if (state.isApplying || mutations.every((mutation) => !isExternalMutation(mutation))) return;
			scheduleLibraryEnhancements();
		}).observe(document.documentElement, {
			childList: true,
			subtree: true
		});
	}
	function isExternalMutation(mutation) {
		const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
		return nodes.length === 0 || nodes.some((node) => isExternalNode(node));
	}
	function isExternalNode(node) {
		if (!(node instanceof Element)) return true;
		if (node.id === HIDE_DRM_FREE_SWITCH_ID || node.hasAttribute(FILTER_BADGE_ATTR) || node.querySelector(`#${CSS.escape(HIDE_DRM_FREE_SWITCH_ID)}`)) return false;
		return !node.querySelector(`[${CSS.escape(FILTER_BADGE_ATTR)}]`);
	}
	function scheduleLibraryEnhancements() {
		if (state.observerTimer) clearTimeout(state.observerTimer);
		state.observerTimer = setTimeout(() => {
			state.observerTimer = void 0;
			runLibraryEnhancements();
		}, OBSERVER_DEBOUNCE_MS);
	}
	function runLibraryEnhancements() {
		if (state.isApplying) return;
		state.isApplying = true;
		try {
			maybeInjectHideDrmFreeSwitch();
			applyDrmFreeDomHide();
			updateSortFilterBadge();
		} finally {
			state.isApplying = false;
		}
	}
	function maybeInjectHideDrmFreeSwitch() {
		if (!isLibraryPath() || document.querySelector(`#${CSS.escape(HIDE_DRM_FREE_SWITCH_ID)}`)) return;
		const showRedeemed = document.querySelector(`#${CSS.escape(SHOW_REDEEMED_SWITCH_ID)}`);
		if (!showRedeemed) return;
		const row = showRedeemed.closest(".flex.items-center.justify-between");
		if (!row?.parentElement) return;
		row.after(buildHideDrmFreeRow(showRedeemed));
	}
	function buildHideDrmFreeRow(showRedeemedSwitch) {
		const templateRow = showRedeemedSwitch.closest(".flex.items-center.justify-between");
		const row = templateRow?.cloneNode(true) ?? document.createElement("div");
		if (!templateRow) row.className = "flex items-center justify-between gap-3";
		const label = row.querySelector("label") ?? (() => {
			const created = document.createElement("label");
			row.prepend(created);
			return created;
		})();
		label.setAttribute("for", HIDE_DRM_FREE_SWITCH_ID);
		label.textContent = "Hide DRM-free";
		const switchElement = row.querySelector("[role=\"switch\"]") ?? (() => {
			const created = document.createElement("button");
			created.type = "button";
			created.setAttribute("role", "switch");
			row.append(created);
			return created;
		})();
		switchElement.id = HIDE_DRM_FREE_SWITCH_ID;
		switchElement.type = "button";
		switchElement.setAttribute("role", "switch");
		syncHideDrmFreeSwitchUi(switchElement, state.shouldHideDrmFree);
		switchElement.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const shouldHide = !state.shouldHideDrmFree;
			writeShouldHideDrmFree(shouldHide);
			syncHideDrmFreeSwitchUi(switchElement, shouldHide);
			runLibraryEnhancements();
		});
		return row;
	}
	function syncHideDrmFreeSwitchUi(switchElement, isChecked) {
		switchElement.setAttribute("aria-checked", String(isChecked));
		switchElement.classList.toggle("bg-primary", isChecked);
		switchElement.classList.toggle("bg-muted", !isChecked);
		const thumb = switchElement.querySelector("span");
		if (!thumb) return;
		thumb.classList.toggle("left-5", isChecked);
		thumb.classList.toggle("left-0.5", !isChecked);
		thumb.classList.remove("translate-x-5", "translate-x-0");
	}
	function getSortFilterButton() {
		return [...document.querySelectorAll("button[aria-haspopup=\"dialog\"]")].find((button) => {
			return button.querySelector(":scope > span")?.textContent.trim() === "Sort & Filter";
		});
	}
	function isNativeFilterBadge(element) {
		return element instanceof HTMLSpanElement && !element.hasAttribute(FILTER_BADGE_ATTR) && element.classList.contains("rounded-full") && element.classList.contains("bg-primary") && Boolean(element.querySelector(":scope > span[aria-hidden=\"true\"]"));
	}
	function updateSortFilterBadge() {
		if (!isLibraryPath()) return;
		const button = getSortFilterButton();
		if (!button) return;
		const nativeBadge = [...button.querySelectorAll(":scope > span")].find((element) => isNativeFilterBadge(element));
		const managedBadge = button.querySelector(`:scope > span[${CSS.escape(FILTER_BADGE_ATTR)}]`);
		if (!state.shouldHideDrmFree) {
			if (nativeBadge instanceof HTMLElement && nativeBadge.style.display) nativeBadge.style.display = "";
			managedBadge?.remove();
			return;
		}
		const total = readBadgeCount(nativeBadge) + 1;
		if (nativeBadge instanceof HTMLElement && nativeBadge.style.display !== "none") nativeBadge.style.display = "none";
		if (managedBadge) {
			setBadgeCount(managedBadge, total);
			return;
		}
		const badge = createFilterBadge();
		setBadgeCount(badge, total);
		const icon = button.querySelector(":scope > svg");
		if (icon) icon.before(badge);
		else button.append(badge);
	}
	function readBadgeCount(badge) {
		if (!badge) return 0;
		const countElement = badge.querySelector(":scope > span[aria-hidden=\"true\"]");
		return countElement ? Number(countElement.textContent.trim()) || 0 : 0;
	}
	function createFilterBadge() {
		const badge = document.createElement("span");
		badge.setAttribute(FILTER_BADGE_ATTR, "true");
		badge.className = "bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-extrabold";
		const visible = document.createElement("span");
		visible.setAttribute("aria-hidden", "true");
		const srOnly = document.createElement("span");
		srOnly.className = "sr-only";
		badge.append(visible, srOnly);
		return badge;
	}
	function setBadgeCount(badge, total) {
		const visible = badge.querySelector(":scope > span[aria-hidden=\"true\"]");
		const nextVisible = String(total);
		if (visible && visible.textContent !== nextVisible) visible.textContent = nextVisible;
		const srOnly = badge.querySelector(":scope > span.sr-only");
		if (!srOnly) return;
		const nextSr = total === 1 ? `, ${String(total)} Filter` : `, ${String(total)} Filters`;
		if (srOnly.textContent !== nextSr) srOnly.textContent = nextSr;
	}
	function applyDrmFreeDomHide() {
		const links = document.querySelectorAll(`a[href*="${CSS.escape(CONTENT_PATH_PREFIX)}"]`);
		for (const link of links) {
			const card = getLibraryCard(link);
			if (!card) continue;
			if (link.style.display === "none") link.style.display = "";
			if (link.hasAttribute(DOM_HIDE_ATTR)) link.removeAttribute(DOM_HIDE_ATTR);
			const isDrmFree = Boolean(link.querySelector(`[aria-label="${CSS.escape(DRM_FREE_ARIA_LABEL)}"]`));
			const isHidden = card.getAttribute(DOM_HIDE_ATTR) === "true";
			if (isDrmFree && state.shouldHideDrmFree) {
				if (!isHidden) {
					card.style.display = "none";
					card.setAttribute(DOM_HIDE_ATTR, "true");
				}
			} else if (isHidden) {
				card.style.display = "";
				card.removeAttribute(DOM_HIDE_ATTR);
			}
		}
	}
	function getLibraryCard(link) {
		return link.closest(".bg-card") ?? void 0;
	}
})();
