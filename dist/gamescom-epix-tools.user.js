// ==UserScript==
// @name         Gamescom Epix Tools
// @namespace    jaredcat/gamescom-epix-tools
// @version      2.1.3
// @author       jaredcat
// @description  Tools for Gamescom Epix 2024 event website
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/gamescom-epix-tools.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/gamescom-epix-tools.user.js
// @match        *://gamescom.global/*
// ==/UserScript==

(function() {
	"use strict";
	var AUTO_COLLECT_INTERVAL_MS = 5e3;
	var GamescomEpixTools = class {
		toolbar = void 0;
		autoCollectInterval = void 0;
		setup() {
			this.addToolbar();
			this.addKeyboardShortcuts();
			this.observePageChanges();
		}
		quickJoinQueue() {
			document.querySelector("button[data-testid=\"join-queue-button\"]")?.click();
		}
		skipCurrentVideo() {
			document.querySelector("button[data-testid=\"skip-video-button\"]")?.click();
		}
		toggleAutoCollect() {
			if (this.autoCollectInterval) {
				clearInterval(this.autoCollectInterval);
				this.autoCollectInterval = void 0;
				console.log("Auto-collect disabled");
			} else {
				this.autoCollectInterval = setInterval(() => {
					const collectButtons = document.querySelectorAll("button[data-testid=\"collect-reward-button\"]");
					for (const button of collectButtons) button.click();
				}, AUTO_COLLECT_INTERVAL_MS);
				console.log("Auto-collect enabled");
			}
		}
		observePageChanges() {
			new MutationObserver(() => {
				if (!this.autoCollectInterval) return;
				const collectButtons = document.querySelectorAll("button[data-testid=\"collect-reward-button\"]");
				for (const button of collectButtons) button.click();
			}).observe(document.body, {
				childList: true,
				subtree: true
			});
		}
		init() {
			if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => this.setup());
			else this.setup();
		}
		addToolbar() {
			this.toolbar = document.createElement("div");
			this.toolbar.className = "epix-tools-toolbar";
			this.toolbar.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      padding: 10px;
      border-radius: 5px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 5px;
    `;
			const buttons = [
				{
					text: "Quick Join Queue",
					action: () => this.quickJoinQueue(),
					hotkey: "J"
				},
				{
					text: "Skip Current Video",
					action: () => this.skipCurrentVideo(),
					hotkey: "S"
				},
				{
					text: "Auto-Collect Rewards",
					action: () => this.toggleAutoCollect(),
					hotkey: "R"
				}
			];
			for (const { text, action, hotkey } of buttons) {
				const button = document.createElement("button");
				button.textContent = `${text} (${hotkey})`;
				button.style.cssText = `
        padding: 5px 10px;
        margin: 2px;
        border: none;
        border-radius: 3px;
        background: #4a4a4a;
        color: white;
        cursor: pointer;
      `;
				button.addEventListener("click", action);
				this.toolbar?.append(button);
			}
			document.body.append(this.toolbar);
		}
		addKeyboardShortcuts() {
			document.addEventListener("keydown", (event) => {
				if (event.target instanceof HTMLInputElement) return;
				switch (event.key.toUpperCase()) {
					case "J":
						this.quickJoinQueue();
						break;
					case "S":
						this.skipCurrentVideo();
						break;
					case "R": this.toggleAutoCollect();
				}
			});
		}
	};
	new GamescomEpixTools().init();
})();
