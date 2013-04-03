/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "JavaScriptChild.h"
#include "mozilla/dom/ContentChild.h"
#include "nsContentUtils.h"
#include "xpcprivate.h"
#include "jsfriendapi.h"

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
    if (!obj) {
        *idp = 0;
        return true;
    }

    ObjectId id = ids_.find(obj);
    if (id) {
        *idp = id;
        return true;
    }

    id = ++lastId_;
    if (id > (unsigned(JSVAL_INT_MAX) >> OBJECT_EXTRA_BITS))
        return false;

    id <<= OBJECT_EXTRA_BITS;
    if (JS_ObjectIsCallable(cx, obj))
        id |= OBJECT_IS_CALLABLE;

    if (!objects_.add(id, obj))
        return false;
    if (!ids_.add(obj, id))
        return false;

    *idp = id;
    return true;
}

JSObject *
JavaScriptChild::unwrap(JSContext *cx, ObjectId id)
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

    // The outparam will be written to the buffer, so it must be set even if
    // the parent won't read it.
    *result = void_t();

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
                                const nsTArray<JSParam> &argv,
                                ReturnStatus *rs,
                                JSVariant *result,
                                nsTArray<JSParam> *outparams)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    // The outparam will be written to the buffer, so it must be set even if
    // the parent won't read it.
    *result = void_t();

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
    JS::AutoValueVector outobjects(cx);
    for (size_t i = 0; i < argv.Length(); i++) {
        if (argv[i].type() == JSParam::Tvoid_t) {
            // This is an outparam.
            JSCompartment *compartment = js::GetContextCompartment(cx);
            JSObject *global = JS_GetGlobalForCompartmentOrNull(cx, compartment); 
            JSObject *obj = xpc_NewOutObject(cx, global);
            if (!obj)
                return fail(cx, rs);
            if (!outobjects.append(OBJECT_TO_JSVAL(obj)))
                return fail(cx, rs);
            if (!vals.append(OBJECT_TO_JSVAL(obj)))
                return fail(cx, rs);
        } else {
            jsval v;
            if (!toValue(cx, argv[i].get_JSVariant(), &v))
                return fail(cx, rs);
            if (!vals.append(v))
                return fail(cx, rs);
        }
    }

    uint32_t oldOpts =
        JS_SetOptions(cx, JS_GetOptions(cx) | JSOPTION_DONT_REPORT_UNCAUGHT);

    jsval rval;
    bool success = JS::Call(cx, vals[1], vals[0], vals.length() - 2, vals.begin() + 2, &rval);

    JS_SetOptions(cx, oldOpts);

    if (!success)
        return fail(cx, rs);

    if (!toVariant(cx, rval, result))
        return fail(cx, rs);

    // Prefill everything with a dummy jsval.
    for (size_t i = 0; i < outobjects.length(); i++)
        outparams->AppendElement(JSParam(JSVariant(false)));

    // Go through each argument that was an outparam, retrieve the "value"
    // field, and add it to a temporary list. We need to do this separately
    // because the outparams vector is not rooted.
    vals.clear();
    for (size_t i = 0; i < outobjects.length(); i++) {
        JSObject *obj = JSVAL_TO_OBJECT(outobjects[i]);

        jsval v;
        JSBool found;
        if (JS_HasProperty(cx, obj, "value", &found)) {
            if (!JS_GetProperty(cx, obj, "value", &v))
                return fail(cx, rs);
        } else {
            v = JSVAL_VOID;
            outparams->ReplaceElementAt(i, JSParam(void_t()));
        }
        if (!vals.append(v))
            return fail(cx, rs);
    }

    // Copy the outparams. If any outparam is already set to a void_t, we
    // treat this as the outparam never having been set.
    for (size_t i = 0; i < vals.length(); i++) {
        if (outparams->ElementAt(i).type() == JSParam::Tvoid_t)
            continue;
        JSVariant variant;
        if (!toVariant(cx, vals[i], &variant))
            return fail(cx, rs);
        outparams->ReplaceElementAt(i, JSParam(variant));
    }

    return ok(rs);
}

bool
JavaScriptChild::AnswerInstanceOf(const ObjectId &objId,
                                  const JSIID &iid,
                                  ReturnStatus *rs,
                                  bool *instanceof)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    JSObject *obj = objects_.find(objId);
    if (!obj)
        return false;

    JSAutoCompartment comp(cx, obj);

    nsID nsiid;
    ConvertID(iid, &nsiid);

    nsresult rv = xpc_HasInstance(cx, obj, &nsiid, instanceof);
    if (rv != NS_OK)
        return fail(cx, rs);

    return ok(rs);
}

bool
JavaScriptChild::AnswerGetPropertyDescriptor(const uint32_t &objId,
                                             const nsString &id,
                                             const uint32_t &flags,
                                             ReturnStatus *rs,
                                             PPropertyDescriptor *out)
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
    if (!JS_GetPropertyDescriptorById(cx, obj, internedId, flags, &desc))
        return fail(cx, rs);

    if (!fromDesc(cx, desc, out))
        return fail(cx, rs);

    return ok(rs);
}

bool
JavaScriptChild::AnswerObjectClassIs(const uint32_t &objId,
                                     const uint32_t &classValue,
                                     bool *result)
{
    SafeAutoJSContext cx;
    JSAutoRequest request(cx);

    JS::RootedObject obj(cx, objects_.find(objId));
    if (!obj)
        return false;

    JSAutoCompartment comp(cx, obj);

    *result = js_ObjectClassIs(cx, obj, (js::ESClassValue)classValue);

    return true;
}

