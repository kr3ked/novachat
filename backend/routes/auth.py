from flask import Blueprint, request, jsonify, current_app
from models import db, User, Chat, Channel, Message, Comment, message_likes, chat_members, channel_subscribers, VerificationCode
from datetime import datetime, timedelta
import re
import random
import bcrypt
import email_service

auth_bp = Blueprint('auth', __name__)


def validate_phone(phone):
    pattern = r'^\+?[1-9]\d{6,14}$'
    cleaned = re.sub(r'[\s\-\(\)]', '', phone)
    return bool(re.match(pattern, cleaned)), cleaned


def validate_email(email):
    """Простая проверка email"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def generate_code():
    """Генерирует 6-значный код"""
    return ''.join([str(random.randint(0, 9)) for _ in range(6)])


# ==================== EMAIL РЕГИСТРАЦИЯ ====================

@auth_bp.route('/send-code', methods=['POST'])
def send_code():
    """Отправить код подтверждения на email"""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных'}), 400

    email = data.get('email', '').strip().lower()
    password = data.get('password', '').strip()
    display_name = data.get('display_name', '').strip()
    username = data.get('username', '').strip() or None

    # Валидация
    if not email or not password or not display_name:
        return jsonify({'error': 'Заполните все обязательные поля'}), 400

    if not validate_email(email):
        return jsonify({'error': 'Неверный формат email'}), 400

    if len(password) < 6:
        return jsonify({'error': 'Пароль должен быть минимум 6 символов'}), 400

    if len(display_name) < 2:
        return jsonify({'error': 'Имя должно быть минимум 2 символа'}), 400

    # Проверка что email не занят
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Этот email уже зарегистрирован'}), 409

    # Проверка username
    if username:
        if len(username) < 3:
            return jsonify({'error': 'Username минимум 3 символа'}), 400
        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            return jsonify({'error': 'Username может содержать только латиницу, цифры и _'}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Этот username уже занят'}), 409

    # Удаляем старые коды для этого email
    VerificationCode.query.filter_by(email=email).delete()
    db.session.commit()

    # Генерируем код
    code = generate_code()
    expires_at = datetime.utcnow() + timedelta(minutes=10)

    # Хэшируем пароль сразу
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    # Сохраняем в БД
    verification = VerificationCode(
        email=email,
        code=code,
        display_name=display_name,
        username=username,
        password_hash=password_hash,
        expires_at=expires_at
    )
    db.session.add(verification)
    db.session.commit()

    # Отправляем письмо
    if not email_service.is_configured():
        return jsonify({'error': 'Email сервис не настроен'}), 500

    success, error = email_service.send_verification_code(email, code, display_name)

    if not success:
        return jsonify({'error': error or 'Не удалось отправить письмо. Проверьте email.'}), 500

    return jsonify({
        'message': 'Код отправлен на ваш email',
        'email': email,
        'expires_in': 600
    }), 200


@auth_bp.route('/verify-code', methods=['POST'])
def verify_code():
    """Проверить код и создать аккаунт"""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных'}), 400

    email = data.get('email', '').strip().lower()
    code = data.get('code', '').strip()

    if not email or not code:
        return jsonify({'error': 'Укажите email и код'}), 400

    if len(code) != 6 or not code.isdigit():
        return jsonify({'error': 'Код должен состоять из 6 цифр'}), 400

    # Ищем код
    verification = VerificationCode.query.filter_by(email=email).order_by(
        VerificationCode.created_at.desc()
    ).first()

    if not verification:
        return jsonify({'error': 'Код не найден. Отправьте новый.'}), 404

    if verification.is_expired():
        db.session.delete(verification)
        db.session.commit()
        return jsonify({'error': 'Код истёк. Отправьте новый.'}), 400

    if verification.attempts >= 5:
        db.session.delete(verification)
        db.session.commit()
        return jsonify({'error': 'Слишком много попыток. Отправьте новый код.'}), 429

    if verification.code != code:
        verification.attempts += 1
        db.session.commit()
        remaining = 5 - verification.attempts
        return jsonify({
            'error': f'Неверный код. Осталось попыток: {remaining}'
        }), 400

    # Проверяем что email не занят (на всякий случай)
    if User.query.filter_by(email=email).first():
        db.session.delete(verification)
        db.session.commit()
        return jsonify({'error': 'Email уже зарегистрирован'}), 409

    # Создаём пользователя
    user = User(
        email=email,
        display_name=verification.display_name,
        username=verification.username,
        password_hash=verification.password_hash,
        email_verified=True
    )
    db.session.add(user)

    # Удаляем код
    db.session.delete(verification)
    db.session.commit()

    # Токен
    token = user.generate_token(current_app.config['SECRET_KEY'])

    # Приветственное письмо (не критично если не отправится)
    try:
        email_service.send_welcome_email(email, user.display_name)
    except:
        pass

    return jsonify({
        'message': 'Регистрация успешна!',
        'token': token,
        'user': user.to_dict()
    }), 201


@auth_bp.route('/resend-code', methods=['POST'])
def resend_code():
    """Отправить код повторно"""
    data = request.get_json()
    email = data.get('email', '').strip().lower()

    if not email:
        return jsonify({'error': 'Укажите email'}), 400

    verification = VerificationCode.query.filter_by(email=email).order_by(
        VerificationCode.created_at.desc()
    ).first()

    if not verification:
        return jsonify({'error': 'Заявка не найдена. Начните регистрацию заново.'}), 404

    # Проверка что прошло минимум 60 секунд с последней отправки
    time_since = (datetime.utcnow() - verification.created_at).total_seconds()
    if time_since < 60:
        wait = int(60 - time_since)
        return jsonify({'error': f'Подождите {wait} секунд перед повторной отправкой'}), 429

    # Генерируем новый код
    new_code = generate_code()
    verification.code = new_code
    verification.attempts = 0
    verification.created_at = datetime.utcnow()
    verification.expires_at = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()

    # Отправляем
    success, error = email_service.send_verification_code(
        email, new_code, verification.display_name
    )

    if not success:
        return jsonify({'error': error or 'Ошибка отправки'}), 500

    return jsonify({
        'message': 'Код отправлен повторно',
        'expires_in': 600
    }), 200


# ==================== СТАРАЯ РЕГИСТРАЦИЯ ПО ТЕЛЕФОНУ (для совместимости) ====================

@auth_bp.route('/register', methods=['POST'])
def register():
    """Старая регистрация по телефону (оставляем для совместимости)"""
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
        return jsonify({'error': 'Неверный формат номера'}), 400

    if len(password) < 6:
        return jsonify({'error': 'Пароль минимум 6 символов'}), 400

    if len(display_name) < 2:
        return jsonify({'error': 'Имя минимум 2 символа'}), 400

    if User.query.filter_by(phone=cleaned_phone).first():
        return jsonify({'error': 'Этот номер уже зарегистрирован'}), 409

    if username:
        if len(username) < 3:
            return jsonify({'error': 'Username минимум 3 символа'}), 400
        if not re.match(r'^[a-zA-Z0-9_]+$', username):
            return jsonify({'error': 'Username только a-z, 0-9, _'}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({'error': 'Username занят'}), 409

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


# ==================== ВХОД (по email ИЛИ телефону) ====================

@auth_bp.route('/login', methods=['POST'])
def login():
    """Вход по email или телефону"""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных'}), 400

    login_field = data.get('phone', '').strip() or data.get('email', '').strip() or data.get('login', '').strip()
    password = data.get('password', '').strip()

    if not login_field or not password:
        return jsonify({'error': 'Введите email/телефон и пароль'}), 400

    user = None

    # Пробуем найти по email
    if '@' in login_field:
        user = User.query.filter_by(email=login_field.lower()).first()
    else:
        # Иначе по телефону
        _, cleaned_phone = validate_phone(login_field)
        user = User.query.filter_by(phone=cleaned_phone).first()

    if not user or not user.check_password(password):
        return jsonify({'error': 'Неверные данные для входа'}), 401

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
    """Простое удаление аккаунта"""
    from routes.users import get_current_user
    from sqlalchemy import text
    
    user = get_current_user()
    
    if not user:
        return jsonify({'error': 'Не авторизован'}), 401

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Нет данных'}), 400

    password = data.get('password', '').strip()
    
    if not password:
        return jsonify({'error': 'Введите пароль'}), 400

    if not user.check_password(password):
        return jsonify({'error': 'Неверный пароль'}), 401

    user_id = user.id

    try:
        db.session.execute(text("DELETE FROM message_likes WHERE user_id = :uid"), {"uid": user_id})
        db.session.execute(text("DELETE FROM comments WHERE user_id = :uid"), {"uid": user_id})
        db.session.execute(text("DELETE FROM chat_members WHERE user_id = :uid"), {"uid": user_id})
        db.session.execute(text("DELETE FROM channel_subscribers WHERE user_id = :uid"), {"uid": user_id})
        db.session.execute(text("UPDATE messages SET is_deleted = true, text = NULL WHERE sender_id = :uid"), {"uid": user_id})
        db.session.execute(text("DELETE FROM channels WHERE owner_id = :uid"), {"uid": user_id})
        db.session.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})
        db.session.commit()

        return jsonify({'message': 'Аккаунт удалён'}), 200

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Ошибка: {str(e)}'}), 500