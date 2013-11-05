/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["fxAccountsClient", "FxAccountsClient"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");

const HOST = "https://idp.dev.lcip.org";
const PREFIX_NAME = "identity.mozilla.com/picl/v1/";

const XMLHttpRequest =
  Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");

function FxAccountsClient(host = HOST) {
  this.host = host;
}

FxAccountsClient.prototype = Object.freeze({

  accountCreate: function () {
    return this._request("/recovery_email/status", "GET",
      this._deriveHawkCredentials(sessionTokenHex, "session", 2 * 32));
  },

  recoveryEmailStatus: function (sessionTokenHex) {
    return this._request("/recovery_email/status", "GET",
      this._deriveHawkCredentials(sessionTokenHex, "session", 2 * 32));
  },

  accountKeys: function (keyFetchTokenHex) {
    let creds = CryptoUtils.deriveCredentials(keyFetchTokenHex, PREFIX_NAME + "account/keys", 5 * 32);

    return doRequest("/account/keys", "GET", creds).then(resp => {
      if (!resp.bundle) {
        throw new Error("failed to retrieve keys");
      }

      let bundle = CommonUtils.hexToBytes(resp.bundle);
      let mac = bundle.slice(-32);

      let respHMACKey = creds.extra.slice(0, 32);
      let respXORKey = creds.extra.slice(32, 96);

      let hasher = CryptoUtils.makeHMACHasher(Ci.nsICryptoHMAC.SHA256,
        CryptoUtils.makeHMACKey(respHMACKey));

      let bundleMAC = CryptoUtils.digestBytes(bundle.slice(0, -32), hasher);
      if (mac !== bundleMAC) {
        throw new Error("error unbundling encryption keys");
      }

      let keyAWrapB = CryptoUtils.xor(creds.extra.slice(-64), bundle.slice(0, 64));

      return {
        kA: keyAWrapB.slice(0, 32),
        wrapKB: keyAWrapB.slice(32)
      }
    });
  },

  _deriveHawkCredentials: function (tokenHex, context, size) {
    let token = CommonUtils.hexToBytes(tokenHex);
    let out = CryptoUtils.hkdf(token, undefined, PREFIX_NAME + context, size || 2 * 32);

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

