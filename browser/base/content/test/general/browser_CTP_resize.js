e10sSkip("Bug 899347 - no e10s click-to-play support");

var rootDir = getRootDirectory(gTestPath);
const gTestRoot = rootDir;
const gHttpTestRoot = rootDir.replace("chrome://mochitests/content/", "http://127.0.0.1:8888/");

var gTestBrowser = null;
var gNextTest = null;
var gPluginHost = Components.classes["@mozilla.org/plugin/host;1"].getService(Components.interfaces.nsIPluginHost);

Components.utils.import("resource://gre/modules/Services.jsm");

// This listens for the next opened tab and checks it is of the right url.
// opencallback is called when the new tab is fully loaded
// closecallback is called when the tab is closed
function TabOpenListener(url, opencallback, closecallback) {
  this.url = url;
  this.opencallback = opencallback;
  this.closecallback = closecallback;

  gBrowser.tabContainer.addEventListener("TabOpen", this, false);
}

TabOpenListener.prototype = {
  url: null,
  opencallback: null,
  closecallback: null,
  tab: null,
  browser: null,

  handleEvent: function(event) {
    if (event.type == "TabOpen") {
      gBrowser.tabContainer.removeEventListener("TabOpen", this, false);
      this.tab = event.originalTarget;
      this.browser = this.tab.linkedBrowser;
      gBrowser.addEventListener("pageshow", this, false);
    } else if (event.type == "pageshow") {
      if (event.target.location.href != this.url)
        return;
      gBrowser.removeEventListener("pageshow", this, false);
      this.tab.addEventListener("TabClose", this, false);
      var url = this.browser.contentDocument.location.href;
      is(url, this.url, "Should have opened the correct tab");
      this.opencallback(this.tab, this.browser.contentWindow);
    } else if (event.type == "TabClose") {
      if (event.originalTarget != this.tab)
        return;
      this.tab.removeEventListener("TabClose", this, false);
      this.opencallback = null;
      this.tab = null;
      this.browser = null;
      // Let the window close complete
      executeSoon(this.closecallback);
      this.closecallback = null;
    }
  }
};

function test() {
  waitForExplicitFinish();
  registerCleanupFunction(function() {
    clearAllPluginPermissions();
    Services.prefs.clearUserPref("extensions.blocklist.suppressUI");
  });
  Services.prefs.setBoolPref("extensions.blocklist.suppressUI", true);

  var newTab = gBrowser.addTab();
  gBrowser.selectedTab = newTab;
  gTestBrowser = gBrowser.selectedBrowser;
  gTestBrowser.addEventListener("load", pageLoad, true);

  Services.prefs.setBoolPref("plugins.click_to_play", true);
  setTestPluginEnabledState(Ci.nsIPluginTag.STATE_CLICKTOPLAY);

  prepareTest(runAfterPluginBindingAttached(test1), gHttpTestRoot + "plugin_small.html");
}

function finishTest() {
  clearAllPluginPermissions();
  gTestBrowser.removeEventListener("load", pageLoad, true);
  gBrowser.removeCurrentTab();
  window.focus();
  finish();
}

function pageLoad() {
  // The plugin events are async dispatched and can come after the load event
  // This just allows the events to fire before we then go on to test the states
  executeSoon(gNextTest);
}

function prepareTest(nextTest, url) {
  gNextTest = nextTest;
  gTestBrowser.contentWindow.location = url;
}

// Due to layout being async, "PluginBindAttached" may trigger later.
// This wraps a function to force a layout flush, thus triggering it,
// and schedules the function execution so they're definitely executed
// afterwards.
function runAfterPluginBindingAttached(func) {
  return function() {
    let doc = gTestBrowser.contentDocument;
    let elems = doc.getElementsByTagName('embed');
    if (elems.length < 1) {
      elems = doc.getElementsByTagName('object');
    }
    elems[0].clientTop;
    executeSoon(func);
  };
}

// Test that the overlay is hidden for "small" plugin elements and is shown
// once they are resized to a size that can hold the overlay

function test1() {
  let popupNotification = PopupNotifications.getNotification("click-to-play-plugins", gTestBrowser);
  ok(popupNotification, "Test 1, Should have a click-to-play notification");

  let plugin = gTestBrowser.contentDocument.getElementById("test");
  let doc = gTestBrowser.contentDocument;
  let overlay = doc.getAnonymousElementByAttribute(plugin, "class", "mainBox");
  ok(overlay, "Test 1, Should have an overlay.");
  is(window.getComputedStyle(overlay).visibility, 'hidden', "Test 1, Overlay should be hidden");

  plugin.style.width = '300px';
  executeSoon(test2);
}

function test2() {
  let plugin = gTestBrowser.contentDocument.getElementById("test");
  let doc = gTestBrowser.contentDocument;
  let overlay = doc.getAnonymousElementByAttribute(plugin, "class", "mainBox");
  ok(overlay, "Test 2, Should have an overlay.");
  is(window.getComputedStyle(overlay).visibility, 'hidden', "Test 2, Overlay should be hidden");

  plugin.style.height = '300px';
  let condition = () => window.getComputedStyle(overlay).visibility == 'visible';
  waitForCondition(condition, test3, "Test 2, Waited too long for overlay to become visible");
}

function test3() {
  let plugin = gTestBrowser.contentDocument.getElementById("test");
  let doc = gTestBrowser.contentDocument;
  let overlay = doc.getAnonymousElementByAttribute(plugin, "class", "mainBox");
  ok(overlay, "Test 3, Should have an overlay.");
  is(window.getComputedStyle(overlay).visibility, 'visible', "Test 3, Overlay should be visible");

  plugin.style.width = '10px';
  plugin.style.height = '10px';
  let condition = () => window.getComputedStyle(overlay).visibility == 'hidden';
  waitForCondition(condition, test4, "Test 3, Waited too long for overlay to become hidden");
}

function test4() {
  let plugin = gTestBrowser.contentDocument.getElementById("test");
  let doc = gTestBrowser.contentDocument;
  let overlay = doc.getAnonymousElementByAttribute(plugin, "class", "mainBox");
  ok(overlay, "Test 4, Should have an overlay.");
  is(window.getComputedStyle(overlay).visibility, 'hidden', "Test 4, Overlay should be hidden");

  clearAllPluginPermissions();
  finishTest();
}
