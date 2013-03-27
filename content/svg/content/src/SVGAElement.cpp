/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/Util.h"

#include "mozilla/dom/SVGAElement.h"
#include "mozilla/dom/SVGAElementBinding.h"
#include "nsILink.h"
#include "nsSVGString.h"
#include "nsCOMPtr.h"
#include "nsGkAtoms.h"
#include "nsContentUtils.h"

NS_IMPL_NS_NEW_NAMESPACED_SVG_ELEMENT(A)

namespace mozilla {
namespace dom {

JSObject*
SVGAElement::WrapNode(JSContext *aCx, JSObject *aScope)
{
  return SVGAElementBinding::Wrap(aCx, aScope, this);
}

nsSVGElement::StringInfo SVGAElement::sStringInfo[2] =
{
  { &nsGkAtoms::href, kNameSpaceID_XLink, true },
  { &nsGkAtoms::target, kNameSpaceID_None, true }
};


//----------------------------------------------------------------------
// nsISupports methods

NS_IMPL_ISUPPORTS_INHERITED5(SVGAElement, SVGAElementBase,
                             nsIDOMNode,
                             nsIDOMElement,
                             nsIDOMSVGElement,
                             nsILink,
                             Link)


//----------------------------------------------------------------------
// Implementation

SVGAElement::SVGAElement(already_AddRefed<nsINodeInfo> aNodeInfo)
  : SVGAElementBase(aNodeInfo),
    Link(this)
{
  SetIsDOMBinding();
}

already_AddRefed<nsIDOMSVGAnimatedString>
SVGAElement::Href()
{
  return mStringAttributes[HREF].ToDOMAnimatedString(this);
}

//----------------------------------------------------------------------
// nsINode methods

nsresult
SVGAElement::PreHandleEvent(nsEventChainPreVisitor& aVisitor)
{
  nsresult rv = Element::PreHandleEvent(aVisitor);
  NS_ENSURE_SUCCESS(rv, rv);

  return PreHandleEventForLinks(aVisitor);
}

nsresult
SVGAElement::PostHandleEvent(nsEventChainPostVisitor& aVisitor)
{
  return PostHandleEventForLinks(aVisitor);
}

NS_IMPL_ELEMENT_CLONE_WITH_INIT(SVGAElement)


//----------------------------------------------------------------------

already_AddRefed<nsIDOMSVGAnimatedString>
SVGAElement::Target()
{
  return mStringAttributes[TARGET].ToDOMAnimatedString(this);
}

void
SVGAElement::GetDownload(nsAString & aDownload)
{
  GetAttr(kNameSpaceID_None, nsGkAtoms::download, aDownload);
}

void
SVGAElement::SetDownload(const nsAString & aDownload, ErrorResult& rv)
{
  rv = SetAttr(kNameSpaceID_None, nsGkAtoms::download, aDownload, true);
}

//----------------------------------------------------------------------
// nsIContent methods

nsresult
SVGAElement::BindToTree(nsIDocument *aDocument, nsIContent *aParent,
                        nsIContent *aBindingParent,
                        bool aCompileEventHandlers)
{
  Link::ResetLinkState(false, Link::ElementHasHref());

  nsresult rv = SVGAElementBase::BindToTree(aDocument, aParent,
                                            aBindingParent,
                                            aCompileEventHandlers);
  NS_ENSURE_SUCCESS(rv, rv);

  if (aDocument) {
    aDocument->RegisterPendingLinkUpdate(this);
  }

  return NS_OK;
}

void
SVGAElement::UnbindFromTree(bool aDeep, bool aNullParent)
{
  // If this link is ever reinserted into a document, it might
  // be under a different xml:base, so forget the cached state now.
  Link::ResetLinkState(false, Link::ElementHasHref());

  nsIDocument* doc = GetCurrentDoc();
  if (doc) {
    doc->UnregisterPendingLinkUpdate(this);
  }

  SVGAElementBase::UnbindFromTree(aDeep, aNullParent);
}

nsLinkState
SVGAElement::GetLinkState() const
{
  return Link::GetLinkState();
}

already_AddRefed<nsIURI>
SVGAElement::GetHrefURI() const
{
  nsCOMPtr<nsIURI> hrefURI;
  return IsLink(getter_AddRefs(hrefURI)) ? hrefURI.forget() : nullptr;
}


NS_IMETHODIMP_(bool)
SVGAElement::IsAttributeMapped(const nsIAtom* name) const
{
  static const MappedAttributeEntry* const map[] = {
    sFEFloodMap,
    sFiltersMap,
    sFontSpecificationMap,
    sGradientStopMap,
    sLightingEffectsMap,
    sMarkersMap,
    sTextContentElementsMap,
    sViewportsMap
  };

  return FindAttributeDependence(name, map) ||
    SVGAElementBase::IsAttributeMapped(name);
}

bool
SVGAElement::IsFocusable(int32_t *aTabIndex, bool aWithMouse)
{
  nsCOMPtr<nsIURI> uri;
  if (IsLink(getter_AddRefs(uri))) {
    if (aTabIndex) {
      *aTabIndex = ((sTabFocusModel & eTabFocus_linksMask) == 0 ? -1 : 0);
    }
    return true;
  }

  if (aTabIndex) {
    *aTabIndex = -1;
  }

  return false;
}

bool
SVGAElement::IsLink(nsIURI** aURI) const
{
  // To be a clickable XLink for styling and interaction purposes, we require:
  //
  //   xlink:href    - must be set
  //   xlink:type    - must be unset or set to "" or set to "simple"
  //   xlink:show    - must be unset or set to "", "new" or "replace"
  //   xlink:actuate - must be unset or set to "" or "onRequest"
  //
  // For any other values, we're either not a *clickable* XLink, or the end
  // result is poorly specified. Either way, we return false.

  static nsIContent::AttrValuesArray sTypeVals[] =
    { &nsGkAtoms::_empty, &nsGkAtoms::simple, nullptr };

  static nsIContent::AttrValuesArray sShowVals[] =
    { &nsGkAtoms::_empty, &nsGkAtoms::_new, &nsGkAtoms::replace, nullptr };

  static nsIContent::AttrValuesArray sActuateVals[] =
    { &nsGkAtoms::_empty, &nsGkAtoms::onRequest, nullptr };

  // Optimization: check for href first for early return
  const nsAttrValue* href = mAttrsAndChildren.GetAttr(nsGkAtoms::href,
                                                      kNameSpaceID_XLink);
  if (href &&
      FindAttrValueIn(kNameSpaceID_XLink, nsGkAtoms::type,
                      sTypeVals, eCaseMatters) !=
                      nsIContent::ATTR_VALUE_NO_MATCH &&
      FindAttrValueIn(kNameSpaceID_XLink, nsGkAtoms::show,
                      sShowVals, eCaseMatters) !=
                      nsIContent::ATTR_VALUE_NO_MATCH &&
      FindAttrValueIn(kNameSpaceID_XLink, nsGkAtoms::actuate,
                      sActuateVals, eCaseMatters) !=
                      nsIContent::ATTR_VALUE_NO_MATCH) {
    nsCOMPtr<nsIURI> baseURI = GetBaseURI();
    // Get absolute URI
    nsAutoString str;
    mStringAttributes[HREF].GetAnimValue(str, this);
    nsContentUtils::NewURIWithDocumentCharset(aURI, str,
                                              OwnerDoc(), baseURI);
    // must promise out param is non-null if we return true
    return !!*aURI;
  }

  *aURI = nullptr;
  return false;
}

void
SVGAElement::GetLinkTarget(nsAString& aTarget)
{
  mStringAttributes[TARGET].GetAnimValue(aTarget, this);
  if (aTarget.IsEmpty()) {

    static nsIContent::AttrValuesArray sShowVals[] =
      { &nsGkAtoms::_new, &nsGkAtoms::replace, nullptr };

    switch (FindAttrValueIn(kNameSpaceID_XLink, nsGkAtoms::show,
                            sShowVals, eCaseMatters)) {
    case 0:
      aTarget.AssignLiteral("_blank");
      return;
    case 1:
      return;
    }
    nsIDocument* ownerDoc = OwnerDoc();
    if (ownerDoc) {
      ownerDoc->GetBaseTarget(aTarget);
    }
  }
}

nsEventStates
SVGAElement::IntrinsicState() const
{
  return Link::LinkState() | SVGAElementBase::IntrinsicState();
}

nsresult
SVGAElement::SetAttr(int32_t aNameSpaceID, nsIAtom* aName,
                     nsIAtom* aPrefix, const nsAString& aValue,
                     bool aNotify)
{
  nsresult rv = SVGAElementBase::SetAttr(aNameSpaceID, aName, aPrefix,
                                         aValue, aNotify);

  // The ordering of the parent class's SetAttr call and Link::ResetLinkState
  // is important here!  The attribute is not set until SetAttr returns, and
  // we will need the updated attribute value because notifying the document
  // that content states have changed will call IntrinsicState, which will try
  // to get updated information about the visitedness from Link.
  if (aName == nsGkAtoms::href && aNameSpaceID == kNameSpaceID_XLink) {
    Link::ResetLinkState(!!aNotify, true);
  }

  return rv;
}

nsresult
SVGAElement::UnsetAttr(int32_t aNameSpaceID, nsIAtom* aAttr,
                       bool aNotify)
{
  nsresult rv = nsSVGElement::UnsetAttr(aNameSpaceID, aAttr, aNotify);

  // The ordering of the parent class's UnsetAttr call and Link::ResetLinkState
  // is important here!  The attribute is not unset until UnsetAttr returns, and
  // we will need the updated attribute value because notifying the document
  // that content states have changed will call IntrinsicState, which will try
  // to get updated information about the visitedness from Link.
  if (aAttr == nsGkAtoms::href && aNameSpaceID == kNameSpaceID_XLink) {
    Link::ResetLinkState(!!aNotify, false);
  }

  return rv;
}

//----------------------------------------------------------------------
// nsSVGElement methods

nsSVGElement::StringAttributesInfo
SVGAElement::GetStringInfo()
{
  return StringAttributesInfo(mStringAttributes, sStringInfo,
                              ArrayLength(sStringInfo));
}

} // namespace dom
} // namespace mozilla