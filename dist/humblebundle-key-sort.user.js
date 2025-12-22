// ==UserScript==
// @name         Humble Bundle Key Sort
// @namespace    jaredcat/humblebundle-key-sort
// @version      1.0.0
// @author       jaredcat
// @description  Sort Humble Bundle by claimed status
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/humblebundle-key-sort.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/humblebundle-key-sort.user.js
// @match        *://www.humblebundle.com/membership/*
// @match        *://www.humblebundle.com/downloads?key=*
// ==/UserScript==

(function () {
  'use strict';

  const MAX_ATTEMPTS = 30;
  let attempts = 0;
  const waitForInit = setInterval(() => {
    attempts++;
    const keyList = getKeyList();
    if (keyList?.children.length) {
      clearInterval(waitForInit);
      main(keyList);
    } else if (attempts >= MAX_ATTEMPTS) {
      clearInterval(waitForInit);
      console.warn(
        "Humble Bundle Key Sort: Key list not found after maximum attempts"
      );
    }
  }, 1e3);
  function getKeyList() {
    return document.querySelector(".content-choice-tiles") || document.querySelector(".key-list");
  }
  function isClaimed(element) {
    return element.className.includes("claimed") || element.querySelector(".redeemed") !== null;
  }
  function main(keyList) {
    const toSort = Array.from(keyList.children);
    toSort.sort((a, b) => {
      const aClaimed = isClaimed(a);
      const bClaimed = isClaimed(b);
      if (aClaimed && !bClaimed) return 1;
      if (!aClaimed && bClaimed) return -1;
      const aText = a.textContent?.trim() ?? "";
      const bText = b.textContent?.trim() ?? "";
      return aText.localeCompare(bText);
    });
    keyList.replaceChildren(...toSort);
  }

})();