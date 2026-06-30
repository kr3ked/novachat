const ChatUI = {
    currentChat: null,
    currentMessages: [],
    replyTo: null,
    activeReactionMessageId: null,
    activeCommentMessageId: null,
    forwardMessageId: null,
    pendingImage: null,
    currentPage: 1,
    totalPages: 1,
    isLoadingMore: false,

    async openChat(chatId) {
        try {
            const chatData = await API.chats.getChat(chatId);
            this.currentChat = chatData.chat;
            this.currentChat.members_list = chatData.members;

            this.currentPage = 1;
            this.totalPages = 1;
            this.isLoadingMore = false;
            this.currentMessages = [];

            document.getElementById('empty-chat').style.display = 'none';
            document.getElementById('channel-view').style.display = 'none';
            document.getElementById('chat-view').style.display = 'flex';
            document.getElementById('main-panel').classList.add('active');

            const chat = this.currentChat;
            document.getElementById('chat-name').textContent = chat.name || 'Чат';

            if (chat.other_user) {
                const status = chat.other_user.is_online ? 'онлайн' : 'был(а) недавно';
                document.getElementById('chat-status').textContent = status;
                document.getElementById('chat-status').className =
                    'chat-header-status' + (chat.other_user.is_online ? ' online' : '');
            } else {
                document.getElementById('chat-status').textContent = `${chat.members_count} участников`;
            }

            await this.initialLoad(chatId);
            this.initScrollListener();

            if (App.socket) App.socket.emit('join_chat', { chat_id: chatId });

            document.querySelectorAll('.chat-item').forEach(el => {
                el.classList.toggle('active', el.dataset.chatId == chatId);
            });

            document.getElementById('message-input').focus();
        } catch (error) {
            Toast.show('Ошибка загрузки чата', 'error');
            console.error(error);
        }
    },

    async initialLoad(chatId) {
        try {
            const data = await API.messages.getChatMessages(chatId, 1);
            this.currentPage = 1;
            this.totalPages = data.pages;
            this.currentMessages = data.messages;
            this.renderMessages(data.messages);
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    },

    async silentRefresh() {
        if (!this.currentChat) return;
        try {
            const area = document.getElementById('messages-area');
            const wasAtBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 60;

            const data = await API.messages.getChatMessages(this.currentChat.id, 1);
            const newMsgs = data.messages;

            const perPage = 50;
            if (this.currentMessages.length > perPage) {
                const olderMsgs = this.currentMessages.slice(0, this.currentMessages.length - perPage);
                this.currentMessages = [...olderMsgs, ...newMsgs];
            } else {
                this.currentMessages = newMsgs;
            }

            this.rerenderAll();
            if (wasAtBottom) this.scrollToBottom();
        } catch (error) {
            console.error('Silent refresh error:', error);
        }
    },

    rerenderAll() {
        const container = document.getElementById('messages-container');
        const userId = Auth.currentUser.id;

        let html = '';
        let lastDate = '';

        this.currentMessages.forEach(msg => {
            const msgDate = new Date(msg.created_at).toLocaleDateString('ru-RU');
            if (msgDate !== lastDate) {
                html += `<div class="date-separator"><span>${this.formatDate(msg.created_at)}</span></div>`;
                lastDate = msgDate;
            }
            const isOutgoing = msg.sender && msg.sender.id === userId;
            html += this.renderMessage(msg, isOutgoing);
        });

        if (this.currentPage >= this.totalPages) {
            html = `<div class="end-of-history"><span>📜 Начало переписки</span></div>` + html;
        }

        container.innerHTML = `<div id="scroll-trigger" style="height:1px;width:100%;"></div>` + html;
        this.bindMessageEvents(container);
    },

    initScrollListener() {
        const area = document.getElementById('messages-area');
        if (this._boundScrollHandler) {
            area.removeEventListener('scroll', this._boundScrollHandler);
        }
        if (this._observer) {
            this._observer.disconnect();
        }

        const container = document.getElementById('messages-container');
        let trigger = document.getElementById('scroll-trigger');
        if (!trigger) {
            trigger = document.createElement('div');
            trigger.id = 'scroll-trigger';
            trigger.style.cssText = 'height: 1px; width: 100%;';
            container.insertBefore(trigger, container.firstChild);
        }

        this._observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) this.loadMoreMessages();
                });
            },
            { root: area, threshold: 0.1 }
        );
        this._observer.observe(trigger);

        this._boundScrollHandler = () => {
            if (area.scrollTop <= 100) this.loadMoreMessages();
        };
        area.addEventListener('scroll', this._boundScrollHandler, { passive: true });
    },

    async loadMoreMessages() {
        if (this.isLoadingMore) return;
        if (this.currentPage >= this.totalPages) return;
        if (!this.currentChat) return;

        this.isLoadingMore = true;
        const area = document.getElementById('messages-area');
        const scrollHeightBefore = area.scrollHeight;
        this.showLoadingIndicator();

        try {
            const nextPage = this.currentPage + 1;
            const data = await API.messages.getChatMessages(this.currentChat.id, nextPage);
            this.hideLoadingIndicator();

            if (!data.messages || data.messages.length === 0) {
                this.isLoadingMore = false;
                return;
            }

            this.currentPage = nextPage;
            this.totalPages = data.pages;
            this.currentMessages = [...data.messages, ...this.currentMessages];
            this.prependMessages(data.messages);

            requestAnimationFrame(() => {
                const scrollHeightAfter = area.scrollHeight;
                area.scrollTop = scrollHeightAfter - scrollHeightBefore;
            });

            if (this.currentPage >= this.totalPages) this.showEndOfHistory();

        } catch (error) {
            this.hideLoadingIndicator();
            console.error('Error loading more:', error);
        }
        this.isLoadingMore = false;
    },

    showLoadingIndicator() {
        const container = document.getElementById('messages-container');
        if (container.querySelector('.loading-more')) return;
        const el = document.createElement('div');
        el.className = 'loading-more';
        el.innerHTML = `<div class="loading-more-inner"><div class="typing-dots"><span></span><span></span><span></span></div><span>Загрузка...</span></div>`;
        const trigger = document.getElementById('scroll-trigger');
        if (trigger && trigger.nextSibling) {
            container.insertBefore(el, trigger.nextSibling);
        } else {
            container.insertBefore(el, container.firstChild);
        }
    },

    hideLoadingIndicator() {
        const el = document.querySelector('.loading-more');
        if (el) el.remove();
    },

    prependMessages(messages) {
        const container = document.getElementById('messages-container');
        const userId = Auth.currentUser.id;

        let html = '';
        let lastDate = '';

        messages.forEach(msg => {
            const msgDate = new Date(msg.created_at).toLocaleDateString('ru-RU');
            if (msgDate !== lastDate) {
                html += `<div class="date-separator"><span>${this.formatDate(msg.created_at)}</span></div>`;
                lastDate = msgDate;
            }
            const isOutgoing = msg.sender && msg.sender.id === userId;
            html += this.renderMessage(msg, isOutgoing);
        });

        const temp = document.createElement('div');
        temp.innerHTML = html;

        const trigger = document.getElementById('scroll-trigger');
        const anchor = trigger ? trigger.nextSibling : container.firstChild;
        const fragment = document.createDocumentFragment();
        while (temp.firstChild) fragment.appendChild(temp.firstChild);
        container.insertBefore(fragment, anchor);

        this.bindMessageEvents(container);
    },

    showEndOfHistory() {
        const container = document.getElementById('messages-container');
        if (container.querySelector('.end-of-history')) return;
        const el = document.createElement('div');
        el.className = 'end-of-history';
        el.innerHTML = `<span>📜 Начало переписки</span>`;
        const trigger = document.getElementById('scroll-trigger');
        if (trigger && trigger.nextSibling) {
            container.insertBefore(el, trigger.nextSibling);
        } else {
            container.insertBefore(el, container.firstChild);
        }
    },

    renderMessages(messages) {
        const container = document.getElementById('messages-container');
        const userId = Auth.currentUser.id;

        if (messages.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comment-dots"></i>
                    <p>Нет сообщений. Начните разговор!</p>
                </div>`;
            return;
        }

        let html = '';
        let lastDate = '';

        messages.forEach(msg => {
            const msgDate = new Date(msg.created_at).toLocaleDateString('ru-RU');
            if (msgDate !== lastDate) {
                html += `<div class="date-separator"><span>${this.formatDate(msg.created_at)}</span></div>`;
                lastDate = msgDate;
            }
            const isOutgoing = msg.sender && msg.sender.id === userId;
            html += this.renderMessage(msg, isOutgoing);
        });

        if (this.totalPages <= 1) {
            html = `<div class="end-of-history"><span>📜 Начало переписки</span></div>` + html;
        }

        container.innerHTML = `<div id="scroll-trigger" style="height:1px;width:100%;"></div>` + html;
        this.scrollToBottom();
        this.bindMessageEvents(container);
    },

    bindMessageEvents(container) {
        container.querySelectorAll('.message[data-message-id]').forEach(el => {
            if (el.dataset.eventsBound === '1') return;
            el.dataset.eventsBound = '1';

            const msgId = parseInt(el.dataset.messageId);
            const isOutgoing = el.classList.contains('outgoing');

            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                App.showMsgContextMenu(e, msgId, isOutgoing);
            });

            let longPressTimer = null;
            let startX = 0, startY = 0;

            el.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                longPressTimer = setTimeout(() => {
                    if (navigator.vibrate) navigator.vibrate(50);
                    App.showMsgContextMenu(null, msgId, isOutgoing);
                }, 500);
            }, { passive: true });

            el.addEventListener('touchend', () => {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            });

            el.addEventListener('touchmove', (e) => {
                const dx = Math.abs(e.touches[0].clientX - startX);
                const dy = Math.abs(e.touches[0].clientY - startY);
                if (dx > 10 || dy > 10) {
                    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
                }
            }, { passive: true });
        });
    },

    renderMessage(msg, isOutgoing) {
        if (msg.is_deleted) {
            return `
                <div class="message ${isOutgoing ? 'outgoing' : 'incoming'}" data-message-id="${msg.id}">
                    <div class="message-bubble" style="opacity: 0.5;">
                        <div class="message-text"><i>Сообщение удалено</i></div>
                    </div>
                </div>`;
        }

        const senderName = msg.sender ? msg.sender.display_name : 'Неизвестный';
        const time = this.formatTime(msg.created_at);
        const isGroup = this.currentChat && this.currentChat.chat_type === 'group';
        const backendBase = 'https://novachat-backend-55fr.onrender.com';

        let replyHtml = '';
        if (msg.reply_to) {
            replyHtml = `
                <div class="message-reply">
                    <div class="message-reply-name">${msg.reply_to.sender ? msg.reply_to.sender.display_name : ''}</div>
                    <div class="message-reply-text">${this.escapeHtml(msg.reply_to.text || '📎 Медиа')}</div>
                </div>`;
        }

        let forwardHtml = '';
        if (msg.forwarded_from) {
            const fwdName = msg.forwarded_from.original_sender
                ? msg.forwarded_from.original_sender.display_name : 'Неизвестный';
            forwardHtml = `
                <div class="message-forwarded">
                    <i class="fas fa-share"></i> Переслано от ${fwdName}
                </div>`;
        }

        let mediaHtml = '';
        if (msg.file_url) {
            const isOldBroken = msg.file_url.startsWith('/uploads/');
            const src = msg.file_url.startsWith('http') ? msg.file_url : backendBase + msg.file_url;
            const isVideo = msg.message_type === 'video' || /\.(mp4|webm|ogg|mov|avi)$/i.test(msg.file_url);
            
            if (isOldBroken) {
                // Старые битые файлы (которые лежали в /tmp/uploads)
                mediaHtml = `
                    <div class="message-image-wrapper" style="padding:14px;background:rgba(139,92,246,0.05);border:1px dashed rgba(139,92,246,0.2);border-radius:8px;text-align:center;">
                        <i class="fas fa-${isVideo ? 'film' : 'image'}" style="font-size:32px;color:var(--text-secondary);opacity:0.3;"></i>
                        <div style="color:var(--text-secondary);font-size:12px;margin-top:6px;">
                            🗑 ${isVideo ? 'Видео' : 'Фото'} больше недоступно
                        </div>
                    </div>`;
            } else if (isVideo) {
                mediaHtml = `
                    <div class="message-video-wrapper">
                        <video class="message-video" controls preload="metadata">
                            <source src="${src}" type="video/mp4">
                            <source src="${src}" type="video/webm">
                        </video>
                        <div class="video-filename">${msg.file_name || 'Видео'}</div>
                    </div>`;
            } else {
                mediaHtml = `
                    <div class="message-image-wrapper">
                        <img src="${src}" class="message-image" alt="${msg.file_name || 'Фото'}"
                             onclick="window.open('${src}', '_blank')"
                             onerror="this.parentElement.innerHTML='<div style=\\'padding:12px;background:rgba(139,92,246,0.05);border-radius:8px;text-align:center;color:var(--text-secondary);font-size:12px;\\'>📷 Фото недоступно</div>'" />
                    </div>`;
            }
        }

        let reactionsHtml = '';
        if (msg.reactions && Object.keys(msg.reactions).length > 0) {
            reactionsHtml = '<div class="message-reactions">';
            for (const [emoji, count] of Object.entries(msg.reactions)) {
                reactionsHtml += `
                    <span class="reaction-badge" onclick="ChatUI.addReaction('${emoji}', ${msg.id})">
                        ${emoji} <span class="count">${count}</span>
                    </span>`;
            }
            reactionsHtml += '</div>';
        }

        return `
            <div class="message ${isOutgoing ? 'outgoing' : 'incoming'}" data-message-id="${msg.id}">
                <div class="message-bubble">
                    ${forwardHtml}
                    ${isGroup && msg.sender ? `<div class="message-sender" onclick="App.showUserProfile(${msg.sender.id})">${senderName}</div>` : ''}
                    ${replyHtml}
                    ${mediaHtml}
                    ${msg.text ? `<div class="message-text">${this.escapeHtml(msg.text)}</div>` : ''}
                    ${reactionsHtml}
                    <div class="message-meta">
                        ${msg.is_edited ? '<span class="message-edited">ред.</span>' : ''}
                        <span class="message-time">${time}</span>
                    </div>
                </div>
            </div>`;
    },

    async sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text && !this.pendingImage) return;
        if (!this.currentChat) return;

        const replyToId = this.replyTo ? this.replyTo.id : null;
        const imageData = this.pendingImage;

        input.value = '';
        input.style.height = 'auto';
        this.cancelReply();
        this.cancelImage();

        try {
            if (App.socket && App.socket.connected) {
                App.socket.emit('send_message', {
                    token: API.token,
                    chat_id: this.currentChat.id,
                    text: text || null,
                    reply_to_id: replyToId,
                    file_url: imageData ? imageData.file_url : null,
                    file_name: imageData ? imageData.file_name : null,
                    file_type: imageData ? imageData.file_type : null
                });
            } else {
                await API.messages.send(
                    this.currentChat.id, text || null, replyToId,
                    imageData ? imageData.file_url : null,
                    imageData ? imageData.file_name : null,
                    imageData ? imageData.file_type : null
                );
                await this.silentRefresh();
            }
        } catch (error) {
            Toast.show('Ошибка отправки', 'error');
        }
    },

    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
        if (App.socket && this.currentChat) {
            App.socket.emit('typing', { token: API.token, chat_id: this.currentChat.id });
        }
    },

    autoResize(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 150) + 'px';
    },

    setReply(messageId) {
        let msg = this.currentMessages.find(m => m.id === messageId);

        if (!msg) {
            const el = document.querySelector(`[data-message-id="${messageId}"]`);
            if (el) {
                const textEl = el.querySelector('.message-text');
                const senderEl = el.querySelector('.message-sender');
                msg = {
                    id: messageId,
                    text: textEl ? textEl.textContent : '📎 Медиа',
                    sender: { display_name: senderEl ? senderEl.textContent : '' }
                };
            }
        }

        if (!msg) return;

        this.replyTo = msg;
        document.getElementById('reply-preview').style.display = 'flex';
        document.getElementById('reply-name').textContent = msg.sender ? msg.sender.display_name : '';
        document.getElementById('reply-text').textContent = msg.text
            || (msg.message_type === 'video' ? '🎥 Видео' : '🖼 Фото');
        document.getElementById('message-input').focus();
    },

    cancelReply() {
        this.replyTo = null;
        document.getElementById('reply-preview').style.display = 'none';
    },

    openImagePicker() {
        document.getElementById('image-input').click();
    },

    async handleImageSelect(input) {
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

        const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (file.size > maxSize) {
            Toast.show(`Файл слишком большой (макс ${isVideo ? '50' : '10'} MB)`, 'error');
            input.value = '';
            return;
        }

        if (isImage) {
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('image-preview-img').src = e.target.result;
                document.getElementById('image-preview-img').style.display = 'block';
                document.getElementById('image-preview-video').style.display = 'none';
                document.getElementById('image-preview').style.display = 'flex';
            };
            reader.readAsDataURL(file);
        } else {
            document.getElementById('image-preview-img').style.display = 'none';
            const vp = document.getElementById('image-preview-video');
            vp.style.display = 'flex';
            vp.querySelector('.video-preview-name').textContent = file.name;
            document.getElementById('image-preview').style.display = 'flex';
        }

        Toast.show('Загрузка...', 'info');
        try {
            const data = await API.messages.uploadFile(file);
            this.pendingImage = { file_url: data.file_url, file_name: data.file_name, file_type: data.file_type };
            Toast.show(`${isVideo ? 'Видео' : 'Фото'} готово ✓`, 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка загрузки', 'error');
            this.cancelImage();
        }
        input.value = '';
    },

    cancelImage() {
        this.pendingImage = null;
        document.getElementById('image-preview').style.display = 'none';
        document.getElementById('image-preview-img').src = '';
        document.getElementById('image-preview-img').style.display = 'none';
        const vp = document.getElementById('image-preview-video');
        if (vp) vp.style.display = 'none';
    },

    async addReaction(emoji, messageId = null) {
        const id = messageId || this.activeReactionMessageId;
        if (!id) return;
        try {
            await API.messages.toggleLike(id, emoji);
            await this.silentRefresh();
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
        document.getElementById('reactions-picker').style.display = 'none';
    },

    async showComments(messageId) {
        this.activeCommentMessageId = messageId;
        try {
            const data = await API.messages.getComments(messageId);
            const list = document.getElementById('comments-list');
            if (data.comments.length === 0) {
                list.innerHTML = '<div class="empty-state"><p>Нет комментариев</p></div>';
            } else {
                list.innerHTML = data.comments.map(c => `
                    <div class="comment-item">
                        <div class="avatar avatar-sm"><i class="fas fa-user"></i></div>
                        <div class="comment-content">
                            <div class="comment-author" onclick="App.showUserProfile(${c.user.id})">${c.user.display_name}</div>
                            <div class="comment-text">${this.escapeHtml(c.text)}</div>
                            <div class="comment-time">${this.formatTime(c.created_at)}</div>
                        </div>
                        ${c.user.id === Auth.currentUser.id ? `
                            <button class="btn-icon" onclick="ChatUI.deleteComment(${c.id})" style="flex-shrink:0;">
                                <i class="fas fa-trash" style="font-size:12px;"></i>
                            </button>` : ''}
                    </div>`).join('');
            }
            UI.openModal('modal-comments');
        } catch (error) {
            Toast.show('Ошибка загрузки комментариев', 'error');
        }
    },

    async addComment() {
        const input = document.getElementById('comment-input');
        const text = input.value.trim();
        if (!text || !this.activeCommentMessageId) return;
        try {
            await API.messages.addComment(this.activeCommentMessageId, text);
            input.value = '';
            await this.showComments(this.activeCommentMessageId);
            await this.silentRefresh();
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
    },

    async deleteComment(commentId) {
        try {
            await API.messages.deleteComment(commentId);
            await this.showComments(this.activeCommentMessageId);
            Toast.show('Комментарий удалён', 'success');
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
    },

    async showForward(messageId) {
        this.forwardMessageId = messageId;
        try {
            const chatsData = await API.chats.getAll();
            const list = document.getElementById('forward-list');
            list.innerHTML = chatsData.chats.map(chat => `
                <div class="forward-item" onclick="ChatUI.forwardTo(${chat.id}, 'chat')">
                    <div class="avatar">
                        <i class="fas fa-${chat.chat_type === 'group' ? 'users' : 'user'}"></i>
                    </div>
                    <div class="chat-item-info">
                        <div class="chat-item-name">${chat.name || 'Чат'}</div>
                    </div>
                </div>`).join('');
            UI.openModal('modal-forward');
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
    },

    async forwardTo(targetId, targetType = 'chat') {
        try {
            if (targetType === 'chat') {
                await API.messages.forward(this.forwardMessageId, targetId, null);
            } else {
                await API.messages.forward(this.forwardMessageId, null, targetId);
            }
            UI.closeModal('modal-forward');
            Toast.show('Сообщение переслано', 'success');
            if (this.currentChat && this.currentChat.id === targetId) {
                await this.silentRefresh();
            }
        } catch (error) {
            Toast.show('Ошибка пересылки', 'error');
        }
    },

    async editMessage(messageId) {
        const msg = this.currentMessages.find(m => m.id === messageId);
        if (!msg) return;
        const newText = prompt('Редактировать сообщение:', msg.text);
        if (newText === null || newText.trim() === '') return;
        try {
            await API.messages.edit(messageId, newText.trim());
            await this.silentRefresh();
            Toast.show('Сообщение отредактировано', 'success');
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
    },

    async deleteMessage(messageId) {
        if (!confirm('Удалить сообщение?')) return;
        try {
            await API.messages.delete(messageId);
            await this.silentRefresh();
            Toast.show('Сообщение удалено', 'success');
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
    },

    scrollToBottom() {
        const area = document.getElementById('messages-area');
        if (area) area.scrollTop = area.scrollHeight;
    },

    appendMessage(msg) {
        if (!this.currentChat || msg.chat_id !== this.currentChat.id) return;
        if (this.currentMessages.find(m => m.id === msg.id)) return;

        this.currentMessages.push(msg);
        const container = document.getElementById('messages-container');
        const isOutgoing = msg.sender && msg.sender.id === Auth.currentUser.id;
        const empty = container.querySelector('.empty-state');
        if (empty) empty.remove();

        container.insertAdjacentHTML('beforeend', this.renderMessage(msg, isOutgoing));
        this.bindMessageEvents(container);
        this.scrollToBottom();
    },

    formatTime(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    },

    formatDate(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === today.toDateString()) return 'Сегодня';
        if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'long',
            year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
        });
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};