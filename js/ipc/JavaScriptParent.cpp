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
#include "js/HeapAPI.h"
#include "xpcprivate.h"

using namespace js;
using namespace JS;
using namespace mozilla;
using namespace mozilla::jsipc;

class JavaScriptParentUtils MOZ_FINAL : public nsIJavaScriptParent
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

int sCPOWProxyHandler;

class CPOWProxyHandler : public BaseProxyHandler
{
  public:
    CPOWProxyHandler()
      : BaseProxyHandler(&sCPOWProxyHandler) {}
    virtual ~CPOWProxyHandler() {}

    virtual bool finalizeInBackground(Value priv) {
        return false;
    }

    virtual bool getPropertyDescriptor(JSContext *cx, HandleObject proxy, HandleId id,
                                       PropertyDescriptor *desc, unsigned flags);
    virtual bool getOwnPropertyDescriptor(JSContext *cx, HandleObject proxy,
                                          HandleId id, PropertyDescriptor *desc, unsigned flags);
    virtual bool defineProperty(JSContext *cx, HandleObject proxy, HandleId id,
                                PropertyDescriptor *desc);
    virtual bool getOwnPropertyNames(JSContext *cx, HandleObject proxy,
                                     AutoIdVector &props);
    virtual bool delete_(JSContext *cx, HandleObject proxy, HandleId id, bool *bp);
    virtual bool enumerate(JSContext *cx, HandleObject proxy, AutoIdVector &props);

    virtual bool has(JSContext *cx, HandleObject proxy, HandleId id, bool *bp);
    virtual bool hasOwn(JSContext *cx, HandleObject proxy, HandleId id, bool *bp);
    virtual bool get(JSContext *cx, HandleObject proxy, HandleObject receiver,
                     HandleId id, MutableHandleValue vp);
    virtual bool set(JSContext *cx, JS::HandleObject proxy, JS::HandleObject receiver,
                     JS::HandleId id, bool strict, JS::MutableHandleValue vp);
    virtual bool keys(JSContext *cx, HandleObject proxy, AutoIdVector &props);
    virtual bool iterate(JSContext *cx, HandleObject proxy, unsigned flags,
                         MutableHandleValue vp);

    virtual bool call(JSContext *cx, HandleObject proxy, const CallArgs &args);
    virtual void finalize(JSFreeOp *fop, JSObject *proxy);
    virtual bool objectClassIs(HandleObject obj, js::ESClassValue classValue, JSContext *cx);
    virtual const char* className(JSContext *cx, HandleObject proxy);
    virtual bool preventExtensions(JSContext *cx, HandleObject proxy);
    virtual bool isExtensible(JSObject *proxy);

    static CPOWProxyHandler singleton;
};

CPOWProxyHandler CPOWProxyHandler::singleton;

bool
JavaScriptParent::getPropertyDescriptor(JSContext *cx, HandleObject proxy, HandleId id,
                                        PropertyDescriptor *desc, unsigned flags)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString idstr;
    if (!toGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    PPropertyDescriptor result;
    if (!CallGetPropertyDescriptor(objId, idstr, flags, &status, &result))
        return ipcfail(cx);
    if (!ok(cx, status))
        return false;

    return toDesc(cx, result, desc);
}


bool
CPOWProxyHandler::getPropertyDescriptor(JSContext *cx, HandleObject proxy, HandleId id,
                                        PropertyDescriptor *desc, unsigned flags)
{
    return ParentOf(proxy)->getPropertyDescriptor(cx, proxy, id, desc, flags);
}

bool
JavaScriptParent::getOwnPropertyDescriptor(JSContext *cx, HandleObject proxy, HandleId id,
                                           PropertyDescriptor *desc, unsigned flags)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString idstr;
    if (!toGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    PPropertyDescriptor result;
    if (!CallGetOwnPropertyDescriptor(objId, idstr, flags, &status, &result))
        return ipcfail(cx);
    if (!ok(cx, status))
        return false;

    return toDesc(cx, result, desc);
}

bool
CPOWProxyHandler::getOwnPropertyDescriptor(JSContext *cx, HandleObject proxy,
                                           HandleId id, PropertyDescriptor *desc, unsigned flags)
{
    return ParentOf(proxy)->getOwnPropertyDescriptor(cx, proxy, id, desc, flags);
}

