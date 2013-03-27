/* -*- Mode: javascript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */

/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Basic use:
 * let spanToEdit = document.getElementById("somespan");
 *
 * editableField({
 *   element: spanToEdit,
 *   done: function(value, commit) {
 *     if (commit) {
 *       spanToEdit.textContent = value;
 *     }
 *   },
 *   trigger: "dblclick"
 * });
 *
 * See editableField() for more options.
 */

"use strict";

const Ci = Components.interfaces;
const Cu = Components.utils;

const HTML_NS = "http://www.w3.org/1999/xhtml";

const FOCUS_FORWARD = Ci.nsIFocusManager.MOVEFOCUS_FORWARD;
const FOCUS_BACKWARD = Ci.nsIFocusManager.MOVEFOCUS_BACKWARD;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

this.EXPORTED_SYMBOLS = ["editableItem",
                         "editableField",
                         "getInplaceEditorForSpan",
                         "InplaceEditor"];

/**
 * Mark a span editable.  |editableField| will listen for the span to
 * be focused and create an InlineEditor to handle text input.
 * Changes will be committed when the InlineEditor's input is blurred
 * or dropped when the user presses escape.
 *
 * @param {object} aOptions
 *    Options for the editable field, including:
 *    {Element} element:
 *      (required) The span to be edited on focus.
 *    {function} canEdit:
 *       Will be called before creating the inplace editor.  Editor
 *       won't be created if canEdit returns false.
 *    {function} start:
 *       Will be called when the inplace editor is initialized.
 *    {function} change:
 *       Will be called when the text input changes.  Will be called
 *       with the current value of the text input.
 *    {function} done:
 *       Called when input is committed or blurred.  Called with
 *       current value and a boolean telling the caller whether to
 *       commit the change.  This function is called before the editor
 *       has been torn down.
 *    {function} destroy:
 *       Called when the editor is destroyed and has been torn down.
 *    {string} advanceChars:
 *       If any characters in advanceChars are typed, focus will advance
 *       to the next element.
 *    {boolean} stopOnReturn:
 *       If true, the return key will not advance the editor to the next
 *       focusable element.
 *    {string} trigger: The DOM event that should trigger editing,
 *      defaults to "click"
 */
function editableField(aOptions)
{
  return editableItem(aOptions, function(aElement, aEvent) {
    new InplaceEditor(aOptions, aEvent);
  });
}

/**
 * Handle events for an element that should respond to
 * clicks and sit in the editing tab order, and call
 * a callback when it is activated.
 *
 * @param {object} aOptions
 *    The options for this editor, including:
 *    {Element} element: The DOM element.
 *    {string} trigger: The DOM event that should trigger editing,
 *      defaults to "click"
 * @param {function} aCallback
 *        Called when the editor is activated.
 */
this.editableItem = function editableItem(aOptions, aCallback)
{
  let trigger = aOptions.trigger || "click"
  let element = aOptions.element;
  element.addEventListener(trigger, function(evt) {
    let win = this.ownerDocument.defaultView;
    let selection = win.getSelection();
    if (trigger != "click" || selection.isCollapsed) {
      aCallback(element, evt);
    }
    evt.stopPropagation();
  }, false);

  // If focused by means other than a click, start editing by
  // pressing enter or space.
  element.addEventListener("keypress", function(evt) {
    if (evt.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN ||
        evt.charCode === Ci.nsIDOMKeyEvent.DOM_VK_SPACE) {
      aCallback(element);
    }
  }, true);

  // Ugly workaround - the element is focused on mousedown but
  // the editor is activated on click/mouseup.  This leads
  // to an ugly flash of the focus ring before showing the editor.
  // So hide the focus ring while the mouse is down.
  element.addEventListener("mousedown", function(evt) {
    let cleanup = function() {
      element.style.removeProperty("outline-style");
      element.removeEventListener("mouseup", cleanup, false);
      element.removeEventListener("mouseout", cleanup, false);
    };
    element.style.setProperty("outline-style", "none");
    element.addEventListener("mouseup", cleanup, false);
    element.addEventListener("mouseout", cleanup, false);
  }, false);

  // Mark the element editable field for tab
  // navigation while editing.
  element._editable = true;
}

