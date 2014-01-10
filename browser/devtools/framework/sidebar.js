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
 * Typically, you'll want the tabbox parameter to be a XUL tabbox like this:
 *
 * <tabbox id="inspector-sidebar" handleCtrlTab="false" class="devtools-sidebar-tabs">
 *   <tabs/>
 *   <tabpanels flex="1"/>
 * </tabbox>
 *
 * The ToolSidebar API has a method to add new tabs, so the tabs and tabpanels
 * nodes can be empty. But they also can already contain items before the
 * ToolSidebar is created.
 *
 * Tabs added through the addTab method are only identified by an ID and a URL
 * which is used as the href of an iframe node that is inserted in the newly
 * created tabpanel.
 * Tabs already present before the ToolSidebar is created may contain anything.
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
 *  - disableTelemetry: By default, switching tabs on and off in the sidebar
 *    will record tool usage in telemetry, pass this option to true to avoid it.
 *
 * Events raised:
 * - new-tab-registered : After a tab has been added via addTab. The tab ID
 *   is passed with the event. This however, is raised before the tab iframe
 *   is fully loaded.
 * - <tabid>-ready : After the tab iframe has been loaded
 * - <tabid>-selected : After tab <tabid> was selected
 * - select : Same as above, but for any tab, the ID is passed with the event
 * - <tabid>-unselected : After tab <tabid> is unselected
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

  if (!options.disableTelemetry) {
    this._telemetry = new Telemetry();
  }

  this._tabbox.tabpanels.addEventListener("select", this, true);

  this._tabs = new Map();
  this.addUnknownTabs();

  if (this._options.hideTabstripe) {
    this._tabbox.setAttribute("hidetabs", "true");
  }

  if (this._options.showAllTabsMenu) {
    this.addAllTabsMenu();
  }
}

exports.ToolSidebar = ToolSidebar;

