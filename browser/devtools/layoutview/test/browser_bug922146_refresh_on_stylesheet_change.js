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
  '  <title>Current element\'s layout should be refreshed when stylesheets are added, removed or changed</title>',
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
    waitForFocus(testLayoutView, content);
  }, true);

  content.location = DOCUMENT_URL;
}

function endTests() {
  doc = inspector = null;
  gBrowser.removeCurrentTab();
  finish();
}

function testLayoutView() {
  info("Testing the layout view");
  openLayoutView(aInspector => {
    inspector = aInspector;
    inspector.selection.setNode(doc.querySelector("p"));
    inspector.once("inspector-updated", () => {
      changingStyleSheetsShouldUpdateLayoutView();
    });
  });
}

function changingStyleSheetsShouldUpdateLayoutView(index=0) {
  if (index === styleSheetChanges.length) {
    endTests();
  } else {
    styleSheetChanges[index]();
    inspector.once("layoutview-updated", () => {
      ok(true, "The layout view was refreshed after stylesheet change " + index);
      changingStyleSheetsShouldUpdateLayoutView(index + 1);
    });
  }
}

var styleSheetChanges = [
  function addStyleSheet() {
    let sheet = doc.createElement("STYLE");
    sheet.type = "text/css";
    sheet.appendChild(doc.createTextNode("p {width: 300px;}"));
    doc.getElementsByTagName("HEAD")[0].appendChild(sheet);
  },
  function modifyLastStyleSheet() {
    let styles = doc.getElementsByTagName("STYLE");
    if (styles.length) {
      let sheet = styles[styles.length - 1];
      sheet.appendChild(doc.createTextNode("p {width: 200px;}"));
    }
  },
  function removeLastStyleSheet() {
    let styles = doc.getElementsByTagName("STYLE");
    if (styles.length) {
      styles[styles.length - 1].remove();
    }
  }
];
