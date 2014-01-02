/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2; js-indent-level: 2; -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {Cu} = require("chrome");
const {DevToolsUtils} = Cu.import("resource://gre/modules/devtools/DevToolsUtils.jsm", {});

/**
 * Stringify a Debugger.Object based on its class.
 *
 * @param Debugger.Object obj
 *        The object to stringify.
 * @return String
 *         The stringification for the object.
 */
exports.stringify = function(obj) {
  if (obj.class == "DeadObject") {
    const error = new Error("Dead object encountered.");
    DevToolsUtils.reportException("stringify", error);
    return "<dead object>";
  }
  const stringifier = stringifiers[obj.class] || stringifiers.Object;
  return stringifier(obj);
}

// Used to prevent infinite recursion when an array is found inside itself.
let seen = null;

let stringifiers = {
  Error: errorStringify,
  EvalError: errorStringify,
  RangeError: errorStringify,
  ReferenceError: errorStringify,
  SyntaxError: errorStringify,
  TypeError: errorStringify,
  URIError: errorStringify,
  Boolean: createBuiltinStringifier(Boolean),
  Function: createBuiltinStringifier(Function),
  Number: createBuiltinStringifier(Number),
  RegExp: createBuiltinStringifier(RegExp),
  String: createBuiltinStringifier(String),
  Object: obj => "[object " + obj.class + "]",
  Array: obj => {
    // If we're at the top level then we need to create the Set for tracking
    // previously stringified arrays.
    const topLevel = !seen;
    if (topLevel) {
      seen = new Set();
    } else if (seen.has(obj)) {
      return "";
    }

    seen.add(obj);

    const len = DevToolsUtils.getProperty(obj, "length");
    let string = "";

    // The following check is only required because the debuggee could possibly
    // be a Proxy and return any value. For normal objects, array.length is
    // always a non-negative integer.
    if (typeof len == "number" && len > 0) {
      for (let i = 0; i < len; i++) {
        const desc = obj.getOwnPropertyDescriptor(i);
        if (desc) {
          const { value } = desc;
          if (value != null) {
            string += isObject(value) ? stringify(value) : value;
          }
        }

        if (i < len - 1) {
          string += ",";
        }
      }
    }

    if (topLevel) {
      seen = null;
    }

    return string;
  },
  DOMException: obj => {
    const message = DevToolsUtils.getProperty(obj, "message") || "<no message>";
    const result = (+DevToolsUtils.getProperty(obj, "result")).toString(16);
    const code = DevToolsUtils.getProperty(obj, "code");
    const name = DevToolsUtils.getProperty(obj, "name") || "<unknown>";

    return '[Exception... "' + message + '" ' +
           'code: "' + code +'" ' +
           'nsresult: "0x' + result + ' (' + name + ')"]';
  }
};

/**
 * Create a function that can safely stringify Debugger.Objects of a given
 * builtin type.
 *
 * @param Function ctor
 *        The builtin class constructor.
 * @return Function
 *         The stringifier for the class.
 */
function createBuiltinStringifier(ctor) {
  return obj => ctor.prototype.toString.call(obj.unsafeDereference());
}

/**
 * Stringify a Debugger.Object-wrapped Error instance.
 *
 * @param Debugger.Object obj
 *        The object to stringify.
 * @return String
 *         The stringification of the object.
 */
function errorStringify(obj) {
  let name = DevToolsUtils.getProperty(obj, "name");
  if (name === "" || name === undefined) {
    name = obj.class;
  } else if (isObject(name)) {
    name = stringify(name);
  }

  let message = DevToolsUtils.getProperty(obj, "message");
  if (isObject(message)) {
    message = stringify(message);
  }

  if (message === "" || message === undefined) {
    return name;
  }
  return name + ": " + message;
}

/**
 * Determine if a given value is non-primitive.
 *
 * @param Any value
 *        The value to test.
 * @return Boolean
 *         Whether the value is non-primitive.
 */
function isObject(value) {
  const type = typeof value;
  return type == "object" ? value !== null : type == "function";
}
