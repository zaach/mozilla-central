/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

Cu.import("resource://services-common/utils.js");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FxAccounts.jsm");
Cu.import("resource://gre/modules/Promise.jsm");

function run_test() {
  run_next_test();
}

let credentials = {
  email: "foo@example.com",
  uid: "1234@lcip.org",
  assertion: "foobar",
  sessionToken: "dead",
  kA: "beef",
  kB: "cafe"
};

add_test(function test_non_https_remote_server_uri() {

  Services.prefs.setCharPref("firefox.accounts.remoteUrl",
                             "http://example.com/browser/browser/base/content/test/general/accounts_testRemoteCommands.html");
  do_check_throws(function () {
    fxAccounts.getAccountsURI();
  }, "Firefox Accounts server must use HTTPS");

  Services.prefs.clearUserPref("firefox.accounts.remoteUrl");

  run_next_test();
});

/*
add_task(function test_get_signed_in_user_initially_unset() {
  // user is initially undefined
  let result = yield fxAccounts.getSignedInUser();
  do_check_eq(result, undefined);

  // set user
  yield fxAccounts.setSignedInUser(credentials);

  // get user
  let result = yield fxAccounts.getSignedInUser();
  do_check_eq(result.email, credentials.email);
  do_check_eq(result.assertion, credentials.assertion);
  do_check_eq(result.kB, credentials.kB);

  // Delete the memory cache and force the user
  // to be read and parsed from storage (e.g. disk via JSONStorage)
  delete fxAccounts._signedInUser;
  let result = yield fxAccounts.getSignedInUser();
  do_check_eq(result.email, credentials.email);
  do_check_eq(result.assertion, credentials.assertion);
  do_check_eq(result.kB, credentials.kB);

  // sign out
  yield fxAccounts.signOut();

  // user should be undefined after sign out
  let result = yield fxAccounts.getSignedInUser();
  do_check_eq(result, undefined);
});
*/

add_test(function test_hawk_credentials() {
  let sessionToken = "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf";
  let result = fxAccounts._deriveHawkCredentials(sessionToken);

  do_check_eq(result.id, "639503a218ffbb62983e9628be5cd64a0438d0ae81b2b9dadeb900a83470bc6b");
  do_check_eq(result.key, "3a0188943837ab228fe74e759566d0e4837cbcc7494157aac4da82025b2811b2");

  run_next_test();
});

function expandHex(two_hex) {
  // return a 64-character hex string, encoding 32 identical bytes
  let eight_hex = two_hex + two_hex + two_hex + two_hex;
  let thirtytwo_hex = eight_hex + eight_hex + eight_hex + eight_hex;
  return thirtytwo_hex + thirtytwo_hex;
};

function expandBytes(two_hex) {
  return CommonUtils.hexToBytes(expandHex(two_hex));
};

let Storage = function() {
  this.data = null;
};
Storage.prototype = Object.freeze({
  set: function (contents) {
    this.data = contents;
    return Promise.resolve(null);
  },
  get: function () {
    return Promise.resolve(this.data);
  },
});

let _MockFXA = function() {
  FxAccounts.apply(this, arguments);
  this._check_count = 0;
  this._d_fetchKeys = Promise.defer();
  this._getCertificateSigned_calls = [];
  this._d_signCertificate = Promise.defer();
  this._now_is = new Date();
};
_MockFXA.prototype = {
  __proto__: FxAccounts.prototype,
  _checkEmailStatus: function(sessionToken) {
    dump("== _checkEmailStatus\n");
    this._check_count += 1;
    if (this._check_count > 2)
      return Promise.resolve({verified: true});
    return Promise.resolve({verified: false});
  },
  _now: function() {
    return this._now_is;
  },
  _fetchKeys: function(keyFetchToken) {
    dump("== _fetchKeys\n");
    return this._d_fetchKeys.promise;
  },
  _getCertificateSigned: function(sessionToken, serializedPublicKey) {
    dump("== _signCertificate\n");
    this._getCertificateSigned_calls.push([sessionToken, serializedPublicKey]);
    return this._d_signCertificate.promise;
  },
};

