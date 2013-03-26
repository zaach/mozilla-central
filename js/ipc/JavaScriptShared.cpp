/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "JavaScriptShared.h"
#include "jsfriendapi.h"
#include "xpcprivate.h"

using namespace js;
using namespace mozilla;
using namespace mozilla::jsipc;

ObjectStore::ObjectStore()
  : table_(SystemAllocPolicy())
{
}

bool
ObjectStore::init()
{
    return table_.init(32);
}

void
ObjectStore::trace(JSTracer *trc)
{
    for (ObjectTable::Range r(table_.all()); !r.empty(); r.popFront()) {
        JS_SET_TRACING_NAME(trc, "ipc-object");
        JS_CallTracer(trc, r.front().value, JSTRACE_OBJECT);
    }
}

JSObject *
ObjectStore::find(ObjectId id)
{
    ObjectTable::Ptr p = table_.lookup(id);
    if (!p)
        return NULL;
    return p->value;
}

bool
ObjectStore::add(ObjectId id, JSObject *obj)
{
    return table_.put(id, obj);
}

void
ObjectStore::remove(ObjectId id)
{
    table_.remove(id);
}

ObjectIdCache::ObjectIdCache()
  : table_(SystemAllocPolicy())
{
}

bool
ObjectIdCache::init()
{
    return table_.init(32);
}

void
ObjectIdCache::trace(JSTracer *trc)
{
    for (ObjectIdTable::Range r(table_.all()); !r.empty(); r.popFront()) {
        JS_SET_TRACING_NAME(trc, "ipc-id");
        JS_CallTracer(trc, r.front().key, JSTRACE_OBJECT);
    }
}

ObjectId
ObjectIdCache::find(JSObject *obj)
{
    ObjectIdTable::Ptr p = table_.lookup(obj);
    if (!p)
        return 0;
    return p->value;
}

bool
ObjectIdCache::add(JSObject *obj, ObjectId id)
{
    return table_.put(obj, id);
}

void
ObjectIdCache::remove(JSObject *obj)
{
    table_.remove(obj);
}

bool
JavaScriptShared::init()
{
    if (!objects_.init())
        return false;
    return true;
}

bool
JavaScriptShared::toVariant(JSContext *cx, jsval from, JSVariant *to)
{
    switch (JS_TypeOfValue(cx, from)) {
      case JSTYPE_VOID:
        *to = void_t();
        return true;

      case JSTYPE_NULL:
      {
        *to = uint32_t(0);
        return true;
      }

      case JSTYPE_OBJECT:
      case JSTYPE_FUNCTION:
      {
        JSObject *obj = JSVAL_TO_OBJECT(from);
        if (!obj) {
            JS_ASSERT(from == JSVAL_NULL);
            *to = uint32_t(0);
            return true;
        }

        if (xpc_JSObjectIsID(cx, obj)) {
            JSIID iid;
            const nsID *id = xpc_JSObjectToID(cx, obj);
            iid.m0() = id->m0;
            iid.m1() = id->m1;
            iid.m2() = id->m2;
            iid.m3_0() = id->m3[0];
            iid.m3_1() = id->m3[1];
            iid.m3_2() = id->m3[2];
            iid.m3_3() = id->m3[3];
            iid.m3_4() = id->m3[4];
            iid.m3_5() = id->m3[5];
            iid.m3_6() = id->m3[6];
            iid.m3_7() = id->m3[7];
            *to = iid;
            return true;
        }

        ObjectId id;
        if (!makeId(cx, obj, &id))
            return false;
        *to = uint32_t(id);
        return true;
      }

      case JSTYPE_STRING:
      {
        nsDependentJSString dep;
        if (!dep.init(cx, from))
            return false;
        *to = dep;
        return true;
      }

      case JSTYPE_NUMBER:
        if (JSVAL_IS_INT(from))
            *to = double(JSVAL_TO_INT(from));
        else
            *to = JSVAL_TO_DOUBLE(from);
        return true;

      case JSTYPE_BOOLEAN:
        *to = !!JSVAL_TO_BOOLEAN(from);
        return true;

      default:
        return false;
    }
}

bool
JavaScriptShared::toValue(JSContext *cx, const JSVariant &from, jsval *to)
{
    switch (from.type()) {
        case JSVariant::Tvoid_t:
          *to = JSVAL_VOID;
          return true;

        case JSVariant::Tuint32_t:
        {
          uint32_t id = from.get_uint32_t();
          if (id) {
              JSObject *obj = unwrap(cx, id);
              if (!obj)
                  return false;
              *to = OBJECT_TO_JSVAL(obj);
          } else {
              *to = JSVAL_NULL;
          }
          return true;
        }

        case JSVariant::Tdouble:
          *to = JS_NumberValue(from.get_double());
          return true;

        case JSVariant::Tbool:
          *to = BOOLEAN_TO_JSVAL(from.get_bool());
          return true;

        case JSVariant::TnsString:
        {
          const nsString &old = from.get_nsString();
          JSString *str = JS_NewUCStringCopyN(cx, old.BeginReading(), old.Length());
          if (!str)
              return false;
          *to = STRING_TO_JSVAL(str);
          return true;
        }

        case JSVariant::TJSIID:
        {
          nsID iid;
          const JSIID &id = from.get_JSIID();

          iid.m0 = id.m0();
          iid.m1 = id.m1();
          iid.m2 = id.m2();
          iid.m3[0] = id.m3_0();
          iid.m3[1] = id.m3_1();
          iid.m3[2] = id.m3_2();
          iid.m3[3] = id.m3_3();
          iid.m3[4] = id.m3_4();
          iid.m3[5] = id.m3_5();
          iid.m3[6] = id.m3_6();
          iid.m3[7] = id.m3_7();

          JSCompartment *compartment = GetContextCompartment(cx);
          JSObject *global = JS_GetGlobalForCompartmentOrNull(cx, compartment);
          JSObject *obj = xpc_NewIDObject(cx, global, iid);
          if (!obj)
              return false;
          *to = OBJECT_TO_JSVAL(obj);
          return true;
        }

        default:
          return false;
    }
}

