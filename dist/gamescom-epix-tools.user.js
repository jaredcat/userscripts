// ==UserScript==
// @name         Gamescom Epix Tools
// @namespace    jaredcat/gamescom-epix-tools
// @version      2.1.1
// @author       jaredcat
// @description  Tools for Gamescom Epix 2024 event website
// @license      AGPL-3.0-or-later
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/gamescom-epix-tools.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/gamescom-epix-tools.user.js
// @match        *://gamescom.global/*
// ==/UserScript==

(function () {
  'use strict';

  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  class GamescomEpixTools {
    constructor() {
      __publicField(this, "toolbar", null);
      __publicField(this, "autoCollectInterval", null);
      this.init();
    }
    init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.setup());
      } else {
        this.setup();
      }
    }
    setup() {
      this.addToolbar();
      this.addKeyboardShortcuts();
      this.observePageChanges();
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
      buttons.forEach(({ text, action, hotkey }) => {
        var _a;
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
        (_a = this.toolbar) == null ? undefined : _a.appendChild(button);
      });
      document.body.appendChild(this.toolbar);
    }
    addKeyboardShortcuts() {
      document.addEventListener("keydown", (e) => {
        if (e.target instanceof HTMLInputElement) return;
        switch (e.key.toUpperCase()) {
          case "J":
            this.quickJoinQueue();
            break;
          case "S":
            this.skipCurrentVideo();
            break;
          case "R":
            this.toggleAutoCollect();
            break;
        }
      });
    }
    quickJoinQueue() {
      const joinButton = document.querySelector(
        'button[data-testid="join-queue-button"]'
      );
      joinButton == null ? undefined : joinButton.click();
    }
    skipCurrentVideo() {
      const skipButton = document.querySelector(
        'button[data-testid="skip-video-button"]'
      );
      skipButton == null ? undefined : skipButton.click();
    }
    toggleAutoCollect() {
      if (this.autoCollectInterval) {
        window.clearInterval(this.autoCollectInterval);
        this.autoCollectInterval = null;
        console.log("Auto-collect disabled");
      } else {
        this.autoCollectInterval = window.setInterval(() => {
          const collectButtons = document.querySelectorAll(
            'button[data-testid="collect-reward-button"]'
          );
          collectButtons.forEach((button) => button.click());
        }, 5e3);
        console.log("Auto-collect enabled");
      }
    }
    observePageChanges() {
      const observer = new MutationObserver(() => {
        if (this.autoCollectInterval) {
          const collectButtons = document.querySelectorAll(
            'button[data-testid="collect-reward-button"]'
          );
          collectButtons.forEach((button) => button.click());
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }
  new GamescomEpixTools();

})();