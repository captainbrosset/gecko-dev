/* -*- Mode: Javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {Cu} = require("chrome");

Cu.import("resource://gre/modules/Services.jsm");

var promise = require("sdk/core/promise");
var EventEmitter = require("devtools/shared/event-emitter");
var Telemetry = require("devtools/shared/telemetry");

const XULNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

/**
 * ToolSidebar provides methods to register tabs in the sidebar.
 * It's assumed that the sidebar contains a xul:tabbox.
 *
 * @param {Node} tabbox
 *  <tabbox> node;
 * @param {ToolPanel} panel
 *  Related ToolPanel instance;
 * @param {String} uid
 *  Unique ID
 * @param {Object} options
 *  - hideTabstripe: Should the tabs be hidden. Defaults to false
 *  - showAllTabsMenu: Should a drop-down menu be displayed in case tabs
 *    become hidden. Defaults to false.
 */
function ToolSidebar(tabbox, panel, uid, options={}) {
  EventEmitter.decorate(this);

  this._tabbox = tabbox;
  this._uid = uid;
  this._panelDoc = this._tabbox.ownerDocument;
  this._toolPanel = panel;
  this._options = options;

  try {
    this._width = Services.prefs.getIntPref("devtools.toolsidebar-width." + this._uid);
  } catch(e) {}

  this._telemetry = new Telemetry();

  this._tabbox.tabpanels.addEventListener("select", this, true);

  this._tabs = new Map();

  if (this._options.hideTabstripe) {
    this._tabbox.setAttribute("hidetabs", "true");
  }

  if (this._options.showAllTabsMenu) {
    this.addHiddenTabsMenu();
  }
}

exports.ToolSidebar = ToolSidebar;

