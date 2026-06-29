from flask import Blueprint, request, jsonify, current_app
from models import db, User
from functools import wraps
from datetime import datetime

users_bp = Blueprint('users', __name__)


def get_current_user():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None

    token = auth_header.split(' ')[1]
    user_id = User.verify_token(token, current_app.config['SECRET_KEY'])

    if not user_id:
        return None

    return User.query.get(user_id)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Требуется авторизация'}), 401
        return f(user, *args, **kwargs)
    return decorated


@users_bp.route('/me', methods=['GET'])
@login_required
def get_profile(user):
    return jsonify({'user': user.to_dict()}), 200


@users_bp.route('/me', methods=['PUT'])
@login_required
def update_profile(user):
    data = request.get_json()

    if 'display_name' in data:
        name = data['display_name'].strip()
        if len(name) >= 2:
            user.display_name = name

    if 'username' in data:
        username = data['username'].strip() if data['username'] else None
        if username:
            import re
            if len(username) >= 3 and re.match(r'^[a-zA-Z0-9_]+$', username):
                existing = User.query.filter_by(username=username).first()
                if not existing or existing.id == user.id:
                    user.username = username
                else:
                    return jsonify({'error': 'Username уже занят'}), 409
        else:
            user.username = None

    if 'bio' in data:
        user.bio = data['bio'][:500]

    if 'avatar_url' in data:
        user.avatar_url = data['avatar_url']

    db.session.commit()
    return jsonify({'user': user.to_dict()}), 200


@users_bp.route('/search', methods=['GET'])
@login_required
def search_users(user):
    query = request.args.get('q', '').strip()
    if len(query) < 2:
        return jsonify({'users': []}), 200

    users = User.query.filter(
        db.or_(
            User.username.ilike(f'%{query}%'),
            User.display_name.ilike(f'%{query}%'),
            User.phone.ilike(f'%{query}%')
        ),
        User.id != user.id
    ).limit(20).all()

    return jsonify({
        'users': [u.to_dict() for u in users]
    }), 200


@users_bp.route('/<int:user_id>', methods=['GET'])
@login_required
def get_user(current_user, user_id):
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    return jsonify({'user': user.to_dict()}), 200


@users_bp.route('/ping', methods=['POST'])
@login_required
def ping(user):
    """Обновить статус активности пользователя"""
    user.is_online = True
    user.last_seen = datetime.utcnow()
    db.session.commit()
    return jsonify({'status': 'ok'}), 200