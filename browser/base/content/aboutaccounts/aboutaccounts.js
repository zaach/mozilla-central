/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FxAccounts.jsm");
Cu.import("resource://services-sync/main.js");
Cu.import("resource://services-sync/util.js");

function log(msg) {
  dump("FXA: " + msg + "\n");
};

function error(msg) {
  console.log("Firefox Account Error: " + msg + "\n");
};

let wrapper = {
  iframe: null,

  init: function () {
    let iframe = document.getElementById("remote");
    this.iframe = iframe;
    iframe.addEventListener("load", this);

    try {
      iframe.src = fxAccounts.getAccountsURI();
    } catch (e) {
      error("Couldn't init Firefox Account wrapper: " + e.message);
    }
  },

  handleEvent: function (evt) {
    switch (evt.type) {
      case "load":
        this.iframe.contentWindow.addEventListener("FirefoxAccountsCommand", this);
        this.iframe.removeEventListener("load", this);
        break;
      case "FirefoxAccountsCommand":
        this.handleRemoteCommand(evt);
        break;
    }
  },

  /**
   * onLogin handler receives user credentials from the jelly after a
   * sucessful login and stores it in the fxaccounts service
   *
   * @param accountData the user's account data and credentials
   */
  onLogin: function (accountData) {
    log("Received: 'login'. Data:" + JSON.stringify(accountData));

    fxAccounts.setSignedInUser(accountData).then(
      () => {
        accountData = JSON.parse(JSON.stringify(accountData));

        Weave.Service.identity.initWithLoggedInUser().then(() => {
          // Set the cluster data that we got from the token
          Weave.Service.clusterURL = Weave.Service.identity.clusterURL;
          // Tell sync that if this is a first sync, it should try and sync the
          // server data with what is on the client - despite the name implying
          // otherwise, this is what "resetClient" does.
          Weave.Svc.Prefs.set("firstSync", "resetClient");

          Weave.Service.login();

          // and off we go...
          Weave.Utils.nextTick(Weave.Service.sync, Weave.Service);
          log("sync setup complete");

          window.location = "about:sync-progress";

          this.injectData("message", { status: "login" });
        }).then(null, Cu.reportError);
      },
      (err) => this.injectData("message", { status: "error", error: err })
    );
  },

  /**
   * onVerified handler receives user credentials from the jelly after
   * sucessful account creation and email verification
   * and stores it in the fxaccounts service
   *
   * @param accountData the user's account data and credentials
   */
  onVerified: function (accountData) {
    log("Received: 'verified'. Data:" + JSON.stringify(accountData));

    fxAccounts.setSignedInUser(accountData).then(
      () => this.injectData("message", { status: "verified" }),
      (err) => this.injectData("message", { status: "error", error: err })
    );
  },

  /**
   * onSessionStatus sends the currently signed in user's credentials
   * to the jelly.
   */
  onSessionStatus: function () {
    log("Received: 'session_status'.");

    fxAccounts.getSignedInUser().then(
      (accountData) => this.injectData("message", { status: "session_status", data: accountData }),
      (err) => this.injectData("message", { status: "error", error: err })
    );
  },

  /**
   * onSignOut handler erases the current user's session from the fxaccounts service
   */
  onSignOut: function () {
    log("Received: 'sign_out'.");

    fxAccounts.signOut().then(
      () => this.injectData("message", { status: "sign_out" }),
      (err) => this.injectData("message", { status: "error", error: err })
    );
  },

  handleRemoteCommand: function (evt) {
    log('command: ' + evt.detail.command);
    let data = evt.detail.data;

    switch (evt.detail.command) {
      case "login":
        this.onLogin(data);
        break;
      case "verified":
        this.onVerified(data);
        break;
      case "session_status":
        this.onSessionStatus(data);
        break;
      case "sign_out":
        this.onSignOut(data);
        break;
      default:
        log("Unexpected remote command received: " + evt.detail.command + ". Ignoring command.");
        break;
    }
  },

  injectData: function (type, content) {
    let authUrl;
    try {
      authUrl = fxAccounts.getAccountsURI();
    } catch (e) {
      error("Couldn't inject data: " + e.message);
      return;
    }
    let data = {
      type: type,
      content: content
    };
    this.iframe.contentWindow.postMessage(data, authUrl);
  },
};

wrapper.init();

