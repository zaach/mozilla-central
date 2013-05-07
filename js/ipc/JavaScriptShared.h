/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=8 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_jsipc_ContextShared_h__
#define mozilla_jsipc_ContextShared_h__

#include "jsapi.h"
#include "jspubtd.h"
#include "js/HashTable.h"
#include "mozilla/dom/DOMTypes.h"
#include "mozilla/jsipc/PJavaScript.h"
#include "nsJSUtils.h"
#include "nsFrameMessageManager.h"

namespace mozilla {
namespace jsipc {

typedef uint32_t ObjectId;

class JavaScriptShared;

class CpowIdHolder : public CpowHolder
{
  public:
    CpowIdHolder(JavaScriptShared *js, const InfallibleTArray<CpowEntry> &cpows)
      : js_(js),
        cpows_(cpows)
    {
    }

    bool ToObject(JSContext *cx, JSObject **objp);

  private:
    JavaScriptShared *js_;
    const InfallibleTArray<CpowEntry> &cpows_;
};

// Map ids -> JSObjects
class ObjectStore
{
    struct TableKeyHasher {
        typedef ObjectId Lookup;

        static inline uint32_t hash(ObjectId id) {
            return id;
        }
        static inline bool match(ObjectId id1, ObjectId id2) {
            return id1 == id2;
        }
    };

    typedef js::HashMap<ObjectId, JSObject *, TableKeyHasher, js::SystemAllocPolicy> ObjectTable;

  public:
    ObjectStore();

    bool init();
    void trace(JSTracer *trc);

    bool add(ObjectId id, JSObject *obj);
    JSObject *find(ObjectId id);
    void remove(ObjectId id);

  private:
    ObjectTable table_;
};

// Map JSObjects -> ids
class ObjectIdCache
{
    typedef js::PointerHasher<JSObject *, 3> Hasher;
    typedef js::HashMap<JSObject *, ObjectId, Hasher, js::SystemAllocPolicy> ObjectIdTable;

  public:
    ObjectIdCache();

    bool init();
    void trace(JSTracer *trc);

    bool add(JSObject *, ObjectId id);
    ObjectId find(JSObject *obj);
    void remove(JSObject *obj);

  private:
    ObjectIdTable table_;
};

class JavaScriptShared
{
  public:
    bool init();

    static const uint32_t OBJECT_EXTRA_BITS  = 1;
    static const uint32_t OBJECT_IS_CALLABLE = (1 << 0);

    bool Wrap(JSContext* cx, JSObject *obj, InfallibleTArray<CpowEntry> *outCpows);
    bool Unwrap(JSContext* cx, const InfallibleTArray<CpowEntry>& cpows, JSObject **objp);

  protected:
    bool toVariant(JSContext *cx, jsval from, JSVariant *to);
    bool toValue(JSContext *cx, const JSVariant &from, JS::MutableHandleValue to);
    bool fromDesc(JSContext *cx, const JSPropertyDescriptor &desc, PPropertyDescriptor *out);
    bool toDesc(JSContext *cx, const PPropertyDescriptor &in, JSPropertyDescriptor *out);
    bool toGecko(JSContext *cx, jsid id, nsString *to);

    bool toValue(JSContext *cx, const JSVariant &from, jsval *to) {
        JS::RootedValue v(cx);
        if (!toValue(cx, from, &v))
            return false;
        *to = v;
        return true;
    }

    virtual bool makeId(JSContext *cx, JSObject *obj, ObjectId *idp) = 0;
    virtual JSObject *unwrap(JSContext *cx, ObjectId id) = 0;

    bool unwrap(JSContext *cx, ObjectId id, JSObject **objp) {
        if (!id) {
            *objp = NULL;
            return true;
        }

        *objp = unwrap(cx, id);
        return !!*objp;
    }

    static void ConvertID(const nsID &from, JSIID *to);
    static void ConvertID(const JSIID &from, nsID *to);

  protected:
    ObjectStore objects_;
};

} // namespace jsipc
} // namespace mozilla

#endif