ToolSidebar.prototype = {
  /**
   * Add a "..." button at the end of the tabstripe that toggles a dropdown
   * menu containing the list of hidden tabs if any become hidden due to lack
   * of room.
   */
  addHiddenTabsMenu: function ToolSidebar_addHiddenTabsMenu() {
    if (!this._allTabsMenu) {
      // Create a toolbar and insert it first in the tabbox
      let allTabsToolbar = this._panelDoc.createElementNS(XULNS, "toolbar");
      this._tabbox.insertBefore(allTabsToolbar, this._tabbox.tabs);

      // Move the tabs inside and make them flex
      allTabsToolbar.appendChild(this._tabbox.tabs);
      this._tabbox.tabs.setAttribute("flex", "1");
      this._tabbox.tabs.setAttribute("style", "overflow:hidden"); // FIXME

      // Create the dropdown menu next to the tabs
      let toolbarButton = this._panelDoc.createElementNS(XULNS, "toolbarbutton");
      toolbarButton.setAttribute("class", "devtools-sidebar-alltabs");
      toolbarButton.setAttribute("type", "menu");
      toolbarButton.setAttribute("label", "..."); // FIXME
      toolbarButton.setAttribute("tooltiptext", "other tools"); // FIXME
      allTabsToolbar.appendChild(toolbarButton);

      this._allTabsMenu = this._panelDoc.createElementNS(XULNS, "menupopup");
      toolbarButton.appendChild(this._allTabsMenu);
    }
  },

  /**
   * Register a tab. A tab is a document.
   * The document must have a title, which will be used as the name of the tab.
   *
   * @param {string} tab uniq id
   * @param {string} url
   */
  addTab: function ToolSidebar_addTab(id, url, selected=false) {
    let iframe = this._panelDoc.createElementNS(XULNS, "iframe");
    iframe.className = "iframe-" + id;
    iframe.setAttribute("flex", "1");
    iframe.setAttribute("src", url);
    iframe.tooltip = "aHTMLTooltip";

    // Creating the tab and adding it to the tabbox
    let tab = this._panelDoc.createElementNS(XULNS, "tab");
    this._tabbox.tabs.appendChild(tab);
    tab.setAttribute("label", ""); // Avoid showing "undefined" while the tab is loading

    // Adding the tab to the alltabs menu if there is one
    let menuItem;
    if (this._allTabsMenu) {
      menuItem = this._panelDoc.createElementNS(XULNS, "menuitem");
      menuItem.setAttribute("label", "");
      this._allTabsMenu.appendChild(menuItem);
      menuItem.addEventListener("click", () => this.select(id), false);
    }

    let onIFrameLoaded = function() {
      let label = iframe.contentDocument.title;

      tab.setAttribute("label", label);
      menuItem && menuItem.setAttribute("label", label);

      iframe.removeEventListener("load", onIFrameLoaded, true);
      if ("setPanel" in iframe.contentWindow) {
        iframe.contentWindow.setPanel(this._toolPanel, iframe);
      }
      this.emit(id + "-ready");
    }.bind(this);

    iframe.addEventListener("load", onIFrameLoaded, true);

    let tabpanel = this._panelDoc.createElementNS(XULNS, "tabpanel");
    tabpanel.setAttribute("id", "sidebar-panel-" + id);
    tabpanel.appendChild(iframe);
    this._tabbox.tabpanels.appendChild(tabpanel);

    this._tooltip = this._panelDoc.createElementNS(XULNS, "tooltip");
    this._tooltip.id = "aHTMLTooltip";
    tabpanel.appendChild(this._tooltip);
    this._tooltip.page = true;

    tab.linkedPanel = "sidebar-panel-" + id;

    // We store the index of this tab.
    this._tabs.set(id, tab);

    if (selected) {
      // For some reason I don't understand, if we call this.select in this
      // event loop (after inserting the tab), the tab will never get the
      // the "selected" attribute set to true.
      this._panelDoc.defaultView.setTimeout(function() {
        this.select(id);
      }.bind(this), 10);
    }

    this.emit("new-tab-registered", id);
  },

  /**
   * Select a specific tab.
   */
  select: function ToolSidebar_select(id) {
    let tab = this._tabs.get(id);
    if (tab) {
      this._tabbox.selectedTab = tab;
    }
  },

  /**
   * Return the id of the selected tab.
   */
  getCurrentTabID: function ToolSidebar_getCurrentTabID() {
    let currentID = null;
    for (let [id, tab] of this._tabs) {
      if (this._tabbox.tabs.selectedItem == tab) {
        currentID = id;
        break;
      }
    }
    return currentID;
  },

  /**
   * Returns the requested tab based on the id.
   *
   * @param String id
   *        unique id of the requested tab.
   */
  getTab: function ToolSidebar_getTab(id) {
    return this._tabbox.tabpanels.querySelector("#sidebar-panel-" + id);
  },

  /**
   * Event handler.
   */
  handleEvent: function ToolSidebar_eventHandler(event) {
    if (event.type == "select") {
      if (this._currentTool == this.getCurrentTabID()) {
        // Tool hasn't changed.
        return;
      }

      let previousTool = this._currentTool;
      this._currentTool = this.getCurrentTabID();
      if (previousTool) {
        this._telemetry.toolClosed(previousTool);
        this.emit(previousTool + "-unselected");
      }

      this._telemetry.toolOpened(this._currentTool);
      this.emit(this._currentTool + "-selected");
      this.emit("select", this._currentTool);
    }
  },

  /**
   * Toggle sidebar's visibility state.
   */
  toggle: function ToolSidebar_toggle() {
    if (this._tabbox.hasAttribute("hidden")) {
      this.show();
    } else {
      this.hide();
    }
  },

  /**
   * Show the sidebar.
   */
  show: function ToolSidebar_show() {
    if (this._width) {
      this._tabbox.width = this._width;
    }
    this._tabbox.removeAttribute("hidden");
  },

  /**
   * Show the sidebar.
   */
  hide: function ToolSidebar_hide() {
    Services.prefs.setIntPref("devtools.toolsidebar-width." + this._uid, this._tabbox.width);
    this._tabbox.setAttribute("hidden", "true");
  },

  /**
   * Return the window containing the tab content.
   */
  getWindowForTab: function ToolSidebar_getWindowForTab(id) {
    if (!this._tabs.has(id)) {
      return null;
    }

    let panel = this._panelDoc.getElementById(this._tabs.get(id).linkedPanel);
    return panel.firstChild.contentWindow;
  },

  /**
   * Clean-up.
   */
  destroy: function ToolSidebar_destroy() {
    if (this._destroyed) {
      return promise.resolve(null);
    }
    this._destroyed = true;

    Services.prefs.setIntPref("devtools.toolsidebar-width." + this._uid, this._tabbox.width);

    this._tabbox.tabpanels.removeEventListener("select", this, true);

    while (this._tabbox.tabpanels.hasChildNodes()) {
      this._tabbox.tabpanels.removeChild(this._tabbox.tabpanels.firstChild);
    }

    while (this._tabbox.tabs.hasChildNodes()) {
      this._tabbox.tabs.removeChild(this._tabbox.tabs.firstChild);
    }

    if (this._currentTool) {
      this._telemetry.toolClosed(this._currentTool);
    }

    this._tabs = null;
    this._tabbox = null;
    this._panelDoc = null;
    this._toolPanel = null;

    return promise.resolve(null);
  },
}
