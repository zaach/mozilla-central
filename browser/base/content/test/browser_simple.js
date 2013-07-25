/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function test() {
  waitForExplicitFinish();

  let testURI = "http://example.org/browser/browser/base/content/test/dummy_page.html";

  let tab = gBrowser.addTab();
  tab.linkedBrowser.loadURI(testURI);
  window.setTimeout(function () { ok(true, "removing tab"); gBrowser.removeTab(tab); finish(); }, 5000);
}
