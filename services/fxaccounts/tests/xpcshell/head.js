/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const {classes: Cc, interfaces: Ci, results: Cr, utils: Cu} = Components;

"use strict";

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

(function initFxAccountsTestingInfrastructure() {
  do_get_profile();

  let ns = {};
  Cu.import("resource://testing-common/services-common/logging.js",
                          ns);

  ns.initTestLogging("Trace");
}).call(this);

/**
 * Test whether specified function throws exception with expected
 * result.
 *
 * @param func
 *        Function to be tested.
 * @param message
 *        Message of expected exception. <code>null</code> for no throws.
 * @param stack
 *        Optional stack object to be printed. <code>null</code> for
 *        Components#stack#caller.
 */
function do_check_throws(func, message, stack)
{
  try {
    func();
  } catch (exc) {
    do_check_eq(e.message, message);
    return;
  }

  do_throw("expected an exception, none thrown", stack);
}

