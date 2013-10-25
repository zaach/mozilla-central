/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

Cu.import("resource://services-common/hawkClient.js");
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

  let result = yield HawkClient.request(server.baseURI + "/foo", {
    method: method,
    credentials: {id: id, key: key, algorithm: "sha256"},
  });

  do_check_eq(message, result.responseText);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});

add_task(function test_authenticated_post_request() {
  _("Ensure that sending a Hawk authenticated POST request works as expected.");

  let id = "eyJleHBpcmVzIjogMTM2NTAxMDg5OC4x";
  let key = "qTZf4ZFpAMpMoeSsX3zVRjiqmNs=";
  let method = "POST";

  let server = httpd_setup({"/foo": function(request, response) {
      do_check_true(request.hasHeader("Authorization"));

      response.setStatusLine(request.httpVersion, 200, "OK");
      response.bodyOutputStream.writeFrom(request.bodyInputStream, request.bodyInputStream.available());
    }
  });

  let result = yield HawkClient.request(server.baseURI + "/foo", {
    method: method,
    credentials: {id: id, key: key, algorithm: "sha256"},
    payload: "oh hai"
  });

  do_check_eq("oh hai", result.responseText);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});

add_task(function test_authenticated_json_request() {
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

  let result = yield HawkClient.request(server.baseURI + "/foo", {
    method: method,
    credentials: {id: id, key: key, algorithm: "sha256"},
    json: { foo: "bar" }
  });

  do_check_eq("bar", result.json.foo);
  do_check_eq(200, result.status);

  yield deferredStop(server);
  run_next_test();
});
