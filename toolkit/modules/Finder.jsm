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

function Finder(docShell, document) {
    this._fastFind = Cc["@mozilla.org/typeaheadfind;1"].createInstance(Components.interfaces.nsITypeAheadFind);
    this._fastFind.init(docShell);

    this._docShell = docShell;
    this._document = document; // Todo: Not sure how to get this.
    this._listeners = [];

    this._previousLink = null;
    this._drewOutline = false;
}

Finder.prototype = {
  addResultListener: function (aListener) {
    this._listeners.push(aListener);
  },

  removeResultListener: function (aListener) {
    this._listeners = this._listeners.filter(function (l) l != aListener);
  },

  _notify: function (aResult, aFindBackwards, aLinksOnly) {
    this._outlineLink(aLinksOnly);

    for (var l of this._listeners)
        l.onFindResult(aResult, aFindBackwards);
  },

  get searchString() {
    return this._fastFind.searchString;
  },

  set caseSensitive(aSensitive) {
    this._fastFind.caseSensitive = aSensitive;
  },

  fastFind: function (aSearchString, aLinksOnly) {
    Services.tm.mainThread.dispatch(() => {
        let result = this._fastFind.find(aSearchString, aLinksOnly);
        this._notify(result, false, aLinksOnly);
    }, Ci.nsIThread.DISPATCH_NORMAL);
  },

  findAgain: function (aFindBackwards, aLinksOnly) {
    Services.tm.mainThread.dispatch(() => {
        let result = this._fastFind.findAgain(aFindBackwards, aLinksOnly);
        this._notify(result, aFindBackwards, aLinksOnly);
    }, Ci.nsIThread.DISPATCH_NORMAL);
  },

  highlight: function (aHighlight, aWord) {
    Services.tm.mainThread.dispatch(() => {
        let reuslt = this._highlight(aHighlight, aWord, null);
        this._notify(result, false, false);
    }, Ci.nsIThread.DISPATCH_NORMAL);
  },

  removeSelection: function() {
    let fastFind = this._fastFind;
    if (fastFind.foundEditable)
      fastFind.collapseSelection();
    else
      fastFind.setSelectionModeAndRepaint(Ci.nsISelectionController.SELECTION_ON);

    // We also drew our own outline, remove that as well.
    if (this._previousLink && this._drewOutline) {
      this._previousLink.style.outline = this._tmpOutline;
      this._previousLink.style.outlineOffset = this._tmpOutlineOffset;
    }
  },

  focusContent: function() {
    let fastFind = this._fastFind;

    try {
        // Try to find the best possible match that should recieve focus.
        if (fastFind.foundLink) {
          fastFind.foundLink.focus();
        } else if (fastFind.foundEditable) {
          fastFind.foundEditable.focus();
          fastFind.collapseSelection();
        } else {
          this._getWindow().focus()
        }
    } catch (e) {}

  },

  keyPress: function (aEvent) {
    let controller = this._getSelectionController(this._getWindow());

    switch (aEvent.keyCode) {
    case Ci.nsIDOMKeyEvent.DOM_VK_RETURN:
      if (this._fastFind.foundLink) // Todo: Handle ctrl click.
        this._fastFind.foundLink.click();
      break;
    case Ci.nsIDOMKeyEvent.DOM_VK_TAB:
      if (aEvent.shiftKey)
        this._document.commandDispatcher.rewindFocus();
      else
        this._document.commandDispatcher.advanceFocus();
      break;
    case Ci.nsIDOMKeyEvent.DOM_VK_PAGE_UP:
      controller.scrollPage(false);
      break;
    case Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN:
      controller.scrollPage(true);
      break;
    case Ci.nsIDOMKeyEvent.DOM_VK_UP:
      controller.scrollLine(false);
      break;
    case Ci.nsIDOMKeyEvent.DOM_VK_DOWN:
      controller.scrollLine(true);
      break;
    }
  },

  _getWindow: function () {
    return this._docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
  },

  _outlineLink: function (aLinksOnly) {
    let foundLink = this._fastFind.foundLink;

    if (foundLink == this._previousLink)
      return;

    if (this._previousLink && this._drewOutline) {
      // restore original outline
      this._previousLink.style.outline = this._tmpOutline;
      this._previousLink.style.outlineOffset = this._tmpOutlineOffset;
    }

    this._drewOutline = (foundLink && aLinksOnly);
    if (this._drewOutline) {
      // backup original outline
      this._tmpOutline = foundLink.style.outline;
      this._tmpOutlineOffset = foundLink.style.outlineOffset;

      // draw pseudo focus rect
      // XXX Should we change the following style for FAYT pseudo focus?
      // XXX Shouldn't we change default design if outline is visible
      //     already?
      // Don't set the outline-color, we should always use initial value.
      foundLink.style.outline = "1px dotted";
      foundLink.style.outlineOffset = "0";
    }

    this._previousLink = foundLink;
  },

  _highlight: function (aHighlight, aWord, aWindow) {
    var win = aWindow || this._getWindow();

    var result = Ci.nsITypeAheadFind.FIND_NOTFOUND;
    for (var i = 0; win.frames && i < win.frames.length; i++) {
      if (this._highlight(aHighlight, aWord, win.frames[i]))
        result = Ci.nsITypeAheadFind.FIND_FOUND;
    }

    var controller = this._getSelectionController(win);
    var doc = win.document;
    if (!controller || !doc || !doc.documentElement) {
      // Without the selection controller,
      // we are unable to (un)highlight any matches
      this._notify(result)
      return;
    }

    var body = (doc instanceof Ci.nsIDOMHTMLDocument && doc.body) ?
               doc.body : doc.documentElement;

    if (aHighlight) {
      var searchRange = doc.createRange();
       searchRange.selectNodeContents(body);

      var startPt = searchRange.cloneRange();
      startPt.collapse(true);

      var endPt = searchRange.cloneRange();
      endPt.collapse(false);

      var retRange = null;
      var finder = Components.classes["@mozilla.org/embedcomp/rangefind;1"]
                             .createInstance()
                             .QueryInterface(Components.interfaces.nsIFind);

      finder.caseSensitive = this._fastFind.caseSensitive;

      while ((retRange = finder.Find(aWord, searchRange,
                                     startPt, endPt))) {
        this._highlightRange(retRange, controller);
        startPt = retRange.cloneRange();
        startPt.collapse(false);

        result = Ci.nsITypeAheadFind.FIND_FOUND;
      }
    } else {
      // First, attempt to remove highlighting from main document
      var sel = controller.getSelection(Ci.nsISelectionController.SELECTION_FIND);
      sel.removeAllRanges();

      // Next, check our editor cache, for editors belonging to this
      // document
      if (this._editors) {
        for (var x = this._editors.length - 1; x >= 0; --x) {
          if (this._editors[x].document == doc) {
            sel = this._editors[x].selectionController
                                  .getSelection(Ci.nsISelectionController.SELECTION_FIND);
            sel.removeAllRanges();
            // We don't need to listen to this editor any more
            this._unhookListenersAtIndex(x);
          }
        }
      }
      return true;
    }

    this._notify(result);
  },

  _highlightRange: function(aRange, aController) {
    var node = aRange.startContainer;
    var controller = aController;

    var editableNode = this._getEditableNode(node);
    if (editableNode)
      controller = editableNode.editor.selectionController;

    var findSelection = controller.getSelection(Ci.nsISelectionController.SELECTION_FIND);
    findSelection.addRange(aRange);

    if (editableNode) {
      // Highlighting added, so cache this editor, and hook up listeners
      // to ensure we deal properly with edits within the highlighting
      if (!this._editors) {
        this._editors = [];
        this._stateListeners = [];
      }

      var existingIndex = this._editors.indexOf(editableNode.editor);
      if (existingIndex == -1) {
        var x = this._editors.length;
        this._editors[x] = editableNode.editor;
        this._stateListeners[x] = this._createStateListener();
        this._editors[x].addEditActionListener(this);
        this._editors[x].addDocumentStateListener(this._stateListeners[x]);
      }
    }
  },

  _getSelectionController: function(aWindow) {
    // display: none iframes don't have a selection controller, see bug 493658
    if (!aWindow.innerWidth || !aWindow.innerHeight)
      return null;

    // Yuck. See bug 138068.
    var Ci = Components.interfaces;
    var docShell = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                          .getInterface(Ci.nsIWebNavigation)
                          .QueryInterface(Ci.nsIDocShell);

    var controller = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsISelectionDisplay)
                             .QueryInterface(Ci.nsISelectionController);
    return controller;
  },

  _getEditableNode: function (aNode) {
    while (aNode) {
      if (aNode instanceof Components.interfaces.nsIDOMNSEditableElement) {
        return aNode.editor ? aNode : null;
      }
      aNode = aNode.parentNode;
    }
    return null;
  }

}
