from flask import Blueprint, jsonify, request
from services.stripe_client import *

stripe_bp = Blueprint('stripe', __name__)

@stripe_bp.route('/stripe/key', methods=['GET'])
def getKey():
    responseData = { "publishableKey": publishableKey }
    return jsonify(responseData), 200

#This endpoint is used for create the payment sheet initiate a user payment, with the information needed.
@stripe_bp.route('/stripe/payment-sheet', methods=['POST'])
def payment_sheet():
  return generatePaymentSheet(request.json["price"], request.json["listerId"])

#This endpoint is used for onboarding users to stripe connect. Needs to be done so users have an account to payout to.
@stripe_bp.route('/stripe/create-connect-account', methods=['POST'])
def create_connect_account():
    return createConnectAccount(request.json['user_id'])

#This endpoint is used after a user ID is generated so that the user can finish their account onboarding
@stripe_bp.route('/stripe/create-account-link', methods=['POST'])
def create_account_link():
    return createAccountLink(request.json['user_id'])