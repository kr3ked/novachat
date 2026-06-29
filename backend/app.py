from flask import Flask, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from models import db, User, Message, Chat
from config import Config
import os

app = Flask(__name__)
app.config.from_object(Config)

CORS(app, resources={r"/api/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

db.init_app(app)

from routes.auth import auth_bp
from routes.users import users_bp
from routes.chats import chats_bp
from routes.channels import channels_bp
from routes.messages import messages_bp

app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(users_bp, url_prefix='/api/users')
app.register_blueprint(chats_bp, url_prefix='/api/chats')
app.register_blueprint(channels_bp, url_prefix='/api/channels')
app.register_blueprint(messages_bp, url_prefix='/api/messages')

connected_users = {}


@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    upload_folder = app.config.get('UPLOAD_FOLDER', '/tmp/uploads')
    return send_from_directory(upload_folder, filename)


@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')


@socketio.on('authenticate')
def handle_authenticate(data):
    token = data.get('token')
    if not token:
        return
    user_id = User.verify_token(token, app.config['SECRET_KEY'])
    if user_id:
        connected_users[user_id] = request.sid
        user = User.query.get(user_id)
        if user:
            user.is_online = True
            db.session.commit()
        for chat in user.chats.all():
            join_room(f'chat_{chat.id}')
        for channel in user.subscribed_channels.all():
            join_room(f'channel_{channel.id}')
        join_room(f'user_{user_id}')
        emit('authenticated', {'user_id': user_id})


@socketio.on('disconnect')
def handle_disconnect():
    from datetime import datetime
    user_id = None
    for uid, sid in connected_users.items():
        if sid == request.sid:
            user_id = uid
            break
    if user_id:
        del connected_users[user_id]
        user = User.query.get(user_id)
        if user:
            user.is_online = False
            user.last_seen = datetime.utcnow()
            db.session.commit()


@socketio.on('send_message')
def handle_send_message(data):
    token = data.get('token')
    user_id = User.verify_token(token, app.config['SECRET_KEY'])
    if not user_id:
        return
    user = User.query.get(user_id)
    chat_id = data.get('chat_id')
    text = data.get('text', '').strip() if data.get('text') else ''
    reply_to_id = data.get('reply_to_id')
    file_url = data.get('file_url')
    file_name = data.get('file_name')

    if not chat_id or (not text and not file_url):
        return

    chat = Chat.query.get(chat_id)
    if not chat or user not in chat.members:
        return

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

    msg_dict = message.to_dict()

    emit('new_message', msg_dict, room=f'chat_{chat_id}')

    for member in chat.members:
        socketio.emit('chat_updated', {
            'chat_id': chat_id,
            'last_message': msg_dict
        }, room=f'user_{member.id}')


@socketio.on('typing')
def handle_typing(data):
    token = data.get('token')
    user_id = User.verify_token(token, app.config['SECRET_KEY'])
    if not user_id:
        return
    user = User.query.get(user_id)
    chat_id = data.get('chat_id')
    if chat_id:
        emit('user_typing', {
            'user_id': user_id,
            'display_name': user.display_name,
            'chat_id': chat_id
        }, room=f'chat_{chat_id}', include_self=False)


@socketio.on('join_chat')
def handle_join_chat(data):
    chat_id = data.get('chat_id')
    if chat_id:
        join_room(f'chat_{chat_id}')


@socketio.on('notify_chat_created')
def handle_chat_created(data):
    token = data.get('token')
    user_id = User.verify_token(token, app.config['SECRET_KEY'])
    if not user_id:
        return
    chat_id = data.get('chat_id')
    if not chat_id:
        return
    chat = Chat.query.get(chat_id)
    if not chat:
        return
    for member in chat.members:
        socketio.emit('chat_updated', {
            'chat_id': chat_id,
            'new_chat': True
        }, room=f'user_{member.id}')


with app.app_context():
    db.create_all()
    print("✅ База данных инициализирована")


if __name__ == '__main__':
    os.makedirs('uploads', exist_ok=True)
    print("🚀 NovaChat запущен на http://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)