ToolSidebar.prototype = {
  /**
   * Add a "..." button at the end of the tabstripe that toggles a dropdown
   * menu containing the list of hidden tabs if any become hidden due to lack
   * of room.
   *
   * If the ToolSidebar instead was created with the "showAllTabsMenu" option
   * set to true, this is done automatically. However, if not, you may call this
   * function at any time to add the menu.
   */
  addAllTabsMenu: function() {
    if (!this._allTabsButton) {
      // Create a toolbar and insert it first in the tabbox
      let allTabsToolbar = this._panelDoc.createElementNS(XULNS, "toolbar");
      this._tabbox.insertBefore(allTabsToolbar, this._tabbox.tabs);

      // Move the tabs inside and make them flex
      allTabsToolbar.appendChild(this._tabbox.tabs);
      this._tabbox.tabs.setAttribute("flex", "1");
      this._tabbox.tabs.setAttribute("style", "overflow:hidden"); // FIXME

      // Create the dropdown menu next to the tabs
      this._allTabsButton = this._panelDoc.createElementNS(XULNS, "toolbarbutton");
      this._allTabsButton.setAttribute("class", "devtools-sidebar-alltabs");
      this._allTabsButton.setAttribute("type", "menu");
      this._allTabsButton.setAttribute("label", "..."); // FIXME
      this._allTabsButton.setAttribute("tooltiptext", "All tabs"); // FIXME
      this._allTabsButton.setAttribute("hidden", "true");
      allTabsToolbar.appendChild(this._allTabsButton);

      let menuPopup = this._panelDoc.createElementNS(XULNS, "menupopup");
      this._allTabsButton.appendChild(menuPopup);

      // Listening to tabs overflow event to toggle the alltabs button
      this._onTabBoxOverflow = this._onTabBoxOverflow.bind(this);
      this._onTabBoxUnderflow = this._onTabBoxUnderflow.bind(this);
      this._tabbox.tabs.addEventListener("overflow", this._onTabBoxOverflow, false);
      this._tabbox.tabs.addEventListener("underflow", this._onTabBoxUnderflow, false);

      // Add menuitems to the alltabs menu if there are already tabs in the
      // sidebar
      for (let [id, tab] of this._tabs) {
        this._addItemToAllTabsMenu(tab);
      }
    }
  },

  removeAllTabsMenu: function() {
    if (this._allTabsButton) {
      this._tabbox.tabs.removeEventListener("overflow", this._onTabBoxOverflow, false);
      this._tabbox.tabs.removeEventListener("underflow", this._onTabBoxUnderflow, false);

      // Moving back the tabs as a first child of the tabbox
      this._tabbox.insertBefore(this._tabbox.tabs, this._tabbox.tabpanels);
      this._tabbox.querySelector("toolbar").remove();

      this._allTabsButton = null;
    }
  },

  _onTabBoxOverflow: function() {
    this._allTabsButton.removeAttribute("hidden");
  },

  _onTabBoxUnderflow: function() {
    this._allTabsButton.setAttribute("hidden", "true");
  },

  _addItemToAllTabsMenu: function(tab) {
    if (this._allTabsButton) {
      let item = this._panelDoc.createElementNS(XULNS, "menuitem");
      item.setAttribute("label", tab.getAttribute("label"));
      this._allTabsButton.querySelector("menupopup").appendChild(item);
      item.addEventListener("click", () => {
        this._tabbox.selectedTab = tab;
      }, false);
    }
  },

  /**
   * Register a tab. A tab is a document.
   * The document must have a title, which will be used as the name of the tab.
   *
   * @param {string} tab uniq id
   * @param {string} url
   */
  addTab: function(id, url, selected=false) {
    let iframe = this._panelDoc.createElementNS(XULNS, "iframe");
    iframe.className = "iframe-" + id;
    iframe.setAttribute("flex", "1");
    iframe.setAttribute("src", url);
    iframe.tooltip = "aHTMLTooltip";

    // Creating the tab and adding it to the tabbox
    let tab = this._panelDoc.createElementNS(XULNS, "tab");
    this._tabbox.tabs.appendChild(tab);
    tab.setAttribute("label", ""); // Avoid showing "undefined" while the tab is loading

    let onIFrameLoaded = function() {
      tab.setAttribute("label", iframe.contentDocument.title);
      // Attempt to add the tab to the allTabs menu if it's there
      this._addItemToAllTabsMenu(tab);

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
   * Check for existing tabs in the markup that aren't know yet and add them
   */
  addUnknownTabs: function() {
    let knownTabs = [tab for (tab of this._tabs.values())];

    let index = 0;
    for (let tab of this._tabbox.tabs.querySelectorAll("tab")) {
      if (knownTabs.indexOf(tab) === -1) {
        let id = tab.linkedPanel || "unknown-tab-" + index;
        this._tabs.set(id, tab);
        this.emit("new-tab-registered", id);
        index ++;
      }
    }
  },

  /**
   * Select a specific tab.
   */
  select: function(id) {
    let tab = this._tabs.get(id);
    if (tab) {
      this._tabbox.selectedTab = tab;
    }
  },

  /**
   * Return the id of the selected tab.
   */
  getCurrentTabID: function() {
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
  getTab: function(id) {
    return this._tabbox.tabpanels.querySelector("#sidebar-panel-" + id);
  },

  /**
   * Event handler.
   */
  handleEvent: function(event) {
    if (event.type == "select") {
      if (this._currentTool == this.getCurrentTabID()) {
        // Tool hasn't changed.
        return;
      }

      let previousTool = this._currentTool;
      this._currentTool = this.getCurrentTabID();
      if (previousTool) {
        if (this._telemetry) {
          this._telemetry.toolClosed(previousTool);
        }
        this.emit(previousTool + "-unselected");
      }

      if (this._telemetry) {
        this._telemetry.toolOpened(this._currentTool);
      }
      this.emit(this._currentTool + "-selected");
      this.emit("select", this._currentTool);
    }
  },

  /**
   * Toggle sidebar's visibility state.
   */
  toggle: function() {
    if (this._tabbox.hasAttribute("hidden")) {
      this.show();
    } else {
      this.hide();
    }
  },

  /**
   * Show the sidebar.
   */
  show: function() {
    if (this._width) {
      this._tabbox.width = this._width;
    }
    this._tabbox.removeAttribute("hidden");
  },

  /**
   * Show the sidebar.
   */
  hide: function() {
    Services.prefs.setIntPref("devtools.toolsidebar-width." + this._uid, this._tabbox.width);
    this._tabbox.setAttribute("hidden", "true");
  },

  /**
   * Return the window containing the tab content.
   */
  getWindowForTab: function(id) {
    if (!this._tabs.has(id)) {
      return null;
    }

    let panel = this._panelDoc.getElementById(this._tabs.get(id).linkedPanel);
    return panel.firstChild.contentWindow;
  },

  /**
   * Clean-up.
   */
  destroy: function() {
    if (this._destroyed) {
      return promise.resolve(null);
    }
    this._destroyed = true;

    Services.prefs.setIntPref("devtools.toolsidebar-width." + this._uid, this._tabbox.width);

    if (this._allTabsButton) {
      this.removeAllTabsMenu();
    }

    this._tabbox.tabpanels.removeEventListener("select", this, true);

    while (this._tabbox.tabpanels.hasChildNodes()) {
      this._tabbox.tabpanels.removeChild(this._tabbox.tabpanels.firstChild);
    }

    while (this._tabbox.tabs.hasChildNodes()) {
      this._tabbox.tabs.removeChild(this._tabbox.tabs.firstChild);
    }

    if (this._currentTool && this._telemetry) {
      this._telemetry.toolClosed(this._currentTool);
      this._telemetry = null;
    }

    this._tabs = null;
    this._tabbox = null;
    this._panelDoc = null;
    this._toolPanel = null;

    return promise.resolve(null);
  }
}