add_task(function test_verification_poll() {
  let a = new _MockFXA(new Storage());
  let creds = {
    sessionToken: "sessionToken",
    keyFetchToken: "keyFetchToken",
    unwrapBKey: expandHex("44"),
  };
  yield a.setSignedInUser(creds);
  let data = yield a._getUserAccountData();
  do_check_eq(a._isReady(data), false);
  data = yield a.getSignedInUser();
  do_check_eq(data, null);
  data = yield a._getUserAccountData();
  data = yield a._whenVerified(data);
  do_check_eq(a._isReady(data), false);
  do_check_eq(data.isVerified, true);

  a._d_fetchKeys.resolve({
    kA: expandBytes("11"),
    wrapKB: expandBytes("22"),
  });

  data = yield a._getUserAccountData();
  yield a._getKeys(data);
  data = yield a._getUserAccountData();
  do_check_eq(a._isReady(data), true);
  do_check_eq(data.kA, expandHex("11"));
  do_check_eq(data.kB, expandHex("66"));
  do_check_eq(data.keyFetchToken, undefined);

  data = yield a.getSignedInUser();
  do_check_eq(data.kA, expandHex("11"));
  do_check_eq(data.kB, expandHex("66"));
  do_check_eq(data.keyFetchToken, undefined);

  dump("----- DONE1 ---\n");
});

add_task(function test_getAssertion() {
  dump("----- START ----\n");
  //let a = new FxAccounts();
  let a = new _MockFXA(new Storage());

  let noData = yield a.getAssertion("nonaudience");
  do_check_eq(noData, null);

  let creds = {
    sessionToken: "sessionToken",
    kA: expandHex("11"),
    kB: expandHex("66"),
    isVerified: true,
  };
  // by putting kA/kB/isVerified in "creds", we skip ahead to the "we're
  // ready" stage
  yield a.setSignedInUser(creds);

  dump("== ready to go\n");
  let now = 138000000*1000;
  let start = Date.now();
  a._now_is = now;
  let d = a.getAssertion("audience.example.com");
  // at this point, a thread has been spawned to generate the keys
  dump("-- back from a.getAssertion\n");
  a._d_signCertificate.resolve("cert1");
  let assertion = yield d;
  let finish = Date.now();
  do_check_eq(a._getCertificateSigned_calls.length, 1);
  do_check_eq(a._getCertificateSigned_calls[0][0], "sessionToken");
  do_check_neq(assertion, null);
  dump("ASSERTION: "+assertion+"\n");
  let pieces = assertion.split("~");
  do_check_eq(pieces[0], "cert1");
  do_check_neq(a._keyPair, undefined);
  dump(a._keyPair.validUntil+"\n");
  let p2 = pieces[1].split(".");
  let header = JSON.parse(atob(p2[0]));
  dump("HEADER: "+JSON.stringify(header)+"\n");
  do_check_eq(header.alg, "DS128");
  let payload = JSON.parse(atob(p2[1]));
  dump("PAYLOAD: "+JSON.stringify(payload)+"\n");
  do_check_eq(payload.aud, "audience.example.com");
  do_check_eq(a._keyPair.validUntil, now + a.keyLifetime);
  do_check_eq(a._cert.validUntil, now + a.certLifetime);
  dump("delta: "+(new Date(payload.exp) - now)+"\n");
  let exp = Number(payload.exp);
  // jwcrypto.jsm uses an unmocked Date.now()+2min to decide on the
  // expiration time, so we test that it's inside a specific timebox
  do_check_true(start + 2*60*1000 <= exp);
  do_check_true(exp <= finish + 2*60*1000);

  // reset for next call
  a._d_signCertificate = Promise.defer();

  // getting a new assertion "soon" (i.e. without incrementing "now"), even
  // for a new audience, should not provoke key generation or a signing
  // request
  assertion = yield a.getAssertion("other.example.com");
  do_check_eq(a._getCertificateSigned_calls.length, 1);

  // but "waiting" (i.e. incrementing "now") will need a new key+signature
  a._now_is = now + 24*3600*1000;
  start = Date.now();
  d = a.getAssertion("third.example.com");
  a._d_signCertificate.resolve("cert2");
  assertion = yield d;
  finish = Date.now();
  do_check_eq(a._getCertificateSigned_calls.length, 2);
  do_check_eq(a._getCertificateSigned_calls[1][0], "sessionToken");
  pieces = assertion.split("~");
  do_check_eq(pieces[0], "cert2");
  p2 = pieces[1].split(".");
  header = JSON.parse(atob(p2[0]));
  payload = JSON.parse(atob(p2[1]));
  do_check_eq(payload.aud, "third.example.com");
  do_check_eq(a._keyPair.validUntil, now + 24*3600*1000 + a.keyLifetime);
  do_check_eq(a._cert.validUntil, now + 24*3600*1000 + a.certLifetime);
  exp = Number(payload.exp);
  do_check_true(start + 2*60*1000 <= exp);
  do_check_true(exp <= finish + 2*60*1000);

  dump("----- DONE ----\n");
});
