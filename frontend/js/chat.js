const ChatUI = {
    currentChat: null,
    currentMessages: [],
    replyTo: null,
    activeReactionMessageId: null,
    activeCommentMessageId: null,
    forwardMessageId: null,

    async openChat(chatId) {
        try {
            const chatData = await API.chats.getChat(chatId);
            this.currentChat = chatData.chat;
            this.currentChat.members_list = chatData.members;

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
                document.getElementById('chat-status').textContent = 
                    `${chat.members_count} участников`;
            }

            await this.loadMessages(chatId);

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

    async loadMessages(chatId, page = 1) {
        try {
            const data = await API.messages.getChatMessages(chatId, page);
            this.currentMessages = data.messages;
            this.renderMessages(data.messages);
        } catch (error) {
            console.error('Error loading messages:', error);
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

        container.innerHTML = html;
        this.scrollToBottom();
    },

    renderMessage(msg, isOutgoing) {
        if (msg.is_deleted) {
            return `
                <div class="message ${isOutgoing ? 'outgoing' : 'incoming'}">
                    <div class="message-bubble" style="opacity: 0.5;">
                        <div class="message-text"><i>Сообщение удалено</i></div>
                    </div>
                </div>`;
        }

        const senderName = msg.sender ? msg.sender.display_name : 'Неизвестный';
        const time = this.formatTime(msg.created_at);
        const isGroup = this.currentChat && this.currentChat.chat_type === 'group';

        let replyHtml = '';
        if (msg.reply_to) {
            replyHtml = `
                <div class="message-reply">
                    <div class="message-reply-name">${msg.reply_to.sender.display_name}</div>
                    <div class="message-reply-text">${this.escapeHtml(msg.reply_to.text)}</div>
                </div>`;
        }

        let forwardHtml = '';
        if (msg.forwarded_from) {
            const fwdName = msg.forwarded_from.original_sender 
                ? msg.forwarded_from.original_sender.display_name 
                : 'Неизвестный';
            forwardHtml = `
                <div class="message-forwarded">
                    <i class="fas fa-share"></i> Переслано от ${fwdName}
                </div>`;
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
                    <div class="message-text">${this.escapeHtml(msg.text || '')}</div>
                    ${reactionsHtml}
                    <div class="message-meta">
                        ${msg.is_edited ? '<span class="message-edited">ред.</span>' : ''}
                        <span class="message-time">${time}</span>
                    </div>
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="ChatUI.showReactions(event, ${msg.id})" title="Реакция">
                            <i class="far fa-smile"></i>
                        </button>
                        <button class="message-action-btn" onclick="ChatUI.setReply(${msg.id})" title="Ответить">
                            <i class="fas fa-reply"></i>
                        </button>
                        <button class="message-action-btn" onclick="ChatUI.showForward(${msg.id})" title="Переслать">
                            <i class="fas fa-share"></i>
                        </button>
                        <button class="message-action-btn" onclick="ChatUI.showComments(${msg.id})" title="Комментарии">
                            <i class="far fa-comment"></i>
                            ${msg.comments_count > 0 ? `<span>${msg.comments_count}</span>` : ''}
                        </button>
                        ${isOutgoing ? `
                            <button class="message-action-btn" onclick="ChatUI.editMessage(${msg.id})" title="Редактировать">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button class="message-action-btn" onclick="ChatUI.deleteMessage(${msg.id})" title="Удалить">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>`;
    },

    async sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text || !this.currentChat) return;

        const replyToId = this.replyTo ? this.replyTo.id : null;
        
        input.value = '';
        input.style.height = 'auto';
        this.cancelReply();

        try {
            if (App.socket && App.socket.connected) {
                App.socket.emit('send_message', {
                    token: API.token,
                    chat_id: this.currentChat.id,
                    text: text,
                    reply_to_id: replyToId
                });
            } else {
                await API.messages.send(this.currentChat.id, text, replyToId);
                await this.loadMessages(this.currentChat.id);
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
            App.socket.emit('typing', {
                token: API.token,
                chat_id: this.currentChat.id
            });
        }
    },

    autoResize(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 150) + 'px';
    },

    setReply(messageId) {
        const msg = this.currentMessages.find(m => m.id === messageId);
        if (!msg) return;
        this.replyTo = msg;
        document.getElementById('reply-preview').style.display = 'flex';
        document.getElementById('reply-name').textContent = msg.sender.display_name;
        document.getElementById('reply-text').textContent = msg.text || '';
        document.getElementById('message-input').focus();
    },

    cancelReply() {
        this.replyTo = null;
        document.getElementById('reply-preview').style.display = 'none';
    },

    showReactions(event, messageId) {
        event.stopPropagation();
        this.activeReactionMessageId = messageId;
        const picker = document.getElementById('reactions-picker');
        const rect = event.target.closest('.message-action-btn').getBoundingClientRect();
        picker.style.display = 'flex';
        picker.style.top = (rect.top - 50) + 'px';
        picker.style.left = rect.left + 'px';
        setTimeout(() => {
            document.addEventListener('click', function handler() {
                picker.style.display = 'none';
                document.removeEventListener('click', handler);
            });
        }, 10);
    },

    async addReaction(emoji, messageId = null) {
        const id = messageId || this.activeReactionMessageId;
        if (!id) return;
        try {
            await API.messages.toggleLike(id, emoji);
            if (this.currentChat) await this.loadMessages(this.currentChat.id);
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
                            </button>
                        ` : ''}
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
            if (this.currentChat) await this.loadMessages(this.currentChat.id);
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
                await this.loadMessages(this.currentChat.id);
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
            await this.loadMessages(this.currentChat.id);
            Toast.show('Сообщение отредактировано', 'success');
        } catch (error) {
            Toast.show('Ошибка', 'error');
        }
    },

    async deleteMessage(messageId) {
        if (!confirm('Удалить сообщение?')) return;
        try {
            await API.messages.delete(messageId);
            await this.loadMessages(this.currentChat.id);
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