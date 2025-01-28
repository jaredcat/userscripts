// ==UserScript==
// @name         TVDB Episode Input Automation
// @namespace    jaredcat/tvdb-episode-automation
// @version      1.0.0
// @author       jaredcat
// @description  Automates episode input process on TVDB
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/tvdb-episode-automation.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/tvdb-episode-automation.user.js
// @match        *://thetvdb.com/series/*/episodes/add*
// ==/UserScript==

(function () {
  'use strict';

  const episodeData = [
    {
      number: "4",
      name: "American Stepdad",
      overview: "When Stan invites his recently widowed mother to move in, she and Roger fall in love and wed; Steve and his friends find a lost movie script.",
      date: "2012-11-18",
      runtime: 25
    },
    {
      number: "5",
      name: "Why Can't We Be Friends?",
      overview: "When Stan decides that Snot isn't cool enough to be Steve's best friend, he tries to separate them by staging a shooting at an ice cream parlor.",
      date: "2012-12-5",
      runtime: 25
    }
  ];
  function fillEpisodeData(episodes) {
    const rows = document.querySelectorAll(".multirow-item");
    episodes.forEach((episode, index) => {
      if (index >= rows.length - 1) {
        const addButton = document.querySelector(".multirow-add");
        addButton == null ? undefined : addButton.click();
      }
      const row = document.querySelectorAll(".multirow-item")[index];
      if (!row) return;
      const numberInput = row.querySelector(
        'input[name="number[]"]'
      );
      if (numberInput) numberInput.value = episode.number;
      const nameInput = row.querySelector(
        'input[name="name[]"]'
      );
      if (nameInput) nameInput.value = episode.name;
      const overviewInput = row.querySelector(
        'textarea[name="overview[]"]'
      );
      if (overviewInput) overviewInput.value = episode.overview;
      if (episode.date) {
        const dateInput = row.querySelector(
          'input[name="date[]"]'
        );
        if (dateInput) dateInput.value = episode.date;
      }
      if (episode.runtime) {
        const runtimeInput = row.querySelector(
          'input[name="runtime[]"]'
        );
        if (runtimeInput) runtimeInput.value = episode.runtime.toString();
      }
    });
  }
  const btn = document.createElement("button");
  btn.innerText = "Auto-fill Episodes";
  btn.style.position = "fixed";
  btn.style.top = "10px";
  btn.style.right = "10px";
  btn.style.zIndex = "9999";
  btn.onclick = () => fillEpisodeData(episodeData);
  document.body.appendChild(btn);

})();