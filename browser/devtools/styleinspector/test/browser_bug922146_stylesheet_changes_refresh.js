/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
 http://creativecommons.org/publicdomain/zero/1.0/ */

let doc;
let inspector;

const DOCUMENT_URL = "data:text/html," + encodeURIComponent([
  '<!DOCTYPE html>',
  '<html>',
  '<head>',
  '  <meta charset=utf-8 />',
  '  <title>Current element\'s styles should be refreshed when stylesheets are added, removed or changed</title>',
  '</head>',
  '<body>',
  '  <p>Some text</p>',
  '</body>',
  '</html>'
].join("\n"));

function test() {
  waitForExplicitFinish();

  gBrowser.selectedTab = gBrowser.addTab();
  gBrowser.selectedBrowser.addEventListener("load", function(evt) {
    gBrowser.selectedBrowser.removeEventListener(evt.type, arguments.callee,
      true);
    doc = content.document;
    waitForFocus(testRuleView, content);
  }, true);

  content.location = DOCUMENT_URL;
}

function endTests() {
  doc = inspector = null;
  gBrowser.removeCurrentTab();
  finish();
}

function testRuleView() {
  info("Testing the rule view");

  openRuleView(aInspector => {
    inspector = aInspector;
    inspector.selection.setNode(doc.querySelector("p"));
    inspector.once("inspector-updated", () => {
      changingStyleSheetsShouldUpdateRuleView();
    });
  });
}

function changingStyleSheetsShouldUpdateRuleView(index=0) {
  if (index === styleSheetChanges.length) {
    testComputedView();
  } else {
    styleSheetChanges[index]();
    inspector.once("rule-view-refreshed", () => {
      ok(true, "The rule view was refreshed after stylesheet change " + index);
      changingStyleSheetsShouldUpdateRuleView(index + 1);
    });
  }
}

function testComputedView() {
  info("Testing the computed view");

  inspector.sidebar.select("computedview");
  changingStyleSheetsShouldUpdateComputedView();
}

function changingStyleSheetsShouldUpdateComputedView(index=0) {
  if (index === styleSheetChanges.length) {
    styleSheetChangeEventsShouldWorkAfterPageReload();
  } else {
    styleSheetChanges[index]();
    inspector.once("computed-view-refreshed", () => {
      ok(true, "The computed view was refreshed after stylesheet change " + index);
      changingStyleSheetsShouldUpdateComputedView(index + 1);
    });
  }
}

function styleSheetChangeEventsShouldWorkAfterPageReload() {
  info("Reloading the page and testing again");

  let el = doc.createElement("div");
  doc.body.appendChild(el);

  gBrowser.selectedBrowser.addEventListener("load", function(evt) {
    gBrowser.selectedBrowser.removeEventListener(evt.type, arguments.callee,
      true);
    doc = content.document;
    is(doc.querySelectorAll("div").length, 0, "The page was reloaded");

    inspector.once("computed-view-refreshed", endTests);
    styleSheetChanges[0]();
  }, true);

  content.location = DOCUMENT_URL;
}

var styleSheetChanges = [
  function addStyleSheet() {
    let sheet = doc.createElement("STYLE");
    sheet.type = "text/css";
    sheet.appendChild(doc.createTextNode("p {color:red; width:200px; font:14px Arial;}"));
    doc.getElementsByTagName("HEAD")[0].appendChild(sheet);
  },
  function modifyLastStyleSheet() {
    let styles = doc.getElementsByTagName("STYLE");
    if (styles.length) {
      let sheet = styles[styles.length - 1];
      sheet.appendChild(doc.createTextNode("p {color:blue; width:100px; font:12px Verdana;}"));
    }
  },
  function removeLastStyleSheet() {
    let styles = doc.getElementsByTagName("STYLE");
    if (styles.length) {
      styles[styles.length - 1].remove();
    }
  }
];
