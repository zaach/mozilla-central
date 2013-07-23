// -*- Mode: javascript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*-
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

this.EXPORTED_SYMBOLS = ["RemoteMarkupDocumentViewer"];

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function RemoteMarkupDocumentViewer(browser)
{
  this._browser = browser;
  this._fullZoom = 1;
  this._textZoom = 1;
}

RemoteMarkupDocumentViewer.prototype = {
  set textZoom(aVal) {
    dump("textZoom: " + aVal + "\n")
    this._textZoom = aVal;
    this._browser.messageManager.sendAsyncMessage("Content:TextZoom",
        {value: aVal});
  },
  get textZoom() {
    return this._textZoom;
  },

  set fullZoom(aVal) {
    dump("fullZoom: " + aVal + "\n")
    this._fullZoom = aVal;
    this._browser.messageManager.sendAsyncMessage("Content:FullZoom",
        {value: aVal});
  },
  get fullZoom() {
    return this._fullZoom;
  }
}