/*
 * Various API consumers (especially tests) sometimes want to grab the
 * inplaceEditor expando off span elements. However, when each global has its
 * own compartment, those expandos live on Xray wrappers that are only visible
 * within this JSM. So we provide a little workaround here.
 */
this.getInplaceEditorForSpan = function getInplaceEditorForSpan(aSpan)
{
  return aSpan.inplaceEditor;
};

function InplaceEditor(aOptions, aEvent)
{
  this.elt = aOptions.element;
  let doc = this.elt.ownerDocument;
  this.doc = doc;
  this.elt.inplaceEditor = this;

  this.change = aOptions.change;
  this.done = aOptions.done;
  this.destroy = aOptions.destroy;
  this.initial = aOptions.initial ? aOptions.initial : this.elt.textContent;
  this.multiline = aOptions.multiline || false;
  this.stopOnReturn = !!aOptions.stopOnReturn;

  this._onBlur = this._onBlur.bind(this);
  this._onKeyPress = this._onKeyPress.bind(this);
  this._onInput = this._onInput.bind(this);
  this._onKeyup = this._onKeyup.bind(this);

  this._createInput();
  this._autosize();

  // Pull out character codes for advanceChars, listing the
  // characters that should trigger a blur.
  this._advanceCharCodes = {};
  let advanceChars = aOptions.advanceChars || '';
  for (let i = 0; i < advanceChars.length; i++) {
    this._advanceCharCodes[advanceChars.charCodeAt(i)] = true;
  }

  // Hide the provided element and add our editor.
  this.originalDisplay = this.elt.style.display;
  this.elt.style.display = "none";
  this.elt.parentNode.insertBefore(this.input, this.elt);

  if (typeof(aOptions.selectAll) == "undefined" || aOptions.selectAll) {
    this.input.select();
  }
  this.input.focus();

  this.input.addEventListener("blur", this._onBlur, false);
  this.input.addEventListener("keypress", this._onKeyPress, false);
  this.input.addEventListener("input", this._onInput, false);
  this.input.addEventListener("mousedown", function(aEvt) {
                                             aEvt.stopPropagation();
                                           }, false);

  this.warning = aOptions.warning;
  this.validate = aOptions.validate;

  if (this.warning && this.validate) {
    this.input.addEventListener("keyup", this._onKeyup, false);
  }

  if (aOptions.start) {
    aOptions.start(this, aEvent);
  }
}

