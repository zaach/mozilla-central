/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {interfaces: Ci, results: Cr, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FxAccounts.jsm");

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

  run_next_test();
});

add_test(function test_hawk_credentials() {
  let sessionToken = "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf";
  let result = fxAccounts._deriveHawkCredentials(sessionToken);

  do_check_eq(result.id, "639503a218ffbb62983e9628be5cd64a0438d0ae81b2b9dadeb900a83470bc6b");
  do_check_eq(result.key, "3a0188943837ab228fe74e759566d0e4837cbcc7494157aac4da82025b2811b2");

  run_next_test();
});
