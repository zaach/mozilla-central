/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "JavaScriptChild.h"
#include "mozilla/dom/ContentChild.h"
#include "nsContentUtils.h"

using namespace mozilla;
using namespace mozilla::jsipc;

using mozilla::SafeAutoJSContext;

JavaScriptChild::JavaScriptChild(JSRuntime *rt)
  : lastId_(0),
    rt_(rt)
{
}

static void
Trace(JSTracer *trc, void *data)
{
    reinterpret_cast<JavaScriptChild *>(data)->trace(trc);
}

JavaScriptChild::~JavaScriptChild()
{
    JS_RemoveExtraGCRootsTracer(rt_, Trace, this);
}

void
JavaScriptChild::trace(JSTracer *trc)
{
    objects_.trace(trc);
    ids_.trace(trc);
}

bool
JavaScriptChild::init()
{
    if (!JavaScriptShared::init())
        return false;
    if (!ids_.init())
        return false;

    JS_AddExtraGCRootsTracer(rt_, Trace, this);
    return true;
}

bool
JavaScriptChild::RecvDropObject(const ObjectId &objId)
{
    JSObject *obj = objects_.find(objId);
    if (obj) {
        ids_.remove(obj);
        objects_.remove(objId);
    }
    return true;
}

static inline bool
ToId(JSContext *cx, const nsString &from, jsid *to)
{
    JSString *str = JS_NewUCStringCopyN(cx, from.BeginReading(), from.Length());
    if (!str)
        return false;

    return JS_ValueToId(cx, STRING_TO_JSVAL(str), to);
}

ObjectId
JavaScriptChild::Send(JSContext *cx, JSObject *obj)
{
    ObjectId objId;
    if (!makeId(cx, obj, &objId)) {
        JS_ReportError(cx, "child IPC error %d", __LINE__);
        return 0;
    }
    return objId;
}

bool
JavaScriptChild::makeId(JSContext *cx, JSObject *obj, ObjectId *idp)
{
    ObjectId id = ids_.find(obj);
    if (id) {
        *idp = id;
        return true;
    }

    id = ++lastId_;
    if (id > unsigned(JSVAL_INT_MAX))
        return false;

    if (!objects_.add(id, obj))
        return false;
    if (!ids_.add(obj, id))
        return false;

    *idp = id;
    return true;
}

JSObject *
JavaScriptChild::unwrap(JSContext *cx, ObjectId id, bool callable)
{
    JSObject *obj = objects_.find(id);
    if (!obj) {
        JS_ReportError(cx, "ipc sent unknown object %d", id);
        return NULL;
    }
    return obj;
}

bool
JavaScriptChild::fail(JSContext *cx, ReturnStatus *rs)
{
    // By default, we set |undefined| unless we can get a more meaningful
    // exception.
    *rs = ReturnStatus(false, JSVariant(void_t()));

    // Note we always return true from this function, since this propagates
    // to the IPC code, and we don't want a JS failure to cause the death
    // of the child process.

    jsval exn;
    if (!JS_GetPendingException(cx, &exn))
        return true;

    // If we don't clear the pending exception, JS will try to wrap it as it
    // leaves the current compartment. Since there is no previous compartment,
    // that would crash.
    JS_ClearPendingException(cx);

    if (!toVariant(cx, exn, &rs->exn()))
        return true;

    return true;
}

bool
JavaScriptChild::ok(ReturnStatus *rs)
{
    *rs = ReturnStatus(true, JSVariant(void_t()));
    return true;
}

bool
JavaScriptChild::AnswerHasHook(const ObjectId &objId, const nsString &id,
                               ReturnStatus *rs, bool *bp)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    JSObject *obj = objects_.find(objId);
    if (!obj)
        return false;

    JSAutoCompartment comp(cx, obj);

    jsid internedId;
    if (!ToId(cx, id, &internedId))
        return fail(cx, rs);

    JSBool found;
    if (!JS_HasPropertyById(cx, obj, internedId, &found))
        return fail(cx, rs);
    *bp = !!found;

    return ok(rs);
}

bool
JavaScriptChild::AnswerHasOwnHook(const ObjectId &objId, const nsString &id,
                                  ReturnStatus *rs, bool *bp)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    JSObject *obj = objects_.find(objId);
    if (!obj)
        return false;

    JSAutoCompartment comp(cx, obj);

    jsid internedId;
    if (!ToId(cx, id, &internedId))
        return fail(cx, rs);

    JSPropertyDescriptor desc;
    if (!JS_GetPropertyDescriptorById(cx, obj, internedId, 0, &desc))
        return fail(cx, rs);
    *bp = (desc.obj == obj);

    return ok(rs);
}

bool
JavaScriptChild::AnswerGetHook(const ObjectId &objId, const ObjectId &receiverId,
                               const nsString &id,
                               ReturnStatus *rs, JSVariant *result)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    JSObject *obj = objects_.find(objId);
    if (!obj)
        return false;

    JSObject *receiver = objects_.find(receiverId);
    if (!receiver)
        return false;

    JSAutoCompartment comp(cx, obj);

    jsid internedId;
    if (!ToId(cx, id, &internedId))
        return fail(cx, rs);

    JS::Value val;
    if (!JS_ForwardGetPropertyTo(cx, obj, internedId, receiver, &val))
        return fail(cx, rs);

    if (!toVariant(cx, val, result))
        return fail(cx, rs);

    return ok(rs);
}

bool
JavaScriptChild::AnswerSetHook(const ObjectId &objId, const ObjectId &receiverId,
                               const nsString &id, const bool &strict,
                               ReturnStatus *rs, JSVariant *result)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    JSObject *obj = objects_.find(objId);
    if (!obj)
        return false;

    JSObject *receiver = objects_.find(receiverId);
    if (!receiver)
        return false;

    JSAutoCompartment comp(cx, obj);

    jsid internedId;
    if (!ToId(cx, id, &internedId))
        return fail(cx, rs);

    MOZ_ASSERT(obj == receiver);

    JS::Value val;
    if (!JS_SetPropertyById(cx, obj, internedId, &val))
        return fail(cx, rs);

    if (!toVariant(cx, val, result))
        return fail(cx, rs);

    return ok(rs);
}

bool
JavaScriptChild::AnswerCallHook(const ObjectId &objId,
                                const InfallibleTArray<JSVariant> &argv,
                                ReturnStatus *rs, JSVariant *result)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    JSObject *obj = objects_.find(objId);
    if (!obj)
        return false;

    MOZ_ASSERT(argv.Length() >= 2);

    jsval objv;
    if (!toValue(cx, argv[0], &objv))
        return fail(cx, rs);

    JSAutoCompartment comp(cx, JSVAL_TO_OBJECT(objv));

    *result = JSVariant(void_t());

    JS::AutoValueVector vals(cx);
    for (size_t i = 0; i < argv.Length(); i++) {
        jsval v;
        if (!toValue(cx, argv[i], &v))
            return fail(cx, rs);
        if (!vals.append(v))
            return fail(cx, rs);
    }

    jsval rval;
    if (!JS::Call(cx, vals[1], vals[0], vals.length() - 2, vals.begin() + 2, &rval))
        return fail(cx, rs);

    if (!toVariant(cx, rval, result))
        return fail(cx, rs);

    return ok(rs);
}
