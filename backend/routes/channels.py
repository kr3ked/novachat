from flask import Blueprint, request, jsonify
from models import db, Channel, User, channel_subscribers
from routes.users import login_required
import re

channels_bp = Blueprint('channels', __name__)


@channels_bp.route('/', methods=['GET'])
@login_required
def get_my_channels(user):
    subscribed = user.subscribed_channels.all()
    return jsonify({
        'channels': [ch.to_dict() for ch in subscribed]
    }), 200


@channels_bp.route('/create', methods=['POST'])
@login_required
def create_channel(user):
    data = request.get_json()

    name = data.get('name', '').strip()
    handle = data.get('handle', '').strip().lower()
    description = data.get('description', '').strip()

    if not name or not handle:
        return jsonify({'error': 'Укажите название и handle канала'}), 400

    if len(name) < 2:
        return jsonify({'error': 'Название минимум 2 символа'}), 400

    if not re.match(r'^[a-z0-9_]{3,30}$', handle):
        return jsonify({
            'error': 'Handle: 3-30 символов, только a-z, 0-9, _'
        }), 400

    if Channel.query.filter_by(handle=handle).first():
        return jsonify({'error': 'Этот handle уже занят'}), 409

    channel = Channel(
        name=name,
        handle=handle,
        description=description[:1000],
        avatar_url=data.get('avatar_url', ''),
        is_public=data.get('is_public', True),
        owner_id=user.id
    )
    channel.subscribers.append(user)

    db.session.add(channel)
    db.session.commit()

    db.session.execute(
        channel_subscribers.update().where(
            db.and_(
                channel_subscribers.c.channel_id == channel.id,
                channel_subscribers.c.user_id == user.id
            )
        ).values(role='owner')
    )
    db.session.commit()

    return jsonify({
        'channel': channel.to_dict()
    }), 201


@channels_bp.route('/<int:channel_id>', methods=['GET'])
@login_required
def get_channel(user, channel_id):
    channel = Channel.query.get(channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404

    is_subscribed = user in channel.subscribers
    is_owner = channel.owner_id == user.id

    data = channel.to_dict()
    data['is_subscribed'] = is_subscribed
    data['is_owner'] = is_owner

    return jsonify({'channel': data}), 200


@channels_bp.route('/search', methods=['GET'])
@login_required
def search_channels(user):
    query = request.args.get('q', '').strip()
    if len(query) < 2:
        return jsonify({'channels': []}), 200

    channels = Channel.query.filter(
        db.and_(
            Channel.is_public == True,
            db.or_(
                Channel.name.ilike(f'%{query}%'),
                Channel.handle.ilike(f'%{query}%')
            )
        )
    ).limit(20).all()

    result = []
    for ch in channels:
        data = ch.to_dict()
        data['is_subscribed'] = user in ch.subscribers
        result.append(data)

    return jsonify({'channels': result}), 200


@channels_bp.route('/<int:channel_id>/subscribe', methods=['POST'])
@login_required
def subscribe(user, channel_id):
    channel = Channel.query.get(channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404

    if user in channel.subscribers:
        return jsonify({'error': 'Вы уже подписаны'}), 409

    channel.subscribers.append(user)
    db.session.commit()

    return jsonify({'message': 'Подписка оформлена'}), 200


@channels_bp.route('/<int:channel_id>/unsubscribe', methods=['POST'])
@login_required
def unsubscribe(user, channel_id):
    channel = Channel.query.get(channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404

    if channel.owner_id == user.id:
        return jsonify({'error': 'Владелец не может отписаться'}), 400

    if user in channel.subscribers:
        channel.subscribers.remove(user)
        db.session.commit()

    return jsonify({'message': 'Вы отписались'}), 200


@channels_bp.route('/<int:channel_id>', methods=['PUT'])
@login_required
def update_channel(user, channel_id):
    channel = Channel.query.get(channel_id)
    if not channel:
        return jsonify({'error': 'Канал не найден'}), 404

    if channel.owner_id != user.id:
        return jsonify({'error': 'Нет прав'}), 403

    data = request.get_json()

    if 'name' in data and len(data['name'].strip()) >= 2:
        channel.name = data['name'].strip()
    if 'description' in data:
        channel.description = data['description'][:1000]
    if 'avatar_url' in data:
        channel.avatar_url = data['avatar_url']

    db.session.commit()
    return jsonify({'channel': channel.to_dict()}), 200