bool
CPOWProxyHandler::defineProperty(JSContext *cx, HandleObject proxy, HandleId id,
                                 PropertyDescriptor *desc)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
JavaScriptParent::getOwnPropertyNames(JSContext *cx, HandleObject proxy, AutoIdVector &props)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    ReturnStatus status;
    InfallibleTArray<nsString> names;
    if (!CallGetOwnPropertyNames(objId, &status, &names))
        return ipcfail(cx);
    if (!ok(cx, status))
        return false;

    for (size_t i = 0; i < names.Length(); i++) {
        jsid name;
        if (!toId(cx, names[i], &name))
            return false;
        if (!props.append(name))
            return false;
    }

    return true;
}

bool
CPOWProxyHandler::getOwnPropertyNames(JSContext *cx, HandleObject proxy, AutoIdVector &props)
{
    return ParentOf(proxy)->getOwnPropertyNames(cx, proxy, props);
}

bool
JavaScriptParent::keys(JSContext *cx, HandleObject proxy, AutoIdVector &props)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    ReturnStatus status;
    InfallibleTArray<nsString> names;
    if (!CallKeys(objId, &status, &names))
        return ipcfail(cx);
    if (!ok(cx, status))
        return false;

    for (size_t i = 0; i < names.Length(); i++) {
        jsid name;
        if (!toId(cx, names[i], &name))
            return false;
        if (!props.append(name))
            return false;
    }

    return true;
}

bool
CPOWProxyHandler::keys(JSContext *cx, HandleObject proxy, AutoIdVector &props)
{
    return ParentOf(proxy)->keys(cx, proxy, props);
}

bool
CPOWProxyHandler::delete_(JSContext *cx, HandleObject proxy, HandleId id, bool *bp)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
CPOWProxyHandler::enumerate(JSContext *cx, HandleObject proxy, AutoIdVector &props)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
JavaScriptParent::preventExtensions(JSContext *cx, HandleObject proxy)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    ReturnStatus status;
    if (!CallPreventExtensions(objId, &status))
        return ipcfail(cx);

    return ok(cx, status);
}

bool
CPOWProxyHandler::preventExtensions(JSContext *cx, HandleObject proxy)
{
    return ParentOf(proxy)->preventExtensions(cx, proxy);
}

bool
JavaScriptParent::isExtensible(JSObject *proxy)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    bool extensible;
    ReturnStatus status;
    if (!CallIsExtensible(objId, &extensible))
        return false;

    return extensible;
}

bool
CPOWProxyHandler::isExtensible(JSObject *proxy)
{
    return ParentOf(proxy)->isExtensible(proxy);
}

bool
JavaScriptParent::has(JSContext *cx, HandleObject proxy, HandleId id, bool *bp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString idstr;
    if (!toGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    if (!CallHasHook(objId, idstr, &status, bp))
        return ipcfail(cx);

    return ok(cx, status);
}

bool
CPOWProxyHandler::has(JSContext *cx, HandleObject proxy, HandleId id, bool *bp)
{
    return ParentOf(proxy)->has(cx, proxy, id, bp);
}

bool
JavaScriptParent::hasOwn(JSContext *cx, HandleObject proxy, HandleId id, bool *bp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString idstr;
    if (!toGecko(cx, id, &idstr))
        return JS_FALSE;

    ReturnStatus status;
    if (!CallHasOwnHook(objId, idstr, &status, bp))
        return ipcfail(cx);

    return !!ok(cx, status);
}

bool
CPOWProxyHandler::hasOwn(JSContext *cx, HandleObject proxy, HandleId id, bool *bp)
{
    return ParentOf(proxy)->hasOwn(cx, proxy, id, bp);
}

bool
JavaScriptParent::get(JSContext *cx, HandleObject proxy, HandleObject receiver,
                      HandleId id, MutableHandleValue vp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    uint32_t receiverId = IdOf(receiver);
    MOZ_ASSERT(receiverId);

    nsString idstr;
    if (!toGecko(cx, id, &idstr))
        return false;

    JSVariant val;
    ReturnStatus status;
    if (!CallGetHook(objId, receiverId, idstr, &status, &val))
        return ipcfail(cx);

    if (!ok(cx, status))
        return false;

    return toValue(cx, val, vp);
}

bool
CPOWProxyHandler::get(JSContext *cx, HandleObject proxy, HandleObject receiver,
                      HandleId id, MutableHandleValue vp)
{
    return ParentOf(proxy)->get(cx, proxy, receiver, id, vp);
}

bool
JavaScriptParent::set(JSContext *cx, JS::HandleObject proxy, JS::HandleObject receiver,
                      JS::HandleId id, bool strict, JS::MutableHandleValue vp)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    uint32_t receiverId = IdOf(receiver);
    MOZ_ASSERT(receiverId);

    nsString idstr;
    if (!toGecko(cx, id, &idstr))
        return false;

    JSVariant val;
    if (!toVariant(cx, vp, &val))
        return false;

    ReturnStatus status;
    JSVariant result;
    if (!CallSetHook(objId, receiverId, idstr, strict, val, &status, &result))
        return ipcfail(cx);

    if (!ok(cx, status))
        return false;

    return toValue(cx, result, vp);
}

