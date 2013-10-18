/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://services-sync/util.js");

const SYNC_PREFS_BRANCH = "services.sync.";


/**
 * Sync's XPCOM service.
 *
 * It is named "Weave" for historical reasons.
 *
 * It's worth noting how Sync is lazily loaded. We register a timer that
 * loads Sync a few seconds after app startup. This is so Sync does not
 * adversely affect application start time.
 *
 * If Sync is not configured, no extra Sync code is loaded. If an
 * external component (say the UI) needs to interact with Sync, it
 * should do something like the following:
 *
 * // 1. Grab a handle to the Sync XPCOM service.
 * let service = Cc["@mozilla.org/weave/service;1"]
 *                 .getService(Components.interfaces.nsISupports)
 *                 .wrappedJSObject;
 *
 * // 2. Check if the service has been initialized.
 * if (service.ready) {
 *   // You are free to interact with "Weave." objects.
 *   return;
 * }
 *
 * // 3. Install "ready" listener.
 * Services.obs.addObserver(function onReady() {
 *   Services.obs.removeObserver(onReady, "weave:service:ready");
 *
 *   // You are free to interact with "Weave." objects.
 * }, "weave:service:ready", false);
 *
 * // 4. Trigger loading of Sync.
 * service.ensureLoaded();
 */
function WeaveService() {
  this.wrappedJSObject = this;
  this.ready = false;
}
WeaveService.prototype = {
  classID: Components.ID("{74b89fb0-f200-4ae8-a3ec-dd164117f6de}"),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsISupportsWeakReference]),

  ensureLoaded: function () {
    Components.utils.import("resource://services-sync/main.js");

    // Side-effect of accessing the service is that it is instantiated.
    Weave.Service;
  },

  observe: function (subject, topic, data) {
    switch (topic) {
    case "app-startup":
      let os = Cc["@mozilla.org/observer-service;1"].
               getService(Ci.nsIObserverService);
      os.addObserver(this, "final-ui-startup", true);
      break;

    case "final-ui-startup":
      // Force Weave service to load if it hasn't triggered from overlays
      this.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      this.timer.initWithCallback({
        notify: function() {
          // We only load more if it looks like Sync is configured.
          let prefs = Services.prefs.getBranch(SYNC_PREFS_BRANCH);
          if (!prefs.prefHasUserValue("username")) {
            return;
          }

          // We have a username. So, do a more thorough check. This will
          // import a number of modules and thus increase memory
          // accordingly. We could potentially copy code performed by
          // this check into this file if our above code is yielding too
          // many false positives.
          Components.utils.import("resource://services-sync/main.js");
          dump("getting signed in user\n");
          // FxAccounts imports lots of stuff, so only do this as we need it
          Cu.import("resource://gre/modules/FxAccounts.jsm");

          // This isn't quite sufficient here to handle all the cases. Cases
          // we need to handle:
          //  - User is signed in to FxAccounts, btu hasn't set up sync.
          fxAccounts.getSignedInUser().then(
            (accountData) => {
              if (accountData) {
                // init the identity module with any account data from
                // firefox accounts
                Weave.Service.identity.initWithLoggedInUser().then(function () {
                  // Set the cluster data that we got from the token
                  Weave.Service.clusterURL = Weave.Service.identity.clusterURL;
                  // checkSetup() will check the auth state of the identity module
                  // and records that status in Weave.Status
                  if (Weave.Status.checkSetup() != Weave.CLIENT_NOT_CONFIGURED) {
                    // This makes sure that Weave.Service is loaded
                    Svc.Obs.notify("weave:service:setup-complete");
                    this.ensureLoaded();
                  }
                }.bind(this));
              } else {
                dump("No logged in user\n");
              }
            },
            (err) => {dump("err in getting logged in account "+err.message)}
          ).then(null, (err) => {dump("err in processing logged in account "+err.message)})
        }.bind(this)
      }, 1000, Ci.nsITimer.TYPE_ONE_SHOT);
      break;
    }
  }
};

function AboutWeaveLog() {}
AboutWeaveLog.prototype = {
  classID: Components.ID("{d28f8a0b-95da-48f4-b712-caf37097be41}"),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule,
                                         Ci.nsISupportsWeakReference]),

  getURIFlags: function(aURI) {
    return 0;
  },

  newChannel: function(aURI) {
    let dir = FileUtils.getDir("ProfD", ["weave", "logs"], true);
    let uri = Services.io.newFileURI(dir);
    let channel = Services.io.newChannelFromURI(uri);
    channel.originalURI = aURI;

    // Ensure that the about page has the same privileges as a regular directory
    // view. That way links to files can be opened.
    let ssm = Cc["@mozilla.org/scriptsecuritymanager;1"]
                .getService(Ci.nsIScriptSecurityManager);
    let principal = ssm.getNoAppCodebasePrincipal(uri);
    channel.owner = principal;
    return channel;
  }
};

const components = [WeaveService, AboutWeaveLog];
this.NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
