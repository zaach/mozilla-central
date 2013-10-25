/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["HAWK"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");

const HOST = "https://idp.dev.lcip.org";
const PREFIX_NAME = "identity.mozilla.com/picl/v1/";

function doRequest(path, method, credentials) {
  return CommonUtils.hawkRequest(HOST + path, {
    method: method,
    credentials: credentials
  });
}

this.HAWK = Object.freeze({
  recoveryEmailStatus: function (sessionTokenHex) {
    return doRequest("/recovery_email/status", "GET",
      CryptoUtils.deriveHawkCredentials(sessionTokenHex, PREFIX_NAME + "session", 2 * 32));
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
  }
});
