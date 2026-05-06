import os
import stripe
from flask import jsonify
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

publishableKey = os.getenv("STRIPE_PUBLISHABLE_KEY") or "pk_test_51SBybVEd6RvlqVZd7GGLyTnIc8R11hFe8sA5r5E53jCPP31QA9Fh54xl897Sl85eBYr4FlfoBt0gxRCdeaABDT1R00MUFwSlaR"
secretKey = os.getenv("STRIPE_SECRET_KEY") or "sk_test_51SBybVEd6RvlqVZdlQyDURAX4ApVNe6Cnwi5m06fL62p0xIPcaKj5cpY4Y4RIRqxs7EYJa7zbB8rMPExi7Kl77iy00HmoPWBtN"

def generatePaymentSheet(price):
    stripe.api_key = secretKey
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