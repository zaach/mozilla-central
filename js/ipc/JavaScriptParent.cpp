/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "JavaScriptParent.h"
#include "mozilla/dom/ContentParent.h"
#include "nsJSUtils.h"
#include "jsfriendapi.h"
#include "HeapAPI.h"
#include "xpcprivate.h"

using namespace js;
using namespace mozilla;
using namespace mozilla::jsipc;

class JavaScriptParentUtils : public nsIJavaScriptParent
{
  public:
    JavaScriptParentUtils(JavaScriptParent *parent)
      : parent_(parent)
    {
    }

    NS_DECL_ISUPPORTS

    NS_IMETHODIMP Unwrap(uint32_t objId, JSContext* cx, JS::Value *_retval) {
        if (!objId) {
            *_retval = JSVAL_NULL;
            return NS_OK;
        }

        JSObject *obj = parent_->Unwrap(cx, objId);
        if (!obj)
            return NS_ERROR_UNEXPECTED;

        *_retval = OBJECT_TO_JSVAL(obj);
        return NS_OK;
    }

  private:
    JavaScriptParent *parent_;
};

NS_IMPL_ISUPPORTS1(JavaScriptParentUtils, nsIJavaScriptParent)

JavaScriptParent::JavaScriptParent()
  : refcount_(1),
    inactive_(false)
{
}

static inline JavaScriptParent *
ParentOf(JSObject *obj)
{
    return reinterpret_cast<JavaScriptParent *>(GetProxyExtra(obj, 0).toPrivate());
}

ObjectId
JavaScriptParent::IdOf(JSObject *obj)
{
    Value v = GetProxyExtra(obj, 1);
    if (!v.isInt32())
        return 0;

    ObjectId objId = v.toInt32();
    MOZ_ASSERT(objects_.find(objId) == obj);
    return objId;
}

static bool
ToGecko(JSContext *cx, jsid id, nsString *to)
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

int sCPOWProxyHandler;

class CPOWProxyHandler : public BaseProxyHandler
{
  public:
    CPOWProxyHandler()
      : BaseProxyHandler(&sCPOWProxyHandler) {}
    virtual ~CPOWProxyHandler() {}

    virtual bool finalizeInBackground(HandleValue priv) {
        return false;
    }

    virtual bool getPropertyDescriptor(JSContext *cx, JSObject *proxy, jsid id,
                                       PropertyDescriptor *desc, unsigned flags);
    virtual bool getOwnPropertyDescriptor(JSContext *cx, JSObject *proxy,
                                          jsid id, PropertyDescriptor *desc, unsigned flags);
    virtual bool defineProperty(JSContext *cx, JSObject *proxy, jsid id,
                                PropertyDescriptor *desc);
    virtual bool getOwnPropertyNames(JSContext *cx, JSObject *proxy,
                                     AutoIdVector &props);
    virtual bool delete_(JSContext *cx, JSObject *proxy, jsid id, bool *bp);
    virtual bool enumerate(JSContext *cx, JSObject *proxy,
                           AutoIdVector &props);

    virtual bool has(JSContext *cx, JSObject *proxy, jsid id, bool *bp);
    virtual bool hasOwn(JSContext *cx, JSObject *proxy, jsid id, bool *bp);
    virtual bool get(JSContext *cx, JSObject *proxy, JSObject *receiver,
                     jsid id, Value *vp);
    virtual bool set(JSContext *cx, JSObject *proxy, JSObject *receiver,
                     jsid id, bool strict, Value *vp);
    virtual bool keys(JSContext *cx, JSObject *proxy, AutoIdVector &props);
    virtual bool iterate(JSContext *cx, JSObject *proxy, unsigned flags,
                         Value *vp);

    virtual bool call(JSContext *cx, JSObject *proxy, unsigned argc, Value *vp);
    virtual void finalize(JSFreeOp *fop, JSObject *proxy);
    virtual bool objectClassIs(JSObject *obj, js::ESClassValue classValue, JSContext *cx);

    static CPOWProxyHandler singleton;
};

CPOWProxyHandler CPOWProxyHandler::singleton;

bool
CPOWProxyHandler::getPropertyDescriptor(JSContext *cx, JSObject *proxy, jsid id,
                                        PropertyDescriptor *desc, unsigned flags)
{
    return ParentOf(proxy)->getPropertyDescriptor(cx, proxy, id, desc, flags);
}

bool
CPOWProxyHandler::getOwnPropertyDescriptor(JSContext *cx, JSObject *proxy,
                                           jsid id, PropertyDescriptor *desc, unsigned flags)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
