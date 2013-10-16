/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = ["BrowserIDManager"];

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://services-common/async.js");
Cu.import("resource://services-common/log4moz.js");
Cu.import("resource://services-common/tokenserverclient.js");
Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://services-sync/identity.js");
Cu.import("resource://services-sync/util.js");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://services-sync/constants.js");

/**
 * Fetch a token for the sync storage server by passing a BrowserID assertion
 * from FxAccounts() to TokenServerClient, then wrap the token in in a Hawk
 * header so that SyncStorageRequest can connect.
 */

this.BrowserIDManager = function BrowserIDManager(fxaService, tokenServerClient) {
  this._fxaService = fxaService;
  this._tokenServerClient = tokenServerClient;
  this._log = Log4Moz.repository.getLogger("Sync.BrowserIDManager");
  this._log.Level = Log4Moz.Level[Svc.Prefs.get("log.logger.identity")];

};

this.BrowserIDManager.prototype = {
  __proto__: IdentityManager.prototype,

  _fxaService: null,
  _tokenServerClient: null,
  // https://docs.services.mozilla.com/token/apis.html
  _token: null,

  _userData: {},
  _username: null,

  _clearUserState: function() {
    this._token = null;
  },

  /**
   * Unify string munging in account setter and testers (e.g. hasValidToken).
   */
  _normalizeAccountValue: function(value) {
    return value.toLowerCase();
  },

  /**
   * Provide override point for testing token expiration.
   */
  _now: function() {
    return Date.now();
  },

  clusterURL: null,

  get account() {
    return this._userData ? this._userData.email : null;
  },

  /**
   * Sets the active account name.
   *
   * This should almost always be called in favor of setting username, as
   * username is derived from account.
   *
   * Changing the account name has the side-effect of wiping out stored
   * credentials. Keep in mind that persistCredentials() will need to be called
   * to flush the changes to disk.
   *
   * Set this value to null to clear out identity information.
   */
  set account(value) {
    this._log.error("account setter should be not used in BrowserIDManager:\n"
                    + (new Error().stack));
  },

  get username() {
    return this._username;
  },

  /**
   * Set the username value.
   *
   * Changing the username has the side-effect of wiping credentials.
   */
  set username(value) {
    this._username = value;
    // If we change the username, we interpret this as a major change event
    // and wipe out the credentials.
    // this._log.info("Username changed. Removing stored credentials.");
    // this.basicPassword = null;
    // this.syncKey = null;
    // syncKeyBundle cleared as a result of setting syncKey.
  },

  /**
   * Obtains the HTTP Basic auth password.
   *
   * Returns a string if set or null if it is not set.
   */
  get basicPassword() {
    return "dontNeedOne";
  },

  /**
   * Set the HTTP basic password to use.
   *
   * Changes will not persist unless persistSyncCredentials() is called.
   */
  set basicPassword(value) {
    this._log.error("basicPassword setter should be not used in BrowserIDManager");
  },

  /**
   * Obtain the Sync Key.
   *
   * This returns a 26 character "friendly" Base32 encoded string on success or
   * null if no Sync Key could be found.
   *
   * If the Sync Key hasn't been set in this session, this will look in the
   * password manager for the sync key.
   */
  get syncKey() {
    return this._syncKey;
  },

  /**
   * The current state of the auth credentials.
   *
   * This essentially validates that enough credentials are available to use
   * Sync.
   */
  get currentAuthState() {
    if (!this.username) {
      return LOGIN_FAILED_NO_USERNAME;
    }

    if (!this.syncKey) {
      return LOGIN_FAILED_NO_PASSPHRASE;
    }

    // If we have a Sync Key but no bundle, bundle creation failed, which
    // implies a bad Sync Key.
    if (!this.syncKeyBundle) {
      return LOGIN_FAILED_INVALID_PASSPHRASE;
    }

    return STATUS_OK;
  },

  /**
   * Do we have a non-null, not yet expired token whose email field
   * matches (when normalized) our account field?
   *
   * If the calling function receives false from hasValidToken, it is
   * responsible for calling _clearUserData().
   */
  hasValidToken: function() {
    if (!this._token) {
      return false;
    }
    if (this._token.expiration < this._now()) {
      return false;
    }
    let signedInUser = this._getSignedInUser();
    if (!signedInUser) {
      return false;
    }
    // Does the signed in user match the user we retrieved the token for?
    if (this._normalizeAccountValue(signedInUser.email) !== this.account) {
      return false;
    }
    return true;
  },

  /**
   * Wrap and synchronize FxAccounts.getSignedInUser().
   *
   * @return credentials per wrapped.
   */
  _getSignedInUser: function() {
    let userBlob;
    let cb = Async.makeSpinningCallback();

    this._fxaService.getSignedInUser().then(function (result) {
        cb(null, result);
    },
    function (err) {
        cb(err);
    });

    try {
      userBlob = cb.wait();
    } catch (err) {
      this._log.error("FxAccounts.getSignedInUser() failed with: " + err);
      return null;
    }
    return userBlob;
  },

  initForUser: function(userData) {
    this._userData = userData;
    this._token = this._fetchTokenForUser(userData);
    dump("user id: " + this._token.uid + "\n");
    this.username = this._token.uid.toString();

    // TODO kB should be decoded from hex first
    let encodedKey = Utils.encodeKeyBase32(userData.kB);
    this._syncKey = encodedKey;
    // TODO: figure out what we need to change to allow us to not have one of these
    //this.basicPassword = "foo";

    let clusterURI = Services.io.newURI(this._token.endpoint, null, null);
    clusterURI.path = "/";
    this.clusterURL = clusterURI.spec;
    this._log.debug("initForUser has username " + this.username + ", endpoint is " + this.clusterURL);
  },

 _fetchTokenForUser: function(user) {
    let token;
    let cb = Async.makeSpinningCallback();
    let tokenServerURI = Svc.Prefs.get("tokenServerURI");

    this._log.info("TokenServerClient tokenServerURI is: " + tokenServerURI);

    try {
      this._tokenServerClient.getTokenFromBrowserIDAssertion(
        tokenServerURI, user.assertion, cb);
      token = cb.wait();
    } catch (err) {
      this._log.error("TokenServerClient.getTokenFromBrowserIDAssertion() failed with: " + err.message);
      return null;
    }

    token.expiration = this._now() + (token.duration * 1000);
    return token;
  },

  getResourceAuthenticator: function() {
    return this._getAuthenticationHeader.bind(this);
  },

  /**
   * Obtain a function to be used for adding auth to RESTRequest instances.
   */
  getRESTRequestAuthenticator: function() {
    return this._addAuthenticationHeader.bind(this);
  },

  /**
   * @return a Hawk HTTP Authorization Header, lightly wrapped, for the .uri
   * of a RESTRequest or AsyncResponse object.
   */
  _getAuthenticationHeader: function(httpObject, method) {
    if (!this.hasValidToken()) {
      this._clearUserState();
      let user = this._getSignedInUser();
      if (!user) {
        return null;
      }
      this._token = this._fetchTokenForUser(user);
      if (!this._token) {
        return null;
      }
    }
    let credentials = {algorithm: "sha256",
                       id: this._token.id,
                       key: this._token.key,
                      };
    method = method || httpObject.method;
    let headerValue = CryptoUtils.computeHAWK(httpObject.uri, method,
                                              {credentials: credentials});
    return {headers: {authorization: headerValue.field}};
  },

  _addAuthenticationHeader: function(request, method) {
    let header = this._getAuthenticationHeader(request, method);
    if (!header) {
      return null;
    }
    request.setHeader("authorization", header.headers.authorization);
    return request;
  }
};
