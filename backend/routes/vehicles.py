from flask import Blueprint, jsonify, request
from services.supabase_client import supabase

vehicles_bp = Blueprint('vehicles', __name__)


@vehicles_bp.route('/vehicles/<user_id>', methods=['GET'])
def get_vehicles(user_id):
    response = (
        supabase.table('vehicles')
        .select('*')
        .eq('owner_user_id', user_id)
        .order('created_at', desc=True)
        .execute()
    )
    return jsonify(response.data), 200


@vehicles_bp.route('/vehicles', methods=['POST'])
def create_vehicle():
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['owner_user_id', 'make', 'model', 'color', 'license_plate']
    missing = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({'error': f"Missing required fields: {', '.join(missing)}"}), 400

    vehicle = {
        'owner_user_id': data['owner_user_id'],
        'make': str(data['make']).strip(),
        'model': str(data['model']).strip(),
        'color': str(data['color']).strip(),
        'license_plate': str(data['license_plate']).strip().upper(),
    }

    response = supabase.table('vehicles').insert(vehicle).execute()
    return jsonify(response.data), 201


@vehicles_bp.route('/vehicles/<vehicle_id>', methods=['PUT'])
def update_vehicle(vehicle_id):
    data = request.json
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    owner_user_id = data.get('owner_user_id')
    if not owner_user_id:
        return jsonify({'error': 'Missing required field: owner_user_id'}), 400

    updates = {}
    for field in ['make', 'model', 'color', 'license_plate']:
        if field in data and data[field] is not None:
            value = str(data[field]).strip()
            updates[field] = value.upper() if field == 'license_plate' else value

    if not updates:
        return jsonify({'error': 'No updatable fields provided'}), 400

    response = (
        supabase.table('vehicles')
        .update(updates)
        .eq('id', vehicle_id)
        .eq('owner_user_id', owner_user_id)
        .execute()
    )

    if not response.data:
        return jsonify({'error': 'Vehicle not found or not owned by user'}), 404

    return jsonify(response.data), 200


@vehicles_bp.route('/vehicles/<vehicle_id>', methods=['DELETE'])
def delete_vehicle(vehicle_id):
    owner_user_id = request.args.get('owner_user_id')
    if not owner_user_id:
        return jsonify({'error': 'Missing required query parameter: owner_user_id'}), 400

    response = (
        supabase.table('vehicles')
        .delete()
        .eq('id', vehicle_id)
        .eq('owner_user_id', owner_user_id)
        .execute()
    )

    if not response.data:
        return jsonify({'error': 'Vehicle not found or not owned by user'}), 404

    return jsonify(response.data), 200
