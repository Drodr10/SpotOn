import os
import stripe
from flask import jsonify
from dotenv import load_dotenv
from pathlib import Path
from services.supabase_client import supabase

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

publishableKey = os.getenv("STRIPE_PUBLISHABLE_KEY")
secretKey = os.getenv("STRIPE_SECRET_KEY")

def generatePaymentSheet(price: float, listerId: str):
    stripe.api_key = secretKey
    
    print(f"Attempting to create payment sheet")
    customer = stripe.Customer.create()

    listerStripeConnectId = supabase.table("profiles").select("stripe_account_id").eq("id", listerId).execute().data[0]["stripe_account_id"]

    customer_session = stripe.CustomerSession.create(
        customer=customer.id,
        components={
            "payment_element": {
                "enabled": True,
            }
        },
    )

    priceInCents = int(price * 100)
    applicationFeeAmount = int(priceInCents * 0.15)

    payment_intent = stripe.PaymentIntent.create(
        amount=priceInCents,
        currency="usd",
        customer=customer.id,
        automatic_payment_methods={
            "enabled": True,
        },
        application_fee_amount=applicationFeeAmount,
        transfer_data={
            'destination': listerStripeConnectId,
        }
    )
    
    return jsonify(paymentIntent=payment_intent.client_secret,
                   customerSessionClientSecret=customer_session.client_secret,
                   customer=customer.id,
                   publishableKey=publishableKey)

def createConnectAccount(user_id: str):
    stripe.api_key = secretKey

    try:
        profile_data = supabase.table("profiles").select("email, stripe_account_id").eq("id", user_id).single().execute().data

        if not profile_data:
            return jsonify({ "error": "User profile not found" }), 404

        if profile_data.get("stripe_account_id"):
            print(f"Stripe account already exists for user {user_id}: {profile_data['stripe_account_id']}")
            return jsonify({ "account_id": profile_data["stripe_account_id"] })

        user_email = profileData.get("email")
        if not user_email:
            return jsonify({ "error": "User email not found in profile" }), 400

        account = stripe.Account.create(
            type="express",
            country="US",
            email=user_email,
            capabilities={
                "card_payments": {"requested": True},
                "transfers": {"requested": True},
            },
        )
        print(f"Account created successfully for {user_email}: {account.id}")

        supabase.table("profiles").update({ "stripe_account_id": account.id }).eq("id", user_id).execute()

        return jsonify({ "account_id": account.id })

    except Exception as err:
        print(f"Error creating Stripe Connect account: {err}")
        return jsonify({'error': str(err)}), 500

def createAccountLink(user_id: str):
    stripe.api_key = secretKey

    try:
        profile_data = supabase.table("profiles").select("stripe_account_id").eq("id", user_id).single().execute().data
        account_id = profile_data.get("stripe_account_id") if profile_data else None

        if not account_id:
            return jsonify({ "error": "Stripe account ID not found for this user. Please create an account first." }), 404

        return_url = "spoton://Homescreen"
        refresh_url = "spoton://stripe-onboarding-refresh"

        account_link = stripe.AccountLink.create(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
        print(f"Account link generated for user {user_id}: {account_link.url}")
        return jsonify({ "account_link_url": account_link.url})

    except Exception as err:
        print(f"Error creating account link: {err}")
        return jsonify({ "error": str(err) }), 500
