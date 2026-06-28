from flask import Blueprint, request, jsonify, current_app
from models import db, User, Chat, Channel, Message, Comment, message_likes, chat_members, channel_subscribers
import re

auth_bp = Blueprint('auth', __name__)


def validate_phone(phone):
    pattern = r'^\+?[1-9]\d{6,14}$'
    cleaned = re.sub(r'[\s\-\(\)]', '', phone)
    return bool(re.match(pattern, cleaned)), cleaned


@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()

    if not data:
        return jsonify({'error': 'Нет данных'}), 400

    phone = data.get('phone', '').strip()
    password = data.get('password', '').strip()
    display_name = data.get('display_name', '').strip()
    username = data.get('username', '').strip() or None

    if not phone or not password or not display_name:
        return jsonify({'error': 'Заполните все обязательные поля'}), 400

    is_valid, cleaned_phone = validate_phone(phone)
    if not is_valid:
        return jsonify({'error': 'Неверный формат номера телефона'}), 400

    if len(password) < 6:
        return jsonify({'error': 'Пароль должен быть минимум 6 символов'}), 400

    if len(display_name) < 2:
        return jsonify({'error': 'Имя должно быть минимум 2 символа'}), 400

    if User.query.filter_by(phone=cleaned_phone).first():
        return jsonify({'error': 'Этот номер уже зарегистрирован'}), 409

    if username:
        if len(username) < 3:
            return jsonify({'error': 'Username минимум 3 символа'}), 400
        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            return jsonify({'error': 'Username может содержать только латиницу, цифры и _'}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Этот username уже занят'}), 409

    user = User(
        phone=cleaned_phone,
        display_name=display_name,
        username=username
    )
    user.set_password(password)

    db.session.add(user)
    db.session.commit()

    token = user.generate_token(current_app.config['SECRET_KEY'])

    return jsonify({
        'message': 'Регистрация успешна!',
        'token': token,
        'user': user.to_dict()
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()

    if not data:
        return jsonify({'error': 'Нет данных'}), 400

    phone = data.get('phone', '').strip()
    password = data.get('password', '').strip()

    if not phone or not password:
        return jsonify({'error': 'Введите телефон и пароль'}), 400

    _, cleaned_phone = validate_phone(phone)

    user = User.query.filter_by(phone=cleaned_phone).first()

    if not user or not user.check_password(password):
        return jsonify({'error': 'Неверный телефон или пароль'}), 401

    user.is_online = True
    db.session.commit()

    token = user.generate_token(current_app.config['SECRET_KEY'])

    return jsonify({
        'message': 'Вход выполнен!',
        'token': token,
        'user': user.to_dict()
    }), 200


@auth_bp.route('/logout', methods=['POST'])
def logout():
    from routes.users import get_current_user
    user = get_current_user()
    if user:
        user.is_online = False
        from datetime import datetime
        user.last_seen = datetime.utcnow()
        db.session.commit()
    return jsonify({'message': 'Вы вышли из аккаунта'}), 200


@auth_bp.route('/check', methods=['GET'])
def check_auth():
    from routes.users import get_current_user
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401
    return jsonify({'user': user.to_dict()}), 200


@auth_bp.route('/delete-account', methods=['POST'])
def delete_account():
    """Полное удаление аккаунта пользователя с подтверждением пароля"""
    from routes.users import get_current_user
    user = get_current_user()
    
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных'}), 400

    password = data.get('password', '').strip()
    
    if not password:
        return jsonify({'error': 'Введите пароль для подтверждения'}), 400

    # Проверяем пароль
    if not user.check_password(password):
        return jsonify({'error': 'Неверный пароль'}), 401

    user_id = user.id
    user_name = user.display_name

    try:
        # 1. Удаляем все реакции пользователя
        db.session.execute(
            message_likes.delete().where(message_likes.c.user_id == user_id)
        )

        # 2. Удаляем все комментарии пользователя
        Comment.query.filter_by(user_id=user_id).delete()

        # 3. Удаляем все сообщения пользователя (помечаем как удалённые)
        Message.query.filter_by(sender_id=user_id).update({
            'is_deleted': True,
            'text': None
        })

        # 4. Удаляем пользователя из всех чатов
        db.session.execute(
            chat_members.delete().where(chat_members.c.user_id == user_id)
        )

        # 5. Удаляем пользователя из всех каналов
        db.session.execute(
            channel_subscribers.delete().where(channel_subscribers.c.user_id == user_id)
        )

        # 6. Удаляем все каналы пользователя (где он владелец)
        owned_channels = Channel.query.filter_by(owner_id=user_id).all()
        for channel in owned_channels:
            # Удаляем всех подписчиков канала
            db.session.execute(
                channel_subscribers.delete().where(
                    channel_subscribers.c.channel_id == channel.id
                )
            )
            # Удаляем все посты канала
            posts = Message.query.filter_by(channel_id=channel.id).all()
            for post in posts:
                # Удаляем реакции на посты
                db.session.execute(
                    message_likes.delete().where(message_likes.c.message_id == post.id)
                )
                # Удаляем комментарии к постам
                Comment.query.filter_by(message_id=post.id).delete()
            # Удаляем сами посты
            Message.query.filter_by(channel_id=channel.id).delete()
            # Удаляем канал
            db.session.delete(channel)

        # 7. Удаляем пустые приватные чаты (где остался только удалённый пользователь)
        empty_chats = Chat.query.filter(
            ~Chat.members.any()
        ).all()
        for chat in empty_chats:
            Message.query.filter_by(chat_id=chat.id).delete()
            db.session.delete(chat)

        # 8. Удаляем самого пользователя
        db.session.delete(user)
        db.session.commit()

        return jsonify({
            'message': f'Аккаунт {user_name} удалён'
        }), 200

    except Exception as e:
        db.session.rollback()
        print(f'Ошибка удаления аккаунта: {e}')
        return jsonify({'error': 'Не удалось удалить аккаунт. Попробуйте позже.'}), 500