/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "JavaScriptParent.h"
#include "mozilla/dom/ContentParent.h"
#include "nsJSUtils.h"

using namespace js;
using namespace mozilla;
using namespace mozilla::jsipc;

JavaScriptParent::JavaScriptParent()
{
}

static const unsigned ID_SLOT = 0;
static const unsigned NUM_SLOTS = ID_SLOT + 1;

static JSClass CpowClass = {
    "CPOW",
    JSCLASS_NEW_RESOLVE |
        JSCLASS_NEW_ENUMERATE |
        JSCLASS_HAS_PRIVATE |
        JSCLASS_HAS_RESERVED_SLOTS(NUM_SLOTS),
    JavaScriptParent::AddProperty,
    JavaScriptParent::DeleteProperty,
    JavaScriptParent::GetProperty,
    JavaScriptParent::SetProperty,
    (JSEnumerateOp)JavaScriptParent::NewEnumerate,
    (JSResolveOp)JavaScriptParent::NewResolve,
    JS_ConvertStub,
    JavaScriptParent::Finalize,

    NULL,   /* checkAccess */
    JavaScriptParent::Call,
    NULL,   /* hasInstance */
    NULL,   /* construct */
    NULL    /* trace */
};

bool
JavaScriptParent::init()
{
    if (!JavaScriptShared::init())
        return false;

    return true;
}

bool
JavaScriptParent::makeId(JSContext *cx, JSObject *obj, ObjectId *idp)
{
    if (JS_GetClass(obj) != &CpowClass) {
        JS_ReportError(cx, "cannot ipc non-cpow object");
        return false;
    }

    *idp = IdOf(obj);
    return true;
}

JSObject *
JavaScriptParent::wrap(JSContext *cx, ObjectId objId)
{
    if (JSObject *obj = objects_.find(objId))
        return obj;

    JSObject *obj = JS_NewObject(cx, &CpowClass, NULL, NULL);
    if (!obj)
        return NULL;

    if (!objects_.add(objId, obj))
        return NULL;

    JS_SetPrivate(obj, this);
    JS_SetReservedSlot(obj, ID_SLOT, INT_TO_JSVAL(objId));
    return obj;
}

static inline JavaScriptParent *
ParentOf(JSObject *obj)
{
    return reinterpret_cast<JavaScriptParent *>(JS_GetPrivate(obj));
}

ObjectId
JavaScriptParent::IdOf(JSObject *obj)
{
    ObjectId objId = JSVAL_TO_INT(JS_GetReservedSlot(obj, ID_SLOT));
    MOZ_ASSERT(objects_.find(objId) == obj);
    return objId;
}

static bool
ToGecko(JSContext *cx, JSHandleId id, nsString *to)
{
    jsval idval;
    if (!JS_IdToValue(cx, id, &idval))
        return false;

    JSString *str = JS_ValueToString(cx, idval);
    if (!str)
        return false;

    const jschar *chars = JS_GetStringCharsZ(cx, str);
    if (!chars)
        return false;

    *to = chars;
    return true;
}

void
JavaScriptParent::drop(JSObject *obj)
{
    uint32_t objId = IdOf(obj);

    objects_.remove(objId);
    
    if (!SendDropObject(objId))
        return;
}

JSBool
JavaScriptParent::addProperty(JSContext *cx, JSHandleObject obj, JSHandleId id)
{
    uint32_t objId = IdOf(obj);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    if (!CallAddProperty(objId, idstr, &status))
        return ipcfail(cx);

    return !!ok(cx, status);
}

JSBool
JavaScriptParent::deleteProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp)
{
    uint32_t objId = IdOf(obj);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    JSVariant val;
    ReturnStatus status;
    if (!CallDeleteProperty(objId, idstr, &status, &val))
        return ipcfail(cx);
    if (!ok(cx, status))
        return JS_FALSE;

    return toValue(cx, val, vp.address());
}

JSBool
JavaScriptParent::getProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp)
{
    uint32_t objId = IdOf(obj);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    JSVariant val;
    ReturnStatus status;
    if (!CallGetProperty(objId, idstr, &status, &val))
        return ipcfail(cx);
    if (!ok(cx, status))
        return JS_FALSE;

    return toValue(cx, val, vp.address());
}

