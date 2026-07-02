from flask import Blueprint, request, jsonify, current_app
from models import db, User, MessageRequest, allowed_contacts
from functools import wraps
from datetime import datetime
import os
from werkzeug.utils import secure_filename
import telegram_storage

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

    # Настройка приватности сообщений
    if 'privacy_messages' in data:
        privacy = data['privacy_messages']
        if privacy in ('all', 'contacts'):
            user.privacy_messages = privacy

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
        return jsonify({'error': 'Формат не поддерживается'}), 400

    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > 5 * 1024 * 1024:
        return jsonify({'error': 'Файл слишком большой (макс 5MB)'}), 400

    file_data = file.read()
    filename = secure_filename(file.filename)

    if not telegram_storage.is_configured():
        return jsonify({'error': 'Хранилище не настроено'}), 500

    file_id, error = telegram_storage.upload_photo(file_data, filename)
    if error:
        return jsonify({'error': 'Ошибка загрузки. Попробуйте позже.'}), 500

    avatar_url = f'/api/messages/tg/{file_id}'
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
    """Обновление активности + продление токена"""
    user.is_online = True
    user.last_seen = datetime.utcnow()
    db.session.commit()
    
    new_token = user.generate_token(current_app.config['SECRET_KEY'])
    
    return jsonify({
        'status': 'ok',
        'token': new_token
    }), 200


# ==================== ЗАЯВКИ НА ПЕРЕПИСКУ ====================

def is_allowed_to_message(from_user_id, to_user):
    """Проверить может ли from_user писать to_user"""
    # Если у получателя настройка "все" - можно
    if to_user.privacy_messages != 'contacts':
        return True
    
    # Если сам себе - можно
    if from_user_id == to_user.id:
        return True
    
    # Проверяем есть ли в allowed_contacts
    result = db.session.execute(
        allowed_contacts.select().where(
            db.and_(
                allowed_contacts.c.user_id == to_user.id,
                allowed_contacts.c.contact_id == from_user_id
            )
        )
    ).first()
    
    return result is not None


@users_bp.route('/message-request', methods=['POST'])
@login_required
def send_message_request(user):
    """Отправить заявку на переписку"""
    data = request.get_json()
    to_user_id = data.get('to_user_id')
    message_text = data.get('message', '').strip()[:500]
    
    if not to_user_id:
        return jsonify({'error': 'Укажите пользователя'}), 400
    
    if to_user_id == user.id:
        return jsonify({'error': 'Нельзя отправить себе'}), 400
    
    to_user = User.query.get(to_user_id)
    if not to_user:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    # Проверяем нет ли уже заявки
    existing = MessageRequest.query.filter_by(
        from_user_id=user.id,
        to_user_id=to_user_id,
        status='pending'
    ).first()
    
    if existing:
        return jsonify({'error': 'Заявка уже отправлена'}), 409
    
    req = MessageRequest(
        from_user_id=user.id,
        to_user_id=to_user_id,
        message_text=message_text
    )
    db.session.add(req)
    db.session.commit()
    
    # Уведомляем получателя через сокет
    try:
        from app import socketio
        socketio.emit('new_message_request', {
            'request': req.to_dict()
        }, room=f'user_{to_user_id}')
    except Exception as e:
        print(f'Notify error: {e}')
    
    return jsonify({
        'message': 'Заявка отправлена',
        'request': req.to_dict()
    }), 201


@users_bp.route('/message-requests', methods=['GET'])
@login_required
def get_message_requests(user):
    """Получить свои заявки (входящие)"""
    requests = MessageRequest.query.filter_by(
        to_user_id=user.id,
        status='pending'
    ).order_by(MessageRequest.created_at.desc()).all()
    
    return jsonify({
        'requests': [r.to_dict() for r in requests]
    }), 200


@users_bp.route('/message-request/<int:request_id>/accept', methods=['POST'])
@login_required
def accept_message_request(user, request_id):
    """Принять заявку — добавить в разрешённые контакты"""
    req = MessageRequest.query.get(request_id)
    if not req:
        return jsonify({'error': 'Заявка не найдена'}), 404
    if req.to_user_id != user.id:
        return jsonify({'error': 'Нет прав'}), 403
    
    req.status = 'accepted'
    
    # Добавляем в разрешённые контакты (взаимно)
    try:
        db.session.execute(
            allowed_contacts.insert().values(
                user_id=user.id,
                contact_id=req.from_user_id
            )
        )
    except:
        pass
    
    try:
        db.session.execute(
            allowed_contacts.insert().values(
                user_id=req.from_user_id,
                contact_id=user.id
            )
        )
    except:
        pass
    
    db.session.commit()
    
    # Уведомляем отправителя
    try:
        from app import socketio
        socketio.emit('message_request_accepted', {
            'from_user': user.to_dict()
        }, room=f'user_{req.from_user_id}')
    except:
        pass
    
    return jsonify({'message': 'Заявка принята'}), 200


@users_bp.route('/message-request/<int:request_id>/reject', methods=['POST'])
@login_required
def reject_message_request(user, request_id):
    """Отклонить заявку"""
    req = MessageRequest.query.get(request_id)
    if not req:
        return jsonify({'error': 'Заявка не найдена'}), 404
    if req.to_user_id != user.id:
        return jsonify({'error': 'Нет прав'}), 403
    
    req.status = 'rejected'
    db.session.commit()
    
    return jsonify({'message': 'Заявка отклонена'}), 200


@users_bp.route('/check-can-message/<int:target_user_id>', methods=['GET'])
@login_required
def check_can_message(user, target_user_id):
    """Проверить можно ли писать этому пользователю"""
    target = User.query.get(target_user_id)
    if not target:
        return jsonify({'error': 'Пользователь не найден'}), 404
    
    can_message = is_allowed_to_message(user.id, target)
    
    # Проверим есть ли pending заявка
    pending_request = None
    if not can_message:
        pending_request = MessageRequest.query.filter_by(
            from_user_id=user.id,
            to_user_id=target_user_id,
            status='pending'
        ).first()
    
    return jsonify({
        'can_message': can_message,
        'privacy': target.privacy_messages,
        'has_pending_request': pending_request is not None
    }), 200