InplaceEditor.prototype = {
  _createInput: function InplaceEditor_createEditor()
  {
    this.input =
      this.doc.createElementNS(HTML_NS, this.multiline ? "textarea" : "input");
    this.input.inplaceEditor = this;
    this.input.classList.add("styleinspector-propertyeditor");
    this.input.value = this.initial;

    copyTextStyles(this.elt, this.input);
  },

  /**
   * Get rid of the editor.
   */
  _clear: function InplaceEditor_clear()
  {
    if (!this.input) {
      // Already cleared.
      return;
    }

    this.input.removeEventListener("blur", this._onBlur, false);
    this.input.removeEventListener("keypress", this._onKeyPress, false);
    this.input.removeEventListener("keyup", this._onKeyup, false);
    this.input.removeEventListener("oninput", this._onInput, false);
    this._stopAutosize();

    this.elt.style.display = this.originalDisplay;
    this.elt.focus();

    if (this.destroy) {
      this.destroy();
    }

    this.elt.parentNode.removeChild(this.input);
    this.input = null;

    delete this.elt.inplaceEditor;
    delete this.elt;
  },

  /**
   * Keeps the editor close to the size of its input string.  This is pretty
   * crappy, suggestions for improvement welcome.
   */
  _autosize: function InplaceEditor_autosize()
  {
    // Create a hidden, absolutely-positioned span to measure the text
    // in the input.  Boo.

    // We can't just measure the original element because a) we don't
    // change the underlying element's text ourselves (we leave that
    // up to the client), and b) without tweaking the style of the
    // original element, it might wrap differently or something.
    this._measurement =
      this.doc.createElementNS(HTML_NS, this.multiline ? "pre" : "span");
    this._measurement.className = "autosizer";
    this.elt.parentNode.appendChild(this._measurement);
    let style = this._measurement.style;
    style.visibility = "hidden";
    style.position = "absolute";
    style.top = "0";
    style.left = "0";
    copyTextStyles(this.input, this._measurement);
    this._updateSize();
  },

  /**
   * Clean up the mess created by _autosize().
   */
  _stopAutosize: function InplaceEditor_stopAutosize()
  {
    if (!this._measurement) {
      return;
    }
    this._measurement.parentNode.removeChild(this._measurement);
    delete this._measurement;
  },

  /**
   * Size the editor to fit its current contents.
   */
  _updateSize: function InplaceEditor_updateSize()
  {
    // Replace spaces with non-breaking spaces.  Otherwise setting
    // the span's textContent will collapse spaces and the measurement
    // will be wrong.
    this._measurement.textContent = this.input.value.replace(/ /g, '\u00a0');

    // We add a bit of padding to the end.  Should be enough to fit
    // any letter that could be typed, otherwise we'll scroll before
    // we get a chance to resize.  Yuck.
    let width = this._measurement.offsetWidth + 10;

    if (this.multiline) {
      // Make sure there's some content in the current line.  This is a hack to
      // account for the fact that after adding a newline the <pre> doesn't grow
      // unless there's text content on the line.
      width += 15;
      this._measurement.textContent += "M";
      this.input.style.height = this._measurement.offsetHeight + "px";
    }

    this.input.style.width = width + "px";
  },

   /**
   * Increment property values in rule view.
   *
   * @param {number} increment
   *        The amount to increase/decrease the property value.
   * @return {bool} true if value has been incremented.
   */
  _incrementValue: function InplaceEditor_incrementValue(increment)
  {
    let value = this.input.value;
    let selectionStart = this.input.selectionStart;
    let selectionEnd = this.input.selectionEnd;

    let newValue = this._incrementCSSValue(value, increment, selectionStart,
                                           selectionEnd);

    if (!newValue) {
      return false;
    }

    this.input.value = newValue.value;
    this.input.setSelectionRange(newValue.start, newValue.end);

    return true;
  },

  /**
   * Increment the property value based on the property type.
   *
   * @param {string} value
   *        Property value.
   * @param {number} increment
   *        Amount to increase/decrease the property value.
   * @param {number} selStart
   *        Starting index of the value.
   * @param {number} selEnd
   *        Ending index of the value.
   * @return {object} object with properties 'value', 'start', and 'end'.
   */
  _incrementCSSValue: function InplaceEditor_incrementCSSValue(value, increment,
                                                               selStart, selEnd)
  {
    let range = this._parseCSSValue(value, selStart);
    let type = (range && range.type) || "";
    let rawValue = (range ? value.substring(range.start, range.end) : "");
    let incrementedValue = null, selection;

    if (type === "num") {
      let newValue = this._incrementRawValue(rawValue, increment);
      if (newValue !== null) {
        incrementedValue = newValue;
        selection = [0, incrementedValue.length];
      }
    } else if (type === "hex") {
      let exprOffset = selStart - range.start;
      let exprOffsetEnd = selEnd - range.start;
      let newValue = this._incHexColor(rawValue, increment, exprOffset,
                                       exprOffsetEnd);
      if (newValue) {
        incrementedValue = newValue.value;
        selection = newValue.selection;
      }
    } else {
      let info;
      if (type === "rgb" || type === "hsl") {
        info = {};
        let part = value.substring(range.start, selStart).split(",").length - 1;
        if (part === 3) { // alpha
          info.minValue = 0;
          info.maxValue = 1;
        } else if (type === "rgb") {
          info.minValue = 0;
          info.maxValue = 255;
        } else if (part !== 0) { // hsl percentage
          info.minValue = 0;
          info.maxValue = 100;

          // select the previous number if the selection is at the end of a
          // percentage sign.
          if (value.charAt(selStart - 1) === "%") {
            --selStart;
          }
        }
      }
      return this._incrementGenericValue(value, increment, selStart, selEnd, info);
    }

    if (incrementedValue === null) {
      return;
    }

    let preRawValue = value.substr(0, range.start);
    let postRawValue = value.substr(range.end);

    return {
      value: preRawValue + incrementedValue + postRawValue,
      start: range.start + selection[0],
      end: range.start + selection[1]
    };
  },

  /**
   * Parses the property value and type.
   *
   * @param {string} value
   *        Property value.
   * @param {number} offset
   *        Starting index of value.
   * @return {object} object with properties 'value', 'start', 'end', and 'type'.
   */
   _parseCSSValue: function InplaceEditor_parseCSSValue(value, offset)
  {
    const reSplitCSS = /(url\("?[^"\)]+"?\)?)|(rgba?\([^)]*\)?)|(hsla?\([^)]*\)?)|(#[\dA-Fa-f]+)|(-?\d+(\.\d+)?(%|[a-z]{1,4})?)|"([^"]*)"?|'([^']*)'?|([^,\s\/!\(\)]+)|(!(.*)?)/;
    let start = 0;
    let m;

    // retreive values from left to right until we find the one at our offset
    while ((m = reSplitCSS.exec(value)) &&
          (m.index + m[0].length < offset)) {
      value = value.substr(m.index + m[0].length);
      start += m.index + m[0].length;
      offset -= m.index + m[0].length;
    }

    if (!m) {
      return;
    }

    let type;
    if (m[1]) {
      type = "url";
    } else if (m[2]) {
      type = "rgb";
    } else if (m[3]) {
      type = "hsl";
    } else if (m[4]) {
      type = "hex";
    } else if (m[5]) {
      type = "num";
    }

    return {
      value: m[0],
      start: start + m.index,
      end: start + m.index + m[0].length,
      type: type
    };
  },

  /**
   * Increment the property value for types other than
   * number or hex, such as rgb, hsl, and file names.
   *
   * @param {string} value
   *        Property value.
   * @param {number} increment
   *        Amount to increment/decrement.
   * @param {number} offset
   *        Starting index of the property value.
   * @param {number} offsetEnd
   *        Ending index of the property value.
   * @param {object} info
   *        Object with details about the property value.
   * @return {object} object with properties 'value', 'start', and 'end'.
   */
  _incrementGenericValue:
  function InplaceEditor_incrementGenericValue(value, increment, offset,
                                               offsetEnd, info)
  {
    // Try to find a number around the cursor to increment.
    let start, end;
    // Check if we are incrementing in a non-number context (such as a URL)
    if (/^-?[0-9.]/.test(value.substring(offset, offsetEnd)) &&
      !(/\d/.test(value.charAt(offset - 1) + value.charAt(offsetEnd)))) {
      // We have a number selected, possibly with a suffix, and we are not in
      // the disallowed case of just part of a known number being selected.
      // Use that number.
      start = offset;
      end = offsetEnd;
    } else {
      // Parse periods as belonging to the number only if we are in a known number
      // context. (This makes incrementing the 1 in 'image1.gif' work.)
      let pattern = "[" + (info ? "0-9." : "0-9") + "]*";
      let before = new RegExp(pattern + "$").exec(value.substr(0, offset))[0].length;
      let after = new RegExp("^" + pattern).exec(value.substr(offset))[0].length;

      start = offset - before;
      end = offset + after;

      // Expand the number to contain an initial minus sign if it seems
      // free-standing.
      if (value.charAt(start - 1) === "-" &&
         (start - 1 === 0 || /[ (:,='"]/.test(value.charAt(start - 2)))) {
        --start;
      }
    }

    if (start !== end)
    {
      // Include percentages as part of the incremented number (they are
      // common enough).
      if (value.charAt(end) === "%") {
        ++end;
      }

      let first = value.substr(0, start);
      let mid = value.substring(start, end);
      let last = value.substr(end);

      mid = this._incrementRawValue(mid, increment, info);

      if (mid !== null) {
        return {
          value: first + mid + last,
          start: start,
          end: start + mid.length
        };
      }
    }
  },

  /**
   * Increment the property value for numbers.
   *
   * @param {string} rawValue
   *        Raw value to increment.
   * @param {number} increment
   *        Amount to increase/decrease the raw value.
   * @param {object} info
   *        Object with info about the property value.
   * @return {string} the incremented value.
   */
  _incrementRawValue:
  function InplaceEditor_incrementRawValue(rawValue, increment, info)
  {
    let num = parseFloat(rawValue);

    if (isNaN(num)) {
      return null;
    }

    let number = /\d+(\.\d+)?/.exec(rawValue);
    let units = rawValue.substr(number.index + number[0].length);

    // avoid rounding errors
    let newValue = Math.round((num + increment) * 1000) / 1000;

    if (info && "minValue" in info) {
      newValue = Math.max(newValue, info.minValue);
    }
    if (info && "maxValue" in info) {
      newValue = Math.min(newValue, info.maxValue);
    }

    newValue = newValue.toString();

    return newValue + units;
  },

  /**
   * Increment the property value for hex.
   *
   * @param {string} value
   *        Property value.
   * @param {number} increment
   *        Amount to increase/decrease the property value.
   * @param {number} offset
   *        Starting index of the property value.
   * @param {number} offsetEnd
   *        Ending index of the property value.
   * @return {object} object with properties 'value' and 'selection'.
   */
  _incHexColor:
  function InplaceEditor_incHexColor(rawValue, increment, offset, offsetEnd)
  {
    // Return early if no part of the rawValue is selected.
    if (offsetEnd > rawValue.length && offset >= rawValue.length) {
      return;
    }
    if (offset < 1 && offsetEnd <= 1) {
      return;
    }
    // Ignore the leading #.
    rawValue = rawValue.substr(1);
    --offset;
    --offsetEnd;

    // Clamp the selection to within the actual value.
    offset = Math.max(offset, 0);
    offsetEnd = Math.min(offsetEnd, rawValue.length);
    offsetEnd = Math.max(offsetEnd, offset);

    // Normalize #ABC -> #AABBCC.
    if (rawValue.length === 3) {
      rawValue = rawValue.charAt(0) + rawValue.charAt(0) +
                 rawValue.charAt(1) + rawValue.charAt(1) +
                 rawValue.charAt(2) + rawValue.charAt(2);
      offset *= 2;
      offsetEnd *= 2;
    }

    if (rawValue.length !== 6) {
      return;
    }

    // If no selection, increment an adjacent color, preferably one to the left.
    if (offset === offsetEnd) {
      if (offset === 0) {
        offsetEnd = 1;
      } else {
        offset = offsetEnd - 1;
      }
    }

    // Make the selection cover entire parts.
    offset -= offset % 2;
    offsetEnd += offsetEnd % 2;

    // Remap the increments from [0.1, 1, 10] to [1, 1, 16].
    if (-1 < increment && increment < 1) {
      increment = (increment < 0 ? -1 : 1);
    }
    if (Math.abs(increment) === 10) {
      increment = (increment < 0 ? -16 : 16);
    }

    let isUpper = (rawValue.toUpperCase() === rawValue);

    for (let pos = offset; pos < offsetEnd; pos += 2) {
      // Increment the part in [pos, pos+2).
      let mid = rawValue.substr(pos, 2);
      let value = parseInt(mid, 16);

      if (isNaN(value)) {
        return;
      }

      mid = Math.min(Math.max(value + increment, 0), 255).toString(16);

      while (mid.length < 2) {
        mid = "0" + mid;
      }
      if (isUpper) {
        mid = mid.toUpperCase();
      }

      rawValue = rawValue.substr(0, pos) + mid + rawValue.substr(pos + 2);
    }

    return {
      value: "#" + rawValue,
      selection: [offset + 1, offsetEnd + 1]
    };
  },

  /**
   * Call the client's done handler and clear out.
   */
  _apply: function InplaceEditor_apply(aEvent)
  {
    if (this._applied) {
      return;
    }

    this._applied = true;

    if (this.done) {
      let val = this.input.value.trim();
      return this.done(this.cancelled ? this.initial : val, !this.cancelled);
    }

    return null;
  },

  /**
   * Handle loss of focus by calling done if it hasn't been called yet.
   */
  _onBlur: function InplaceEditor_onBlur(aEvent, aDoNotClear)
  {
    this._apply();
    if (!aDoNotClear) {
      this._clear();
    }
  },

  /**
   * Handle the input field's keypress event.
   */
  _onKeyPress: function InplaceEditor_onKeyPress(aEvent)
  {
    let prevent = false;

    const largeIncrement = 100;
    const mediumIncrement = 10;
    const smallIncrement = 0.1;

    let increment = 0;

    if (aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_UP
       || aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_UP) {
      increment = 1;
    } else if (aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_DOWN
       || aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN) {
      increment = -1;
    }

    if (aEvent.shiftKey && !aEvent.altKey) {
      if (aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_UP
           ||  aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN) {
        increment *= largeIncrement;
      } else {
        increment *= mediumIncrement;
      }
    } else if (aEvent.altKey && !aEvent.shiftKey) {
      increment *= smallIncrement;
    }

    if (increment && this._incrementValue(increment) ) {
      this._updateSize();
      prevent = true;
    }

    if (this.multiline &&
        aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN &&
        aEvent.shiftKey) {
      prevent = false;
    } else if (aEvent.charCode in this._advanceCharCodes
       || aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN
       || aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_TAB) {
      prevent = true;

      let direction = FOCUS_FORWARD;
      if (aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_TAB &&
          aEvent.shiftKey) {
        this.cancelled = true;
        direction = FOCUS_BACKWARD;
      }
      if (this.stopOnReturn && aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_RETURN) {
        direction = null;
      }

      let input = this.input;

      this._apply();

      if (direction !== null && focusManager.focusedElement === input) {
        // If the focused element wasn't changed by the done callback,
        // move the focus as requested.
        let next = moveFocus(this.doc.defaultView, direction);

        // If the next node to be focused has been tagged as an editable
        // node, send it a click event to trigger
        if (next && next.ownerDocument === this.doc && next._editable) {
          next.click();
        }
      }

      this._clear();
    } else if (aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_ESCAPE) {
      // Cancel and blur ourselves.
      prevent = true;
      this.cancelled = true;
      this._apply();
      this._clear();
      aEvent.stopPropagation();
    } else if (aEvent.keyCode === Ci.nsIDOMKeyEvent.DOM_VK_SPACE) {
      // No need for leading spaces here.  This is particularly
      // noticable when adding a property: it's very natural to type
      // <name>: (which advances to the next property) then spacebar.
      prevent = !this.input.value;
    }

    if (prevent) {
      aEvent.preventDefault();
    }
  },

  /**
   * Handle the input field's keyup event.
   */
  _onKeyup: function(aEvent) {
    // Validate the entered value.
    this.warning.hidden = this.validate(this.input.value);
    this._applied = false;
    this._onBlur(null, true);
  },

  /**
   * Handle changes to the input text.
   */
  _onInput: function InplaceEditor_onInput(aEvent)
  {
    // Validate the entered value.
    if (this.warning && this.validate) {
      this.warning.hidden = this.validate(this.input.value);
    }

    // Update size if we're autosizing.
    if (this._measurement) {
      this._updateSize();
    }

    // Call the user's change handler if available.
    if (this.change) {
      this.change(this.input.value.trim());
    }
  }
};

/**
 * Copy text-related styles from one element to another.
 */
function copyTextStyles(aFrom, aTo)
{
  let win = aFrom.ownerDocument.defaultView;
  let style = win.getComputedStyle(aFrom);
  aTo.style.fontFamily = style.getPropertyCSSValue("font-family").cssText;
  aTo.style.fontSize = style.getPropertyCSSValue("font-size").cssText;
  aTo.style.fontWeight = style.getPropertyCSSValue("font-weight").cssText;
  aTo.style.fontStyle = style.getPropertyCSSValue("font-style").cssText;
}

/**
 * Trigger a focus change similar to pressing tab/shift-tab.
 */
function moveFocus(aWin, aDirection)
{
  return focusManager.moveFocus(aWin, null, aDirection, 0);
}


XPCOMUtils.defineLazyGetter(this, "focusManager", function() {
  return Services.focus;
});