// ==UserScript==
// @name         SteamTrade Matcher Userscript
// @namespace    https://www.steamtradematcher.com
// @version      2.1.2
// @author       Robou / Tithen-Firion / jaredcat
// @description  Allows quicker trade offers by automatically adding cards as matched by SteamTrade Matcher
// @license      AGPL-3.0-or-later
// @icon         https://www.steamtradematcher.com/favicon.png
// @downloadURL  https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/steam-trade.user.js
// @updateURL    https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/steam-trade.user.js
// @match        *://steamcommunity.com/tradeoffer/new/*source=stm*
// @match        *://*.steamtradematcher.com/*
// @require      https://greasemonkey.github.io/gm4-polyfill/gm4-polyfill.js
// @connect      steamtradematcher.com
// @grant        GM.deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  var _GM = (() => typeof GM != "undefined" ? GM : void 0)();
  const CONFIG = {
    WEBSITE_HOSTS: ["www.steamtradematcher.com"],
    STEAM: {
      APP_ID: 753,
      CONTEXT_ID: 6
    },
    TRADE: {
      CHUNK_SIZE: 100,
      WINDOW_DELAY: 1e3
    },
    DEFAULT_SETTINGS: {
      MESSAGE: "SteamTrade Matcher",
      AUTO_SEND: false,
      DO_AFTER_TRADE: "NOTHING",
      ORDER: "AS_IS",
      SIDE_BY_SIDE: false
    }
  };
  const SIDE_BY_SIDE_STYLE = `
  .pagecontent:has(> .trade_area ) {
    width: 100% !important;
  }
  .trade_area .inventory_ctn .inventory_page {
    width: auto !important;
    overflow-y: auto;
  }
  .trade_area {
    display: grid;
    grid-template-columns: minmax(200px, 458px) 1fr;
    gap: 10px 10px;
    padding: 0 20px;
    .inventory_user_tab {
      width: 49% !important;
    }
    .trade_box {
      width: 100% !important
    }
    .trade_left,
    .trade_left > .trade_box {
      box-sizing: border-box;
      height: fit-content;
      width: auto !important;
      max-width: 458px !important;
      float: none !important;
    }
    @media (min-height: 800px) {
      .trade_left {
        position: sticky !important;
        top: 0;
      }
    }
    div.appselect {
      width: auto !important;
    }
    #inventories,
    .inventory_ctn {
      width: auto !important;
    }
    .trade_right {
        float: none;
    }
    .offerheader {
      min-height: 71px;
      h2 {
        white-space: nowrap;
        max-width: 20ch;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
    #your_slots,
    #their_slots {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
    }
    #your_slots {
      justify-content: flex-end;
    }
    #their_slots {
          justify-content: flex-start;
    }
    .trade_right .trade_box_contents{
      display: grid;
      grid-template-columns: 50% 50%;
      grid-template-rows:1fr 0fr;
      gap: 10px 10px;
      grid-template-areas:
        "yours theirs"
        "bottom bottom";
    }
    #trade_yours {
      grid-area: yours;
    }
    #trade_theirs {
      grid-area: theirs;
    }
    .trade_offer {
      display:flex;
      flex-direction: column;
    }
    #trade_items_separator,
    .trade_rule.maketrade{
      display: none;
      grid-area: bottom;
    }
    .trade_confirm_box{
      grid-area: bottom;
    }
  }
`;
  class StyleManager {
    styleId;
    styleElement;
    isEnabled;
    constructor() {
      this.styleId = "side-by-side-style";
      this.styleElement = null;
      this.isEnabled = false;
    }
    async initialize() {
      this.isEnabled = await _GM.getValue("SIDE_BY_SIDE", false);
      if (this.isEnabled) this.enableStyle();
    }
    enableStyle() {
      if (!this.styleElement) {
        this.styleElement = document.createElement("style");
        this.styleElement.id = this.styleId;
        this.styleElement.textContent = SIDE_BY_SIDE_STYLE;
        document.head.appendChild(this.styleElement);
      }
    }
    disableStyle() {
      if (this.styleElement) {
        this.styleElement.remove();
        this.styleElement = null;
      }
    }
  }
  function getUrlParameters() {
    const url = new URL(window.location.href);
    const you = url.searchParams.getAll("you[]");
    const them = url.searchParams.getAll("them[]");
    if (you.length || them.length) return { you, them };
    const params = Object.fromEntries(url.searchParams);
    return {
      you: params.you?.split(";") || [],
      them: params.them?.split(";") || []
    };
  }
  const CookieManager = {
    getInventoryCookie() {
      const match = document.cookie.match(/strTradeLastInventoryContext=([^;]+)/);
      return match ? match[1] : null;
    },
    clearInventoryCookie() {
      document.cookie = "strTradeLastInventoryContext=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/tradeoffer/";
    },
    restoreInventoryCookie(cookieValue) {
      if (!cookieValue) return;
      const expiry = new Date();
      expiry.setTime(expiry.getTime() + 15 * 24 * 60 * 60 * 1e3);
      document.cookie = `strTradeLastInventoryContext=${cookieValue}; expires=${expiry.toUTCString()}; path=/tradeoffer/`;
    }
  };
  class InventoryValidator {
    static validateInventories(yourInventory, theirInventory) {
      if (!Object.keys(yourInventory).length || !Object.keys(theirInventory).length) {
        throw new Error("Invalid inventory state");
      }
    }
    static validateCardTypes(yourTypes, theirTypes) {
      const remainingTypes = [...yourTypes];
      for (const type of theirTypes) {
        const index = remainingTypes.indexOf(type);
        if (index === -1) throw new Error("Not a 1:1 trade");
        remainingTypes.splice(index, 1);
      }
    }
  }
  class TradeHandler {
    settings;
    users;
    cards;
    oldCookie;
    constructor(settings, users, cards) {
      this.settings = settings;
      this.users = users;
      this.cards = cards;
      this.oldCookie = CookieManager.getInventoryCookie();
    }
    async validateTrade() {
      const [yourCards, theirCards] = this.cards;
      const yourInventory = this.users[0].rgContexts[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory?.rgInventory || {};
      const theirInventory = this.users[1].rgContexts[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory?.rgInventory || {};
      InventoryValidator.validateInventories(yourInventory, theirInventory);
      const validCards = this.findValidCards(
        yourInventory,
        theirInventory,
        yourCards,
        theirCards
      );
      this.cards = [validCards.yours, validCards.theirs];
      if (!validCards.yours.length) {
        throw new Error("No valid matching cards found in both inventories");
      }
      return true;
    }
    findValidCards(yourInventory, theirInventory, yourCards, theirCards) {
      const validYourCards = new Set();
      const validTheirCards = new Set();
      yourCards.forEach((classId) => {
        if (Object.values(yourInventory).some((item) => item.classid === classId)) {
          validYourCards.add(classId);
        }
      });
      theirCards.forEach((classId) => {
        if (Object.values(theirInventory).some((item) => item.classid === classId)) {
          validTheirCards.add(classId);
        }
      });
      const matchingYourCards = [];
      const matchingTheirCards = [];
      for (let i = 0; i < yourCards.length; i++) {
        if (validYourCards.has(yourCards[i]) && validTheirCards.has(theirCards[i])) {
          matchingYourCards.push(yourCards[i]);
          matchingTheirCards.push(theirCards[i]);
        }
      }
      return { yours: matchingYourCards, theirs: matchingTheirCards };
    }
    async processCards() {
      const cardTypes = [[], []];
      for (let i = 0; i < 2; i++) {
        const inventory = this.users[i].rgContexts[CONFIG.STEAM.APP_ID][CONFIG.STEAM.CONTEXT_ID].inventory;
        inventory.BuildInventoryDisplayElements();
        const cardMapping = this.createCardMapping(
          inventory.rgInventory,
          this.cards[i]
        );
        await this.addCardsToTrade(cardMapping, this.cards[i], cardTypes[i]);
      }
      InventoryValidator.validateCardTypes(cardTypes[0], cardTypes[1]);
      return true;
    }
    createCardMapping(inventory, requestedCards) {
      const mapping = {};
      Object.values(inventory).forEach((item) => {
        if (requestedCards.includes(item.classid)) {
          if (!mapping[item.classid]) mapping[item.classid] = [];
          mapping[item.classid].push({
            type: item.type,
            element: item.element,
            id: item.id
          });
        }
      });
      if (this.settings.ORDER === "SORT") {
        Object.values(mapping).forEach(
          (cards) => cards.sort((a, b) => parseInt(b.id) - parseInt(a.id))
        );
      }
      return mapping;
    }
    async addCardsToTrade(mapping, requestedCards, typeArray) {
      for (const classid of requestedCards) {
        const availableCards = mapping[classid] || [];
        if (!availableCards.length) throw new Error("Missing cards");
        const index = this.settings.ORDER === "RANDOM" ? Math.floor(Math.random() * availableCards.length) : 0;
        unsafeWindow.MoveItemToTrade(availableCards[index].element);
        typeArray.push(availableCards[index].type);
        availableCards.splice(index, 1);
      }
    }
    injectPostTradeHandler() {
      if (this.settings.DO_AFTER_TRADE === "NOTHING") return;
      const script = document.createElement("script");
      script.textContent = `
      const DO_AFTER_TRADE = "${this.settings.DO_AFTER_TRADE}";
      $J(document).ajaxSuccess((event, xhr, settings) => {
        if (settings.url === "https://steamcommunity.com/tradeoffer/new/send") {
          if (DO_AFTER_TRADE === "CLOSE_WINDOW") {
            window.close();
          } else if (DO_AFTER_TRADE === "CLICK_OK") {
            document.querySelector("div.newmodal_buttons > div")?.click();
          }
        }
      });
    `;
      document.body.appendChild(script);
    }
    async completeTrade() {
      if (this.settings.AUTO_SEND) {
        unsafeWindow.ToggleReady(true);
        unsafeWindow.CTradeOfferStateManager.ConfirmTradeOffer();
      }
    }
  }
  class TradeSplitter {
    constructor() {
      this.bindEvents();
    }
    bindEvents() {
      document.addEventListener("click", async (e) => {
        const tradeButton = e.target?.closest(".user-results > .card-header > div > .btn");
        if (!tradeButton) return;
        e.preventDefault();
        await this.handleTradeClick(tradeButton);
      });
    }
    async handleTradeClick(button) {
      const url = new URL(button.href);
      const youParams = url.searchParams.getAll("you[]");
      const themParams = url.searchParams.getAll("them[]");
      if (youParams.length < CONFIG.TRADE.CHUNK_SIZE && themParams.length < CONFIG.TRADE.CHUNK_SIZE) {
        window.open(button.href, "_blank");
        return;
      }
      for (let i = 0; i < youParams.length; i += CONFIG.TRADE.CHUNK_SIZE) {
        await this.openTradeWindow(url, youParams, themParams, i);
        await new Promise(
          (resolve) => setTimeout(resolve, CONFIG.TRADE.WINDOW_DELAY)
        );
      }
    }
    async openTradeWindow(baseUrl, youParams, themParams, startIndex) {
      const newUrl = new URL(baseUrl);
      newUrl.search = "";
      const youChunk = youParams.slice(
        startIndex,
        startIndex + CONFIG.TRADE.CHUNK_SIZE
      );
      const themChunk = themParams.slice(
        startIndex,
        startIndex + CONFIG.TRADE.CHUNK_SIZE
      );
      youChunk.forEach((val) => newUrl.searchParams.append("you[]", val));
      themChunk.forEach((val) => newUrl.searchParams.append("them[]", val));
      window.open(newUrl.toString(), "_blank");
    }
  }
  class SettingsManager {
    static async loadSettings() {
      let settings = { ...CONFIG.DEFAULT_SETTINGS };
      for (const [key, defaultValue] of Object.entries(CONFIG.DEFAULT_SETTINGS)) {
        const value = await _GM.getValue(
          key,
          defaultValue
        );
        if (value !== void 0) {
          settings = {
            ...settings,
            [key]: value
          };
        }
      }
      return settings;
    }
    static async saveSettings() {
      const settings = {
        MESSAGE: document.getElementById("trade-message")?.value,
        DO_AFTER_TRADE: document.getElementById("after-trade")?.value,
        ORDER: document.getElementById("cards-order")?.value,
        AUTO_SEND: document.getElementById("auto-send")?.checked,
        SIDE_BY_SIDE: document.getElementById("side-by-side")?.checked
      };
      await Promise.all(
        Object.entries(settings).map(([key, value]) => _GM.setValue(key, value))
      );
      const alert = document.getElementById("alert");
      if (alert) {
        alert.style.display = "block";
      }
      window.scroll(0, 0);
    }
    static async restoreDefaults() {
      if (!window.confirm("Restore default settings?")) return;
      await Promise.all(
        Object.keys(CONFIG.DEFAULT_SETTINGS).map((key) => _GM.deleteValue(key))
      );
      document.location.reload();
    }
    static prepareSettings(settings) {
      const createCard = (title, body) => `
      <div class="col-xl-6 g-3">
        <div class="card border-dark h-100">
          <div class="card-header">${title}</div>
          <div class="card-body fw-light">${body}</div>
        </div>
      </div>
    `;
      const content = document.getElementById("userscript-settings-target");
      const cards = [
        {
          title: "Action after trade",
          body: `
          <p>Determines what happens when you complete a trade offer.</p>
          <ul>
            <li><strong>Do nothing</strong>: Will do nothing more than the normal behavior.</li>
            <li><strong>Close window</strong>: Will close the window after the trade offer is sent.</li>
            <li><strong>Click OK</strong>: Will redirect you to the trade offers recap page.</li>
          </ul>
          <div class="option-block">
            <label for="after-trade">After trade...</label>
            <select class="form-control" name="after-trade" id="after-trade">
              <option value="NOTHING" ${settings.DO_AFTER_TRADE === "NOTHING" ? "selected" : ""}>Do Nothing</option>
              <option value="CLOSE_WINDOW" ${settings.DO_AFTER_TRADE === "CLOSE_WINDOW" ? "selected" : ""}>Close window</option>
              <option value="CLICK_OK" ${settings.DO_AFTER_TRADE === "CLICK_OK" ? "selected" : ""}>Click OK</option>
            </select>
          </div>`
        },
        {
          title: "Cards order",
          body: `
          <p>Determines which card is added to trade.</p>
          <ul>
            <li><strong>Sorted</strong>: Will sort cards by their IDs before adding to trade.</li>
            <li><strong>Random</strong>: Will add cards to trade randomly.</li>
            <li><strong>As is</strong>: Script doesn't change anything in order.</li>
          </ul>
          <div class="option-block">
            <label for="cards-order">Cards order</label>
            <select class="form-control" name="cards-order" id="cards-order">
              <option value="SORT" ${settings.ORDER === "SORT" ? "selected" : ""}>Sorted</option>
              <option value="RANDOM" ${settings.ORDER === "RANDOM" ? "selected" : ""}>Random</option>
              <option value="AS_IS" ${settings.ORDER === "AS_IS" ? "selected" : ""}>As is</option>
            </select>
          </div>`
        },
        {
          title: "Trade offer message",
          body: `
          <p>Custom text that will be included automatically with your trade offers.</p>
          <div>
            <input type="text" name="trade-message" id="trade-message" class="form-control" value="${settings.MESSAGE}">
          </div>`
        },
        {
          title: "Auto-send trade offer",
          body: `
          <p>Makes it possible for the script to automatically send trade offers without any action.</p>
          <div class="checkbox form-check form-switch">
            <label for="auto-send">
              <input name="auto-send" class="form-check-input" id="auto-send" value="1" type="checkbox" ${settings.AUTO_SEND ? "checked" : ""}>
              Enable
            </label>
          </div>`
        },
        {
          title: "Side-by-side trade view",
          body: `
          <p>Changes the steam trade window so that the trade columns are side-by-side.</p>
          <div class="checkbox form-check form-switch">
            <label for="side-by-side">
              <input name="side-by-side" class="form-check-input" id="side-by-side" value="1" type="checkbox" ${settings.SIDE_BY_SIDE ? "checked" : ""}>
              Enable
            </label>
          </div>`
        }
      ];
      const cardElements = cards.map((card) => createCard(card.title, card.body)).join("");
      const buttons = `
      <div class="position-fixed bottom-0 end-0 m-2 col-auto g-3">
        <div class="bg-opacity-25 bg-primary p-3 border border-primary rounded">
          <button class="btn btn-secondary border-dark me-2" id="restore" type="button">Restore default settings</button>
          <button class="btn btn-primary" id="save" type="button">Save</button>
        </div>
      </div>
    `;
      if (content) {
        content.innerHTML = `
          <div class="alert alert-success mt-3 mb-0" id="alert" style="display:none">Your parameters have been saved.</div>
          ${cardElements}
          ${buttons}
          ${content.innerHTML}
      `;
      }
      document.getElementById("save")?.addEventListener("click", SettingsManager.saveSettings);
      document.getElementById("restore")?.addEventListener("click", SettingsManager.restoreDefaults);
      const userscriptSettings = document.getElementById("userscript-settings");
      if (userscriptSettings) {
        userscriptSettings.style.display = "block";
      }
      const userscriptGuide = document.getElementById("userscript-guide");
      if (userscriptGuide) {
        userscriptGuide.style.display = "none";
      }
    }
  }
  async function handleSteamTrade(settings) {
    const params = getUrlParameters();
    const cards = [params.you, params.them];
    if (!cards[0].length || !cards[1].length) {
      throw new Error("No cards specified in URL parameters");
    }
    CookieManager.clearInventoryCookie();
    const tradeHandler = new TradeHandler(
      settings,
      [unsafeWindow.UserYou, unsafeWindow.UserThem],
      cards
    );
    try {
      await new Promise((resolve) => {
        const checkInventories = () => {
          const users = [unsafeWindow.UserYou, unsafeWindow.UserThem];
          const ready = users.every((user) => {
            if (user.rgContexts?.[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory) {
              const inventory = user.rgContexts[CONFIG.STEAM.APP_ID][CONFIG.STEAM.CONTEXT_ID].inventory;
              if (!inventory.rgInventory) {
                inventory.BuildInventoryDisplayElements();
              }
              return Object.keys(inventory.rgInventory || {}).length > 0 && user.cLoadsInFlight === 0;
            }
            return false;
          });
          if (ready) {
            resolve();
          } else {
            users.forEach((user) => {
              if (!user.rgContexts?.[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory) {
                $J("#trade_inventory_unavailable").show();
                $J("#trade_inventory_pending").show();
                user.loadInventory(CONFIG.STEAM.APP_ID, CONFIG.STEAM.CONTEXT_ID);
              }
            });
            setTimeout(checkInventories, 500);
          }
        };
        checkInventories();
      });
      await tradeHandler.validateTrade();
      unsafeWindow.TradePageSelectInventory(
        unsafeWindow.UserYou,
        CONFIG.STEAM.APP_ID,
        CONFIG.STEAM.CONTEXT_ID.toString()
      );
      const tradeOfferNote = document.getElementById(
        "trade_offer_note"
      );
      if (tradeOfferNote) {
        tradeOfferNote.value = settings.MESSAGE;
      }
      await tradeHandler.processCards();
      tradeHandler.injectPostTradeHandler();
      await tradeHandler.completeTrade();
    } catch (error) {
      if (error instanceof Error) {
        unsafeWindow.ShowAlertDialog("Trade Error", error.message);
        console.error("Trade error:", error);
      }
    } finally {
      CookieManager.restoreInventoryCookie(tradeHandler.oldCookie);
    }
  }
  async function init() {
    const settings = await SettingsManager.loadSettings();
    if (window.location.host === "steamcommunity.com") {
      if (window.location.pathname.startsWith("/tradeoffer/new/")) {
        const styleManager = new StyleManager();
        await styleManager.initialize();
      }
      if (window.location.search.includes("source=stm")) {
        await handleSteamTrade(settings);
      }
    } else if (CONFIG.WEBSITE_HOSTS.includes(window.location.host)) {
      new TradeSplitter();
      document.addEventListener("turbo:load", () => {
        if (window.location.pathname === "/userscript") {
          SettingsManager.prepareSettings(settings);
        }
      });
    }
  }
  init().catch(console.error);

})();