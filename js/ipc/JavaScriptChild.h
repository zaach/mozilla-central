/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 * vim: set ts=4 sw=4 et tw=80:
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#ifndef mozilla_jsipc_JavaScriptWrapperChild_h_
#define mozilla_jsipc_JavaScriptWrapperChild_h_

#include "mozilla/jsipc/PJavaScriptChild.h"
#include "JavaScriptShared.h"

namespace mozilla {
namespace jsipc {

class JavaScriptChild
  : public PJavaScriptChild,
    public JavaScriptShared
{
  public:
    JavaScriptChild(JSRuntime *rt);
    ~JavaScriptChild();

    bool init();
    void trace(JSTracer *trc);

    bool RecvDropObject(const ObjectId &objId);
    bool AnswerAddProperty(const ObjectId &objId, const nsString &id, ReturnStatus *rs);
    bool AnswerGetProperty(const ObjectId &objId, const nsString &id, ReturnStatus *rs, JSVariant *result);
    bool AnswerSetProperty(const ObjectId &objId, const nsString &id, const JSVariant &value, ReturnStatus *rs, JSVariant *result);
    bool AnswerDeleteProperty(const ObjectId &objId, const nsString &id, ReturnStatus *rs, JSVariant *result);
    bool AnswerNewResolve(const ObjectId &objId, const nsString &id, const uint32_t &flags, ReturnStatus *rs, ObjectId *obj2);
    bool AnswerCall(const InfallibleTArray<JSVariant> &argv, ReturnStatus *rs, JSVariant *result);

    ObjectId Send(JSObject *obj);

    JSContext *GetContext() {
        return cx;
    }

  protected:
    JSObject *wrap(JSContext *cx, ObjectId id);

  private:
    bool makeId(JSContext *cx, JSObject *obj, ObjectId *idp);
    bool fail(ReturnStatus *rs);
    bool ok(ReturnStatus *rs);

  private:
    ObjectId lastId_;
    JSRuntime *rt_;
    JSContext *cx;
    ObjectIdCache ids_;
};

} // mozilla
} // jsipc

#endif
