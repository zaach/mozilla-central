/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["HAWK"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://services-common/utils.js");
Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Promise.jsm");

const XMLHttpRequest =
  Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");

const HOST = "https://idp.dev.lcip.org/v1";
//const HOST = "http://127.0.0.1:9000/v1";
const PREFIX_NAME = "identity.mozilla.com/picl/v1/";

function deriveCredentials(tokenHex, name) {
  let token = CommonUtils.hexToBytes(tokenHex);
  let out = CryptoUtils.hkdf(token, undefined, PREFIX_NAME + name, 5 * 32);

  return {
    algorithm: "sha256",
    key: out.slice(32, 64),
    extra: out.slice(64),
    id: CommonUtils.bytesAsHex(out.slice(0, 32))
  };
}

function doRequest(path, method, credentials, body) {
  dump(" ++ sending hawk request: "+HOST+path+"\n");
  let deferred = Promise.defer();
  let xhr = new XMLHttpRequest({mozSystem: true});

  xhr.open(method, HOST + path);
  xhr.onerror = deferred.reject;
  xhr.onload = function onload() {
    dump(" ++ hawk response " + xhr.responseText + "\n");
    try {
      deferred.resolve(JSON.parse(xhr.responseText));
    } catch (e) {
      deferred.reject(e);
    }
  };
  dump("  about to build newURI\n");
  let uri = Services.io.newURI(HOST + path, null, null);
  let options = {credentials: credentials};
  if (body) {
    options.payload = body;
    options.contentType = "application/json";
    xhr.setRequestHeader("Content-Type", "application/json");
  }
  dump("  about to computeHAWK\n");
  let header = CryptoUtils.computeHAWK(uri, method, options);
  dump("  about to setRequestHeader\n");
  xhr.setRequestHeader("authorization", header.field);
  dump("  about to send("+body+")\n");
  xhr.send(body);
  dump("  did send(body)\n");

  return deferred.promise;
}

this.HAWK = Object.freeze({
  recoveryEmailStatus: function (sessionTokenHex) {
    return doRequest("/recovery_email/status", "GET",
      deriveCredentials(sessionTokenHex, "sessionToken"));
  },

  accountKeys: function (keyFetchTokenHex) {
    let creds = deriveCredentials(keyFetchTokenHex, "keyFetchToken");
    let keyRequestKey = creds.extra.slice(0, 32);
    let morecreds = CryptoUtils.hkdf(keyRequestKey, undefined,
                                     PREFIX_NAME + "account/keys", 3 * 32);
    let respHMACKey = morecreds.slice(0, 32);
    let respXORKey = morecreds.slice(32, 96);

    return doRequest("/account/keys", "GET", creds).then(resp => {
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
    let creds = deriveCredentials(sessionTokenHex, "sessionToken");

    let body = { publicKey: serializedPublicKey,
                 duration: lifetime };
    return Promise.resolve()
      .then(_ => doRequest("/certificate/sign", "POST", creds,
                           JSON.stringify(body)))
      .then(resp => {
        if (resp.code) {
          throw new Error("bad code!");
        } else {
          return resp.cert;
        }})
      .then(cert => cert,
            err => {dump("HAWK.signCertificate error: "+err+"\n");
                    throw err;});
  },
});
