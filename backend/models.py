from datetime import datetime, timedelta
from flask_sqlalchemy import SQLAlchemy
import bcrypt
import jwt

db = SQLAlchemy()

chat_members = db.Table('chat_members',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
    db.Column('chat_id', db.Integer, db.ForeignKey('chats.id'), primary_key=True),
    db.Column('joined_at', db.DateTime, default=datetime.utcnow),
    db.Column('role', db.String(20), default='member')
)

channel_subscribers = db.Table('channel_subscribers',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
    db.Column('channel_id', db.Integer, db.ForeignKey('channels.id'), primary_key=True),
    db.Column('joined_at', db.DateTime, default=datetime.utcnow),
    db.Column('role', db.String(20), default='subscriber')
)

message_likes = db.Table('message_likes',
    db.Column('user_id', db.Integer, db.ForeignKey('users.id'), primary_key=True),
    db.Column('message_id', db.Integer, db.ForeignKey('messages.id'), primary_key=True),
    db.Column('reaction', db.String(10), default='👍'),
    db.Column('created_at', db.DateTime, default=datetime.utcnow)
)


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    phone = db.Column(db.String(20), unique=True, nullable=False)
    username = db.Column(db.String(50), unique=True, nullable=True)
    display_name = db.Column(db.String(100), nullable=False)
    bio = db.Column(db.String(500), default='')
    avatar_url = db.Column(db.String(300), default='')
    password_hash = db.Column(db.String(200), nullable=False)
    is_online = db.Column(db.Boolean, default=False)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sent_messages = db.relationship('Message', backref='sender', lazy='dynamic',
                                     foreign_keys='Message.sender_id')
    owned_channels = db.relationship('Channel', backref='owner', lazy='dynamic')

    def set_password(self, password):
        self.password_hash = bcrypt.hashpw(
            password.encode('utf-8'),
            bcrypt.gensalt()
        ).decode('utf-8')

    def check_password(self, password):
        return bcrypt.checkpw(
            password.encode('utf-8'),
            self.password_hash.encode('utf-8')
        )

    def generate_token(self, secret_key, hours=72):
        payload = {
            'user_id': self.id,
            'exp': datetime.utcnow() + timedelta(hours=hours),
            'iat': datetime.utcnow()
        }
        return jwt.encode(payload, secret_key, algorithm='HS256')

    @staticmethod
    def verify_token(token, secret_key):
        try:
            payload = jwt.decode(token, secret_key, algorithms=['HS256'])
            return payload['user_id']
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            return None

    def to_dict(self):
        return {
            'id': self.id,
            'phone': self.phone,
            'username': self.username,
            'display_name': self.display_name,
            'bio': self.bio,
            'avatar_url': self.avatar_url,
            'is_online': self.is_online,
            'last_seen': self.last_seen.isoformat() + 'Z' if self.last_seen else None,
            'created_at': self.created_at.isoformat() + 'Z'
        }


class Chat(db.Model):
    __tablename__ = 'chats'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=True)
    chat_type = db.Column(db.String(20), default='private')
    avatar_url = db.Column(db.String(300), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))

    members = db.relationship('User', secondary=chat_members,
                               backref=db.backref('chats', lazy='dynamic'))
    messages = db.relationship('Message', backref='chat', lazy='dynamic',
                                order_by='Message.created_at.desc()')

    def to_dict(self, current_user_id=None):
        last_msg = self.messages.first()
        
        data = {
            'id': self.id,
            'name': self.name,
            'chat_type': self.chat_type,
            'avatar_url': self.avatar_url,
            'created_at': self.created_at.isoformat() + 'Z',
            'members_count': len(self.members),
            'last_message': last_msg.to_dict() if last_msg else None
        }

        if self.chat_type == 'private' and current_user_id:
            other_user = next(
                (m for m in self.members if m.id != current_user_id), None
            )
            if other_user:
                data['name'] = other_user.display_name
                data['avatar_url'] = other_user.avatar_url
                data['other_user'] = other_user.to_dict()

        return data


