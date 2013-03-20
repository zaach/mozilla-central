/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/PrivateBrowsingUtils.jsm");

function contextMenuHandler(aEvent) {
  if (aEvent.type == "contextmenu") {
    let contextMenu = null;
    try {
      contextMenu = new nsContextMenu(aEvent.originalTarget);
    } catch (e) {
      dump("contextMenuHandler: " + e + "\n");
    }
    sendSyncMessage("contextmenu", { contextMenuContext: contextMenu,
                                     screenX: aEvent.screenX + 2,
                                     screenY: aEvent.screenY + 2 });
                                     // so, "screen" in this case is really
                                     // just the viewport...
                                     // XXX can do shiftKey as well!
  }
}

addEventListener("contextmenu", contextMenuHandler, false);

function nsContextMenu(aTarget) {
  this.shouldDisplay = true;
  this.initMenu(aTarget);
}

// Prototype for nsContextMenu "class."
nsContextMenu.prototype = {
  initMenu: function CM_initMenu(aTarget) {
    // Get contextual info.
    this.setTarget(aTarget);
    if (!this.shouldDisplay)
      return;

    this.hasPageMenu = false;

    this.ellipsis = "\u2026";
    this.isTextSelected = this.isTextSelection();
    this.isContentSelected = this.isContentSelection();
    this.onPlainTextLink = false;
  },

  // Set various context menu attributes based on the state of the world.
  setTarget: function (aNode) {
    const xulNS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    if (aNode.namespaceURI == xulNS ||
        aNode.nodeType == Ci.nsIDOMNode.DOCUMENT_NODE) {
      this.shouldDisplay = false;
      return;
    }

    // Initialize contextual info.
    this.onImage           = false;
    this.onLoadedImage     = false;
    this.onCompletedImage  = false;
    this.onCanvas          = false;
    this.onVideo           = false;
    this.onAudio           = false;
    this.onTextInput       = false;
    this.onKeywordField    = false;
    this.mediaURL          = "";
    this.onLink            = false;
    this.onMailtoLink      = false;
    this.onSaveableLink    = false;
    this.link              = null;
    this.linkURL           = "";
    this.linkURI           = null;
    this.linkProtocol      = "";
    this.onMathML          = false;
    this.inFrame           = false;
    this.inSyntheticDoc    = false;
    this.hasBGImage        = false;
    this.bgImageURL        = "";
    this.onEditableArea    = false;
    this.isDesignMode      = false;
    this.onCTPPlugin       = false;

    // Remember the node that was clicked.
    this.target = aNode;

    // Check if we are in a synthetic document (stand alone image, video, etc.).
    this.inSyntheticDoc =  this.target.ownerDocument.mozSyntheticDocument;
    // First, do checks for nodes that never have children.
    if (this.target.nodeType == Ci.nsIDOMNode.ELEMENT_NODE) {
      // See if the user clicked on an image.
      if (this.target instanceof Ci.nsIImageLoadingContent &&
          this.target.currentURI) {
        this.onImage = true;

        var request =
          this.target.getRequest(Ci.nsIImageLoadingContent.CURRENT_REQUEST);
        if (request && (request.imageStatus & request.STATUS_SIZE_AVAILABLE))
          this.onLoadedImage = true;
        if (request && (request.imageStatus & request.STATUS_LOAD_COMPLETE))
          this.onCompletedImage = true;

        this.mediaURL = this.target.currentURI.spec;
      }
      else if (this.target instanceof Ci.nsIDOMHTMLCanvasElement) {
        this.onCanvas = true;
      }
      else if (this.target instanceof Ci.nsIDOMHTMLVideoElement) {
        this.mediaURL = this.target.currentSrc || this.target.src;
        // Firefox always creates a HTMLVideoElement when loading an ogg file
        // directly. If the media is actually audio, be smarter and provide a
        // context menu with audio operations.
        if (this.target.readyState >= this.target.HAVE_METADATA &&
            (this.target.videoWidth == 0 || this.target.videoHeight == 0)) {
          this.onAudio = true;
        } else {
          this.onVideo = true;
        }
      }
      else if (this.target instanceof Ci.nsIDOMHTMLAudioElement) {
        this.onAudio = true;
        this.mediaURL = this.target.currentSrc || this.target.src;
      }
      else if (this.target instanceof Ci.nsIDOMHTMLInputElement ) {
        this.onTextInput = this.isTargetATextBox(this.target);
        // Allow spellchecking UI on all text and search inputs.
        if (this.onTextInput && ! this.target.readOnly &&
            (this.target.type == "text" || this.target.type == "search")) {
          this.onEditableArea = true;
          InlineSpellCheckerUI.init(this.target.QueryInterface(Ci.nsIDOMNSEditableElement).editor);
          InlineSpellCheckerUI.initFromEvent(aRangeParent, aRangeOffset);
        }
        this.onKeywordField = this.isTargetAKeywordField(this.target);
      }
      else if (this.target instanceof Ci.nsIDOMHTMLTextAreaElement) {
        this.onTextInput = true;
        if (!this.target.readOnly) {
          this.onEditableArea = true;
          InlineSpellCheckerUI.init(this.target.QueryInterface(Ci.nsIDOMNSEditableElement).editor);
          InlineSpellCheckerUI.initFromEvent(aRangeParent, aRangeOffset);
        }
      }
      else if (this.target instanceof Ci.nsIDOMHTMLHtmlElement) {
        var bodyElt = this.target.ownerDocument.body;
        if (bodyElt) {
          let computedURL;
          try {
            computedURL = this.getComputedURL(bodyElt, "background-image");
            this._hasMultipleBGImages = false;
          } catch (e) {
            this._hasMultipleBGImages = true;
          }
          if (computedURL) {
            this.hasBGImage = true;
            this.bgImageURL = makeURLAbsolute(bodyElt.baseURI,
                                              computedURL);
          }
        }
      }
    }

    // Second, bubble out, looking for items of interest that can have childen.
    // Always pick the innermost link, background image, etc.
    const XMLNS = "http://www.w3.org/XML/1998/namespace";
    var elem = this.target;
    while (elem) {
      if (elem.nodeType == Ci.nsIDOMNode.ELEMENT_NODE) {
        // Link?
        if (!this.onLink &&
            // Be consistent with what hrefAndLinkNodeForClickEvent
            // does in browser.js
             ((elem instanceof Ci.nsIDOMHTMLAnchorElement && elem.href) ||
              (elem instanceof Ci.nsIDOMHTMLAreaElement && elem.href) ||
              elem instanceof Ci.nsIDOMHTMLLinkElement ||
              elem.getAttributeNS("http://www.w3.org/1999/xlink", "type") == "simple")) {

          // Target is a link or a descendant of a link.
          this.onLink = true;

          // Remember corresponding element.
          this.link = elem;
          this.linkURL = this.getLinkURL();
          this.linkURI = this.getLinkURI();
          this.linkProtocol = this.getLinkProtocol();
          this.onMailtoLink = (this.linkProtocol == "mailto");
          this.onSaveableLink = this.isLinkSaveable( this.link );
        }

        // Background image?  Don't bother if we've already found a
        // background image further down the hierarchy.  Otherwise,
        // we look for the computed background-image style.
        if (!this.hasBGImage &&
            !this._hasMultipleBGImages) {
          let bgImgUrl;
          try {
            bgImgUrl = this.getComputedURL(elem, "background-image");
            this._hasMultipleBGImages = false;
          } catch (e) {
            this._hasMultipleBGImages = true;
          }
          if (bgImgUrl) {
            this.hasBGImage = true;
            this.bgImageURL = makeURLAbsolute(elem.baseURI,
                                              bgImgUrl);
          }
        }
      }

      elem = elem.parentNode;
    }

    // See if the user clicked on MathML
    const NS_MathML = "http://www.w3.org/1998/Math/MathML";
    if ((this.target.nodeType == Ci.nsIDOMNode.TEXT_NODE &&
         this.target.parentNode.namespaceURI == NS_MathML)
         || (this.target.namespaceURI == NS_MathML))
      this.onMathML = true;

    // See if the user clicked in a frame.
    var docDefaultView = this.target.ownerDocument.defaultView;
    if (docDefaultView != docDefaultView.top)
      this.inFrame = true;

    // if the document is editable, show context menu like in text inputs
    if (!this.onEditableArea) {
      var win = this.target.ownerDocument.defaultView;
      if (win) {
        var isEditable = false;
        try {
          var editingSession = win.QueryInterface(Ci.nsIInterfaceRequestor)
                                  .getInterface(Ci.nsIWebNavigation)
                                  .QueryInterface(Ci.nsIInterfaceRequestor)
                                  .getInterface(Ci.nsIEditingSession);
          if (editingSession.windowIsEditable(win) &&
              this.getComputedStyle(this.target, "-moz-user-modify") == "read-write") {
            isEditable = true;
          }
        }
        catch(ex) {
          // If someone built with composer disabled, we can't get an editing session.
        }

        if (isEditable) {
          this.onTextInput       = true;
          this.onKeywordField    = false;
          this.onImage           = false;
          this.onLoadedImage     = false;
          this.onCompletedImage  = false;
          this.onMathML          = false;
          this.inFrame           = false;
          this.hasBGImage        = false;
          this.isDesignMode      = true;
          this.onEditableArea = true;
          InlineSpellCheckerUI.init(editingSession.getEditorForWindow(win));
          var canSpell = InlineSpellCheckerUI.canSpellCheck;
          InlineSpellCheckerUI.initFromEvent(aRangeParent, aRangeOffset);
          this.showItem("spell-check-enabled", canSpell);
          this.showItem("spell-separator", canSpell);
        }
      }
    }
  },

  // Returns the computed style attribute for the given element.
  getComputedStyle: function(aElem, aProp) {
    return aElem.ownerDocument
                .defaultView
                .getComputedStyle(aElem, "").getPropertyValue(aProp);
  },

  // Returns a "url"-type computed style attribute value, with the url() stripped.
  getComputedURL: function(aElem, aProp) {
    var url = aElem.ownerDocument
                   .defaultView.getComputedStyle(aElem, "")
                   .getPropertyCSSValue(aProp);
    if (url instanceof CSSValueList) {
      if (url.length != 1)
        throw "found multiple URLs";
      url = url[0];
    }
    return url.primitiveType == CSSPrimitiveValue.CSS_URI ?
           url.getStringValue() : null;
  },

  // Returns true if clicked-on link targets a resource that can be saved.
  isLinkSaveable: function(aLink) {
    // We don't do the Right Thing for news/snews yet, so turn them off
    // until we do.
    return this.linkProtocol && !(
             this.linkProtocol == "mailto"     ||
             this.linkProtocol == "javascript" ||
             this.linkProtocol == "news"       ||
             this.linkProtocol == "snews"      );
  },

  // Generate fully qualified URL for clicked-on link.
  getLinkURL: function() {
    var href = this.link.href;
    if (href)
      return href;

    href = this.link.getAttributeNS("http://www.w3.org/1999/xlink",
                                    "href");

    if (!href || !href.match(/\S/)) {
      // Without this we try to save as the current doc,
      // for example, HTML case also throws if empty
      throw "Empty href";
    }

    return makeURLAbsolute(this.link.baseURI, href);
  },

  getLinkURI: function() {
    try {
	return Services.io.newURI(this.linkURL, undefined, undefined);
    }
    catch (ex) {
     // e.g. empty URL string
    }

    return null;
  },

  getLinkProtocol: function() {
    if (this.linkURI)
      return this.linkURI.scheme; // can be |undefined|

    return null;
  },

  // Get text of link.
  linkText: function() {
    var text = gatherTextUnder(this.link);
    if (!text || !text.match(/\S/)) {
      text = this.link.getAttribute("title");
      if (!text || !text.match(/\S/)) {
        text = this.link.getAttribute("alt");
        if (!text || !text.match(/\S/))
          text = this.linkURL;
      }
    }

    return text;
  },

  // Get selected text. Only display the first 15 chars.
  isTextSelection: function() {
      return false;
    // Get 16 characters, so that we can trim the selection if it's greater
    // than 15 chars
    this.selectedText = "placeholder";

    if (!this.selectedText)
      return false;

    if (this.selectedText.length > 15)
      this.selectedText = this.selectedText.substr(0,15) + this.ellipsis;

    return true;
  },

  // Returns true if anything is selected.
  isContentSelection: function() {
    return !content.getSelection().isCollapsed;
  },

  toString: function () {
    return "contextMenu.target     = " + this.target + "\n" +
           "contextMenu.onImage    = " + this.onImage + "\n" +
           "contextMenu.onLink     = " + this.onLink + "\n" +
           "contextMenu.link       = " + this.link + "\n" +
           "contextMenu.inFrame    = " + this.inFrame + "\n" +
           "contextMenu.hasBGImage = " + this.hasBGImage + "\n";
  },

  isTargetATextBox: function(node) {
    if (node instanceof Ci.nsIDOMHTMLInputElement)
      return node.mozIsTextField(false);

    return (node instanceof Ci.nsIDOMHTMLTextAreaElement);
  },

  isTargetAKeywordField: function(aNode) {
    if (!(aNode instanceof Ci.nsIDOMHTMLInputElement))
      return false;

    var form = aNode.form;
    if (!form || aNode.type == "password")
      return false;

    var method = form.method.toUpperCase();

    // These are the following types of forms we can create keywords for:
    //
    // method   encoding type       can create keyword
    // GET      *                                 YES
    //          *                                 YES
    // POST                                       YES
    // POST     application/x-www-form-urlencoded YES
    // POST     text/plain                        NO (a little tricky to do)
    // POST     multipart/form-data               NO
    // POST     everything else                   YES
    return (method == "GET" || method == "") ||
           (form.enctype != "text/plain") && (form.enctype != "multipart/form-data");
  }
};
