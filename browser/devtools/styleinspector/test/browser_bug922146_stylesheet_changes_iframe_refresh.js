/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* Any copyright is dedicated to the Public Domain.
 http://creativecommons.org/publicdomain/zero/1.0/ */

let doc;
let iframeDoc;
let inspector;

const DOCUMENT_URL = "data:text/html," + encodeURIComponent([
  '<!DOCTYPE html>',
  '<html>',
  '<head>',
  '  <meta charset=utf-8 />',
  '  <title>Current element\'s styles should be refreshed when stylesheets are added, removed or changed, even if that element is in an iframe</title>',
  '</head>',
  '<body>',
  '  <p>Some content in the root doc</p>',
  '  <iframe src="data:text/html,<p>Some content in the iframe doc</p>"></iframe>',
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
    iframeDoc = doc.querySelector("iframe").contentDocument;
    waitForFocus(testNestedIframeElement, content);
  }, true);

  content.location = DOCUMENT_URL;
}

function endTests() {
  doc = iframeDoc = inspector = null;
  gBrowser.removeCurrentTab();
  finish();
}

function testNestedIframeElement() {
  info("Testing the element nested in the iframe");

  openRuleView(aInspector => {
    inspector = aInspector;
    inspector.selection.setNode(iframeDoc.querySelector("p"));
    inspector.once("inspector-updated", () => {
      // Add a stylesheet to the iframe doc and see if the event gets fired
      addStyleSheet(iframeDoc);
      inspector.once("rule-view-refreshed", () => {
        ok(true, "The rule view was refreshed after stylesheet added in iframe");
        testRootDocElement();
      });
    });
  });
}

function testRootDocElement() {
  info("Testing the element in the root doc");

  inspector.selection.setNode(doc.querySelector("p"));
  inspector.once("inspector-updated", () => {
    // Add a stylesheet to the iframe doc and see if the event gets fired
    addStyleSheet(doc);
    inspector.once("rule-view-refreshed", () => {
      ok(true, "The rule view was refreshed after stylesheet added in iframe");
      endTests();
    });
  });
}

function addStyleSheet(doc) {
  let sheet = doc.createElement("STYLE");
  sheet.type = "text/css";
  sheet.appendChild(doc.createTextNode("p {color:red; width:200px; font:14px Arial;}"));
  doc.getElementsByTagName("HEAD")[0].appendChild(sheet);
}