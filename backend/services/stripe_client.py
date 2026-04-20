import os
import stripe
from flask import jsonify

publishableKey = os.getenv("STRIPE_PUBLISHABLE_KEY")
secretKey = os.getenv("STRIPE_SECRET_KEY")

stripe.api_key = secretKey

def generatePaymentSheet(price):
    print(f"Attempting to create payment sheet")
    customer = stripe.Customer.create()

    customer_session = stripe.CustomerSession.create(
        customer=customer.id,
        components={
            "payment_element": {
                "enabled": True,
            }
        },
    )

    priceInCents = int(price * 100)

    payment_intent = stripe.PaymentIntent.create(
        amount=priceInCents,
        currency="usd",
        customer=customer.id,
        automatic_payment_methods={
            "enabled": True,
        },
    )
    return jsonify(paymentIntent=payment_intent.client_secret,
                   customerSessionClientSecret=customer_session.client_secret,
                   customer=customer.id,
                   publishableKey=publishableKey)