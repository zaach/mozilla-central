/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["fxAccountsClient", "FxAccountsClient"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");

// TODO make this URL a pref
const HOST = "https://idp.dev.lcip.org";
const PREFIX_NAME = "identity.mozilla.com/picl/v1/";

const XMLHttpRequest =
  Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");

function FxAccountsClient(host = HOST) {
  this.host = host;
}

FxAccountsClient.prototype = Object.freeze({

  signUp: function (email, password) {
    let uuid; // XXX store this somewhere?
    let sessionTokenPromise = null;
    let hexEmail = email.toString('hex');
    let uuidPromise = this._request("/raw_password/account/create", "POST", null,
                          {email: hexEmail, password: password});
    let self = this;

    uuidPromise.then(function(result) {
      uuid = result;
      return self.signIn(email, password);
    },
    function(err) {
      throw new Error("FxAccountsClient.signUp() failed with: " + err);
    });
    return uuidPromise;
  },

  signIn: function signIn(email, password) {
    let hexEmail = email.toString('hex');
    return this._request("/raw_password/session/create", "POST", null,
                         {email: hexEmail, password: password});
  },

  recoveryEmailStatus: function (sessionTokenHex) {
    return this._request("/recovery_email/status", "GET",
      this._deriveHawkCredentials(sessionTokenHex, "sessionToken"))
      .then(xhr => xhr.json);
  },

  accountKeys: function (keyFetchTokenHex) {
    let creds = this._deriveHawkCredentials(keyFetchTokenHex, "keyFetchToken");
    let keyRequestKey = creds.extra.slice(0, 32);
    let morecreds = CryptoUtils.hkdf(keyRequestKey, undefined,
                                     PREFIX_NAME + "account/keys", 3 * 32);
    let respHMACKey = morecreds.slice(0, 32);
    let respXORKey = morecreds.slice(32, 96);

    return this._request("/account/keys", "GET", creds).then(xhr => {
      let resp = xhr.json;
      if (!resp.bundle) {
        throw new Error("failed to retrieve keys");
      }

      let bundle = CommonUtils.hexToBytes(resp.bundle);
      let mac = bundle.slice(-32);

      let hasher = CryptoUtils.makeHMACHasher(Ci.nsICryptoHMAC.SHA256,
        CryptoUtils.makeHMACKey(respHMACKey));

      let bundleMAC = CryptoUtils.digestBytes(bundle.slice(0, -32), hasher);
      if (mac !== bundleMAC) {
        throw new Error("error unbundling encryption keys");
      }

      let keyAWrapB = CryptoUtils.xor(respXORKey, bundle.slice(0, 64));

      return {
        kA: keyAWrapB.slice(0, 32),
        wrapKB: keyAWrapB.slice(32)
      };
    });
  },

  signCertificate: function (sessionTokenHex, serializedPublicKey, lifetime) {
    let creds = this._deriveHawkCredentials(sessionTokenHex, "sessionToken");

    let body = { publicKey: serializedPublicKey,
                 duration: lifetime };
    return Promise.resolve()
      .then(_ => this._request("/certificate/sign", "POST", creds, body))
      .then(xhr => {
        let resp = xhr.json;
        if (resp.code) {
          throw new Error("bad code!");
        } else {
          return resp.cert;
        }})
      .then(cert => cert,
            err => {dump("HAWK.signCertificate error: "+err+"\n");
                    throw err;});
  },

  _deriveHawkCredentials: function (tokenHex, context, size) {
    let token = CommonUtils.hexToBytes(tokenHex);
    let out = CryptoUtils.hkdf(token, undefined, PREFIX_NAME + context, size || 5 * 32);

    return {
      algorithm: "sha256",
      key: out.slice(32, 64),
      extra: out.slice(64),
      id: CommonUtils.bytesAsHex(out.slice(0, 32))
    };
  },

  _request: function hawkRequest(path, method, credentials, jsonPayload) {
    let deferred = Promise.defer();
    let xhr = new XMLHttpRequest({mozSystem: true});
    let URI = this.host + path;
    let payload;

    if (jsonPayload) {
      payload = JSON.stringify(jsonPayload);
    }

    xhr.open(method, URI);
    xhr.onerror = deferred.reject;
    xhr.onload = function onload() {
      try {
        xhr.json = JSON.parse(xhr.responseText);
      } catch (e) {
        return deferred.reject(e);
      }
      deferred.resolve(xhr);
    };

    let uri = Services.io.newURI(URI, null, null);

    if (credentials) {
      let header = CryptoUtils.computeHAWK(uri, method, {
                          credentials: credentials,
                          payload: payload
                        });
      xhr.setRequestHeader("authorization", header.field);
    }

    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(payload);

    return deferred.promise;
  }
});

fxAccountsClient = new FxAccountsClient();

this.FxAccountsClient = FxAccountsClient;