JSBool
JavaScriptParent::setProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSBool strict, JSMutableHandleValue vp)
{
    uint32_t objId = IdOf(obj);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    JSVariant val;
    if (!toVariant(cx, vp, &val))
        return JS_FALSE;

    // Note, the strict parameter ends up unused for now.
    JSVariant result;
    ReturnStatus status;
    if (!CallSetProperty(objId, idstr, val, &status, &result))
        return ipcfail(cx);
    if (!ok(cx, status))
        return JS_FALSE;

    return toValue(cx, result, vp.address());
}

JSBool
JavaScriptParent::resolve(JSContext *cx, JSHandleObject obj, JSHandleId id, unsigned flags, JSMutableHandleObject objp)
{
    uint32_t objId = IdOf(obj);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    uint32_t obj2;
    ReturnStatus status;
    if (!CallNewResolve(objId, idstr, flags, &status, &obj2))
        return ipcfail(cx);
    if (!ok(cx, status))
        return JS_FALSE;

    if (!obj2) {
        objp.set(NULL);
    } else {
        JSObject *wrapped = wrap(cx, obj2);
        if (!wrapped)
            return JS_FALSE;
        objp.set(wrapped);
    }

    return JS_TRUE;
}

JSBool
JavaScriptParent::enumerate(JSContext *cx, JSHandleObject obj, JSIterateOp enum_op,
                            JSMutableHandleValue statep, JSMutableHandleId idp)
{
    JS_ReportError(cx, "NYI %s:%d", __FILE__, __LINE__);
    return JS_FALSE;
}

JSBool
JavaScriptParent::call(JSContext *cx, JSObject *obj, unsigned argc, jsval *vp)
{
    InfallibleTArray<JSVariant> vals;

    for (size_t i = 0; i < argc + 2; i++) {
        JSVariant val;
        if (!toVariant(cx, vp[i], &val))
            return JS_FALSE;
        vals.AppendElement(val);
    }

    JSVariant result;
    ReturnStatus status;
    if (!CallCall(vals, &status, &result))
        return ipcfail(cx);
    if (!ok(cx, status))
        return JS_FALSE;

    jsval rval;
    if (!toValue(cx, result, &rval))
        return JS_FALSE;

    JS_SET_RVAL(cx, vp, rval);
    return JS_TRUE;
}

JSBool
JavaScriptParent::ipcfail(JSContext *cx)
{
    JS_ReportError(cx, "catastrophic IPC failure");
    return JS_FALSE;
}

bool
JavaScriptParent::ok(JSContext *cx, const ReturnStatus &status)
{
    if (status.ok())
        return true;

    jsval exn;
    if (!toValue(cx, status.exn(), &exn))
        return false;

    JS_SetPendingException(cx, exn);
    return false;
}

JSBool
JavaScriptParent::AddProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp)
{
    return ParentOf(obj)->addProperty(cx, obj, id);
}

JSBool
JavaScriptParent::DeleteProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp)
{
    return ParentOf(obj)->deleteProperty(cx, obj, id, vp);
}

JSBool
JavaScriptParent::GetProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSMutableHandleValue vp)
{
    return ParentOf(obj)->getProperty(cx, obj, id, vp);
}

JSBool
JavaScriptParent::SetProperty(JSContext *cx, JSHandleObject obj, JSHandleId id, JSBool strict, JSMutableHandleValue vp)
{
    return ParentOf(obj)->setProperty(cx, obj, id, strict, vp);
}

JSBool
JavaScriptParent::NewEnumerate(JSContext *cx, JSHandleObject obj, JSIterateOp enum_op,
                               JSMutableHandleValue statep, JSMutableHandleId idp)
{
    return ParentOf(obj)->enumerate(cx, obj, enum_op, statep, idp);
}

JSBool
JavaScriptParent::Call(JSContext *cx, unsigned argc, jsval *vp)
{
    JSObject *callee = &JS_CALLEE(cx, vp).toObject();
    return ParentOf(callee)->call(cx, callee, argc, vp);
}

JSBool
JavaScriptParent::NewResolve(JSContext *cx, JSHandleObject obj, JSHandleId id, unsigned flags, JSMutableHandleObject objp)
{
    return ParentOf(obj)->resolve(cx, obj, id, flags, objp);
}

void
JavaScriptParent::Finalize(JSFreeOp *fop, JSObject *obj)
{
    ParentOf(obj)->drop(obj);
}

