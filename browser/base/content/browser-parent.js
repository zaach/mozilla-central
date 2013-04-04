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
