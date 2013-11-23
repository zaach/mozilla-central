/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


this.EXPORTED_SYMBOLS = ["fxAccounts", "FxAccounts"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Timer.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/FxAccountsClient.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "jwcrypto",
                                  "resource://gre/modules/identity/jwcrypto.jsm");


const defaultStorageFilename = "signedInUser.json";

function log(msg) {
  //dump(msg);
}

/**
 * FxAccounts constructor
 *
 * @param signedInUserStorage is a storage instance for getting/setting
 *                            the signedInUser. Uses JSONStorage by default.
 * @return instance
 */
this.FxAccounts = function(signedInUserStorage) {
  // We don't reference |profileDir| in the top-level module scope as we may
  // be imported before we know where it is.
  if (!signedInUserStorage) {
    signedInUserStorage = new JSONStorage({
      filename: defaultStorageFilename,
      baseDir: OS.Constants.Path.profileDir,
    });
  }
  this._signedInUserStorage = signedInUserStorage;
  // these two promises only exist while we're querying the server
  this._whenVerifiedPromise = null;
  this._whenKeysReadyPromise = null;

  this._fxAccountsClient = new FxAccountsClient();
}

this.FxAccounts.prototype = Object.freeze({
  // data format version
  version: 1,

  getReady: function() {
    // kick things off. This must be called after construction. I return a
    // promise that fires when everything is ready to go, but the caller is
    // free to ignore it.
    this._getUserAccountData()
      .then(data => {
        if (data && !this._isReady(data)) {
          return this._startVerifiedCheck(data);
        }
        return data;
      });
  },

  // set() makes sure that polling is happening, if necessary
  // get() does not wait for verification, and returns an object even if
  // unverified. The caller of get() must check .isVerified .
  // The "fxaccounts:onlogin" event will fire only when the verified state
  // goes from false to true, so callers must register their observer
  // and then call get(). In particular, it will not fire when the account
  // was found to be verified in a previous boot: if our stored state says
  // the account is verified, the event will never fire. So callers must do:
  //  register notification observer (go)
  //  userdata = get()
  //  if (userdata.isVerified()) go()

  /**
   * Set the current user signed in to Firefox Accounts (FxA)
   *
   * @param credentials
   *        The credentials object obtained by logging in or creating
   *        an account on the FxA server:
   *
   *        {
   *          email: The users email address
   *          uid: The user's unique id
   *          sessionToken: Session for the FxA server
   *          keyFetchToken: an unused keyFetchToken
   *          isVerified: true/false
   *        }
   *
   * @param waitForReady
   *        If true, the returned promise will not fire until the
   *        email address has been verified and we have fetched the
   *        keys. If false or undefined, it will fire as soon as we
   *        have saved the data successfully.
   *
   * @return Promise
   *         The promise resolves to null when the data is saved
   *         successfully (or, if waitForReady=true, when verification and
   *         key-fetch are done), or is rejected on error
   */
  setSignedInUser: function setSignedInUser(credentials, waitForReady) {
    let record = { version: this.version, accountData: credentials };
    // cache a clone of the credentials object
    this._signedInUser = JSON.parse(JSON.stringify(record));

    // note: this waits for storage, but not for verification
    return this._signedInUserStorage.set(record)
      .then(() => {
        if (!this._isReady(credentials)) {
          this._startVerifiedCheck(credentials);
        }
      });
  },

  _isReady: function _isReady(data) {
    return !!(data && data.isVerified);
  },

  _startVerifiedCheck: function(data) {
    // get us to the verified state, then get the keys. This returns a
    // promise that will fire when we are completely ready.
    return this._whenVerified(data)
      .then(this._notifyLoginObservers)
      .then(() => data);
  },

  _whenVerified: function(data) {
    if (data.isVerified) {
      return Promise.resolve(data);
    }
    if (!this._whenVerifiedPromise) {
      // poll for 5 minutes
      this._pollTimeRemaining = 5 * 60 * 1000;
      this._whenVerifiedPromise = Promise.defer();
      this._pollEmailStatus(data.sessionToken, "start");
    }
    return this._whenVerifiedPromise.promise;
  },

  _pollEmailStatus: function _pollEmailStatus(sessionToken, why) {
    log(" entering _pollEmailStatus ("+(why||"")+")\n");
    this._checkEmailStatus(sessionToken)
      .then(response => {
        log(" - response: "+JSON.stringify(response)+"\n");
        if (response && response.verified) {
          this._getUserAccountData()
            .then(data => {
              data.isVerified = true;
              return this._setUserAccountData(data);
            })
            .then((data) => {
              this._whenVerifiedPromise.resolve(data);
              delete this._whenVerifiedPromise;
            });
        } else {
          this._pollTimeRemaining -= 3000;
          if (this._pollTimeRemaining > 0) {
            log("-=*=- starting setTimeout()\n");
            setTimeout(() => this._pollEmailStatus(sessionToken, "timer"), 3000);
          }
        }
      });
    },

  _checkEmailStatus: function _checkEmailStatus(sessionToken) {
    return this._fxAccountsClient.recoveryEmailStatus(sessionToken);
  },

  /**
   * Fetches encryption keys for the signed-in-user from the FxA API server.
   *
   * @return Promise
   *        The promise resolves to the credentials object of the signed-in user:
   *
   *        {
   *          email: The user's email address
   *          uid: The user's unique id
   *          sessionToken: Session for the FxA server
   *          kA: An encryption key from the FxA server
   *          kB: An encryption key derived from the user's FxA password
   *          isVerified: email verification status
   *        }
   *
   *        or null if no user is signed in
   *
   */
  getKeys: function(data) {
    if (data.kA && data.kB) {
      return Promise.resolve(data);
    }
    if (!this._whenKeysReadyPromise) {
      this._whenKeysReadyPromise = Promise.defer();
      this._fetchAndUnwrapKeys(data.keyFetchToken)
        .then(data => {
          this._whenKeysReadyPromise.resolve(data);
        });
    }
    return this._whenKeysReadyPromise.promise;
  },

  _fetchAndUnwrapKeys: function (keyFetchToken) {
    log("== _fetchAndUnwrapKeys\n");
    return Task.spawn(function task() {
      // Sign out if we don't have a key fetch token.
      if (!keyFetchToken) {
        yield this.signOut();
        return;
      }

      let {kA, wrapKB} = yield this._fetchKeys(keyFetchToken);

      let data = yield this._getUserAccountData();
      let kB_hex = CryptoUtils.xor(CommonUtils.hexToBytes(data.unwrapBKey),
                                   wrapKB);
      data.kA = CommonUtils.bytesAsHex(kA); // store kA/kB as hex
      data.kB = CommonUtils.bytesAsHex(kB_hex);
      delete data.keyFetchToken;
      log("Keys Obtained: kA="+data.kA+", kB="+data.kB+"\n");
      yield this._setUserAccountData(data);
      // we are now ready for business. This should only be invoked once per
      // setSignedInUser(), regardless of whether we've rebooted since
      // setSignedInUser() was called
      yield data;
    }.bind(this));
  },

  _fetchKeys: function _fetchKeys(keyFetchToken) {
    return this._fxAccountsClient.accountKeys(keyFetchToken);
  },

  _notifyLoginObservers: function () {
    Services.obs.notifyObservers(null, "fxaccounts:onlogin", null);
  },

  /**
   * Get the user currently signed in to Firefox Accounts (FxA)
   *
   * @return Promise
   *        The promise resolves to the credentials object of the signed-in user:
   *
   *        {
   *          email: The user's email address
   *          uid: The user's unique id
   *          sessionToken: Session for the FxA server
   *          kA: An encryption key from the FxA server
   *          kB: An encryption key derived from the user's FxA password
   *          isVerified: email verification status
   *        }
   *
   *        or null if no user is signed in
   *
   */
  getSignedInUser: function getSignedInUser() {
    return this._getUserAccountData()
      .then(data => data || null);
  },

  keyLifetime: 12*3600*1000, // 12 hours
  certLifetime: 6*3600*1000, // 6 hours
  assertionLifetime: 5*1000, // 5 minutes

  getAssertion: function getAssertion(audience) {
    log("--- getAssertion() starts\n");
    // returns a Persona assertion used to enable Sync. All three components
    // (the key, the cert which signs it, and the assertion) must be valid
    // for at least the next 5 minutes.
    let mustBeValidUntil = this._now() + this.assertionLifetime;
    return this._getUserAccountData()
      .then(data => {
        if (!this._isReady(data)) {
          return null;
        }
        return this._getKeyPair(mustBeValidUntil)
          .then(keyPair => {
            return this._getCertificate(data, keyPair, mustBeValidUntil)
              .then(cert => this._getAssertionFromCert(data, keyPair, cert,
                                                       audience));
          });
      });
  },

  _willBeValidIn: function _willBeValidIn(time, validityPeriod) {
    log([" _willBeValidIn", this._now() +validityPeriod, time, validityPeriod].join(" ")+"\n");
    return (this._now() + validityPeriod < time);
  },

  _now: function() {
    return Date.now();
  },

  _getKeyPair: function _getKeyPair(mustBeValidUntil) {
    log("_getKeyPair\n");
    if (this._keyPair) {
      log(" "+this._keyPair.validUntil+" "+mustBeValidUntil+"\n");
    }
    if (this._keyPair && this._keyPair.validUntil > mustBeValidUntil) {
      log(" _getKeyPair already had one\n");
      return Promise.resolve(this._keyPair.keyPair);
    }
    // else create a keypair, set validity limit to 12 hours
    let willBeValidUntil = this._now() + this.keyLifetime;
    let d = Promise.defer();
    jwcrypto.generateKeyPair("DS160", (err, kp) => {
      if (err) {
        d.reject(err);
      } else {
        log(" _getKeyPair got keypair\n");
        this._keyPair = { keyPair: kp,
                          validUntil: willBeValidUntil };
        delete this._cert;
        d.resolve(this._keyPair.keyPair);
      }
    });
    return d.promise;
  },

  _getCertificate: function _getCertificate(data, keyPair, mustBeValidUntil) {
    log("_getCertificate\n");
    // TODO: get the lifetime from the cert's .exp field
    if (this._cert && this._cert.validUntil > mustBeValidUntil) {
      log(" _getCertificate already had one\n");
      return Promise.resolve(this._cert.cert);
    }
    // else get our cert signed
    let willBeValidUntil = this._now() + this.certLifetime;
    return this._getCertificateSigned(data.sessionToken,
                                      keyPair.serializedPublicKey,
                                      this.certLifetime)
      .then((cert) => {
        this._cert = { cert: cert,
                       validUntil: willBeValidUntil };
        return cert;
      });
  },

  _getCertificateSigned: function _getCertificateSigned(sessionToken,
                                                        serializedPublicKey,
                                                        lifetime) {
    log(" _getCertificateSigned: "+sessionToken+" "+serializedPublicKey+"\n");
    return this._fxAccountsClient.signCertificate(sessionToken,
                                JSON.parse(serializedPublicKey), lifetime);
  },

  _getAssertionFromCert: function _getAssertionFromCert(data, keyPair, cert,
                                                        audience) {
    log("_getAssertionFromCert\n");
    let payload = {};
    let d = Promise.defer();
    // "audience" should be like "http://123done.org"
    // the generated assertion will expire in two minutes
    jwcrypto.generateAssertion(cert, keyPair, audience, function(err, signed) {
      if (err) {
        d.reject(err);
      } else {
        log(" _getAssertionFromCert returning signed: "+signed+"\n");
        d.resolve(signed);
      }
    });
    return d.promise;
  },

  _getUserAccountData: function () {
    // skip disk if user is cached
    if (this._signedInUser) {
      return Promise.resolve(this._signedInUser.accountData);
    }

    let deferred = Promise.defer();

    this._signedInUserStorage.get().then(user => {
      if (user && user.version == this.version) {
        this._signedInUser = user;
      }

      deferred.resolve(user ? user.accountData : undefined);
    }, err => deferred.resolve(undefined));

    return deferred.promise;
  },

  _setUserAccountData: function (accountData) {
    return this._signedInUserStorage.get().then(record => {
      record.accountData = accountData;
      this._signedInUser = record;
      return this._signedInUserStorage.set(record).then(() => accountData);
    });
  },

  /**
   * Sign the current user out
   *
   * @return Promise
   *         The promise is rejected if a storage error occurs
   */
  signOut: function signOut() {
    this._signedInUser = null;
    return this._signedInUserStorage.set(null).then(() => {
      Services.obs.notifyObservers(null, "fxaccounts:onlogout", null);
    });
  },

  // returns the URI of the remote UI flows
  getAccountsURI: function () {
    let url = Services.urlFormatter.formatURLPref("firefox.accounts.remoteUrl");
    if (!/^https:/.test(url)) {
      throw new Error("Firefox Accounts server must use HTTPS");
    }
    return url;
  },
});



/**
 * JSONStorage constructor that creates instances that may set/get
 * to a specified file, in a directory that will be created if it
 * doesn't exist.
 *
 * @param options {
 *                  filename: of the file to write to
 *                  baseDir: directory where the file resides
 *                }
 * @return instance
 */
function JSONStorage(options) {
  this.baseDir = options.baseDir;
  this.path = OS.Path.join(options.baseDir, options.filename);
}

JSONStorage.prototype = Object.freeze({
  set: function (contents) {
    return OS.File.makeDir(this.baseDir, {ignoreExisting: true})
      .then(CommonUtils.writeJSON.bind(null, contents, this.path));
  },

  get: function () {
    return CommonUtils.readJSON(this.path);
  },
});

// A getter for the instance to export
XPCOMUtils.defineLazyGetter(this, "fxAccounts", function() {
  let a = new FxAccounts();
  a.getReady();
  return a;
});

