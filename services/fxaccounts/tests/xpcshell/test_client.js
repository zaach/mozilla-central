/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Cu.import("resource://gre/modules/FxAccountsClient.jsm");
Cu.import("resource://gre/modules/Promise.jsm");

function run_test() {
  initTestLogging("Trace");
  run_next_test();
}

function deferredStop(server) {
    let deferred = Promise.defer();
    server.stop(function () {
      deferred.resolve(true);
    });
    return deferred.promise;
}

add_task(function test_authenticated_get_request() {
  _("Ensure that sending a Hawk authenticated GET request works as expected.");

  let message = "Great Success!";

  let id = "eyJleHBpcmVzIjogMTM2NTAxMDg5OC4x";
  let key = "qTZf4ZFpAMpMoeSsX3zVRjiqmNs=";
  let method = "GET";

  let server = httpd_setup({"/foo": function(request, response) {
      do_check_true(request.hasHeader("Authorization"));

      response.setStatusLine(request.httpVersion, 200, "OK");
      response.bodyOutputStream.write(message, message.length);
    }
  });

  let result = yield FxAccountsClient._request(server.baseURI + "/foo",
    method: method,
    {id: id, key: key, algorithm: "sha256"}
  );

  do_check_eq(message, result.responseText);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});

add_task(function test_authenticated_post_request() {
  _("Ensure that sending a Hawk authenticated JSON POST request works as expected.");

  let message = "Great Success!";

  let id = "eyJleHBpcmVzIjogMTM2NTAxMDg5OC4x";
  let key = "qTZf4ZFpAMpMoeSsX3zVRjiqmNs=";
  let method = "POST";

  let server = httpd_setup({"/foo": function(request, response) {
      do_check_true(request.hasHeader("Authorization"));

      response.setStatusLine(request.httpVersion, 200, "OK");
      response.setHeader("Content-Type", "application/json");
      response.bodyOutputStream.writeFrom(request.bodyInputStream, request.bodyInputStream.available());
    }
  });

  let result = yield FxAccountsClient._request(server.baseURI + "/foo",
    method,
    {id: id, key: key, algorithm: "sha256"},
    { foo: "bar" }
  );

  do_check_eq("bar", result.json.foo);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});
