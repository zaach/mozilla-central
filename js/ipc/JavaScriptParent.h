/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_jsipc_JavaScriptParent__
#define mozilla_jsipc_JavaScriptParent__

#include "mozilla/jsipc/PJavaScriptParent.h"
#include "JavaScriptShared.h"

namespace mozilla {
namespace jsipc {

class JavaScriptParent
  : public PJavaScriptParent,
    public JavaScriptShared
{
  public:
    JavaScriptParent();

    bool init();

  public:
    static JSBool AddProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp);
    static JSBool DeleteProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp);
    static JSBool GetProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp);
    static JSBool SetProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSBool strict, JSMutableHandleValue vp);
    static JSBool NewEnumerate(JSContext *cx, JSHandleObject obj, JSIterateOp enum_op,
                               JSMutableHandleValue statep, JSMutableHandleId idp);
    static JSBool NewResolve(JSContext *cx, JSHandleObject obj, JSHandleId id,
                             unsigned flags, JSMutableHandleObject objp);
    static void Finalize(JSFreeOp *fop, JSObject *obj);
    static JSBool Call(JSContext *cx, unsigned argc, jsval *vp);

    JSObject *Wrap(JSContext *cx, ObjectId objId) {
        JSAutoRequest request(cx);
        return wrap(cx, objId);
    }

  private:
    void drop(JSObject *obj);
    JSBool addProperty(JSContext *cx, JSHandleObject obj, JSHandleId id);
    JSBool deleteProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp);
    JSBool getProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp);
    JSBool setProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSBool strict, JSMutableHandleValue vp);
    JSBool resolve(JSContext *cx, JSHandleObject obj, JSHandleId id, unsigned flags, JSMutableHandleObject objp);
    JSBool enumerate(JSContext *cx, JSHandleObject obj, JSIterateOp enum_op,
                     JSMutableHandleValue statep, JSMutableHandleId idp);
    JSBool call(JSContext *cx, JSObject *callee, unsigned argc, jsval *vp);

  protected:
    JSObject *wrap(JSContext *cx, ObjectId objId);

  private:
    bool makeId(JSContext *cx, JSObject *obj, ObjectId *idp);
    ObjectId IdOf(JSObject *obj);

    // Catastrophic IPC failure.
    JSBool ipcfail(JSContext *cx);

    // Check whether a return status is okay, and if not, propagate its error.
    bool ok(JSContext *cx, const ReturnStatus &status);
};

} // jsipc
} // mozilla

#endif // mozilla_jsipc_JavaScriptWrapper_h__

