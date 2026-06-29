from flask import Blueprint, request, jsonify, current_app
from models import db, Message, Chat, Channel, Comment, User, message_likes
from routes.users import login_required
from datetime import datetime
import os
import uuid
from werkzeug.utils import secure_filename

messages_bp = Blueprint('messages', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@messages_bp.route('/chat/<int:chat_id>', methods=['GET'])
@login_required
def get_chat_messages(user, chat_id):
    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({'error': 'Чат не найден'}), 404
    if user not in chat.members:
        return jsonify({'error': 'Вы не участник чата'}), 403

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 100)

    messages = Message.query.filter_by(
        chat_id=chat_id, is_deleted=False
    ).order_by(
        Message.created_at.desc()
    ).paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        'messages': [m.to_dict() for m in reversed(messages.items)],
        'total': messages.total,
        'pages': messages.pages,
        'current_page': page
    }), 200


@messages_bp.route('/channel/<int:channel_id>', methods=['GET'])
@login_required
def get_channel_posts(user, channel_id):
    channel = Channel.query.get(channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 30, type=int)

    posts = Message.query.filter_by(
        channel_id=channel_id, is_deleted=False
    ).order_by(
        Message.created_at.desc()
    ).paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        'messages': [m.to_dict() for m in posts.items],
        'total': posts.total,
        'pages': posts.pages,
        'current_page': page
    }), 200


@messages_bp.route('/send', methods=['POST'])
@login_required
def send_message(user):
    data = request.get_json()

    chat_id = data.get('chat_id')
    text = data.get('text', '').strip() if data.get('text') else ''
    reply_to_id = data.get('reply_to_id')
    file_url = data.get('file_url')
    file_name = data.get('file_name')

    if not chat_id:
        return jsonify({'error': 'Укажите chat_id'}), 400
    if not text and not file_url:
        return jsonify({'error': 'Сообщение не может быть пустым'}), 400

    chat = Chat.query.get(chat_id)
    if not chat:
        return jsonify({'error': 'Чат не найден'}), 404
    if user not in chat.members:
        return jsonify({'error': 'Вы не участник чата'}), 403

    msg_type = 'image' if file_url else 'text'

    message = Message(
        text=text if text else None,
        chat_id=chat_id,
        sender_id=user.id,
        message_type=msg_type,
        reply_to_id=reply_to_id,
        file_url=file_url,
        file_name=file_name
    )

    db.session.add(message)
    db.session.commit()

    return jsonify({
        'message': message.to_dict()
    }), 201


