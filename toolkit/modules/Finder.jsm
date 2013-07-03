// -*- Mode: javascript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

this.EXPORTED_SYMBOLS = ["Finder"];

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
const Services = Cu.import("resource://gre/modules/Services.jsm").Services;

function Finder(docShell) {
    this._fastFind = Cc["@mozilla.org/typeaheadfind;1"].createInstance(Components.interfaces.nsITypeAheadFind);
    this._fastFind.init(docShell);

    this._listeners = [];
}

Finder.prototype = {
  addResultListener: function (aListener) {
    this._listeners.push(aListener);
  },

  removeResultListener: function (aListener) {
    this._listeners = this._listeners.filter(function (l) l != aListener);
  },

  _notify: function (aResult) {
  	for (var l of this._listeners)
        l.onFindResult(aResult);
  },

  get searchString() {
    return this._fastFind.searchString;
  },

  set caseSensitive(aSensitive) {
    this._fastFind.caseSensitive = aSensitive;
  },

  fastFind: function (aSearchString, aLinksOnly) {
    Services.tm.mainThread.dispatch(() => {
        this._notify(this._fastFind.find(aSearchString, aLinksOnly));
    }, Ci.nsIThread.DISPATCH_NORMAL);
  },

  findAgain: function (aFindBackwards, aLinksOnly) {
    Services.tm.mainThread.dispatch(() => {
        this._notify(this._fastFind.findAgain(aFindBackwards, aLinksOnly));
    }, Ci.nsIThread.DISPATCH_NORMAL);
  },

  highlight: function () {
  }

}

