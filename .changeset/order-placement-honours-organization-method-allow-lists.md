---
'@endora-commerce/mod-orders': minor
---

Order placement and order preview honour an Organization's delivery- and payment-method
allow-lists (`PUT /api/v1/admin/organizations/:id/restrictions`) on every surface, as
`GET /api/v1/delivery-methods` and `GET /api/v1/payment-methods` do.

These requests answer **`400 VALIDATION_FAILED`** when the Organization the order is for has a
non-empty allow-list that does not contain the chosen method:

- `POST /api/v1/orders` and `POST /api/v1/orders/preview-total`
- `POST /api/v1/admin/orders` and `POST /api/v1/admin/orders/preview`
- `POST /api/v1/external/orders`
- every other caller of `orderPlacementPort.placeOrder`

`error.details.code` is `delivery_method_not_allowed_for_organization` (with `deliveryMethodId`) or
`payment_method_not_allowed_for_organization` (with `paymentMethodId`). When both methods are
outside the lists, the delivery method is the one reported. Nothing is written on a refusal — no
order, no stock reservation, no payment — and the customer's basket is left as it was.

- **The Organization** is the one the order is placed for: the signed-in buyer's, the one an API
  key is bound to, or the customer's when an administrator creates the order.
- **An administrator is bound too.** An order created on a customer's behalf honours that
  customer's Organization allow-lists; there is no setting that exempts it. The create form lists
  every method, and the preview and the create answer the refusal above for one the Organization
  does not allow.
- **An empty list is no restriction**, as before, and the two lists are independent.
- **One-click buy** is unchanged: a default method the lists do not contain makes the buyer
  ineligible (`one_click_unavailable`, reason `missing_defaults`).

What an integrator sees differently:

- **Storefront and admin clients** receive the `400` above for a method outside the Organization's
  lists. Offer the methods `GET /api/v1/delivery-methods` and `GET /api/v1/payment-methods` return
  for the signed-in buyer, and handle the two `error.details.code` values.
- **`POST /api/v1/external/orders`** answered `400 VALIDATION_FAILED` for such a method before, and
  still does. Three things about that answer are different:
  - `error.message` is *"The selected delivery method is not available to this Organization."* or
    *"The selected payment method is not available to this Organization."* (it ended *"… is not
    available for this order."*, and said *"shipping method"*), and `error.details` is present.
    Match on `error.details.code`.
  - when both methods are outside the lists, the refusal names the delivery method (it named the
    payment method);
  - when the allow-lists cannot be read, the request answers `500 INTERNAL` and places nothing.
