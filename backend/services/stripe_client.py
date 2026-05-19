import os
import stripe
from flask import jsonify
from dotenv import load_dotenv
from pathlib import Path
from services.supabase_client import supabase

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

    payment_intent = stripe.PaymentIntent .create(
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

def createConnectAccount(data):
    stripe.api_key = secretKey
    user_id = data.get("user_id")
    email = data.get("email")

    if not user_id:
        return jsonify({'error': 'user_id is required'}), 400

    try:
        profile_resp = supabase.table("profiles").select("stripe_account_id").eq("id", user_id).single().execute()
        
        stripe_account_id = profile_resp.data.get("stripe_account_id") if profile_resp.data else None

        if not stripe_account_id:
            print(f"Creating new Stripe Express account for user {user_id}")
            account = stripe.Account.create(
                type="express",
                email=email,
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
            )
            stripe_account_id = account.id
            
            # 3. Save the new account ID to the user's profile
            supabase.table("profiles").update({"stripe_account_id": stripe_account_id}).eq("id", user_id).execute()
        else:
            print(f"Found existing Stripe account {stripe_account_id} for user {user_id}")

        # 4. Create a one-time account link for onboarding
        account_link = stripe.AccountLink.create(
            account=stripe_account_id,
            refresh_url="spoton://onboarding-failed",
            return_url="spoton://onboarding-success",
            type="account_onboarding",
        )

        return jsonify({'url': account_link.url})
    except Exception as e:
        print(f"Error creating account link: {e}")
        return jsonify({'error': str(e)}), 500

def createProduct(data):
    stripe.api_key = secretKey
    product_name = data.get('name')
    product_description = data.get('description')
    product_price_dollars = data.get('price')
    account_id = data.get('stripeId')
    listing_id = data.get('listing_id')

    if not listing_id:
        return jsonify({'error': 'listing_id is required'}), 400

    if product_price_dollars is None:
        return jsonify({'error': 'price is required'}), 400

    try:
        # 1. Create the Stripe Product
        product = stripe.Product.create(
            name=product_name,
            description=product_description,
            metadata={'listing_id': listing_id, 'stripeAccount': account_id}
        )

        # 2. Associate the product ID with the listing in Supabase
        update_response = supabase.table("listings").update({
            "stripe_product_id": product.id
        }).eq("id", listing_id).execute()

        # Handle case where listing doesn't exist
        if not update_response.data:
            stripe.Product.delete(product.id) # Clean up orphan Stripe product
            return jsonify({'error': f'Failed to associate product with listing_id {listing_id}. Listing not found.'}), 404

        # 3. Create a default price for the product (fixing original implementation)
        price_in_cents = int(product_price_dollars * 100)
        price = stripe.Price.create(
            product=product.id,
            unit_amount=price_in_cents,
            currency='usd',
            metadata={'listing_id': listing_id, 'stripeAccount': account_id}
        )

        return jsonify({ 'productId': product.id, 'priceId': price.id, 'message': f'Stripe product {product.id} created and associated with listing {listing_id}.' })
    except Exception as e:
        print(f"Error creating product/price for listing {listing_id}: {e}")
        return jsonify({'error': str(e)}), 500