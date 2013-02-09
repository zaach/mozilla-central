/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "JavaScriptShared.h"

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
        *to = ObjectId(0);
        return true;

      case JSTYPE_OBJECT:
      case JSTYPE_FUNCTION:
        ObjectId id;
        if (!makeId(cx, JSVAL_TO_OBJECT(from), &id))
            return false;
        *to = id;
        return true;

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
          if (from.get_uint32_t()) {
              JSObject *obj = wrap(cx, from.get_uint32_t());
              if (!obj)
                  return false;
              *to = OBJECT_TO_JSVAL(obj);
          } else {
              *to = JSVAL_NULL;
          }
          return true;

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

        default:
          return false;
    }
}

