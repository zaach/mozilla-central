/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [
  "btoa", // It comes from a module import.
  "encryptPayload",
  "setBasicCredentials",
  "getDefaultIdentityConfig",
  "configureFxAccountIdentity",
  "SyncTestingInfrastructure",
  "waitForZeroTimer",
];

const {utils: Cu} = Components;

Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://services-sync/util.js");
Cu.import("resource://testing-common/services-common/logging.js");
Cu.import("resource://testing-common/services/sync/fakeservices.js");
Cu.import("resource://gre/modules/FxAccounts.jsm");
Cu.import("resource://gre/modules/Promise.jsm");

/**
 * First wait >100ms (nsITimers can take up to that much time to fire, so
 * we can account for the timer in delayedAutoconnect) and then two event
 * loop ticks (to account for the Utils.nextTick() in autoConnect).
 */
this.waitForZeroTimer = function waitForZeroTimer(callback) {
  let ticks = 2;
  function wait() {
    if (ticks) {
      ticks -= 1;
      CommonUtils.nextTick(wait);
      return;
    }
    callback();
  }
  CommonUtils.namedTimer(wait, 150, {}, "timer");
}

this.setBasicCredentials =
 function setBasicCredentials(username, password, syncKey) {
  let ns = {};
  Cu.import("resource://services-sync/service.js", ns);

  let auth = ns.Service.identity;
  auth.username = username;
  auth.basicPassword = password;
  auth.syncKey = syncKey;
}

// Return a default identity configuration suitable for testing with our
// identity providers.
this.getDefaultIdentityConfig = function() {
  return {
    // Username used in both fxaccount and sync identity configs.
    username: "foo",
    // fxaccount specific credentials.
    fxaccount: {
      user: {
        assertion: 'assertion',
        email: 'email',
        kA: 'kA',
        kB: 'kB',
        sessionToken: 'sessionToken',
        uid: 'user_uid',
      },
      token: {
        endpoint: Svc.Prefs.get("tokenServerURI"),
        duration: 300,
        id: "id",
        key: "key",
        // uid will be set to the username.
      }
    }
    // XXX - todo - basic identity provider config
  };
}

// Configure an instance of an FxAccount identity provider with the specified
// config (or the default config if not specified).
this.configureFxAccountIdentity = function(authService,
                                           config = getDefaultIdentityConfig()) {
  let _MockFXA = function(blob) {
    this.user = blob;
  };
  _MockFXA.prototype = {
    __proto__: FxAccounts.prototype,
    getSignedInUser: function getSignedInUser() {
      let deferred = Promise.defer();
      deferred.resolve(this.user);
      return deferred.promise;
    },
  };
  let mockFXA = new _MockFXA(config.fxaccount.user);

  let mockTSC = { // TokenServerClient
    getTokenFromBrowserIDAssertion: function(uri, assertion, cb) {
      config.fxaccount.token.uid = config.username;
      cb(null, config.fxaccount.token);
    },
  };
  authService._fxaService = mockFXA;
  authService._tokenServerClient = mockTSC;
  // Set the "account" of the browserId manager to be the "email" of the
  // logged in user of the mockFXA service.
  authService._account = config.fxaccount.user.email;
}

this.SyncTestingInfrastructure = function (server, username, password, syncKey) {
  let ns = {};
  Cu.import("resource://services-sync/service.js", ns);

  let auth = ns.Service.identity;
  auth.account = username || "foo";
  auth.basicPassword = password || "password";
  auth.syncKey = syncKey || "abcdeabcdeabcdeabcdeabcdea";

  let i = server.identity;
  let uri = i.primaryScheme + "://" + i.primaryHost + ":" +
            i.primaryPort + "/";

  ns.Service.serverURL = uri;
  ns.Service.clusterURL = uri;

  this.logStats = initTestLogging();
  this.fakeFilesystem = new FakeFilesystemService({});
  this.fakeGUIDService = new FakeGUIDService();
  this.fakeCryptoService = new FakeCryptoService();
}

/**
 * Turn WBO cleartext into fake "encrypted" payload as it goes over the wire.
 */
this.encryptPayload = function encryptPayload(cleartext) {
  if (typeof cleartext == "object") {
    cleartext = JSON.stringify(cleartext);
  }

  return {
    ciphertext: cleartext, // ciphertext == cleartext with fake crypto
    IV: "irrelevant",
    hmac: fakeSHA256HMAC(cleartext, CryptoUtils.makeHMACKey("")),
  };
}