CPOWProxyHandler::defineProperty(JSContext *cx, JSObject *proxy, jsid id,
                                 PropertyDescriptor *desc)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
CPOWProxyHandler::getOwnPropertyNames(JSContext *cx, JSObject *proxy,
                                      AutoIdVector &props)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
CPOWProxyHandler::delete_(JSContext *cx, JSObject *proxy, jsid id, bool *bp)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
CPOWProxyHandler::enumerate(JSContext *cx, JSObject *proxy,
                            AutoIdVector &props)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
JavaScriptParent::has(JSContext *cx, JSObject *proxy, jsid id, bool *bp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    if (!CallHasHook(objId, idstr, &status, bp))
        return ipcfail(cx);

    return ok(cx, status);
}

bool
CPOWProxyHandler::has(JSContext *cx, JSObject *proxy, jsid id, bool *bp)
{
    return ParentOf(proxy)->has(cx, proxy, id, bp);
}

bool
JavaScriptParent::hasOwn(JSContext *cx, JSObject *proxy, jsid id, bool *bp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    if (!CallHasOwnHook(objId, idstr, &status, bp))
        return ipcfail(cx);

    return !!ok(cx, status);
}

bool
CPOWProxyHandler::hasOwn(JSContext *cx, JSObject *proxy, jsid id, bool *bp)
{
    return ParentOf(proxy)->hasOwn(cx, proxy, id, bp);
}

bool
JavaScriptParent::get(JSContext *cx, JSObject *proxy, JSObject *receiver,
                      jsid id, Value *vp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    uint32_t receiverId = IdOf(receiver);
    MOZ_ASSERT(receiverId);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    JSVariant val;
    ReturnStatus status;
    if (!CallGetHook(objId, receiverId, idstr, &status, &val))
        return ipcfail(cx);

    if (!ok(cx, status))
        return JS_FALSE;

    return toValue(cx, val, vp);
}

bool
CPOWProxyHandler::get(JSContext *cx, JSObject *proxy, JSObject *receiver,
                      jsid id, Value *vp)
{
    return ParentOf(proxy)->get(cx, proxy, receiver, id, vp);
}

bool
JavaScriptParent::set(JSContext *cx, JSObject *proxy, JSObject *receiver,
                      jsid id, bool strict, Value *vp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    uint32_t receiverId = IdOf(receiver);
    MOZ_ASSERT(receiverId);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    JSVariant val;
    ReturnStatus status;
    if (!CallSetHook(objId, receiverId, idstr, strict, &status, &val))
        return ipcfail(cx);

    if (!ok(cx, status))
        return JS_FALSE;

    return toValue(cx, val, vp);
}

bool
CPOWProxyHandler::set(JSContext *cx, JSObject *proxy, JSObject *receiver,
                      jsid id, bool strict, Value *vp)
{
    return ParentOf(proxy)->set(cx, proxy, receiver, id, strict, vp);
}

bool
CPOWProxyHandler::keys(JSContext *cx, JSObject *proxy, AutoIdVector &props)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
CPOWProxyHandler::iterate(JSContext *cx, JSObject *proxy, unsigned flags,
                          Value *vp)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
JavaScriptParent::call(JSContext *cx, JSObject *proxy, unsigned argc, Value *vp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    InfallibleTArray<JSParam> vals;
    JS::AutoValueVector outobjects(cx);

    for (size_t i = 0; i < argc + 2; i++) {
        if (vp[i].isObject()) {
            JSObject *obj = JSVAL_TO_OBJECT(vp[i]);
            if (xpc_IsOutObject(cx, obj)) {
                vals.AppendElement(JSParam(void_t()));
                if (!outobjects.append(ObjectValue(*obj)))
                    return false;
                continue;
            }
        }
        JSVariant val;
        if (!toVariant(cx, vp[i], &val))
            return false;
        vals.AppendElement(JSParam(val));
    }

    JSVariant result;
    ReturnStatus status;
    InfallibleTArray<JSParam> outparams;
    if (!CallCallHook(objId, vals, &status, &result, &outparams))
        return ipcfail(cx);
    if (!ok(cx, status))
        return false;

    if (outparams.Length() != outobjects.length())
        return ipcfail(cx);

    for (size_t i = 0; i < outparams.Length(); i++) {
        // Don't bother doing anything for outparams that weren't set.
        if (outparams[i].type() == JSParam::Tvoid_t)
            continue;

        // Take the value the child process returned, and set it on the XPC
        // object.
        jsval v;
        if (!toValue(cx, outparams[i], &v))
            return false;

        JSObject *obj = JSVAL_TO_OBJECT(outobjects[i]);
        if (!JS_SetProperty(cx, obj, "value", &v))
            return false;
    }

    jsval rval;
    if (!toValue(cx, result, &rval))
        return false;

    JS_SET_RVAL(cx, vp, rval);
    return JS_TRUE;
}

