/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


this.EXPORTED_SYMBOLS = ["fxAccounts", "FxAccounts"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/osfile.jsm")
Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://gre/modules/HAWK.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Timer.jsm");
Cu.import("resource://gre/modules/Task.jsm");

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
   *          assertion: A Persona assertion used to enable Sync
   *          kA: An encryption key from the FxA server
   *          kB: An encryption key derived from the user's FxA password
   *        }
   *
   * @return Promise
   *         The promise resolves to null on success or is rejected on error
   */
  setSignedInUser: function setSignedInUser(credentials) {
    let record = { version: this.version, accountData: credentials };
    // cache a clone of the credentials object
    this._signedInUser = JSON.parse(JSON.stringify(record));

    return this._signedInUserStorage.set(record).then(() => {
      this._notifyLoginObservers();

      /*this._isUserVerified().then(isVerified => {
        if (isVerified) {
          this._notifyLoginObservers();
        } else {
          this._startPolling();
        }
      });*/
    });
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
   *          assertion: A Persona assertion used to enable Sync
   *          kA: An encryption key from the FxA server
   *          kB: An encryption key derived from the user's FxA password
   *        }
   *
   *        or null if no user is signed in or the user data is an
   *        unrecognized version.
   *
   */
  getSignedInUser: function getSignedInUser() {
    return this._getUserAccountData().then(data => {
      if (!data) {
        return undefined;
      }

      return this._isUserVerified().then(isVerified => {
        /*if (!isVerified) {
          this._startPolling();
          return undefined;
        }*/

        return data;
      });
    });
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
      return this._signedInUserStorage.set(record);
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

  _isUserVerified: function () {
    return this._getUserAccountData()
      .then(data => data && data.isVerified);
  },

  _startPolling: function () {
    this._isEmailAddressVerified().then(isVerified => {
      if (isVerified) {
        this._retrieveKeys();
      } else {
        setTimeout(() => this._startPolling(), 1000);
      }
    });
  },

  _isEmailAddressVerified: function () {
    return this._getUserAccountData().then(data => {
      return HAWK.recoveryEmailStatus(data.sessionToken)
        .then(response => response && response.verified, err => false);
    });
  },

  _retrieveKeys: function () {
    return Task.spawn(function task() {
      let data = yield this._getUserAccountData();

      // Sign out if we don't have a key fetch token.
      if (!data.keyFetchToken) {
        yield this.signOut();
        return;
      }

      let {keyFetchToken} = data;
      delete data.keyFetchToken;

      // Clear the token before we request keys...
      yield this._setUserAccountData(data);

      let {kA, wrapKB} = yield HAWK.accountKeys(keyFetchToken);

      data.kA = kA;
      data.kB = CryptoUtils.xor(CommonUtils.hexToBytes(data.unwrapBKey), wrapKB);
      data.isVerified = true;

      yield this._setUserAccountData(data);
      this._notifyLoginObservers();
    }.bind(this));
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
