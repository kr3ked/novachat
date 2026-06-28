const ChannelUI = {
    currentChannel: null,
    currentPosts: [],

    async openChannel(channelId) {
        try {
            const data = await API.channels.get(channelId);
            this.currentChannel = data.channel;

            document.getElementById('empty-chat').style.display = 'none';
            document.getElementById('chat-view').style.display = 'none';
            document.getElementById('channel-view').style.display = 'flex';
            document.getElementById('main-panel').classList.add('active');

            document.getElementById('channel-name').textContent = data.channel.name;
            document.getElementById('channel-subs').textContent = 
                `${data.channel.subscribers_count} подписчиков`;

            const subBtn = document.getElementById('btn-subscribe');
            if (data.channel.is_subscribed) {
                subBtn.innerHTML = '<i class="fas fa-bell-slash"></i>';
                subBtn.title = 'Отписаться';
            } else {
                subBtn.innerHTML = '<i class="fas fa-bell"></i>';
                subBtn.title = 'Подписаться';
            }

            const inputArea = document.getElementById('channel-input-area');
            inputArea.style.display = data.channel.is_owner ? 'flex' : 'none';

            await this.loadPosts(channelId);
        } catch (error) {
            Toast.show('Ошибка загрузки канала', 'error');
            console.error(error);
        }
    },

    async loadPosts(channelId, page = 1) {
        try {
            const data = await API.messages.getChannelPosts(channelId, page);
            this.currentPosts = data.messages;
            this.renderPosts(data.messages);
        } catch (error) {
            console.error('Error loading posts:', error);
        }
    },

renderPosts(posts) {
    const container = document.getElementById('channel-posts-container');
    if (posts.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-bullhorn"></i>
                <p>Пока нет постов</p>
            </div>`;
        return;
    }
    // Разворачиваем массив: старые сверху, новые снизу
    const sortedPosts = [...posts].reverse();
    container.innerHTML = sortedPosts.map(post => this.renderPost(post)).join('');
    
    // Скроллим вниз к новым постам
    setTimeout(() => {
        const area = container.closest('.messages-area');
        if (area) area.scrollTop = area.scrollHeight;
    }, 50);
},

    renderPost(post) {
        const time = ChatUI.formatTime(post.created_at);
        const date = ChatUI.formatDate(post.created_at);

        let reactionsHtml = '';
        if (post.reactions && Object.keys(post.reactions).length > 0) {
            reactionsHtml = '<div class="message-reactions" style="margin-top:8px;">';
            for (const [emoji, count] of Object.entries(post.reactions)) {
                reactionsHtml += `
                    <span class="reaction-badge" onclick="ChannelUI.reactToPost(${post.id}, '${emoji}')">
                        ${emoji} <span class="count">${count}</span>
                    </span>`;
            }
            reactionsHtml += '</div>';
        }

        let forwardHtml = '';
        if (post.forwarded_from) {
            const fwdName = post.forwarded_from.original_sender 
                ? post.forwarded_from.original_sender.display_name 
                : 'Неизвестный';
            forwardHtml = `
                <div class="message-forwarded">
                    <i class="fas fa-share"></i> Переслано от ${fwdName}
                </div>`;
        }

        return `
            <div class="channel-post" data-post-id="${post.id}">
                ${forwardHtml}
                <div class="channel-post-text">${ChatUI.escapeHtml(post.text || '')}</div>
                ${reactionsHtml}
                <div class="channel-post-footer">
                    <span class="message-time">${date}, ${time}</span>
                    <div class="channel-post-actions">
                        <button class="post-action-btn" onclick="ChannelUI.reactToPost(${post.id}, '👍')">
                            <i class="far fa-thumbs-up"></i>
                            ${post.likes_count || ''}
                        </button>
                        <button class="post-action-btn" onclick="ChatUI.showComments(${post.id})">
                            <i class="far fa-comment"></i>
                            ${post.comments_count || ''}
                        </button>
                        <button class="post-action-btn" onclick="ChatUI.showForward(${post.id})">
                            <i class="fas fa-share"></i>
                        </button>
                    </div>
                </div>
            </div>`;
    },

async createPost() {
    const input = document.getElementById('channel-post-input');
    const text = input.value.trim();
    if (!text || !this.currentChannel) return;
    try {
        await API.messages.createPost(this.currentChannel.id, text);
        input.value = '';
        input.style.height = 'auto';
        await this.loadPosts(this.currentChannel.id);
        // Скроллим вниз после добавления
        setTimeout(() => {
            const container = document.getElementById('channel-posts-container');
            const area = container.closest('.messages-area');
            if (area) area.scrollTop = area.scrollHeight;
        }, 100);
        Toast.show('Пост опубликован!', 'success');
    } catch (error) {
        Toast.show('Ошибка публикации', 'error');
    }
},

    async toggleSubscribe() {
        if (!this.currentChannel) return;
        try {
            if (this.currentChannel.is_subscribed) {
                await API.channels.unsubscribe(this.currentChannel.id);
                this.currentChannel.is_subscribed = false;
                Toast.show('Вы отписались', 'success');
            } else {
                await API.channels.subscribe(this.currentChannel.id);
                this.currentChannel.is_subscribed = true;
                Toast.show('Вы подписались!', 'success');
            }
            const subBtn = document.getElementById('btn-subscribe');
            if (this.currentChannel.is_subscribed) {
                subBtn.innerHTML = '<i class="fas fa-bell-slash"></i>';
            } else {
                subBtn.innerHTML = '<i class="fas fa-bell"></i>';
            }
            App.loadChannels();
        } catch (error) {
            Toast.show(error.error || 'Ошибка', 'error');
        }
    },

    async reactToPost(postId, emoji) {
        try {
            await API.messages.toggleLike(postId, emoji);
            if (this.currentChannel) await this.loadPosts(this.currentChannel.id);
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
    }
};