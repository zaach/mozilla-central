/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://gre/modules/Services.jsm");

this.EXPORTED_SYMBOLS = ["HawkClient"];

const XMLHttpRequest =
  Components.Constructor("@mozilla.org/xmlextras/xmlhttprequest;1");

this.HawkClient = {
  /**
   * Make a Hawk authenticated HTTP request
   *
   * The client optimizes for JSON APIs, allowing JSON to be sent and
   * and received without worrying about (de)serialization.
   *
   * @param uri
   *        (string) HTTP request URI.
   * @param options
   *         (object) extra parameters:
   *           method - (string, mandatory) HTTP request method.
   *           credentials - (object, mandatory) HAWK credentials object.
   *             All three keys are required:
   *             id - (string) key identifier
   *             key - (string) raw key bytes
   *             algorithm - (string) which hash to use: "sha1" or "sha256"
   *           ext - (string) application-specific data, included in MAC
   *           localtimeOffsetMsec - (number) local clock offset (vs server)
   *           payload - (string) payload to include in hash, containing the
   *                     HTTP request body. If not provided, the HAWK hash
   *                     will not cover the request body, and the server
   *                     should not check it either. This will be UTF-8
   *                     encoded into bytes before hashing. This function
   *                     cannot handle arbitrary binary data, sorry (the
   *                     UTF-8 encoding process will corrupt any codepoints
   *                     between U+0080 and U+00FF). Callers must be careful
   *                     to use an HTTP client function which encodes the
   *                     payload exactly the same way, otherwise the hash
   *                     will not match.
   *           json - (object) JSON will be serialized and overwrite the
   *                  payload option. The contentType will be set to
   *                  application/json and the response will also be parsed
   *                  as JSON.
   *           contentType - (string) payload Content-Type. This is included
   *                         (without any attributes like "charset=") in the
   *                         HAWK hash. It does *not* affect interpretation
   *                         of the "payload" property.
   *           hash - (base64 string) pre-calculated payload hash. If
   *                  provided, "payload" is ignored.
   *           ts - (number) pre-calculated timestamp, secs since epoch
   *           now - (number) current time, ms-since-epoch, for tests
   *           nonce - (string) pre-calculated nonce. Should only be defined
   *                   for testing as this function will generate a
   *                   cryptographically secure random one if not defined.
   *
   * @return promise
   */
  request: function hawkRequest (uri, options) {
    let useJson = !!options.json;
    let deferred = Promise.defer();
    let xhr = new XMLHttpRequest({mozSystem: true});

    if (options.json) {
      options.payload = JSON.stringify(options.json);
      options.contentType = "application/json";
      delete options.json;
    }

    xhr.open(options.method, uri);
    xhr.onerror = deferred.reject;
    xhr.onload = function onload() {
      if (useJson) {
        try {
          xhr.json = JSON.parse(xhr.responseText);
        } catch (e) { }
      }
      deferred.resolve(xhr);
    };

    uri = Services.io.newURI(uri, null, null);
    let header = CryptoUtils.computeHAWK(uri, options.method,
                      { credentials: options.credentials });

    if (useJson) {
      xhr.setRequestHeader("Content-Type", "application/json");
    }
    xhr.setRequestHeader("authorization", header.field);

    xhr.send(options.payload);

    return deferred.promise;
  },
};

