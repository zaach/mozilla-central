# -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

let AddonParent = {
  init: function() {
    messageManager.addMessageListener("Addon:Observe", this);
    messageManager.addMessageListener("Addon:ShouldLoad", this);

    var styleSheets = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
    var list = styleSheets.enumerateStyleSheets(1);
    while (list.hasMoreElements()) {
      var item = list.getNext();
      messageManager.broadcastAsyncMessage("StyleSheet:Load", {"href":item.href});
    }

    Services.obs.addObserver(function(sheet, topic, data) {
      messageManager.broadcastAsyncMessage("StyleSheet:Load", {"href":sheet.href});
    }, "user-sheet-added", false);
  },

  receiveMessage: function (message) {
    switch (message.name) {
    case "Addon:Observe":
      break;

    case "Addon:ShouldLoad":
      return this.shouldLoad(message.target, message.json);
      break;
    }
  },

  shouldLoad: function(target, json) {
    dump('--------------------------------- HOOK ShouldLoad ---\n');
    var js = target.jsParentUtils;
    var contentLocation = js.unwrap(json.contentLocationId);
    var requestOrigin = js.unwrap(json.requestOriginId);
    var node = js.unwrap(json.nodeId);
    var contentType = json.contentType;
    var mimeTypeGuess = json.mimeTypeGuess;

    var catMan = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
    var list = catMan.enumerateCategory("content-policy");
    while (list.hasMoreElements()) {
      var item = list.getNext();
      var service = item.QueryInterface(Components.interfaces.nsISupportsCString).toString();
      dump("!!! SERVICE: " + service + "\n");
      if (!(service in Cc))
        continue;
      var policy = Cc[service].getService(Ci.nsIContentPolicy);
      var r = Ci.nsIContentPolicy.ACCEPT;
      try {
        r = policy.shouldLoad(contentType,
                              contentLocation,
                              requestOrigin,
                              node,
                              mimeTypeGuess,
                              null);
      } catch (e) {
        if (e.name != 'NS_ERROR_XPC_CANT_PASS_CPOW_TO_NATIVE')
          throw e;
      }
      if (r != Ci.nsIContentPolicy.ACCEPT && r != 0) {
        dump("@@@@@@ service \"" + service + "\" rval: " + r + "\n");
        return r;
      }
    }

    dump('--------------------------------- ENDHOOK ShouldLoad ---\n');
    return Ci.nsIContentPolicy.ACCEPT;
  }
};

let BrowserParent = {
  init: function() {
    AddonParent.init();
    messageManager.addMessageListener("Content:Click", this);
  },

  receiveMessage: function (message) {
    switch (message.name) {
    case "Content:Click":
      openLinkIn(message.json.href, "tab", {});
      break;
    }
  }
};

function RemoteWebProgress(browser)
{
  this._browser = browser;
  this._isDocumentLoading = false;
  this._isTopLevel = false;
  this._progressListeners = [];
}

RemoteWebProgress.prototype = {
  NOTIFY_STATE_REQUEST:  0x00000001,
  NOTIFY_STATE_DOCUMENT: 0x00000002,
  NOTIFY_STATE_NETWORK:  0x00000004,
  NOTIFY_STATE_WINDOW:   0x00000008,
  NOTIFY_STATE_ALL:      0x0000000f,
  NOTIFY_PROGRESS:       0x00000010,
  NOTIFY_STATUS:         0x00000020,
  NOTIFY_SECURITY:       0x00000040,
  NOTIFY_LOCATION:       0x00000080,
  NOTIFY_REFRESH:        0x00000100,
  NOTIFY_ALL:            0x000001ff,

  _init: function WP_Init() {
    this._browser.messageManager.addMessageListener("Content:StateChange", this);
    this._browser.messageManager.addMessageListener("Content:LocationChange", this);
    this._browser.messageManager.addMessageListener("Content:SecurityChange", this);
    this._browser.messageManager.addMessageListener("Content:StatusChange", this);
  },

  get isLoadingDocument() { return this._isDocumentLoading },
  get isTopLevel() { return this._isTopLevel; },

  addProgressListener: function WP_AddProgressListener (aListener) {
    let listener = aListener.QueryInterface(Ci.nsIAsyncWebProgressListener);
    this._progressListeners.push(listener);
  },
  removeProgressListener: function WP_RemoveProgressListener (aListener) {
    this._progressListeners =
      this._progressListeners.filter(function (l) l != aListener);
  },

  receiveMessage: function WP_ReceiveMessage(aMessage) {
    this._isTopLevel = aMessage.json.isTopLevel;

    switch (aMessage.name) {
    case "Content:StateChange":
      for each (let p in this._progressListeners) {
        p.onStateChange(this, null, aMessage.json.stateFlags, aMessage.json.status);
      }
      break;

    case "Content:LocationChange":
      let loc = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService).newURI(aMessage.json.location, null, null);
      this._browser.webNavigation._currentURI = loc;
      this._browser.webNavigation.canGoBack = aMessage.json.canGoBack;
      this._browser.webNavigation.canGoForward = aMessage.json.canGoForward;
      for each (let p in this._progressListeners) {
        p.onLocationChange(this, null, loc);
      }
      break;

    case "Content:SecurityChange":
      for each (let p in this._progressListeners) {
        p.onSecurityChange(this, null, aMessage.json.state);
      }
      break;

    case "Content:StatusChange":
      for each (let p in this._progressListeners) {
        p.onStatusChange(this, null, aMessage.json.status, aMessage.json.message);
      }
      break;
    }
  }
};
