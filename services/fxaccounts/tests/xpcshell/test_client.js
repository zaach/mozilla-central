/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Cu.import("resource://gre/modules/FxAccountsClient.jsm");
Cu.import("resource://gre/modules/Promise.jsm");
Cu.import("resource://services-common/utils.js");


function run_test() {
  run_next_test();
}

function deferredStop(server) {
    let deferred = Promise.defer();
    server.stop(function () {
      deferred.resolve(true);
    });
    return deferred.promise;
}


add_test(function test_hawk_credentials() {
  let sessionToken = "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf";
  let client = new FxAccountsClient();
  let result = client._deriveHawkCredentials(sessionToken, "session");

  do_check_eq(result.id, "639503a218ffbb62983e9628be5cd64a0438d0ae81b2b9dadeb900a83470bc6b");
  do_check_eq(CommonUtils.bytesAsHex(result.key), "3a0188943837ab228fe74e759566d0e4837cbcc7494157aac4da82025b2811b2");

  run_next_test();
});

add_task(function test_authenticated_get_request() {
  let message = "{\"msg\": \"Great Success!\"}";
  let credentials = {
    id: "eyJleHBpcmVzIjogMTM2NTAxMDg5OC4x",
    key: "qTZf4ZFpAMpMoeSsX3zVRjiqmNs=",
    algorithm: "sha256"
  };
  let method = "GET";

  let server = httpd_setup({"/foo": function(request, response) {
      do_check_true(request.hasHeader("Authorization"));

      response.setStatusLine(request.httpVersion, 200, "OK");
      response.bodyOutputStream.write(message, message.length);
    }
  });

  let client = new FxAccountsClient(server.baseURI);

  let result = yield client._request("/foo", method, credentials);

  do_check_eq("Great Success!", result.json.msg);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});

add_task(function test_authenticated_post_request() {
  let credentials = {
    id: "eyJleHBpcmVzIjogMTM2NTAxMDg5OC4x",
    key: "qTZf4ZFpAMpMoeSsX3zVRjiqmNs=",
    algorithm: "sha256"
  };
  let method = "POST";

  let server = httpd_setup({"/foo": function(request, response) {
      do_check_true(request.hasHeader("Authorization"));

      response.setStatusLine(request.httpVersion, 200, "OK");
      response.setHeader("Content-Type", "application/json");
      response.bodyOutputStream.writeFrom(request.bodyInputStream, request.bodyInputStream.available());
    }
  });

  let client = new FxAccountsClient(server.baseURI);

  let result = yield client._request("/foo", method, credentials, {foo: "bar"});

  do_check_eq("bar", result.json.foo);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});

add_task(function test_signUp() {
  let sessionMessage = JSON.stringify({sessionToken: "NotARealToken"});
  let creationMessage = JSON.stringify({uid: "NotARealUid"});

  let server = httpd_setup(
    {
      "/raw_password/account/create": function(request, response) {
        response.setStatusLine(request.httpVersion, 200, "OK");
        response.bodyOutputStream.write(creationMessage, creationMessage.length);
      },
      "/raw_password/session/create": function(request, response) {
        response.setStatusLine(request.httpVersion, 200, "OK");
        response.bodyOutputStream.write(sessionMessage, sessionMessage.length);
      },
    }
  );

  let client = new FxAccountsClient(server.baseURI);

  let result = yield client.signUp('you@example.com', 'biggersecret');
  do_check_eq("NotARealUid", result.json.uid);
  do_check_eq(200, result.status);

  let result = yield client.signIn('me@example.com', 'bigsecret');
  do_check_eq("NotARealToken", result.json.sessionToken);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});
