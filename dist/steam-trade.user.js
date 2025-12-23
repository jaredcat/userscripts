// ==UserScript==
// @name         SteamTrade Matcher Userscript
// @namespace    https://www.steamtradematcher.com
// @version      2.1.3
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
      WINDOW_DELAY: 1e3,
      INVENTORY_CHECK_INTERVAL: 500,
      INVENTORY_CHECK_TIMEOUT: 6e4,
      INVENTORY_CHECK_MAX_RETRIES: 120
    },
    COOKIE: {
      EXPIRY_DAYS: 15
    },
    DEFAULT_SETTINGS: {
      MESSAGE: "SteamTrade Matcher",
      AUTO_SEND: false,
      DO_AFTER_TRADE: "NOTHING",
      ORDER: "AS_IS",
      SIDE_BY_SIDE: false
    },
    VALIDATION: {
      DO_AFTER_TRADE_VALUES: ["NOTHING", "CLOSE_WINDOW", "CLICK_OK"],
      ORDER_VALUES: ["AS_IS", "SORT", "RANDOM"],
      MESSAGE_MAX_LENGTH: 500
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
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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
      expiry.setTime(
        expiry.getTime() + CONFIG.COOKIE.EXPIRY_DAYS * 24 * 60 * 60 * 1e3
      );
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
      this.oldCookie = CookieManager.getInventoryCookie() ?? null;
    }
    validateTrade() {
      const [yourCards, theirCards] = this.cards;
      if (!yourCards || !theirCards) {
        throw new Error("Invalid cards array");
      }
      if (this.users.length < 2) {
        throw new Error("Invalid users array");
      }
      const yourInventory = this.users[0]?.rgContexts[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory?.rgInventory || {};
      const theirInventory = this.users[1]?.rgContexts[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory?.rgInventory || {};
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
        const yourCard = yourCards[i];
        const theirCard = theirCards[i];
        if (yourCard && theirCard && validYourCards.has(yourCard) && validTheirCards.has(theirCard)) {
          matchingYourCards.push(yourCard);
          matchingTheirCards.push(theirCard);
        }
      }
      return { yours: matchingYourCards, theirs: matchingTheirCards };
    }
    processCards() {
      const cardTypes = [[], []];
      for (let i = 0; i < 2; i++) {
        const user = this.users[i];
        if (!user) {
          throw new Error(`User at index ${i} is undefined`);
        }
        const inventory = user.rgContexts[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory;
        if (!inventory) {
          throw new Error(`Inventory for user ${i} is undefined`);
        }
        inventory.BuildInventoryDisplayElements();
        const cards = this.cards[i];
        if (!cards) {
          throw new Error(`Cards array at index ${i} is undefined`);
        }
        const cardMapping = this.createCardMapping(
          inventory.rgInventory || {},
          cards
        );
        const cardTypeArray = cardTypes[i];
        if (!cardTypeArray) {
          throw new Error(`Card types array at index ${i} is undefined`);
        }
        this.addCardsToTrade(cardMapping, cards, cardTypeArray);
      }
      const yourTypes = cardTypes[0];
      const theirTypes = cardTypes[1];
      if (!yourTypes || !theirTypes) {
        throw new Error("Card types arrays are invalid");
      }
      InventoryValidator.validateCardTypes(yourTypes, theirTypes);
      return true;
    }
    createCardMapping(inventory, requestedCards) {
      const mapping = {};
      Object.values(inventory).forEach((item) => {
        if (requestedCards.includes(item.classid)) {
          if (!mapping[item.classid]) {
            mapping[item.classid] = [];
          }
          const cardArray = mapping[item.classid];
          if (cardArray) {
            cardArray.push({
              type: item.type,
              element: item.element,
              id: item.id
            });
          }
        }
      });
      if (this.settings.ORDER === "SORT") {
        Object.values(mapping).forEach((cards) => {
          if (cards) {
            cards.sort((a, b) => parseInt(b.id) - parseInt(a.id));
          }
        });
      }
      return mapping;
    }
    addCardsToTrade(mapping, requestedCards, typeArray) {
      for (const classid of requestedCards) {
        const availableCards = mapping[classid] || [];
        if (!availableCards.length) throw new Error("Missing cards");
        const index = this.settings.ORDER === "RANDOM" ? Math.floor(Math.random() * availableCards.length) : 0;
        const selectedCard = availableCards[index];
        if (!selectedCard) {
          throw new Error("Selected card is undefined");
        }
        unsafeWindow.MoveItemToTrade(selectedCard.element);
        typeArray.push(selectedCard.type);
        availableCards.splice(index, 1);
      }
    }
    injectPostTradeHandler() {
      if (this.settings.DO_AFTER_TRADE === "NOTHING") return;
      const script = document.createElement("script");
      const action = JSON.stringify(this.settings.DO_AFTER_TRADE);
      script.textContent = `
      const DO_AFTER_TRADE = ${action};
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
    completeTrade() {
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
      document.addEventListener("click", (e) => {
        const tradeButton = e.target?.closest(".user-results > .card-header > div > .btn");
        if (!tradeButton) return;
        e.preventDefault();
        void this.handleTradeClick(tradeButton);
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
        this.openTradeWindow(url, youParams, themParams, i);
        await new Promise(
          (resolve) => setTimeout(resolve, CONFIG.TRADE.WINDOW_DELAY)
        );
      }
    }
    openTradeWindow(baseUrl, youParams, themParams, startIndex) {
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
    static isValidDoAfterTrade(value) {
      return typeof value === "string" && CONFIG.VALIDATION.DO_AFTER_TRADE_VALUES.includes(value);
    }
    static isValidCardOrder(value) {
      return typeof value === "string" && CONFIG.VALIDATION.ORDER_VALUES.includes(value);
    }
    static async loadSettings() {
      const settings = { ...CONFIG.DEFAULT_SETTINGS };
      const message = await _GM.getValue(
        "MESSAGE",
        CONFIG.DEFAULT_SETTINGS.MESSAGE
      );
      if (typeof message === "string") {
        settings.MESSAGE = message;
      }
      const autoSend = await _GM.getValue(
        "AUTO_SEND",
        CONFIG.DEFAULT_SETTINGS.AUTO_SEND
      );
      if (typeof autoSend === "boolean") {
        settings.AUTO_SEND = autoSend;
      }
      const doAfterTrade = await _GM.getValue(
        "DO_AFTER_TRADE",
        CONFIG.DEFAULT_SETTINGS.DO_AFTER_TRADE
      );
      if (this.isValidDoAfterTrade(doAfterTrade)) {
        settings.DO_AFTER_TRADE = doAfterTrade;
      }
      const order = await _GM.getValue("ORDER", CONFIG.DEFAULT_SETTINGS.ORDER);
      if (this.isValidCardOrder(order)) {
        settings.ORDER = order;
      }
      const sideBySide = await _GM.getValue(
        "SIDE_BY_SIDE",
        CONFIG.DEFAULT_SETTINGS.SIDE_BY_SIDE
      );
      if (typeof sideBySide === "boolean") {
        settings.SIDE_BY_SIDE = sideBySide;
      }
      return settings;
    }
    static async saveSettings() {
      const messageInput = document.getElementById(
        "trade-message"
      );
      const message = messageInput?.value?.trim() || CONFIG.DEFAULT_SETTINGS.MESSAGE;
      if (message.length > CONFIG.VALIDATION.MESSAGE_MAX_LENGTH) {
        throw new Error(
          `Message exceeds maximum length of ${CONFIG.VALIDATION.MESSAGE_MAX_LENGTH} characters`
        );
      }
      const doAfterTradeInput = document.getElementById(
        "after-trade"
      );
      const doAfterTrade = doAfterTradeInput?.value;
      if (!this.isValidDoAfterTrade(doAfterTrade)) {
        throw new Error(`Invalid DO_AFTER_TRADE value: ${doAfterTrade}`);
      }
      const orderInput = document.getElementById(
        "cards-order"
      );
      const order = orderInput?.value;
      if (!this.isValidCardOrder(order)) {
        throw new Error(`Invalid ORDER value: ${order}`);
      }
      const autoSendInput = document.getElementById(
        "auto-send"
      );
      const autoSend = autoSendInput?.checked ?? CONFIG.DEFAULT_SETTINGS.AUTO_SEND;
      const sideBySideInput = document.getElementById(
        "side-by-side"
      );
      const sideBySide = sideBySideInput?.checked ?? CONFIG.DEFAULT_SETTINGS.SIDE_BY_SIDE;
      const settings = {
        MESSAGE: message,
        DO_AFTER_TRADE: doAfterTrade,
        ORDER: order,
        AUTO_SEND: autoSend,
        SIDE_BY_SIDE: sideBySide
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
    static createCard(title, body) {
      return `
      <div class="col-xl-6 g-3">
        <div class="card border-dark h-100">
          <div class="card-header">${escapeHtml(title)}</div>
          <div class="card-body fw-light">${body}</div>
        </div>
      </div>
    `;
    }
    static createAfterTradeCard(settings) {
      const selected = (value) => settings.DO_AFTER_TRADE === value ? "selected" : "";
      return `
      <p>Determines what happens when you complete a trade offer.</p>
      <ul>
        <li><strong>Do nothing</strong>: Will do nothing more than the normal behavior.</li>
        <li><strong>Close window</strong>: Will close the window after the trade offer is sent.</li>
        <li><strong>Click OK</strong>: Will redirect you to the trade offers recap page.</li>
      </ul>
      <div class="option-block">
        <label for="after-trade">After trade...</label>
        <select class="form-control" name="after-trade" id="after-trade">
          <option value="NOTHING" ${selected("NOTHING")}>Do Nothing</option>
          <option value="CLOSE_WINDOW" ${selected("CLOSE_WINDOW")}>Close window</option>
          <option value="CLICK_OK" ${selected("CLICK_OK")}>Click OK</option>
        </select>
      </div>`;
    }
    static createOrderCard(settings) {
      const selected = (value) => settings.ORDER === value ? "selected" : "";
      return `
      <p>Determines which card is added to trade.</p>
      <ul>
        <li><strong>Sorted</strong>: Will sort cards by their IDs before adding to trade.</li>
        <li><strong>Random</strong>: Will add cards to trade randomly.</li>
        <li><strong>As is</strong>: Script doesn't change anything in order.</li>
      </ul>
      <div class="option-block">
        <label for="cards-order">Cards order</label>
        <select class="form-control" name="cards-order" id="cards-order">
          <option value="SORT" ${selected("SORT")}>Sorted</option>
          <option value="RANDOM" ${selected("RANDOM")}>Random</option>
          <option value="AS_IS" ${selected("AS_IS")}>As is</option>
        </select>
      </div>`;
    }
    static createMessageCard(settings) {
      return `
      <p>Custom text that will be included automatically with your trade offers.</p>
      <div>
        <input type="text" name="trade-message" id="trade-message" class="form-control" value="${escapeHtml(settings.MESSAGE)}">
      </div>`;
    }
    static createCheckboxCard(id, _title, description, checked) {
      return `
      <p>${escapeHtml(description)}</p>
      <div class="checkbox form-check form-switch">
        <label for="${escapeHtml(id)}">
          <input name="${escapeHtml(id)}" class="form-check-input" id="${escapeHtml(id)}" value="1" type="checkbox" ${checked ? "checked" : ""}>
          Enable
        </label>
      </div>`;
    }
    static createActionButtons() {
      return `
      <div class="position-fixed bottom-0 end-0 m-2 col-auto g-3">
        <div class="bg-opacity-25 bg-primary p-3 border border-primary rounded">
          <button class="btn btn-secondary border-dark me-2" id="restore" type="button">Restore default settings</button>
          <button class="btn btn-primary" id="save" type="button">Save</button>
        </div>
      </div>
    `;
    }
    static bindEventHandlers() {
      document.getElementById("save")?.addEventListener("click", () => {
        SettingsManager.saveSettings().catch((error) => {
          console.error("Failed to save settings:", error);
          const alert = document.getElementById("alert");
          if (alert) {
            alert.textContent = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
            alert.className = "alert alert-danger mt-3 mb-0";
            alert.style.display = "block";
          }
        });
      });
      document.getElementById("restore")?.addEventListener("click", () => {
        void SettingsManager.restoreDefaults();
      });
    }
    static toggleVisibility() {
      const userscriptSettings = document.getElementById("userscript-settings");
      if (userscriptSettings) {
        userscriptSettings.style.display = "block";
      }
      const userscriptGuide = document.getElementById("userscript-guide");
      if (userscriptGuide) {
        userscriptGuide.style.display = "none";
      }
    }
    static prepareSettings(settings) {
      const content = document.getElementById("userscript-settings-target");
      if (!content) return;
      const cards = [
        {
          title: "Action after trade",
          body: this.createAfterTradeCard(settings)
        },
        {
          title: "Cards order",
          body: this.createOrderCard(settings)
        },
        {
          title: "Trade offer message",
          body: this.createMessageCard(settings)
        },
        {
          title: "Auto-send trade offer",
          body: this.createCheckboxCard(
            "auto-send",
            "Auto-send trade offer",
            "Makes it possible for the script to automatically send trade offers without any action.",
            settings.AUTO_SEND
          )
        },
        {
          title: "Side-by-side trade view",
          body: this.createCheckboxCard(
            "side-by-side",
            "Side-by-side trade view",
            "Changes the steam trade window so that the trade columns are side-by-side.",
            settings.SIDE_BY_SIDE
          )
        }
      ];
      const cardElements = cards.map((card) => this.createCard(card.title, card.body)).join("");
      const buttons = this.createActionButtons();
      content.innerHTML = `
        <div class="alert alert-success mt-3 mb-0" id="alert" style="display:none">Your parameters have been saved.</div>
        ${cardElements}
        ${buttons}
        ${content.innerHTML}
    `;
      this.bindEventHandlers();
      this.toggleVisibility();
    }
  }
  async function handleSteamTrade(settings) {
    const params = getUrlParameters();
    const cards = [params.you, params.them];
    const yourCards = cards[0];
    const theirCards = cards[1];
    if (!yourCards?.length || !theirCards?.length) {
      throw new Error("No cards specified in URL parameters");
    }
    CookieManager.clearInventoryCookie();
    const tradeHandler = new TradeHandler(
      settings,
      [unsafeWindow.UserYou, unsafeWindow.UserThem],
      cards
    );
    try {
      await new Promise((resolve, reject) => {
        const startTime = Date.now();
        let retryCount = 0;
        const checkInventories = () => {
          const elapsed = Date.now() - startTime;
          if (elapsed > CONFIG.TRADE.INVENTORY_CHECK_TIMEOUT) {
            reject(
              new Error(
                `Inventory loading timeout after ${CONFIG.TRADE.INVENTORY_CHECK_TIMEOUT}ms`
              )
            );
            return;
          }
          if (retryCount >= CONFIG.TRADE.INVENTORY_CHECK_MAX_RETRIES) {
            reject(
              new Error(`Inventory loading failed after ${retryCount} retries`)
            );
            return;
          }
          retryCount++;
          const users = [unsafeWindow.UserYou, unsafeWindow.UserThem];
          const ready = users.every((user) => {
            const inventory = user.rgContexts?.[CONFIG.STEAM.APP_ID]?.[CONFIG.STEAM.CONTEXT_ID]?.inventory;
            if (inventory) {
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
            setTimeout(checkInventories, CONFIG.TRADE.INVENTORY_CHECK_INTERVAL);
          }
        };
        checkInventories();
      });
      tradeHandler.validateTrade();
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
      tradeHandler.processCards();
      tradeHandler.injectPostTradeHandler();
      tradeHandler.completeTrade();
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