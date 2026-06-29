from flask import Blueprint, request, jsonify
from models import db, Chat, User, Message, Comment, message_likes, chat_members
from routes.users import login_required
from sqlalchemy import text

chats_bp = Blueprint('chats', __name__)


@chats_bp.route('/', methods=['GET'])
@login_required
def get_chats(user):
    user_chats = user.chats.all()
    return jsonify({
        'chats': [chat.to_dict(current_user_id=user.id) for chat in user_chats]
    }), 200


@chats_bp.route('/private', methods=['POST'])
@login_required
def create_private_chat(user):
    data = request.get_json()
    other_user_id = data.get('user_id')

    if not other_user_id:
        return jsonify({'error': 'Укажите ID пользователя'}), 400
    if other_user_id == user.id:
        return jsonify({'error': 'Нельзя создать чат с самим собой'}), 400

    other_user = User.query.get(other_user_id)
    if not other_user:
        return jsonify({'error': 'Пользователь не найден'}), 404

    existing_chat = Chat.query.filter_by(chat_type='private').filter(
        Chat.members.any(id=user.id)
    ).filter(
        Chat.members.any(id=other_user_id)
    ).first()

    if existing_chat:
        return jsonify({
            'chat': existing_chat.to_dict(current_user_id=user.id),
            'existing': True
        }), 200

    chat = Chat(chat_type='private', created_by=user.id)
    chat.members.append(user)
    chat.members.append(other_user)

    db.session.add(chat)
    db.session.commit()

    from app import socketio
    socketio.emit('chat_updated', {
        'chat_id': chat.id,
        'new_chat': True
    }, room=f'user_{other_user_id}')

    return jsonify({
        'chat': chat.to_dict(current_user_id=user.id),
        'existing': False
    }), 201


@chats_bp.route('/group', methods=['POST'])
@login_required
def create_group_chat(user):
    data = request.get_json()
    name = data.get('name', '').strip()
    member_ids = data.get('member_ids', [])

    if not name:
        return jsonify({'error': 'Укажите название группы'}), 400
    if len(name) < 2:
        return jsonify({'error': 'Название минимум 2 символа'}), 400

    chat = Chat(
        name=name,
        chat_type='group',
        created_by=user.id,
        avatar_url=data.get('avatar_url', '')
    )
    chat.members.append(user)

    for uid in member_ids:
        member = User.query.get(uid)
        if member and member.id != user.id:
            chat.members.append(member)

    db.session.add(chat)
    db.session.commit()

    db.session.execute(
        chat_members.update().where(
            db.and_(
                chat_members.c.chat_id == chat.id,
                chat_members.c.user_id == user.id
            )
        ).values(role='owner')
    )
    db.session.commit()

    from app import socketio
    for member in chat.members:
        socketio.emit('chat_updated', {
            'chat_id': chat.id,
            'new_chat': True
        }, room=f'user_{member.id}')

    return jsonify({'chat': chat.to_dict(current_user_id=user.id)}), 201


@chats_bp.route('/<int:chat_id>', methods=['GET'])
@login_required
def get_chat(user, chat_id):
    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({'error': 'Чат не найден'}), 404
    if user not in chat.members:
        return jsonify({'error': 'Вы не участник этого чата'}), 403

    return jsonify({
        'chat': chat.to_dict(current_user_id=user.id),
        'members': [m.to_dict() for m in chat.members]
    }), 200


@chats_bp.route('/<int:chat_id>/members', methods=['POST'])
@login_required
def add_member(user, chat_id):
    chat = Chat.query.get(chat_id)
    if not chat or chat.chat_type != 'group':
        return jsonify({'error': 'Групповой чат не найден'}), 404
    if user not in chat.members:
        return jsonify({'error': 'Вы не участник этого чата'}), 403

    data = request.get_json()
    new_user_id = data.get('user_id')
    new_member = User.query.get(new_user_id)
    if not new_member:
        return jsonify({'error': 'Пользователь не найден'}), 404
    if new_member in chat.members:
        return jsonify({'error': 'Пользователь уже в чате'}), 409

    chat.members.append(new_member)
    db.session.commit()

    from app import socketio
    socketio.emit('chat_updated', {
        'chat_id': chat_id,
        'new_chat': True
    }, room=f'user_{new_user_id}')

    return jsonify({'message': 'Участник добавлен'}), 200


@chats_bp.route('/<int:chat_id>/leave', methods=['POST'])
@login_required
def leave_chat(user, chat_id):
    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({'error': 'Чат не найден'}), 404

    if user in chat.members:
        chat.members.remove(user)
        db.session.commit()

    return jsonify({'message': 'Вы покинули чат'}), 200


@chats_bp.route('/<int:chat_id>/delete', methods=['DELETE'])
@login_required
def delete_chat(user, chat_id):
    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({'error': 'Чат не найден'}), 404
    if user not in chat.members:
        return jsonify({'error': 'Вы не участник этого чата'}), 403

    try:
        if chat.chat_type == 'private':
            # Получаем все сообщения чата
            messages = Message.query.filter_by(chat_id=chat_id).all()

            for msg in messages:
                # Удаляем реакции на сообщение
                db.session.execute(
                    message_likes.delete().where(
                        message_likes.c.message_id == msg.id
                    )
                )
                # Удаляем комментарии к сообщению
                Comment.query.filter_by(message_id=msg.id).delete()

            db.session.flush()

            # Удаляем сами сообщения по одному
            for msg in messages:
                db.session.delete(msg)

            db.session.flush()

            # Удаляем участников чата
            db.session.execute(
                chat_members.delete().where(
                    chat_members.c.chat_id == chat_id
                )
            )

            db.session.flush()

            # Удаляем чат
            db.session.delete(chat)
            db.session.commit()

            return jsonify({'message': 'Чат удалён', 'deleted': True}), 200

        else:
            # Для группы — просто выходим
            chat.members.remove(user)
            db.session.commit()
            return jsonify({'message': 'Вы покинули группу', 'deleted': False}), 200

    except Exception as e:
        db.session.rollback()
        print(f'Ошибка удаления чата: {e}')
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Ошибка удаления: {str(e)}'}), 500