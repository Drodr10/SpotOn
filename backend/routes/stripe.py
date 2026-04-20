from flask import Blueprint, jsonify, request
from services.stripe_client import publishableKey, generatePaymentSheet

stripe_bp = Blueprint('stripe', __name__)

@stripe_bp.route('/stripe/key', methods=['GET'])
def getKey():
    responseData ={ "publishableKey": publishableKey}
    return jsonify(responseData), 200

@stripe_bp.route('/stripe/payment-sheet', methods=['POST'])
def payment_sheet():
  return generatePaymentSheet(request.json["price"])
