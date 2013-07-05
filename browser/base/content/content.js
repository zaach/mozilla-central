/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import('resource://gre/modules/Services.jsm');

XPCOMUtils.defineLazyModuleGetter(this,
  "LoginManagerContent", "resource://gre/modules/LoginManagerContent.jsm");

// Bug 671101 - directly using webNavigation in this context
// causes docshells to leak
this.__defineGetter__("webNavigation", function () {
  return docShell.QueryInterface(Ci.nsIWebNavigation);
});

addMessageListener("WebNavigation:LoadURI", function (message) {
  let flags = message.json.flags || webNavigation.LOAD_FLAGS_NONE;

  webNavigation.loadURI(message.json.uri, flags, null, null, null);
});

addMessageListener("Browser:HideSessionRestoreButton", function (message) {
  // Hide session restore button on about:home
  let doc = content.document;
  let container;
  if (doc.documentURI.toLowerCase() == "about:home" &&
      (container = doc.getElementById("sessionRestoreContainer"))){
    container.hidden = true;
  }
});

addEventListener("DOMContentLoaded", function(event) {
  if (!Services.prefs.getBoolPref("browser.tabs.remote"))
    LoginManagerContent.onContentLoaded(event);
});
addEventListener("DOMAutoComplete", function(event) {
  if (!Services.prefs.getBoolPref("browser.tabs.remote"))
    LoginManagerContent.onUsernameInput(event);
});
addEventListener("blur", function(event) {
  if (!Services.prefs.getBoolPref("browser.tabs.remote"))
    LoginManagerContent.onUsernameInput(event);
});

let AboutHomeListener = {
  init: function() {
    let webProgress = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIWebProgress);
    webProgress.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_ALL);

    addMessageListener("AboutHome:Update", this);
  },

  receiveMessage: function(aMessage) {
    switch (aMessage.name) {
    case "AboutHome:Update":
      this.onUpdate(aMessage.data);
      break;
    }
  },

  onUpdate: function(aData) {
    let doc = content.document;
    if (doc.documentURI.toLowerCase() != "about:home")
      return;

    if (aData.showRestoreLastSession)
      doc.getElementById("launcher").setAttribute("session", "true");

    // Inject search engine and snippets URL.
    let docElt = doc.documentElement;
    // set the following attributes BEFORE searchEngineURL, which triggers to
    // show the snippets when it's set.
    docElt.setAttribute("snippetsURL", aData.snippetsURL);
    if (aData.showKnowYourRights) {
      docElt.setAttribute("showKnowYourRights", "true");
    }
    docElt.setAttribute("snippetsVersion", aData.snippetsVersion);

    let engine = aData.defaultSearchEngine;
    docElt.setAttribute("searchEngineName", engine.name);
    docElt.setAttribute("searchEngineURL", engine.searchURL);
  },

  onPageLoad: function(aDocument) {
    // XXX bug 738646 - when Marketplace is launched, remove this statement and
    // the hidden attribute set on the apps button in aboutHome.xhtml
    if (Services.prefs.getPrefType("browser.aboutHome.apps") == Services.prefs.PREF_BOOL &&
        Services.prefs.getBoolPref("browser.aboutHome.apps"))
      doc.getElementById("apps").removeAttribute("hidden");

    // Listen for the event that's triggered when the user changes search engine.
    // At this point we simply reload about:home to reflect the change.
    sendAsyncMessage("AboutHome:RequestUpdates");

    // Remove the observer when the page is reloaded or closed.
    aDocument.defaultView.addEventListener("pagehide", function removeObserver() {
      aDocument.defaultView.removeEventListener("pagehide", removeObserver);
      sendAsyncMessage("AboutHome:CancelUpdates");
    }, false);

    aDocument.addEventListener("AboutHomeSearchEvent", function onSearch(e) {
      sendAsyncMessage("AboutHome:Search", { name: e.detail });
    }, true, true);
  },

  onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
    let doc = aWebProgress.DOMWindow.document;
    if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP &&
        Components.isSuccessCode(aStatus) &&
        doc.documentURI.toLowerCase() == "about:home" &&
        !doc.documentElement.hasAttribute("hasBrowserHandlers")) {
      // STATE_STOP may be received twice for documents, thus store an
      // attribute to ensure handling it just once.
      doc.documentElement.setAttribute("hasBrowserHandlers", "true");
      addEventListener("click", this.onClick.bind(this), true);
      addEventListener("pagehide", function onPageHide(event) {
        if (event.target.defaultView.frameElement)
          return;
        //removeEventListener("click", this.onClick.bind(this), true);
        removeEventListener("pagehide", onPageHide, true);
        if (event.target.documentElement)
          event.target.documentElement.removeAttribute("hasBrowserHandlers");
      }, true);

      // We also want to make changes to page UI for unprivileged about pages.
      this.onPageLoad(doc);
    }
  },

  onClick: function(aEvent) {
    if (!aEvent.isTrusted || // Don't trust synthetic events
        aEvent.button == 2 || aEvent.target.localName != "button") {
      return;
    }

    let originalTarget = aEvent.originalTarget;
    let ownerDoc = originalTarget.ownerDocument;
    let elmId = originalTarget.getAttribute("id");

    switch (elmId) {
      case "restorePreviousSession":
        sendAsyncMessage("AboutHome:RestorePreviousSession");
        ownerDoc.getElementById("launcher").removeAttribute("session");
        break;

      case "downloads":
        sendAsyncMessage("AboutHome:Downloads");
        break;

      case "bookmarks":
        sendAsyncMessage("AboutHome:Bookmarks");
        break;

      case "history":
        sendAsyncMessage("AboutHome:History");
        break;

      case "apps":
        sendAsyncMessage("AboutHome:Apps");
        break;

      case "addons":
        sendAsyncMessage("AboutHome:Addons");
        break;

      case "sync":
        sendAsyncMessage("AboutHome:Sync");
        break;

      case "settings":
        sendAsyncMessage("AboutHome:Settings");
        break;
    }
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
AboutHomeListener.init();
