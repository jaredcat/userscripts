// ==UserScript==
// @name         TVDB Episode Input Automation
// @namespace    jaredcat/tvdb-episode-automation
// @version      0.0.4
// @author       jaredcat
// @description  Automates episode input process on TVDB
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/tvdb-episode-automation.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/tvdb-episode-automation.user.js
// @match        *://thetvdb.com/series/*/episodes/add*
// ==/UserScript==

(function() {
	"use strict";
	var episodeData = [{
		number: "4",
		name: "American Stepdad",
		overview: "When Stan invites his recently widowed mother to move in, she and Roger fall in love and wed; Steve and his friends find a lost movie script.",
		date: "2012-11-18",
		runtime: 25
	}, {
		number: "5",
		name: "Why Can't We Be Friends?",
		overview: "When Stan decides that Snot isn't cool enough to be Steve's best friend, he tries to separate them by staging a shooting at an ice cream parlor.",
		date: "2012-12-5",
		runtime: 25
	}];
	function fillRowField(row, selector, value) {
		if (value === void 0) return;
		const input = row.querySelector(selector);
		if (input) input.value = value;
	}
	function ensureRowExists(index) {
		let rows = document.querySelectorAll(".multirow-item");
		if (index >= rows.length - 1) {
			document.querySelector(".multirow-add")?.click();
			rows = document.querySelectorAll(".multirow-item");
		}
		return rows[index];
	}
	function fillEpisodeRow(row, episode) {
		fillRowField(row, "input[name=\"number[]\"]", episode.number);
		fillRowField(row, "input[name=\"name[]\"]", episode.name);
		fillRowField(row, "textarea[name=\"overview[]\"]", episode.overview);
		fillRowField(row, "input[name=\"date[]\"]", episode.date);
		fillRowField(row, "input[name=\"runtime[]\"]", episode.runtime?.toString());
	}
	function fillEpisodeData(episodes) {
		for (const [index, episode] of episodes.entries()) {
			const row = ensureRowExists(index);
			if (!row) continue;
			fillEpisodeRow(row, episode);
		}
	}
	var button = document.createElement("button");
	button.textContent = "Auto-fill Episodes";
	button.style.position = "fixed";
	button.style.top = "10px";
	button.style.right = "10px";
	button.style.zIndex = "9999";
	button.addEventListener("click", () => fillEpisodeData(episodeData));
	document.body.append(button);
})();
