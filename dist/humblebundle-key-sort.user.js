// ==UserScript==
// @name         Humble Bundle Key Sort
// @namespace    jaredcat/humblebundle-key-sort
// @version      1.0.2
// @author       jaredcat
// @description  Sort Humble Bundle by claimed status
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/humblebundle-key-sort.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/humblebundle-key-sort.user.js
// @match        *://www.humblebundle.com/membership/*
// @match        *://www.humblebundle.com/downloads?key=*
// ==/UserScript==

(function() {
	"use strict";
	var MAX_ATTEMPTS = 30;
	var POLL_INTERVAL_MS = 1e3;
	var state = { attempts: 0 };
	var waitForInit = setInterval(() => {
		state.attempts++;
		const keyList = getKeyList();
		if (keyList?.children.length) {
			clearInterval(waitForInit);
			main(keyList);
		} else if (state.attempts >= MAX_ATTEMPTS) {
			clearInterval(waitForInit);
			console.warn("Humble Bundle Key Sort: Key list not found after maximum attempts");
		}
	}, POLL_INTERVAL_MS);
	function getKeyList() {
		return document.querySelector(".content-choice-tiles") || document.querySelector(".key-list") || void 0;
	}
	function isClaimed(element) {
		return element.className.includes("claimed") || Boolean(element.querySelector(".redeemed"));
	}
	function main(keyList) {
		const toSort = [...keyList.children];
		toSort.sort((a, b) => {
			const isAClaimed = isClaimed(a);
			const isBClaimed = isClaimed(b);
			if (isAClaimed && !isBClaimed) return 1;
			if (!isAClaimed && isBClaimed) return -1;
			const aText = a.textContent?.trim() ?? "";
			const bText = b.textContent?.trim() ?? "";
			return aText.localeCompare(bText);
		});
		keyList.replaceChildren(...toSort);
	}
})();
