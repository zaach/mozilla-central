// -*- Mode: javascript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

this.EXPORTED_SYMBOLS = ["RemoteFinder"];

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function RemoteFinder(browser) {
  this._browser = browser;
  this._listeners = [];
  this._searchString = null;
}

RemoteFinder.prototype = {
  _init: function () {
    this._browser.messageManager.addMessageListener("Finder:Result", this);
  },

  _destroy: function () {
    this._browser.messageManager.removeMessageListener("Finder:Result", this);
    this._browser = null;
  },

  addResultListener: function (aListener) {
    this._listeners.push(aListener);
  },

  removeResultListener: function (aListener) {
    this._listeners = this._listeners.filter(function (l) l != aListener);
  },

  receiveMessage: function (aMessage) {
    dump(aMessage.name + " " + aMessage.json.searchString + "\n");
    this._searchString = aMessage.json.searchString;

    for (var l of this._listeners)
        l.onFindResult(aMessage.json.result, aMessage.json.findBackwards);
  },

  get searchString() {
    dump("searchString " + this._searchString + "\n");
    return this._searchString;
  },

  set caseSensitive(aSensitive) {
    this._browser.messageManager.sendAsyncMessage("Finder:CaseSensitive",
        {caseSensitive: aSensitive});
  },

  fastFind: function (aSearchString, aLinksOnly) {
    dump("FastFind: " + aSearchString + " " + aLinksOnly + "\n")
    this._browser.messageManager.sendAsyncMessage("Finder:FastFind",
        {searchString: aSearchString, linksOnly: aLinksOnly});
  },

  findAgain: function (aFindBackwards, aLinksOnly) {
    dump("FindAgain: " + aFindBackwards + " " + aLinksOnly + "\n")
    this._browser.messageManager.sendAsyncMessage("Finder:FindAgain",
        {findBackwards: aFindBackwards, linksOnly: aLinksOnly});
  },

  highlight: function (aHighlight, aWord) {
    dump("Highlight: " + aHighlight + " " + aWord + "\n")
    this._browser.messageManager.sendAsyncMessage("Finder:Highlight",
        {highlight: aHighlight, word: aWord});
  },

  removeSelection: function () {
    dump("removeSelection \n");
    this._browser.messageManager.sendAsyncMessage("Finder:RemoveSelection");
  },

  focusContent: function () {
    dump("FocusContent \n");
    this._browser.messageManager.sendAsyncMessage("Finder:FocusContent");
  },

  keyPress: function (aEvent) {
    dump("KeyPress \n");
    this._browser.messageManager.sendAsyncMessage("Finder:KeyPress",
      {keyCode: aEvent.keyCode, shiftKey: aEvent.shiftKey});
  }
}