bool
CPOWProxyHandler::set(JSContext *cx, JS::HandleObject proxy, JS::HandleObject receiver,
                      JS::HandleId id, bool strict, JS::MutableHandleValue vp)
{
    return ParentOf(proxy)->set(cx, proxy, receiver, id, strict, vp);
}

bool
CPOWProxyHandler::iterate(JSContext *cx, HandleObject proxy, unsigned flags,
                          MutableHandleValue vp)
{
    MOZ_NOT_REACHED("unimplemented");
}

bool
JavaScriptParent::call(JSContext *cx, HandleObject proxy, const CallArgs &args)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    InfallibleTArray<JSParam> vals;
    AutoValueVector outobjects(cx);

    RootedValue v(cx);
    for (size_t i = 0; i < args.length() + 2; i++) {
        v = args.base()[i];
        if (v.isObject()) {
            JSObject *obj = JSVAL_TO_OBJECT(v);
            if (xpc_IsOutObject(cx, obj)) {
                vals.AppendElement(JSParam(void_t()));
                if (!outobjects.append(ObjectValue(*obj)))
                    return false;
                continue;
            }
        }
        JSVariant val;
        if (!toVariant(cx, v, &val))
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
        if (!toValue(cx, outparams[i], &v))
            return false;

        JSObject *obj = JSVAL_TO_OBJECT(outobjects[i]);
        if (!JS_SetProperty(cx, obj, "value", v.address()))
            return false;
    }

    if (!toValue(cx, result, args.rval()))
        return false;

    return true;
}

bool
CPOWProxyHandler::call(JSContext *cx, HandleObject proxy, const CallArgs &args)
{
    return ParentOf(proxy)->call(cx, proxy, args);
}

void
CPOWProxyHandler::finalize(JSFreeOp *fop, JSObject *proxy)
{
    ParentOf(proxy)->drop(proxy);
}

bool
JavaScriptParent::objectClassIs(JSContext *cx, HandleObject proxy, js::ESClassValue classValue)
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
CPOWProxyHandler::objectClassIs(HandleObject proxy, js::ESClassValue classValue, JSContext *cx)
{
    return ParentOf(proxy)->objectClassIs(cx, proxy, classValue);
}

const char *
JavaScriptParent::className(JSContext *cx, HandleObject proxy)
{
    uint32_t objId = IdOf(proxy);
    MOZ_ASSERT(objId);

    nsString name;
    if (!CallClassName(objId, &name))
        return NULL;

    return ToNewCString(name);
}

const char *
CPOWProxyHandler::className(JSContext *cx, HandleObject proxy)
{
    return ParentOf(proxy)->className(cx, proxy);
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
        if (!JS_WrapObject(cx, &obj))
            return NULL;
        return obj;
    }

    bool callable = !!(objId & OBJECT_IS_CALLABLE);
    RootedObject someObj(cx, JS_GetGlobalForCompartmentOrNull(cx, GetContextCompartment(cx)));
    RootedObject someObj2(cx);

    JSObject *obj = NewProxyObject(cx,
                                   &CPOWProxyHandler::singleton,
                                   UndefinedHandleValue,
                                   NULL,
                                   someObj,
                                   callable ? ProxyIsCallable : ProxyNotCallable);
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
    if (!SendDropObject(objId))
        MOZ_CRASH();
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

    RootedValue exn(cx);
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
