/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Cu.import("resource://services-crypto/utils.js");
Cu.import("resource://services-common/async.js");
Cu.import("resource://services-common/rest.js");
Cu.import("resource://services-common/utils.js");

function run_test() {
  initTestLogging("Trace");
  run_next_test();
}

add_task(function test_authenticated_request() {
  _("Ensure that sending a Hawk authenticated GET request works as expected.");

  let message = "Great Success!";

  let id = "eyJleHBpcmVzIjogMTM2NTAxMDg5OC4x";
  let key = "qTZf4ZFpAMpMoeSsX3zVRjiqmNs=";
  let method = "GET";

  //let nonce = btoa(CryptoUtils.generateRandomBytes(16));
  //let ts = Math.floor(Date.now() / 1000);
  //let extra = {ts: ts, nonce: nonce};

  let auth;

  let server = httpd_setup({"/foo": function(request, response) {
      do_check_true(request.hasHeader("Authorization"));
      do_check_eq(auth, request.getHeader("Authorization"));

      response.setStatusLine(request.httpVersion, 200, "OK");
      response.bodyOutputStream.write(message, message.length);
    }
  });

  let result = yield CommonUtils.hawkRequest(server.baseURI + "/foo", {
    method: method,
    credentials: {id: id, key: key, algorithm: "sha256"},
  });

  do_check_eq(message, result);

  server.stop(run_next_test);
});

add_task(function test_authenticated_request() {
  _("Ensure that sending a Hawk authenticated GET request works as expected.");

  let message = "Great Success!";

  let id = "eyJleHBpcmVzIjogMTM2NTAxMDg5OC4x";
  let key = "qTZf4ZFpAMpMoeSsX3zVRjiqmNs=";
  let method = "POST";

  //let nonce = btoa(CryptoUtils.generateRandomBytes(16));
  //let ts = Math.floor(Date.now() / 1000);
  //let extra = {ts: ts, nonce: nonce};

  let auth;

  let server = httpd_setup({"/foo": function(request, response) {
      do_check_true(request.hasHeader("Authorization"));
      do_check_eq(auth, request.getHeader("Authorization"));

      response.setStatusLine(request.httpVersion, 200, "OK");
      response.bodyOutputStream.write(message, message.length);
      dump("request " + request.body + "\n");
    }
  });

  let result = yield CommonUtils.hawkRequest(server.baseURI + "/foo", {
    method: method,
    credentials: {id: id, key: key, algorithm: "sha256"},
    payload: "oh hai"
  });

  do_check_eq("oh hai", result);

  server.stop(run_next_test);
});
