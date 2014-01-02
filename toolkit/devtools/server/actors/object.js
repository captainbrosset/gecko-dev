/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2; js-indent-level: 2; -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {Cu} = require("chrome");
const {DebuggerServer} = Cu.import("resource://gre/modules/devtools/dbg-server.jsm", {});
const {DevToolsUtils} = Cu.import("resource://gre/modules/devtools/DevToolsUtils.jsm", {});
const {stringify} = require("devtools/server/actors/object-stringifier");

/**
 * Creates an actor for the specified object.
 *
 * @param aObj Debugger.Object
 *        The debuggee object.
 * @param aThreadActor ThreadActor
 *        The parent thread actor for this object.
 */
function ObjectActor(aObj, aThreadActor) {
  this.obj = aObj;
  this.threadActor = aThreadActor;
}

exports.ObjectActor = ObjectActor;

ObjectActor.prototype = {
  actorPrefix: "obj",

  /**
   * Returns a grip for this actor for returning in a protocol message.
   */
  grip: function() {
    this.threadActor._gripDepth++;

    let g = {
      "type": "object",
      "class": this.obj.class,
      "actor": this.actorID,
      "extensible": this.obj.isExtensible(),
      "frozen": this.obj.isFrozen(),
      "sealed": this.obj.isSealed()
    };

    if (this.obj.class != "DeadObject") {
      let raw = Cu.unwaiveXrays(this.obj.unsafeDereference());
      if (!DevToolsUtils.isSafeJSObject(raw)) {
        raw = null;
      }

      let previewers = DebuggerServer.ObjectActorPreviewers[this.obj.class] ||
                       DebuggerServer.ObjectActorPreviewers.Object;
      for (let fn of previewers) {
        if (fn(this, g, raw)) {
          break;
        }
      }
    }

    this.threadActor._gripDepth--;
    return g;
  },

  /**
   * Releases this actor from the pool.
   */
  release: function() {
    if (this.registeredPool.objectActors) {
      this.registeredPool.objectActors.delete(this.obj);
    }
    this.registeredPool.removeActor(this);
  },

  /**
   * Handle a protocol request to provide the definition site of this function
   * object.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onDefinitionSite: function(aRequest) {
    if (this.obj.class != "Function") {
      return {
        from: this.actorID,
        error: "objectNotFunction",
        message: this.actorID + " is not a function."
      };
    }

    if (!this.obj.script) {
      return {
        from: this.actorID,
        error: "noScript",
        message: this.actorID + " has no Debugger.Script"
      };
    }

    const generatedLocation = {
      url: this.obj.script.url,
      line: this.obj.script.startLine,
      // TODO bug 901138: use Debugger.Script.prototype.startColumn.
      column: 0
    };

    return this.threadActor.sources.getOriginalLocation(generatedLocation)
      .then(({ url, line, column }) => {
        return {
          from: this.actorID,
          url: url,
          line: line,
          column: column
        };
      });
  },

  /**
   * Handle a protocol request to provide the names of the properties defined on
   * the object and not its prototype.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onOwnPropertyNames: function(aRequest) {
    return { from: this.actorID,
             ownPropertyNames: this.obj.getOwnPropertyNames() };
  },

  /**
   * Handle a protocol request to provide the prototype and own properties of
   * the object.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onPrototypeAndProperties: function(aRequest) {
    let ownProperties = Object.create(null);
    let names;
    try {
      names = this.obj.getOwnPropertyNames();
    } catch (ex) {
      // The above can throw if this.obj points to a dead object.
      // TODO: we should use Cu.isDeadWrapper() - see bug 885800.
      return { from: this.actorID,
               prototype: this.threadActor.createValueGrip(null),
               ownProperties: ownProperties,
               safeGetterValues: Object.create(null) };
    }
    for (let name of names) {
      ownProperties[name] = this._propertyDescriptor(name);
    }
    return { from: this.actorID,
             prototype: this.threadActor.createValueGrip(this.obj.proto),
             ownProperties: ownProperties,
             safeGetterValues: this._findSafeGetterValues(ownProperties) };
  },

  /**
   * Find the safe getter values for the current Debugger.Object, |this.obj|.
   *
   * @private
   * @param object aOwnProperties
   *        The object that holds the list of known ownProperties for
   *        |this.obj|.
   * @param number [aLimit=0]
   *        Optional limit of getter values to find.
   * @return object
   *         An object that maps property names to safe getter descriptors as
   *         defined by the remote debugging protocol.
   */
  _findSafeGetterValues: function(aOwnProperties, aLimit = 0) {
    let safeGetterValues = Object.create(null);
    let obj = this.obj;
    let level = 0, i = 0;

    while (obj) {
      let getters = this._findSafeGetters(obj);
      for (let name of getters) {
        // Avoid overwriting properties from prototypes closer to this.obj. Also
        // avoid providing safeGetterValues from prototypes if property |name|
        // is already defined as an own property.
        if (name in safeGetterValues ||
            (obj != this.obj && name in aOwnProperties)) {
          continue;
        }

        let desc = null, getter = null;
        try {
          desc = obj.getOwnPropertyDescriptor(name);
          getter = desc.get;
        } catch (ex) {
          // The above can throw if the cache becomes stale.
        }
        if (!getter) {
          obj._safeGetters = null;
          continue;
        }

        let result = getter.call(this.obj);
        if (result && !("throw" in result)) {
          let getterValue = undefined;
          if ("return" in result) {
            getterValue = result.return;
          } else if ("yield" in result) {
            getterValue = result.yield;
          }
          // WebIDL attributes specified with the LenientThis extended attribute
          // return undefined and should be ignored.
          if (getterValue !== undefined) {
            safeGetterValues[name] = {
              getterValue: this.threadActor.createValueGrip(getterValue),
              getterPrototypeLevel: level,
              enumerable: desc.enumerable,
              writable: level == 0 ? desc.writable : true,
            };
            if (aLimit && ++i == aLimit) {
              break;
            }
          }
        }
      }
      if (aLimit && i == aLimit) {
        break;
      }

      obj = obj.proto;
      level++;
    }

    return safeGetterValues;
  },

  /**
   * Find the safe getters for a given Debugger.Object. Safe getters are native
   * getters which are safe to execute.
   *
   * @private
   * @param Debugger.Object aObject
   *        The Debugger.Object where you want to find safe getters.
   * @return Set
   *         A Set of names of safe getters. This result is cached for each
   *         Debugger.Object.
   */
  _findSafeGetters: function(aObject) {
    if (aObject._safeGetters) {
      return aObject._safeGetters;
    }

    let getters = new Set();
    let names = [];
    try {
      names = aObject.getOwnPropertyNames()
    } catch (ex) {
      // Calling getOwnPropertyNames() on some wrapped native prototypes is not
      // allowed: "cannot modify properties of a WrappedNative". See bug 952093.
    }

    for (let name of names) {
      let desc = null;
      try {
        desc = aObject.getOwnPropertyDescriptor(name);
      } catch (e) {
        // Calling getOwnPropertyDescriptor on wrapped native prototypes is not
        // allowed (bug 560072).
      }
      if (!desc || desc.value !== undefined || !("get" in desc)) {
        continue;
      }

      if (DevToolsUtils.hasSafeGetter(desc)) {
        getters.add(name);
      }
    }

    aObject._safeGetters = getters;
    return getters;
  },

  /**
   * Handle a protocol request to provide the prototype of the object.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onPrototype: function(aRequest) {
    return { from: this.actorID,
             prototype: this.threadActor.createValueGrip(this.obj.proto) };
  },

  /**
   * Handle a protocol request to provide the property descriptor of the
   * object's specified property.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onProperty: function(aRequest) {
    if (!aRequest.name) {
      return { error: "missingParameter",
               message: "no property name was specified" };
    }

    return { from: this.actorID,
             descriptor: this._propertyDescriptor(aRequest.name) };
  },

  /**
   * Handle a protocol request to provide the display string for the object.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onDisplayString: function(aRequest) {
    const string = stringify(this.obj);
    return { from: this.actorID,
             displayString: this.threadActor.createValueGrip(string) };
  },

  /**
   * A helper method that creates a property descriptor for the provided object,
   * properly formatted for sending in a protocol response.
   *
   * @private
   * @param string aName
   *        The property that the descriptor is generated for.
   * @param boolean [aOnlyEnumerable]
   *        Optional: true if you want a descriptor only for an enumerable
   *        property, false otherwise.
   * @return object|undefined
   *         The property descriptor, or undefined if this is not an enumerable
   *         property and aOnlyEnumerable=true.
   */
  _propertyDescriptor: function(aName, aOnlyEnumerable) {
    let desc;
    try {
      desc = this.obj.getOwnPropertyDescriptor(aName);
    } catch (e) {
      // Calling getOwnPropertyDescriptor on wrapped native prototypes is not
      // allowed (bug 560072). Inform the user with a bogus, but hopefully
      // explanatory, descriptor.
      return {
        configurable: false,
        writable: false,
        enumerable: false,
        value: e.name
      };
    }

    if (!desc || aOnlyEnumerable && !desc.enumerable) {
      return undefined;
    }

    let retval = {
      configurable: desc.configurable,
      enumerable: desc.enumerable
    };

    if ("value" in desc) {
      retval.writable = desc.writable;
      retval.value = this.threadActor.createValueGrip(desc.value);
    } else {
      if ("get" in desc) {
        retval.get = this.threadActor.createValueGrip(desc.get);
      }
      if ("set" in desc) {
        retval.set = this.threadActor.createValueGrip(desc.set);
      }
    }
    return retval;
  },

  /**
   * Handle a protocol request to provide the source code of a function.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onDecompile: function(aRequest) {
    if (this.obj.class !== "Function") {
      return { error: "objectNotFunction",
               message: "decompile request is only valid for object grips " +
                        "with a 'Function' class." };
    }

    return { from: this.actorID,
             decompiledCode: this.obj.decompile(!!aRequest.pretty) };
  },

  /**
   * Handle a protocol request to provide the parameters of a function.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onParameterNames: function(aRequest) {
    if (this.obj.class !== "Function") {
      return { error: "objectNotFunction",
               message: "'parameterNames' request is only valid for object " +
                        "grips with a 'Function' class." };
    }

    return { parameterNames: this.obj.parameterNames };
  },

  /**
   * Handle a protocol request to release a thread-lifetime grip.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onRelease: function(aRequest) {
    this.release();
    return {};
  },

  /**
   * Handle a protocol request to provide the lexical scope of a function.
   *
   * @param aRequest object
   *        The protocol request object.
   */
  onScope: function(aRequest) {
    if (this.obj.class !== "Function") {
      return { error: "objectNotFunction",
               message: "scope request is only valid for object grips with a" +
                        " 'Function' class." };
    }

    let envActor = this.threadActor.createEnvironmentActor(this.obj.environment,
                                                           this.registeredPool);
    if (!envActor) {
      return { error: "notDebuggee",
               message: "cannot access the environment of this function." };
    }

    return { from: this.actorID, scope: envActor.form() };
  }
};

ObjectActor.prototype.requestTypes = {
  "definitionSite": ObjectActor.prototype.onDefinitionSite,
  "parameterNames": ObjectActor.prototype.onParameterNames,
  "prototypeAndProperties": ObjectActor.prototype.onPrototypeAndProperties,
  "prototype": ObjectActor.prototype.onPrototype,
  "property": ObjectActor.prototype.onProperty,
  "displayString": ObjectActor.prototype.onDisplayString,
  "ownPropertyNames": ObjectActor.prototype.onOwnPropertyNames,
  "decompile": ObjectActor.prototype.onDecompile,
  "release": ObjectActor.prototype.onRelease,
  "scope": ObjectActor.prototype.onScope,
};
