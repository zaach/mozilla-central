/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Note: this is never instantiated in chrome - the source is sent across
// to the worker and it is evaluated there and created in response to a
// port-create message we send.

function importScripts() {
  for (var i=0; i < arguments.length; i++) {
    // load the url *synchronously*
    var scriptURL = arguments[i];
    var xhr = new XMLHttpRequest();
    xhr.open('GET', scriptURL, false);
    xhr.onreadystatechange = function(aEvt) {
      if (xhr.readyState == 4) {
        if (xhr.status == 200 || xhr.status == 0) {
          _evalInSandbox(xhr.responseText);
        }
        else {
          throw new Error("Unable to importScripts ["+scriptURL+"], status " + xhr.status)
        }
      }
    };
    xhr.send(null);
  }
}

// This function is magically injected into the sandbox and used there.
// Thus, it is only ever dealing with "worker" ports.
function __initWorkerMessageHandler() {

  function messageHandler(event) {
    // We will ignore all messages destined for otherType.
    let data = event.data;
    switch (data.portTopic) {
      case "port-create":
        // and call the "onconnect" handler.
        try {
          onconnect({ports: [data.port]});
        } catch(e) {
          // we have a bad worker and cannot continue, we need to signal
          // an error
          port._postControlMessage("port-connection-error", JSON.stringify(e.toString()));
          throw e;
        }
        break;

      default:
        break;
    }
  }
  // addEventListener is injected into the sandbox.
  _addEventListener('message', messageHandler);
}
__initWorkerMessageHandler();