class Channel(db.Model):
    __tablename__ = 'channels'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    handle = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(1000), default='')
    avatar_url = db.Column(db.String(300), default='')
    is_public = db.Column(db.Boolean, default=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    subscribers = db.relationship('User', secondary=channel_subscribers,
                                   backref=db.backref('subscribed_channels', lazy='dynamic'))
    posts = db.relationship('Message', backref='channel', lazy='dynamic',
                             order_by='Message.created_at.desc()')

    def to_dict(self):
        last_post = self.posts.first()
        return {
            'id': self.id,
            'name': self.name,
            'handle': self.handle,
            'description': self.description,
            'avatar_url': self.avatar_url,
            'is_public': self.is_public,
            'owner_id': self.owner_id,
            'subscribers_count': len(self.subscribers),
            'created_at': self.created_at.isoformat() + 'Z',
            'last_post': last_post.to_dict() if last_post else None
        }


class Message(db.Model):
    __tablename__ = 'messages'

    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=True)
    message_type = db.Column(db.String(20), default='text')
    
    chat_id = db.Column(db.Integer, db.ForeignKey('chats.id'), nullable=True)
    channel_id = db.Column(db.Integer, db.ForeignKey('channels.id'), nullable=True)
    
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    
    forwarded_from_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=True)
    forwarded_from_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    reply_to_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=True)
    
    file_url = db.Column(db.String(300), nullable=True)
    file_name = db.Column(db.String(200), nullable=True)
    
    is_edited = db.Column(db.Boolean, default=False)
    is_deleted = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    edited_at = db.Column(db.DateTime, nullable=True)

    likes = db.relationship('User', secondary=message_likes,
                             backref=db.backref('liked_messages', lazy='dynamic'))
    comments = db.relationship('Comment', backref='message', lazy='dynamic',
                                order_by='Comment.created_at')
    reply_to = db.relationship('Message', remote_side=[id],
                                foreign_keys=[reply_to_id])
    forwarded_from = db.relationship('Message', remote_side=[id],
                                      foreign_keys=[forwarded_from_id])
    forwarded_user = db.relationship('User', foreign_keys=[forwarded_from_user_id])

    def get_reactions_summary(self):
        from sqlalchemy import func
        reactions = db.session.query(
            message_likes.c.reaction,
            func.count(message_likes.c.user_id)
        ).filter(
            message_likes.c.message_id == self.id
        ).group_by(message_likes.c.reaction).all()
        
        return {r[0]: r[1] for r in reactions}

    def to_dict(self):
        sender = User.query.get(self.sender_id)
        
        data = {
            'id': self.id,
            'text': self.text,
            'message_type': self.message_type,
            'chat_id': self.chat_id,
            'channel_id': self.channel_id,
            'sender': sender.to_dict() if sender else None,
            'file_url': self.file_url,
            'file_name': self.file_name,
            'is_edited': self.is_edited,
            'is_deleted': self.is_deleted,
            'created_at': self.created_at.isoformat() + 'Z',
            'edited_at': self.edited_at.isoformat() + 'Z' if self.edited_at else None,
            'likes_count': len(self.likes),
            'reactions': self.get_reactions_summary(),
            'comments_count': self.comments.count(),
            'reply_to': None,
            'forwarded_from': None
        }

        if self.reply_to_id and self.reply_to:
            data['reply_to'] = {
                'id': self.reply_to.id,
                'text': self.reply_to.text[:100] if self.reply_to.text else '',
                'sender': User.query.get(self.reply_to.sender_id).to_dict()
            }

        if self.forwarded_from_id:
            data['forwarded_from'] = {
                'original_message_id': self.forwarded_from_id,
                'original_sender': self.forwarded_user.to_dict() if self.forwarded_user else None
            }

        return data


class Comment(db.Model):
    __tablename__ = 'comments'

    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    message_id = db.Column(db.Integer, db.ForeignKey('messages.id'))
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='comments')

    def to_dict(self):
        return {
            'id': self.id,
            'text': self.text,
            'message_id': self.message_id,
            'user': self.user.to_dict(),
            'created_at': self.created_at.isoformat() + 'Z'
        }