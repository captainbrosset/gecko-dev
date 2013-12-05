let {devtools} = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
let TargetFactory = devtools.TargetFactory;

function openLayoutView(cb) {
  let target = TargetFactory.forTab(gBrowser.selectedTab);
  gDevTools.showToolbox(target, "inspector").then(function(toolbox) {
    let inspector = toolbox.getCurrentPanel();
    inspector.sidebar.select("layoutview");
    inspector.sidebar.once("layoutview-ready", () => {
      cb(inspector);
    });
  });
}
