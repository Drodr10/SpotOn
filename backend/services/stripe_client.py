import os
import stripe
from flask import jsonify
from dotenv import load_dotenv
from pathlib import Path
from services.supabase_client import supabase

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

publishableKey = os.getenv("STRIPE_PUBLISHABLE_KEY")
secretKey = os.getenv("STRIPE_SECRET_KEY")
backendUrl = os.getenv("BACKEND_URL")

def generatePaymentSheet(price: float, listerId: str):
    stripe.api_key = secretKey
    
    print(f"Attempting to create payment sheet")
    customer = stripe.Customer.create()

    idData = supabase.table("profiles").select("stripe_account_id").eq("id", listerId).single().execute()
    listerStripeConnectId = idData.data.get("stripe_account_id") if idData.data else None

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

    paymentIntentParams = {
        "amount": priceInCents,
        "currency": "usd",
        "customer": customer.id,
        "automatic_payment_methods": {"enabled": True},
    }

    if listerStripeConnectId:
        paymentIntentParams["application_fee_amount"] = applicationFeeAmount
        paymentIntentParams["transfer_data"] = {"destination": listerStripeConnectId}
        
        #TODO: Logic to save the amount the user is owed in the databases for later payout

    payment_intent = stripe.PaymentIntent.create(**paymentIntentParams)

    
    return jsonify(
        paymentIntent=payment_intent.client_secret,
        customerSessionClientSecret=customer_session.client_secret,
        customer=customer.id,
        publishableKey=publishableKey
    )

def createConnectAccount(user_id: str):
    stripe.api_key = secretKey
    print(f"Attempting to create Stripe Connect account for user {user_id}")

    try:
        profile_data = supabase.table("profiles").select("email, stripe_account_id").eq("id", user_id).single().execute().data

        if not profile_data:
            print(f"User profile not found for user {user_id}")
            return jsonify({ "error": "User profile not found" }), 404

        if profile_data.get("stripe_account_id"):
            # Account already exists
            print(f"Stripe account already exists for user {user_id}: {profile_data['stripe_account_id']}")
            return jsonify({ "account_id": profile_data["stripe_account_id"] })

        user_email = profile_data.get("email")
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

        return jsonify({ "account_id": account.id })

    except Exception as err:
        print(f"Error creating Stripe Connect account: {str(err)}")
        return jsonify({'error': str(err)}), 500

def createAccountLink(user_id: str):
    stripe.api_key = secretKey

    try:
        profile_data = supabase.table("profiles").select("stripe_account_id").eq("id", user_id).single().execute().data
        account_id = profile_data.get("stripe_account_id") if profile_data else None

        if not account_id:
            print(f"Stripe account ID not found for user {user_id}")
            return jsonify({ "error": "Stripe account ID not found for this user. Please create an account first." }), 404

        return_url = f"https://{backendUrl}/api/stripe/onboarding-complete"
        refresh_url = f"https://{backendUrl}/api/stripe/onboarding-expired"

        account_link = stripe.AccountLink.create(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
        print(f"Account link generated for user {user_id}: {account_link.url}")
        return jsonify({ "account_link_url": account_link.url})

    except Exception as err:
        print(f"Error creating account link: {str(err)}")
        return jsonify({ "error": str(err) }), 500