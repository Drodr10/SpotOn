from flask import Blueprint, jsonify, request
from services.stripe_client import *

stripe_bp = Blueprint('stripe', __name__)

@stripe_bp.route('/stripe/key', methods=['GET'])
def getKey():
    responseData ={ "publishableKey": publishableKey}
    return jsonify(responseData), 200

@stripe_bp.route('/stripe/payment-sheet', methods=['POST'])
def payment_sheet():
  return generatePaymentSheet(request.json["price"])

@stripe_bp.route('/stripe/create-connect-account', methods=['POST'])
def create_connect_account():
    return createConnectAccount(parse_request_body())

@stripe_bp.route('/stripe/create-account-link', methods=['POST'])
def create_account_link():
    return createAccountLink(parse_request_body())

@stripe_bp.route('/stripe/create-product', methods=['POST'])
def create_product():
    return createProduct(parse_request_body())