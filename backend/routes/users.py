from flask import Blueprint, request, jsonify, current_app
from models import db, User
from functools import wraps
from datetime import datetime
import os
import uuid
from werkzeug.utils import secure_filename

users_bp = Blueprint('users', __name__)

ALLOWED_AVATAR_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

def allowed_avatar(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_AVATAR_EXTENSIONS


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


@users_bp.route('/me/avatar', methods=['POST'])
@login_required
def upload_avatar(user):
    if 'avatar' not in request.files:
        return jsonify({'error': 'Файл не найден'}), 400

    file = request.files['avatar']
    if not file or file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400

    if not allowed_avatar(file.filename):
        return jsonify({'error': 'Формат не поддерживается (png, jpg, jpeg, gif, webp)'}), 400

    # Проверка размера (макс 5MB)
    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > 5 * 1024 * 1024:
        return jsonify({'error': 'Файл слишком большой (макс 5MB)'}), 400

    ext = file.filename.rsplit('.', 1)[1].lower()
    filename = f"avatar_{user.id}_{uuid.uuid4().hex}.{ext}"

    upload_folder = current_app.config.get('UPLOAD_FOLDER', '/tmp/uploads')
    os.makedirs(upload_folder, exist_ok=True)

    # Удаляем старую аватарку если она локальная
    if user.avatar_url and user.avatar_url.startswith('/uploads/'):
        old_path = os.path.join(upload_folder, os.path.basename(user.avatar_url))
        if os.path.exists(old_path):
            try:
                os.remove(old_path)
            except:
                pass

    filepath = os.path.join(upload_folder, filename)
    file.save(filepath)

    avatar_url = f'/uploads/{filename}'
    user.avatar_url = avatar_url
    db.session.commit()

    return jsonify({
        'avatar_url': avatar_url,
        'user': user.to_dict()
    }), 200


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
    user.is_online = True
    user.last_seen = datetime.utcnow()
    db.session.commit()
    return jsonify({'status': 'ok'}), 200