bool
CPOWProxyHandler::call(JSContext *cx, JSObject *proxy, unsigned argc, Value *vp)
{
    return ParentOf(proxy)->call(cx, proxy, argc, vp);
}

void
CPOWProxyHandler::finalize(JSFreeOp *fop, JSObject *proxy)
{
    ParentOf(proxy)->drop(proxy);
}

bool
JavaScriptParent::objectClassIs(JSContext *cx, JSObject *proxy, js::ESClassValue classValue)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    // This function is assumed infallible, so we just return false of the IPC
    // channel fails.
    bool result;
    if (!CallObjectClassIs(objId, classValue, &result))
        return false;

    return result;
}

bool
CPOWProxyHandler::objectClassIs(JSObject *proxy, ESClassValue classValue, JSContext *cx)
{
    return ParentOf(proxy)->objectClassIs(cx, proxy, classValue);
}

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
    if (!IsProxy(obj) || GetProxyHandler(obj) != &CPOWProxyHandler::singleton) {
        JS_ReportError(cx, "cannot ipc non-cpow object");
        return false;
    }

    *idp = IdOf(obj);
    return true;
}

JSObject *
JavaScriptParent::unwrap(JSContext *cx, ObjectId objId)
{
    if (JSObject *obj = objects_.find(objId)) {
        JS_ASSERT(GetObjectCompartment(obj) == GetContextCompartment(cx));
        return obj;
    }

    bool callable = !!(objId & OBJECT_IS_CALLABLE);
    JSObject *someObj = JS_GetGlobalForCompartmentOrNull(cx, GetContextCompartment(cx));
    BaseProxyHandler *handler = &CPOWProxyHandler::singleton;

    JSObject *obj = NewProxyObject(cx,
                                   handler,
                                   UndefinedValue(),
                                   NULL,
                                   NULL,
                                   callable ? someObj : NULL);
    if (!obj)
        return NULL;

    if (!objects_.add(objId, obj))
        return NULL;

    // Incref once we know the decref will be called.
    IncRef();

    SetProxyExtra(obj, 0, PrivateValue(this));
    SetProxyExtra(obj, 1, Int32Value(objId));
    return obj;
}

void
JavaScriptParent::drop(JSObject *obj)
{
    if (inactive_)
        return;

    uint32_t objId = IdOf(obj);
    if (!objId)
        return;

    objects_.remove(objId);
    SendDropObject(objId);
    DecRef();
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

void
JavaScriptParent::GetUtils(nsIJavaScriptParent **parent)
{
    if (!utils_)
        utils_ = new JavaScriptParentUtils(this);

    NS_IF_ADDREF(utils_);
    *parent = utils_;
    return;
}

void
JavaScriptParent::DecRef()
{
    refcount_--;
    if (!refcount_)
        delete this;
}

void
JavaScriptParent::IncRef()
{
    refcount_++;
}

void
JavaScriptParent::DestroyFromContent()
{
    inactive_ = true;
    DecRef();
}

/* static */ bool
JavaScriptParent::IsCPOW(JSObject *obj)
{
    return IsProxy(obj) && GetProxyHandler(obj) == &CPOWProxyHandler::singleton;
}

/* static */ nsresult
JavaScriptParent::InstanceOf(JSObject *obj, const nsID *id, bool *bp)
{
    return ParentOf(obj)->instanceOf(obj, id, bp);
}

nsresult
JavaScriptParent::instanceOf(JSObject *obj, const nsID *id, bool *bp)
{
    uint32_t objId = IdOf(obj);
    MOZ_ASSERT(objId);

    JSIID iid;
    ConvertID(*id, &iid);

    ReturnStatus status;
    if (!CallInstanceOf(objId, iid, &status, bp))
        return NS_ERROR_UNEXPECTED;

    if (!status.ok())
        return NS_ERROR_UNEXPECTED;

    return NS_OK;
}

bool
JavaScriptParent::getPropertyDescriptor(JSContext *cx, JSObject *proxy, jsid id,
                                        PropertyDescriptor *desc, unsigned flags)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString idstr;
    if (!ToGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    PPropertyDescriptor result;
    if (!CallGetPropertyDescriptor(objId, idstr, flags, &status, &result))
        return ipcfail(cx);
    if (!ok(cx, status))
        return false;

    return toDesc(cx, result, desc);
}

