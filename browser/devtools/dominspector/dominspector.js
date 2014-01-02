/* -*- Mode: Javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource:///modules/devtools/VariablesView.jsm");
Cu.import("resource:///modules/devtools/VariablesViewController.jsm");
Cu.import("resource://gre/modules/devtools/dbg-client.jsm");
Cu.import("resource://gre/modules/devtools/Loader.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
let promise = devtools.require("sdk/core/promise");

function DomInspector(inspector, rootEl) {
  this._rootEl = rootEl;
  this._inspector = inspector;
  this.init();
}

DomInspector.prototype = {
  _currentNode: null,

  init: function() {
    this._variableView = new VariablesView(this._rootEl, {
      searchEnabled: true,
      searchPlaceholder: this.strings.GetStringFromName("dominspector.searchPlaceholder")
    });
    VariablesViewController.attach(this._variableView, {
      getObjectClient: grip => {
        return new ObjectClient(this._inspector.walker.conn, grip);
      }
    });

    this.update = this.update.bind(this);
    this._inspector.selection.on("new-node-front", this.update);
    this._inspector.sidebar.on("dominspector-selected", this.update);

    this._onMutation = this._onMutation.bind(this);
    this._inspector.on("markupmutation", this._onMutation);

    this.update();
  },

  destroy: function() {
    this._variableView.empty();
    this._variableView = null;

    this._inspector.off("markupmutation", this._onMutation);
    this._inspector.selection.off("new-node-front", this.update);
    this._inspector.sidebar.off("dominspector-selected", this.update);
    this._inspector = null;

    this._rootEl = null;
    this._currentNode = null;
  },

  isActive: function() {
    return this._inspector.sidebar &&
           this._inspector.sidebar.getCurrentTabID() == "dominspector";
  },

  isNodeSelected: function() {
    let selection = this._inspector.selection;
    return selection.nodeFront && selection.isElementNode();
  },

  _onMutation: function(event, mutations) {
    if (this._currentNode) {
      for (let mutation of mutations) {
        if (mutation.target === this._currentNode) {
          this.update();
          break;
        }
      }
    }
  },

  update: function() {
    if (!this.isActive() || !this.isNodeSelected()) {
      this._variableView.empty();
      this._currentNode = null;
      return promise.resolve();
    }

    let nodeFront = this._inspector.selection.nodeFront;
    if (this._currentNode === nodeFront) {
      return promise.resolve();
    }
    this._currentNode = nodeFront;

    return this._inspector.walker.getActorGripForNode(nodeFront).then(grip => {
      if (nodeFront === this._inspector.selection.nodeFront) {
        this._variableView.controller.setSingleVariable({
          objectActor: grip
        }, {});
      }
    });
  }
};

XPCOMUtils.defineLazyGetter(DomInspector.prototype, "strings", () => Services.strings.createBundle(
  "chrome://browser/locale/devtools/inspector.properties"
));
