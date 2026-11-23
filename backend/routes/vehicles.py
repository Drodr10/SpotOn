from flask import Blueprint, jsonify, request
from services.supabase_client import supabase
from services.auth import token_required

vehicles_bp = Blueprint('vehicles', __name__)

# Mirrors vehicles_plate_state_check (20261116140000). USPS codes: 50 states,
# DC and the inhabited territories.
US_PLATE_STATES = frozenset({
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
    'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
    'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR', 'GU', 'VI', 'AS', 'MP',
})

# Raised by trg_guard_vehicle_in_active_booking (SQLSTATE 23514). Matched on
# text too, because the guard's two messages are the only 23514s on vehicles
# that should become a 409 — the plate_state CHECK also raises 23514.
_BOOKING_LOCK_MARKERS = ('booking that has not finished', 'checking out right now')


def _normalize_plate_state(raw):
    """Return (value, error). value is an upper-cased USPS code."""
    value = str(raw).strip().upper()
    if value not in US_PLATE_STATES:
        return None, f"Invalid plate_state '{raw}'. Use a two-letter US state code."
    return value, None


def _booking_lock_response(err):
    """Map the vehicle guards to a 409; None means 'not ours, re-raise'."""
    code = getattr(err, 'code', None)
    text = str(err)
    message = getattr(err, 'message', None) or text
    if (code in (None, '23514')) and any(m in text for m in _BOOKING_LOCK_MARKERS):
        return jsonify({'error': message, 'code': 'vehicle_in_active_booking'}), 409
    # 23503: reservations FK before 20261116120000 (ON DELETE SET NULL) is applied.
    if code == '23503' or 'violates foreign key constraint' in text:
        return jsonify({
            'error': "This car has booking history, so it can't be removed yet.",
            'code': 'vehicle_has_history',
        }), 409
    return None


@vehicles_bp.route('/vehicles/<user_id>', methods=['GET'])
@token_required
def get_vehicles(current_user_id, user_id):
    if current_user_id != user_id:
        return jsonify({"error": "Forbidden: You can only access your own vehicles."}), 403
    response = (
        supabase.table('vehicles')
        .select('*')
        .eq('owner_user_id', user_id)
        .order('created_at', desc=True)
        .execute()
    )
    return jsonify(response.data), 200


@vehicles_bp.route('/vehicles', methods=['POST'])
@token_required
def create_vehicle(current_user_id):
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['make', 'model', 'color', 'license_plate', 'plate_state']
    missing = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f"Missing required fields: {', '.join(missing)}"}), 400

    vehicle = {
        'owner_user_id': current_user_id,
        'make': str(data['make']).strip(),
        'model': str(data['model']).strip(),
        'color': str(data['color']).strip(),
        'license_plate': str(data['license_plate']).strip().upper(),
    }
    plate_state, err = _normalize_plate_state(data['plate_state'])
    if err:
        return jsonify({'error': err}), 400
    vehicle['plate_state'] = plate_state

    response = supabase.table('vehicles').insert(vehicle).execute()
    return jsonify(response.data), 201


@vehicles_bp.route('/vehicles/<vehicle_id>', methods=['PUT'])
@token_required
def update_vehicle(current_user_id, vehicle_id):
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    updates = {}
    for field in ['make', 'model', 'color', 'license_plate']:
        if field in data and data[field] is not None:
            value = str(data[field]).strip()
            updates[field] = value.upper() if field == 'license_plate' else value
    if data.get('plate_state') is not None:
        plate_state, err = _normalize_plate_state(data['plate_state'])
        if err:
            return jsonify({'error': err}), 400
        updates['plate_state'] = plate_state

    if not updates:
        return jsonify({'error': 'No updatable fields provided'}), 400

    try:
        response = (
            supabase.table('vehicles')
            .update(updates)
            .eq('id', vehicle_id)
            .eq('owner_user_id', current_user_id)
            .execute()
        )
    except Exception as err:  # noqa: BLE001 — re-raised unless it's the booking lock
        locked = _booking_lock_response(err)
        if locked:
            return locked
        raise

    if not response.data:
        return jsonify({'error': 'Vehicle not found or not owned by user'}), 404

    return jsonify(response.data), 200


@vehicles_bp.route('/vehicles/<vehicle_id>', methods=['DELETE'])
@token_required
def delete_vehicle(current_user_id, vehicle_id):
    try:
        response = (
            supabase.table('vehicles')
            .delete()
            .eq('id', vehicle_id)
            .eq('owner_user_id', current_user_id)
            .execute()
        )
    except Exception as err:  # noqa: BLE001 — re-raised unless it's the booking lock
        locked = _booking_lock_response(err)
        if locked:
            return locked
        raise

    if not response.data:
        return jsonify({'error': 'Vehicle not found or not owned by user'}), 404

    return jsonify(response.data), 200
