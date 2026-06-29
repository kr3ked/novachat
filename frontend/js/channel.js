const ChannelUI = {
    currentChannel: null,
    currentPosts: [],
    pendingChannelFile: null,

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

            // Показываем кнопку редактирования только владельцу
            const editBtn = document.getElementById('btn-edit-channel');
            if (editBtn) {
                editBtn.style.display = data.channel.is_owner ? 'flex' : 'none';
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

        const sortedPosts = [...posts].reverse();
        container.innerHTML = sortedPosts.map(post => this.renderPost(post)).join('');

        setTimeout(() => {
            const area = container.closest('.messages-area');
            if (area) area.scrollTop = area.scrollHeight;
        }, 50);
    },

    renderPost(post) {
        const time = ChatUI.formatTime(post.created_at);
        const date = ChatUI.formatDate(post.created_at);
        const backendBase = 'https://novachat-backend-55fr.onrender.com';

        let mediaHtml = '';
        if (post.file_url) {
            const src = post.file_url.startsWith('http') ? post.file_url : backendBase + post.file_url;
            const isVideo = post.message_type === 'video' ||
                /\.(mp4|webm|ogg|mov|avi)$/i.test(post.file_url);

            if (isVideo) {
                mediaHtml = `
                    <div class="message-video-wrapper" style="margin-bottom:8px;">
                        <video class="message-video" controls preload="metadata">
                            <source src="${src}" type="video/mp4">
                            <source src="${src}" type="video/webm">
                        </video>
                        <div class="video-filename">${post.file_name || 'Видео'}</div>
                    </div>`;
            } else {
                mediaHtml = `
                    <div class="message-image-wrapper" style="margin-bottom:8px;">
                        <img src="${src}" class="message-image" style="max-width:100%;"
                             alt="${post.file_name || 'Фото'}"
                             onclick="window.open('${src}', '_blank')"
                             onerror="this.parentElement.style.display='none'" />
                    </div>`;
            }
        }

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
                ${mediaHtml}
                ${post.text ? `<div class="channel-post-text">${ChatUI.escapeHtml(post.text)}</div>` : ''}
                ${reactionsHtml}
                <div class="channel-post-footer">
                    <span class="message-time">${date}, ${time}</span>
                    <div class="channel-post-actions">
                        <button class="post-action-btn" onclick="ChannelUI.reactToPost(${post.id}, '👍')">
                            <i class="far fa-thumbs-up"></i> ${post.likes_count || ''}
                        </button>
                        <button class="post-action-btn" onclick="ChatUI.showComments(${post.id})">
                            <i class="far fa-comment"></i> ${post.comments_count || ''}
                        </button>
                        <button class="post-action-btn" onclick="ChatUI.showForward(${post.id})">
                            <i class="fas fa-share"></i>
                        </button>
                    </div>
                </div>
            </div>`;
    },

    openChannelFilePicker() {
        document.getElementById('channel-file-input').click();
    },

    async handleChannelFileSelect(input) {
        const file = input.files[0];
        if (!file) return;

        const allowedImages = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        const allowedVideos = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'];
        const isImage = allowedImages.includes(file.type);
        const isVideo = allowedVideos.includes(file.type);

        if (!isImage && !isVideo) {
            Toast.show('Формат не поддерживается', 'error');
            input.value = '';
            return;
        }

        const preview = document.getElementById('channel-file-preview');
        const previewImg = document.getElementById('channel-preview-img');
        const previewVideo = document.getElementById('channel-preview-video');

        if (isImage) {
            const reader = new FileReader();
            reader.onload = (e) => {
                previewImg.src = e.target.result;
                previewImg.style.display = 'block';
                previewVideo.style.display = 'none';
                preview.style.display = 'flex';
            };
            reader.readAsDataURL(file);
        } else {
            previewImg.style.display = 'none';
            previewVideo.style.display = 'flex';
            previewVideo.querySelector('.video-preview-name').textContent = file.name;
            preview.style.display = 'flex';
        }

        Toast.show('Загрузка...', 'info');
        try {
            const data = await API.messages.uploadFile(file);
            this.pendingChannelFile = {
                file_url: data.file_url,
                file_name: data.file_name,
                file_type: data.file_type
            };
            Toast.show(`${isVideo ? 'Видео' : 'Фото'} готово к публикации ✓`, 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка загрузки', 'error');
            this.cancelChannelFile();
        }
        input.value = '';
    },

    cancelChannelFile() {
        this.pendingChannelFile = null;
        document.getElementById('channel-file-preview').style.display = 'none';
        document.getElementById('channel-preview-img').src = '';
        document.getElementById('channel-preview-img').style.display = 'none';
        const vp = document.getElementById('channel-preview-video');
        if (vp) vp.style.display = 'none';
    },

    async createPost() {
        const input = document.getElementById('channel-post-input');
        const text = input.value.trim();
        const fileData = this.pendingChannelFile;

        if (!text && !fileData) return;
        if (!this.currentChannel) return;

        input.value = '';
        input.style.height = 'auto';
        this.cancelChannelFile();

        try {
            await API.messages.createPost(
                this.currentChannel.id,
                text || null,
                fileData ? fileData.file_url : null,
                fileData ? fileData.file_name : null,
                fileData ? fileData.file_type : null
            );
            await this.loadPosts(this.currentChannel.id);
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
            subBtn.innerHTML = this.currentChannel.is_subscribed
                ? '<i class="fas fa-bell-slash"></i>'
                : '<i class="fas fa-bell"></i>';
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
    },

    // Показать профиль канала
    showChannelInfo() {
        if (!this.currentChannel) return;
        const ch = this.currentChannel;
        const backendBase = 'https://novachat-backend-55fr.onrender.com';

        const avatarEl = document.getElementById('channel-info-avatar');
        if (ch.avatar_url) {
            const src = ch.avatar_url.startsWith('http') ? ch.avatar_url : backendBase + ch.avatar_url;
            avatarEl.innerHTML = `<img src="${src}" alt="">`;
        } else {
            avatarEl.innerHTML = ch.name.charAt(0).toUpperCase();
        }

        document.getElementById('channel-info-name').textContent = ch.name;
        document.getElementById('channel-info-handle').textContent = '@' + ch.handle;
        document.getElementById('channel-info-subs').textContent = `${ch.subscribers_count} подписчиков`;

        const descSection = document.getElementById('channel-info-desc-section');
        if (ch.description && ch.description.trim()) {
            document.getElementById('channel-info-desc').textContent = ch.description;
            descSection.style.display = 'block';
        } else {
            descSection.style.display = 'none';
        }

        // Кнопки для владельца
        const ownerSection = document.getElementById('channel-info-owner-section');
        ownerSection.style.display = ch.is_owner ? 'block' : 'none';

        UI.openModal('modal-channel-info');
    },

    // Открыть модал редактирования канала
    showEditChannel() {
        if (!this.currentChannel || !this.currentChannel.is_owner) return;
        const ch = this.currentChannel;

        document.getElementById('edit-channel-name').value = ch.name || '';
        document.getElementById('edit-channel-desc').value = ch.description || '';
        document.getElementById('edit-channel-public').checked = ch.is_public !== false;

        UI.closeModal('modal-channel-info');
        UI.openModal('modal-edit-channel');
    },

    // Сохранить изменения канала
    async saveChannel() {
        if (!this.currentChannel) return;

        const name = document.getElementById('edit-channel-name').value.trim();
        const desc = document.getElementById('edit-channel-desc').value.trim();
        const isPublic = document.getElementById('edit-channel-public').checked;

        if (!name || name.length < 2) {
            Toast.show('Название минимум 2 символа', 'error');
            return;
        }

        const btn = document.getElementById('btn-save-channel');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Сохранение...';

        try {
            const data = await API.channels.update(this.currentChannel.id, {
                name,
                description: desc,
                is_public: isPublic
            });

            // Обновляем данные текущего канала
            this.currentChannel = { ...this.currentChannel, ...data.channel };

            // Обновляем шапку канала
            document.getElementById('channel-name').textContent = data.channel.name;

            // Обновляем список каналов
            await App.loadChannels();

            UI.closeModal('modal-edit-channel');
            Toast.show('Канал обновлён!', 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка сохранения', 'error');
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Сохранить';
    },

    // Удалить канал
    async deleteChannel() {
        if (!this.currentChannel || !this.currentChannel.is_owner) return;

        if (!confirm(`Удалить канал "${this.currentChannel.name}"? Это действие необратимо!`)) return;

        try {
            await API.channels.delete(this.currentChannel.id);
            UI.closeModal('modal-edit-channel');
            UI.closeModal('modal-channel-info');
            UI.closeChat();
            await App.loadChannels();
            Toast.show('Канал удалён', 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка удаления', 'error');
        }
    }
};