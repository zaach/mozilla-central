/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

let WebProgressListener = {
  init: function() {
    let webProgress = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIWebProgress);
    webProgress.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_ALL);
  },

  _requestSpec: function (aRequest) {
    if (!aRequest)
      return null;
    if (aRequest instanceof Ci.nsIChannel)
      return aRequest.QueryInterface(Ci.nsIChannel).URI.spec;
    return undefined;
  },

  _setupJSON: function setupJSON(aWebProgress, aRequest) {
    let utils = content.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIDOMWindowUtils);

    return { innerWindowId: utils.currentInnerWindowID,
	     outerWindowId: utils.outerWindowID,
	     domWindowId: aWebProgress ? aWebProgress.DOMWindowID : null,
       domWindow: aWebProgress ? wrap(aWebProgress.DOMWindow) : 0,
	     requestURI: this._requestSpec(aRequest)
	   };
  },

  onStateChange: function onStateChange(aWebProgress, aRequest, aStateFlags, aStatus) {
    let json = this._setupJSON(aWebProgress, aRequest);
    json.stateFlags = aStateFlags;
    json.status = aStatus;

    sendAsyncMessage("Content:StateChange", json);
  },

  onProgressChange: function onProgressChange(aWebProgress, aRequest, aCurSelf, aMaxSelf, aCurTotal, aMaxTotal) {
  },

  onLocationChange: function onLocationChange(aWebProgress, aRequest, aLocationURI, aFlags) {
    let spec = aLocationURI ? aLocationURI.spec : "";
    let location = spec.split("#")[0];

    let charset = content.document.characterSet;

    let json = this._setupJSON(aWebProgress, aRequest);
    json.documentURI = aWebProgress.DOMWindow.document.documentURIObject.spec;
    json.location = spec;
    json.canGoBack = docShell.canGoBack;
    json.canGoForward = docShell.canGoForward;
    json.charset = charset.toString();

    sendAsyncMessage("Content:LocationChange", json);

    let self = this;
  },

  onStatusChange: function onStatusChange(aWebProgress, aRequest, aStatus, aMessage) {
    let json = this._setupJSON(aWebProgress, aRequest);
    json.status = aStatus;
    json.message = aMessage;

    sendAsyncMessage("Content:StatusChange", json);
  },

  onSecurityChange: function onSecurityChange(aWebProgress, aRequest, aState) {
    let json = this._setupJSON(aWebProgress, aRequest);
    json.state = aState;

    sendAsyncMessage("Content:SecurityChange", json);
  },

  QueryInterface: function QueryInterface(aIID) {
    if (aIID.equals(Ci.nsIWebProgressListener) ||
        aIID.equals(Ci.nsISupportsWeakReference) ||
        aIID.equals(Ci.nsISupports)) {
        return this;
    }

    throw Components.results.NS_ERROR_NO_INTERFACE;
  }
};

WebProgressListener.init();

let DOMEvents = {
  init: function() {
    addEventListener("DOMTitleChanged", this, false);
  },

  handleEvent: function (aEvent) {
    let document = content.document;
    switch (aEvent.type) {
    case "DOMTitleChanged":
      if (!aEvent.isTrusted ||
          aEvent.target.defaultView != aEvent.target.defaultView.top)
        return;

      sendAsyncMessage("DOMTitleChanged", { title: document.title });
      break;
    }
  }
};

DOMEvents.init();

let WebNavigation =  {
  _webNavigation: docShell.QueryInterface(Ci.nsIWebNavigation),
  _timer: null,

  init: function() {
    addMessageListener("WebNavigation:GoBack", this);
    addMessageListener("WebNavigation:GoForward", this);
    addMessageListener("WebNavigation:GotoIndex", this);
    addMessageListener("WebNavigation:LoadURI", this);
    addMessageListener("WebNavigation:Reload", this);
    addMessageListener("WebNavigation:Stop", this);
  },

  receiveMessage: function(message) {
    switch (message.name) {
      case "WebNavigation:GoBack":
        this.goBack();
        break;
      case "WebNavigation:GoForward":
        this.goForward();
        break;
      case "WebNavigation:GotoIndex":
        this.gotoIndex(message);
        break;
      case "WebNavigation:LoadURI":
        this.loadURI(message);
        break;
      case "WebNavigation:Reload":
        this.reload(message);
        break;
      case "WebNavigation:Stop":
        this.stop(message);
        break;
    }
  },

  goBack: function() {
    if (this._webNavigation.canGoBack)
      this._webNavigation.goBack();
  },

  goForward: function() {
    if (this._webNavigation.canGoForward)
      this._webNavigation.goForward();
  },

  gotoIndex: function(message) {
    this._webNavigation.gotoIndex(message.index);
  },

  loadURI: function(message) {
    let flags = message.json.flags || this._webNavigation.LOAD_FLAGS_NONE;
    this._webNavigation.loadURI(message.json.uri, flags, null, null, null);
  },

  reload: function(message) {
    let flags = message.json.flags || this._webNavigation.LOAD_FLAGS_NONE;
    this._webNavigation.reload(flags);
  },

  stop: function(message) {
    let flags = message.json.flags || this._webNavigation.STOP_ALL;
    this._webNavigation.stop(flags);
  }
};