@messages_bp.route('/upload', methods=['POST'])
@login_required
def upload_file(user):
    if 'image' not in request.files:
        return jsonify({'error': 'Файл не найден'}), 400

    file = request.files['image']
    if not file or file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Формат не поддерживается (png, jpg, jpeg, gif, webp)'}), 400

    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > 10 * 1024 * 1024:
        return jsonify({'error': 'Файл слишком большой (макс 10MB)'}), 400

    ext = file.filename.rsplit('.', 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    original_name = secure_filename(file.filename)

    upload_folder = current_app.config.get('UPLOAD_FOLDER', '/tmp/uploads')
    os.makedirs(upload_folder, exist_ok=True)

    file.save(os.path.join(upload_folder, filename))

    return jsonify({
        'file_url': f'/uploads/{filename}',
        'file_name': original_name
    }), 200


@messages_bp.route('/channel/<int:channel_id>/post', methods=['POST'])
@login_required
def create_post(user, channel_id):
    channel = Channel.query.get(channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404

    if channel.owner_id != user.id:
        return jsonify({'error': 'Нет прав на публикацию'}), 403

    data = request.get_json()
    text = data.get('text', '').strip()

    if not text:
        return jsonify({'error': 'Пост не может быть пустым'}), 400

    message = Message(
        text=text,
        channel_id=channel_id,
        sender_id=user.id,
        message_type='text'
    )

    db.session.add(message)
    db.session.commit()

    return jsonify({
        'message': message.to_dict()
    }), 201


@messages_bp.route('/<int:message_id>/edit', methods=['PUT'])
@login_required
def edit_message(user, message_id):
    message = Message.query.get(message_id)
    if not message:
        return jsonify({'error': 'Сообщение не найдено'}), 404
    if message.sender_id != user.id:
        return jsonify({'error': 'Нет прав'}), 403

    data = request.get_json()
    new_text = data.get('text', '').strip()

    if not new_text:
        return jsonify({'error': 'Текст не может быть пустым'}), 400

    message.text = new_text
    message.is_edited = True
    message.edited_at = datetime.utcnow()

    db.session.commit()

    return jsonify({'message': message.to_dict()}), 200


@messages_bp.route('/<int:message_id>/delete', methods=['DELETE'])
@login_required
def delete_message(user, message_id):
    message = Message.query.get(message_id)
    if not message:
        return jsonify({'error': 'Сообщение не найдено'}), 404
    if message.sender_id != user.id:
        return jsonify({'error': 'Нет прав'}), 403

    message.is_deleted = True
    message.text = None
    db.session.commit()

    return jsonify({'message': 'Сообщение удалено'}), 200


@messages_bp.route('/<int:message_id>/like', methods=['POST'])
@login_required
def toggle_like(user, message_id):
    message = Message.query.get(message_id)
    if not message:
        return jsonify({'error': 'Сообщение не найдено'}), 404

    data = request.get_json() or {}
    reaction = data.get('reaction', '👍')

    existing = db.session.query(message_likes).filter_by(
        user_id=user.id, message_id=message_id
    ).first()

    if existing:
        db.session.execute(
            message_likes.delete().where(
                db.and_(
                    message_likes.c.user_id == user.id,
                    message_likes.c.message_id == message_id
                )
            )
        )
        db.session.commit()
        action = 'unliked'
    else:
        db.session.execute(
            message_likes.insert().values(
                user_id=user.id,
                message_id=message_id,
                reaction=reaction
            )
        )
        db.session.commit()
        action = 'liked'

    return jsonify({
        'action': action,
        'reactions': message.get_reactions_summary(),
        'likes_count': len(message.likes)
    }), 200


@messages_bp.route('/<int:message_id>/reactions', methods=['GET'])
@login_required
def get_reactions(user, message_id):
    message = Message.query.get(message_id)
    if not message:
        return jsonify({'error': 'Сообщение не найдено'}), 404

    reactions_data = db.session.query(
        message_likes.c.reaction,
        User
    ).join(
        User, User.id == message_likes.c.user_id
    ).filter(
        message_likes.c.message_id == message_id
    ).all()

    reactions = {}
    for reaction, reactor in reactions_data:
        if reaction not in reactions:
            reactions[reaction] = []
        reactions[reaction].append(reactor.to_dict())

    return jsonify({
        'reactions': reactions,
        'summary': message.get_reactions_summary()
    }), 200


@messages_bp.route('/<int:message_id>/comments', methods=['GET'])
@login_required
def get_comments(user, message_id):
    message = Message.query.get(message_id)
    if not message:
        return jsonify({'error': 'Сообщение не найдено'}), 404

    comments = message.comments.all()

    return jsonify({
        'comments': [c.to_dict() for c in comments],
        'total': len(comments)
    }), 200


@messages_bp.route('/<int:message_id>/comments', methods=['POST'])
@login_required
def add_comment(user, message_id):
    message = Message.query.get(message_id)
    if not message:
        return jsonify({'error': 'Сообщение не найдено'}), 404

    data = request.get_json()
    text = data.get('text', '').strip()

    if not text:
        return jsonify({'error': 'Комментарий не может быть пустым'}), 400

    comment = Comment(
        text=text,
        message_id=message_id,
        user_id=user.id
    )

    db.session.add(comment)
    db.session.commit()

    return jsonify({
        'comment': comment.to_dict()
    }), 201


@messages_bp.route('/comments/<int:comment_id>', methods=['DELETE'])
@login_required
def delete_comment(user, comment_id):
    comment = Comment.query.get(comment_id)
    if not comment:
        return jsonify({'error': 'Комментарий не найден'}), 404
    if comment.user_id != user.id:
        return jsonify({'error': 'Нет прав'}), 403

    db.session.delete(comment)
    db.session.commit()

    return jsonify({'message': 'Комментарий удалён'}), 200


@messages_bp.route('/<int:message_id>/forward', methods=['POST'])
@login_required
def forward_message(user, message_id):
    original = Message.query.get(message_id)
    if not original:
        return jsonify({'error': 'Сообщение не найдено'}), 404

    data = request.get_json()
    target_chat_id = data.get('chat_id')
    target_channel_id = data.get('channel_id')

    if not target_chat_id and not target_channel_id:
        return jsonify({'error': 'Укажите куда переслать'}), 400

    if target_chat_id:
        chat = Chat.query.get(target_chat_id)
        if not chat or user not in chat.members:
            return jsonify({'error': 'Нет доступа к чату'}), 403

    if target_channel_id:
        channel = Channel.query.get(target_channel_id)
        if not channel or channel.owner_id != user.id:
            return jsonify({'error': 'Нет прав на публикацию'}), 403

    forwarded = Message(
        text=original.text,
        message_type='forwarded',
        chat_id=target_chat_id,
        channel_id=target_channel_id,
        sender_id=user.id,
        forwarded_from_id=original.id,
        forwarded_from_user_id=original.sender_id,
        file_url=original.file_url,
        file_name=original.file_name
    )

    db.session.add(forwarded)
    db.session.commit()

    return jsonify({
        'message': forwarded.to_dict()
    }), 201