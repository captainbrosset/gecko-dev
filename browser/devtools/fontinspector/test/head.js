let {devtools} = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
let TargetFactory = devtools.TargetFactory;

function openFontInspector(cb) {
  let target = TargetFactory.forTab(gBrowser.selectedTab);
  gDevTools.showToolbox(target, "inspector").then(function(toolbox) {
    let inspector = toolbox.getCurrentPanel();
    inspector.sidebar.select("fontinspector");
    inspector.sidebar.once("fontinspector-ready", () => {
      cb(inspector);
    });
  });
}