WebNavigation.init();

let Content = {
  init: function init() {
    docShell.QueryInterface(Ci.nsIDocShellHistory).useGlobalHistory = true;

    addEventListener("click", this.contentAreaClick, false);
    addMessageListener("StyleSheet:Load", this);
  },

  receiveMessage: function(aMessage) {
    let json = aMessage.json;
    switch (aMessage.name) {
    case "StyleSheet:Load":
      let uri = Services.io.newURI(json.href, null, null);
      let styleSheets = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
      if (!styleSheets.sheetRegistered(uri, Ci.nsIStyleSheetService.USER_SHEET))
	styleSheets.loadAndRegisterSheet(uri, Ci.nsIStyleSheetService.USER_SHEET);
      break;
    }
  },

  contentAreaClick: function(event) {
    if (event.button != 1)
      return;

    function isHTMLLink(aNode)
    {
      // Be consistent with what nsContextMenu.js does.
      return ((aNode instanceof content.HTMLAnchorElement && aNode.href) ||
              (aNode instanceof content.HTMLAreaElement && aNode.href) ||
              aNode instanceof content.HTMLLinkElement);
    }
    let node = event.target;
    while (node && !isHTMLLink(node)) {
      node = node.parentNode;
    }

    if (!node)
      return;

    sendAsyncMessage("Content:Click", { href: node.href });
  }
};

Content.init();

let AddonListeners = {
  classDescription: "Addon shim content policy",
  classID: Components.ID("6e869130-635c-11e2-bcfd-0800200c9a66"),
  contractID: "@mozilla.org/addonjunk/policy;1",
  xpcom_categories: ["content-policy"],

  init: function init() {
    try {
      wrap({});
    } catch (e) {
      return;
    }
    Services.obs.addObserver(this, "content-document-global-created", false);

    let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.registerFactory(this.classID, this.classDescription, this.contractID, this);

    //let xpcom_categories = ["content-policy", "net-channel-event-sinks"];
    let xpcom_categories = ["content-policy"];
    var catMan = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
    for each (let category in this.xpcom_categories)
      catMan.addCategoryEntry(category, this.contractID, this.contractID, false, true);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIContentPolicy, Ci.nsIObserver,
                                         Ci.nsIChannelEventSink, Ci.nsIFactory,
                                         Ci.nsISupportsWeakReference]),

  observe: function AddonListeners_observe(aSubject, aTopic, aData) {
    sendSyncMessage("Addon:Observe", {
      topic: aTopic,
      data: aData
    });
  },

  shouldLoad: function(contentType, contentLocation, requestOrigin, node, mimeTypeGuess, extra) {
    try {
      var contentLocationId = wrap(contentLocation);
      var requestOriginId = wrap(requestOrigin);
      var nodeId = wrap(node);
    } catch (e) {
      return Ci.nsIContentPolicy.ACCEPT;
    }
    var rval = sendSyncMessage("Addon:ShouldLoad", {
      contentType: contentType,
      contentLocationId: contentLocationId,
      requestOriginId: requestOriginId,
      nodeId: nodeId,
      mimeTypeGuess: mimeTypeGuess
    });
    if (rval == undefined)
      return Ci.nsIContentPolicy.ACCEPT;
    return rval;
  },

  shouldProcess: function(contentType, contentLocation, requestOrigin, insecNode, mimeType, extra) {
    return Ci.nsIContentPolicy.ACCEPT;
  },

  createInstance: function(outer, iid) {
    if (outer)
      throw Cr.NS_ERROR_NO_AGGREGATION;
    return this.QueryInterface(iid);
  }
};

AddonListeners.init();

addMessageListener("Browser:HideSessionRestoreButton", function (message) {
  // Hide session restore button on about:home
  let doc = content.document;
  let container;
  if (doc.documentURI.toLowerCase() == "about:home" &&
      (container = doc.getElementById("sessionRestoreContainer"))){
    container.hidden = true;
  }
});
