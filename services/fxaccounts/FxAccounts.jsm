/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


this.EXPORTED_SYMBOLS = ["fxAccounts", "FxAccounts"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/osfile.jsm");
Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://gre/modules/HAWK.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Timer.jsm");
Cu.import("resource://gre/modules/Task.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "jwcrypto",
                                  "resource://gre/modules/identity/jwcrypto.jsm");

const defaultStorageFilename = "signedInUser.json";

/**
 * FxAccounts constructor
 *
 * @param signedInUserStorage is a storage instance for getting/setting
 *                            the signedInUser. Uses JSONStorage by default.
 * @return instance
 */
function FxAccounts(signedInUserStorage = undefined) {
  // We don't reference |profileDir| in the top-level module scope as we may
  // be imported before we know where it is.
  if (!signedInUserStorage) {
    signedInUserStorage = new JSONStorage({
      filename: defaultStorageFilename,
      baseDir: OS.Constants.Path.profileDir,
    });
  }
  this._signedInUserStorage = signedInUserStorage;
  this._isPollingEmailStatus = false;
  this._whenVerifiedPromises = [];
}

FxAccounts.prototype = Object.freeze({
  // data format version
  version: 1,

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
   *        }
   *
   * @return Promise
   *         The promise resolves to null on success or is rejected on error
   */
  setSignedInUser: function setSignedInUser(credentials) {
    let record = { version: this.version, accountData: credentials };
    // cache a clone of the credentials object
    this._signedInUser = JSON.parse(JSON.stringify(record));

    return this._signedInUserStorage.set(record)
      .then(() => this._whenReady() )
      .then(() => this._notifyLoginObservers() )
    ;
  },

  _isReady: function _isReady(data) {
    if (data.isVerified && data.kA && data.kB)
      return true;
    return false;
  },

  _whenReady: function _whenReady() {
    // fires when email is verified and keys fetched
    return this._whenVerified()
      .then( data => data.keyFetchToken ?
             this._fetchAndUnwrapKeys(data.keyFetchToken) : undefined );
  },

  _whenVerified: function _whenVerified() {
    // fires when email is verified
    let deferred = Promise.defer();
    this._whenVerifiedPromises.push(deferred);
    if (!this._isPollingEmailStatus) {
      this._isPollingEmailStatus = true;
      this._pollEmailStatus();
    }
    dump("== _whenVerified returning promise\n");
    return deferred.promise;
  },

  _pollEmailStatus: function _pollEmailStatus() {
    this._getUserAccountData()
      .then(data => {
        if (!data) {
          dump("Huh? _pollEmailStatus got empty _getUserAccountData\n");
        } else if (data.isVerified) {
          this._notifyVerified(data);
        } else {
          this._checkEmailStatus(data.sessionToken)
            .then(response => {
              dump(" - response: "+JSON.stringify(response)+"\n");
              if (response && response.verified) {
                this._getUserAccountData()
                  .then(data => {
                    data.isVerified = true;
                    return this._setUserAccountData(data);
                  })
                  .then(() => {
                    this._isPollingEmailStatus = false;
                    this._notifyVerified(data);
                  });
              } else {
                setTimeout(() => this._pollEmailStatus(), 1000);
              }
            });
        }
      });
    },

  _checkEmailStatus: function _checkEmailStatus(sessionToken) {
    return HAWK.recoveryEmailStatus(sessionToken);
  },

  _notifyVerified: function _notifyVerified(data) {
    dump("== _notifyVerified "+this._whenVerifiedPromises.length+"\n");
    while (this._whenVerifiedPromises.length) {
      let d = this._whenVerifiedPromises.shift();
      d.resolve(data);
    }
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
   *        }
   *
   *        or null if the signed in user does not yet have the necessary
   *        keys, the user data is an unrecognized version, or no user is
   *        signed in.
   *
   */
  getSignedInUser: function getSignedInUser() {
    return this._getUserAccountData()
      .then(data => {
        if (!this._isReady(data)) {
          this._whenReady() // kick off the process, it will finish eventually
            .then( () => this._notifyLoginObservers() );
          // but our caller doesn't wait for that
          return null;
        }
        return data;
      });
  },

  getAssertion: function getAssertion(audience, validityPeriod_ms) {
    // returns a Persona assertion used to enable Sync
    return this._getUserAccountData()
      .then(data => {
        return this._getKeyPair(data, validityPeriod_ms)
          .then(keyPair => {
            return this._getCertificate(data, keyPair, validityPeriod_ms)
              .then(cert => this._getAssertionFromCert(data, keyPair, cert,
                                                       audience,
                                                       validityPeriod_ms));
          });
      });
  },

  _willBeValidIn: function _willBeValidIn(time, validityPeriod) {
    return (time < this._now() + validityPeriod);
  },

  _now: function() {
    return Date.now();
  },

  _getKeyPair: function _getKeyPair(data, validityPeriod) {
    if (this._keyPair && this._willBeValidIn(this._keyPair.validUntil,
                                             validityPeriod)) {
      return Promise.resolve(this._keyPair.keyPair);
    }
    // else create a keypair, set validity limit to 12 hours
    let now = this._now();
    let d = Promise.defer();
    jwcrypto.generateKeyPair("DS160", function(err, kp) {
      if (err) {
        d.reject(err);
      } else {
        this._keyPair = { keyPair: kp,
                          validUntil: now + 12*3600*1000 };
        d.resolve(this._keyPair.keyPair);
      }
    });
    return d.promise;
  },

  _getCertificate: function _getCertificate(data, keyPair, validityPeriod) {
    if (this._cert && this._willBeValidIn(this._cert.validUntil,
                                          validityPeriod)) {
      return Promise.resolve(this._cert.cert);
    }
    // else get our cert signed
    return this._getCertificateSigned(data.sessionToken,
                                      keyPair.serializedPublicKey);
  },

  _getCertificateSigned: function _getCertificateSigned(sessionToken,
                                                        serializedPublicKey) {
    return HAWK.signCertificate(sessionToken, serializedPublicKey);
  },

  _getAssertionFromCert: function _getAssertionFromCert(data, keyPair, cert,
                                                        audience,
                                                        validityPeriod) {
    let payload = {};
    let d = Promise.defer();
    // "audience" should be like "http://123done.org"
    // the generated assertion will expire in two minutes
    jwcrypto.generateAssertion(cert, keyPair, audience, function(err, signed) {
      if (err) {
        d.reject(err);
      } else {
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

  getAccountsURI: function () {
    let url = Services.urlFormatter.formatURLPref("firefox.accounts.remoteUrl");
    return url;
    if (!/^https:/.test(url)) {
      throw new Error("Firefox Accounts server must use HTTPS");
    }
    return url;
  },

  _deriveHawkCredentials: function (sessionToken) {
    let bytes = [];
    for (let i=0; i <  sessionToken.length-1; i += 2) {
      bytes.push(parseInt(sessionToken.substr(i, 2), 16));
    }
    let key = String.fromCharCode.apply(String, bytes);
    let out = CryptoUtils.hkdf(key, undefined, "identity.mozilla.com/picl/v1/session", 2*32);
    return {
      algorithm: "sha256",
      id: CommonUtils.bytesAsHex(out.slice(0, 32)),
      key: CommonUtils.bytesAsHex(out.slice(32, 64))
    };
  },

  _fetchAndUnwrapKeys: function (keyFetchToken) {
    dump("== _fetchAndUnwrapKeys\n");
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
      dump("Keys Obtained: kA="+data.kA+", kB="+data.kB+"\n");
      yield this._setUserAccountData(data);
    }.bind(this));
  },

  _fetchKeys: function _fetchKeys(keyFetchToken) {
    return HAWK.accountKeys(keyFetchToken);
  },

  _notifyLoginObservers: function () {
    Services.obs.notifyObservers(null, "fxaccounts:onlogin", null);
  }
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
  return new FxAccounts();
});
