const App = {
    socket: null,
    selectedGroupMembers: [],

    init() {
        Auth.init();
        ThemeManager.init();
        Notifications.init();

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.reactions-picker') &&
                !e.target.closest('.message-action-btn')) {
                document.getElementById('reactions-picker').style.display = 'none';
            }
            if (!e.target.closest('.context-menu')) {
                this.hideContextMenu();
                this.hideMsgContextMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideContextMenu();
                this.hideMsgContextMenu();
            }
        });
    },

    showMainScreen() {
        document.getElementById('auth-screen').classList.remove('active');
        document.getElementById('main-screen').classList.add('active');
        this.updateUserInfo();
        this.loadChats();
        this.loadChannels();
        this.connectSocket();
        this.startActivityPing();
    },

    startActivityPing() {
        this.sendPing();
        if (this._pingInterval) clearInterval(this._pingInterval);
        this._pingInterval = setInterval(() => this.sendPing(), 30000);
        let lastActivity = Date.now();
        const onActivity = () => {
            const now = Date.now();
            if (now - lastActivity > 30000) { lastActivity = now; this.sendPing(); }
        };
        document.addEventListener('click', onActivity);
        document.addEventListener('keydown', onActivity);
    },

    async sendPing() {
        try { await API.users.ping(); } catch (e) {}
    },

    updateUserInfo() {
        const user = Auth.currentUser;
        if (!user) return;
        document.getElementById('menu-username').textContent = user.display_name;
        document.getElementById('menu-phone').textContent = user.phone;
        document.getElementById('menu-avatar').innerHTML = this.getAvatarHtml(user, true);
    },

    getAvatarHtml(user, large = false) {
        const backendBase = 'https://novachat-backend-55fr.onrender.com';
        if (user.avatar_url) {
            // Проверка на старые битые аватары
            if (user.avatar_url.startsWith('/uploads/')) {
                return user.display_name ? user.display_name.charAt(0).toUpperCase() : '?';
            }
            const src = user.avatar_url.startsWith('http')
                ? user.avatar_url
                : backendBase + user.avatar_url;
            const fallback = user.display_name
                ? user.display_name.charAt(0).toUpperCase() : '?';
            return `<img src="${src}" alt=""
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
                onerror="this.parentElement.innerHTML='${fallback}'">`;
        }
        return user.display_name ? user.display_name.charAt(0).toUpperCase() : '?';
    },

    getAvatarContent(user) { return this.getAvatarHtml(user); },

    connectSocket() {
        this.socket = io('https://novachat-backend-55fr.onrender.com');

        this.socket.on('connect', () => {
            console.log('🔌 WebSocket connected');
            this.socket.emit('authenticate', { token: API.token });
        });

        this.socket.on('authenticated', (data) => {
            console.log('✅ Authenticated, user:', data.user_id);
        });

        this.socket.on('new_message', (msg) => {
            ChatUI.appendMessage(msg);
            this.loadChats();
            
            if (Notifications.enabled) {
                API.chats.getChat(msg.chat_id).then(data => {
                    Notifications.notify(msg, data.chat);
                }).catch(() => {
                    Notifications.notify(msg, null);
                });
            }
        });

        this.socket.on('chat_updated', () => { this.loadChats(); });

        this.socket.on('kicked_from_chat', (data) => {
            Toast.show(`Вас выгнали из группы "${data.chat_name}"`, 'error');
            if (ChatUI.currentChat && ChatUI.currentChat.id === data.chat_id) {
                UI.closeChat();
            }
            this.loadChats();
        });

        this.socket.on('user_typing', (data) => {
            if (ChatUI.currentChat && data.chat_id === ChatUI.currentChat.id) {
                const indicator = document.getElementById('typing-indicator');
                document.getElementById('typing-user').textContent = data.display_name;
                indicator.style.display = 'flex';
                clearTimeout(this._typingTimeout);
                this._typingTimeout = setTimeout(() => {
                    indicator.style.display = 'none';
                }, 3000);
            }
        });

        this.socket.on('disconnect', () => {
            console.log('❌ WebSocket disconnected');
        });
                // Инициализация звонков после подключения сокета
        if (typeof Calls !== 'undefined') {
            Calls.init();
            console.log('📞 Модуль звонков инициализирован');
        }
    },

    async loadChats() {
        try {
            const data = await API.chats.getAll();
            this.renderChatList(data.chats);
        } catch (error) {
            console.error('Error loading chats:', error);
        }
    },

    renderChatList(chats) {
        const list = document.getElementById('chat-list');
        const backendBase = 'https://novachat-backend-55fr.onrender.com';

        if (chats.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comments"></i>
                    <p>У вас пока нет чатов</p>
                    <button class="btn btn-small" onclick="UI.showNewChat()">
                        Найти собеседника
                    </button>
                </div>`;
            return;
        }

        list.innerHTML = chats.map(chat => {
            const isActive = ChatUI.currentChat && ChatUI.currentChat.id === chat.id;
            const icon = chat.chat_type === 'group' ? 'fa-users' : 'fa-user';
            const preview = chat.last_message
                ? (chat.last_message.text ||
                  (chat.last_message.message_type === 'video'
                      ? '🎥 Видео' : '🖼 Фото')).substring(0, 40)
                : 'Нет сообщений';
            const time = chat.last_message
                ? ChatUI.formatTime(chat.last_message.created_at) : '';

            let avatarContent;
            if (chat.avatar_url && !chat.avatar_url.startsWith('/uploads/')) {
                const src = chat.avatar_url.startsWith('http')
                    ? chat.avatar_url
                    : backendBase + chat.avatar_url;
                const fallback = (chat.name || 'Ч').charAt(0).toUpperCase();
                avatarContent = `<img src="${src}" alt=""
                    onerror="this.parentElement.innerHTML='${fallback}'">`;
            } else {
                avatarContent = chat.name
                    ? chat.name.charAt(0).toUpperCase()
                    : `<i class="fas ${icon}"></i>`;
            }

            const onlineDot = (chat.chat_type === 'private' &&
                               chat.other_user && chat.other_user.is_online)
                ? '<div class="online-dot"></div>' : '';

            return `
                <div class="chat-item ${isActive ? 'active' : ''}"
                     data-chat-id="${chat.id}"
                     onclick="ChatUI.openChat(${chat.id})"
                     oncontextmenu="App.showChatContextMenu(event, ${chat.id},
                         '${chat.chat_type}',
                         '${(chat.name || '').replace(/'/g, "\\'")}')">
                    <div class="avatar" style="position:relative;">
                        ${avatarContent}
                        ${onlineDot}
                    </div>
                    <div class="chat-item-info">
                        <div class="chat-item-top">
                            <span class="chat-item-name">${chat.name || 'Чат'}</span>
                            <span class="chat-item-time">${time}</span>
                        </div>
                        <div class="chat-item-preview">
                            ${ChatUI.escapeHtml(preview)}
                        </div>
                    </div>
                </div>`;
        }).join('');
    },

    showChatContextMenu(event, chatId, chatType, chatName) {
        event.preventDefault();
        event.stopPropagation();
        this.hideMsgContextMenu();

        const menu = document.getElementById('chat-context-menu');
        const isGroup = chatType === 'group';
        const deleteBtn = document.getElementById('ctx-delete-chat');

        deleteBtn.innerHTML = isGroup
            ? '<i class="fas fa-sign-out-alt"></i> Покинуть группу'
            : '<i class="fas fa-trash"></i> Удалить чат';

        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            this.hideContextMenu();
            this.deleteChatById(chatId, chatType, chatName);
        };

        this._positionMenu(menu, event.clientX, event.clientY);
    },

    hideContextMenu() {
        const menu = document.getElementById('chat-context-menu');
        if (menu) {
            menu.classList.remove('visible');
            setTimeout(() => {
                if (!menu.classList.contains('visible')) menu.style.display = 'none';
            }, 150);
        }
    },

    showMsgContextMenu(event, messageId, isOutgoing) {
        if (event && event.preventDefault) {
            event.preventDefault();
            event.stopPropagation();
        }
        this.hideContextMenu();

        const menu = document.getElementById('msg-context-menu');

        document.getElementById('ctx-msg-edit').style.display =
            isOutgoing ? 'flex' : 'none';
        document.getElementById('ctx-msg-delete').style.display =
            isOutgoing ? 'flex' : 'none';

        document.getElementById('ctx-msg-reply').onclick = (e) => {
            e.stopPropagation();
            this.hideMsgContextMenu();
            ChatUI.setReply(messageId);
        };
        document.getElementById('ctx-msg-forward').onclick = (e) => {
            e.stopPropagation();
            this.hideMsgContextMenu();
            ChatUI.showForward(messageId);
        };
        document.getElementById('ctx-msg-react').onclick = (e) => {
            e.stopPropagation();
            this.hideMsgContextMenu();
            const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
            if (msgEl) {
                const rect = msgEl.getBoundingClientRect();
                const picker = document.getElementById('reactions-picker');
                picker.style.display = 'flex';
                picker.style.top = Math.max(8, rect.top - 56) + 'px';
                picker.style.left = Math.max(8, rect.left) + 'px';
                ChatUI.activeReactionMessageId = messageId;
                setTimeout(() => {
                    document.addEventListener('click', function handler() {
                        picker.style.display = 'none';
                        document.removeEventListener('click', handler);
                    });
                }, 10);
            }
        };
        document.getElementById('ctx-msg-edit').onclick = (e) => {
            e.stopPropagation();
            this.hideMsgContextMenu();
            ChatUI.editMessage(messageId);
        };
        document.getElementById('ctx-msg-delete').onclick = (e) => {
            e.stopPropagation();
            this.hideMsgContextMenu();
            ChatUI.deleteMessage(messageId);
        };

        if (event && event.clientX) {
            this._positionMenu(menu, event.clientX, event.clientY);
        } else {
            menu.style.display = 'block';
            menu.style.left = '50%';
            menu.style.top = 'auto';
            menu.style.bottom = '80px';
            menu.style.transform = 'translateX(-50%)';
            requestAnimationFrame(() => menu.classList.add('visible'));
        }
    },

    hideMsgContextMenu() {
        const menu = document.getElementById('msg-context-menu');
        if (menu) {
            menu.classList.remove('visible');
            menu.style.transform = '';
            menu.style.bottom = '';
            setTimeout(() => {
                if (!menu.classList.contains('visible')) menu.style.display = 'none';
            }, 150);
        }
    },

    _positionMenu(menu, x, y) {
        menu.style.display = 'block';
        menu.style.left = '0px';
        menu.style.top = '0px';
        menu.style.bottom = '';
        menu.style.transform = '';

        requestAnimationFrame(() => {
            const menuW = menu.offsetWidth || 200;
            const menuH = menu.offsetHeight || 160;
            const winW = window.innerWidth;
            const winH = window.innerHeight;

            let left = x;
            let top = y;
            if (left + menuW > winW) left = winW - menuW - 8;
            if (top + menuH > winH) top = winH - menuH - 8;
            if (left < 8) left = 8;
            if (top < 8) top = 8;

            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
            menu.classList.add('visible');
        });
    },

    async deleteChatById(chatId, chatType, chatName) {
        const isGroup = chatType === 'group';
        const confirmText = isGroup
            ? `Покинуть группу "${chatName}"?`
            : `Удалить чат? История сообщений будет удалена.`;

        if (!confirm(confirmText)) return;

        try {
            await API.chats.delete(chatId);
            if (ChatUI.currentChat && ChatUI.currentChat.id === chatId) {
                UI.closeChat();
            }
            await this.loadChats();
            Toast.show(isGroup ? 'Вы покинули группу' : 'Чат удалён', 'success');
        } catch (error) {
            console.error('Delete chat error:', error);
            Toast.show(error.error || 'Ошибка удаления', 'error');
        }
    },

    async loadChannels() {
        try {
            const data = await API.channels.getAll();
            this.renderChannelList(data.channels);
        } catch (error) {
            console.error('Error loading channels:', error);
        }
    },

    renderChannelList(channels) {
        const list = document.getElementById('channel-list');
        if (channels.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-bullhorn"></i>
                    <p>Нет подписок на каналы</p>
                    <button class="btn btn-small" onclick="UI.showNewChannel()">
                        Создать канал
                    </button>
                </div>`;
            return;
        }
        list.innerHTML = channels.map(ch => {
            const avatarContent = (ch.avatar_url && !ch.avatar_url.startsWith('/uploads/'))
                ? `<img src="${ch.avatar_url}" alt=""
                       onerror="this.parentElement.innerHTML='${ch.name.charAt(0).toUpperCase()}'">` 
                : ch.name.charAt(0).toUpperCase();
            const preview = ch.last_post
                ? (ch.last_post.text || '📎 Медиа').substring(0, 40)
                : 'Нет постов';
            const time = ch.last_post
                ? ChatUI.formatTime(ch.last_post.created_at) : '';
            return `
                <div class="channel-item" onclick="ChannelUI.openChannel(${ch.id})">
                    <div class="avatar">${avatarContent}</div>
                    <div class="channel-item-info">
                        <div class="chat-item-top">
                            <span class="chat-item-name">${ch.name}</span>
                            <span class="chat-item-time">${time}</span>
                        </div>
                        <div class="chat-item-preview">
                            ${ChatUI.escapeHtml(preview)}
                        </div>
                    </div>
                </div>`;
        }).join('');
    },

    async handleSearch(query) {
        const resultsEl = document.getElementById('search-results');
        const chatList = document.getElementById('chat-list');
        const channelList = document.getElementById('channel-list');

        if (query.length < 2) {
            resultsEl.style.display = 'none';
            chatList.style.display = '';
            channelList.style.display = '';
            return;
        }

        resultsEl.style.display = 'block';
        chatList.style.display = 'none';
        channelList.style.display = 'none';

        try {
            const [usersData, channelsData] = await Promise.all([
                API.users.search(query),
                API.channels.search(query)
            ]);

            let html = '';
            if (usersData.users.length > 0) {
                html += '<div style="padding:8px 12px;font-size:12px;color:var(--text-secondary);font-weight:600;">ПОЛЬЗОВАТЕЛИ</div>';
                html += usersData.users.map(u => `
                    <div class="chat-item" onclick="App.startChatWith(${u.id})">
                        <div class="avatar" style="position:relative;">
                            ${App.getAvatarHtml(u)}
                            ${u.is_online ? '<div class="online-dot"></div>' : ''}
                        </div>
                        <div class="chat-item-info">
                            <div class="chat-item-name">${u.display_name}</div>
                            <div class="chat-item-preview"
                                 style="color:${u.is_online ? 'var(--accent-green)' : ''}">
                                ${u.is_online ? '● онлайн' : '@' + (u.username || u.phone)}
                            </div>
                        </div>
                    </div>`).join('');
            }
            if (channelsData.channels.length > 0) {
                html += '<div style="padding:8px 12px;font-size:12px;color:var(--text-secondary);font-weight:600;">КАНАЛЫ</div>';
                html += channelsData.channels.map(ch => `
                    <div class="channel-item" onclick="ChannelUI.openChannel(${ch.id})">
                        <div class="avatar">${ch.name.charAt(0).toUpperCase()}</div>
                        <div class="channel-item-info">
                            <div class="chat-item-name">${ch.name}</div>
                            <div class="chat-item-preview">
                                @${ch.handle} · ${ch.subscribers_count} подписчиков
                            </div>
                        </div>
                    </div>`).join('');
            }
            if (!html) html = '<div class="empty-state"><p>Ничего не найдено</p></div>';
            resultsEl.innerHTML = html;
        } catch (error) {
            resultsEl.innerHTML = '<div class="empty-state"><p>Ошибка поиска</p></div>';
        }
    },

    async startChatWith(userId) {
        try {
            const data = await API.chats.createPrivate(userId);
            UI.closeModal('modal-new-chat');
            document.getElementById('search-input').value = '';
            document.getElementById('search-results').style.display = 'none';
            document.getElementById('chat-list').style.display = '';
            await this.loadChats();
            await ChatUI.openChat(data.chat.id);
        } catch (error) {
            Toast.show(error.error || 'Ошибка', 'error');
        }
    },

    async searchUsersForChat(query) {
        const list = document.getElementById('new-chat-users');
        if (query.length < 2) { list.innerHTML = ''; return; }
        try {
            const data = await API.users.search(query);
            list.innerHTML = data.users.map(u => `
                <div class="user-item" onclick="App.startChatWith(${u.id})">
                    <div class="avatar avatar-sm" style="position:relative;">
                        ${App.getAvatarHtml(u)}
                        ${u.is_online ? '<div class="online-dot online-dot-sm"></div>' : ''}
                    </div>
                    <div>
                        <div class="user-item-name">${u.display_name}</div>
                        <div class="user-item-username"
                             style="color:${u.is_online ? 'var(--accent-green)' : ''}">
                            ${u.is_online ? '● онлайн' : (u.username ? '@' + u.username : u.phone)}
                        </div>
                    </div>
                </div>`).join('');
        } catch (error) {
            list.innerHTML = '<div class="empty-state"><p>Ошибка поиска</p></div>';
        }
    },

    async searchUsersForGroup(query) {
        const list = document.getElementById('group-users-list');
        if (query.length < 2) { list.innerHTML = ''; return; }
        try {
            const data = await API.users.search(query);
            list.innerHTML = data.users.map(u => {
                const isSelected = this.selectedGroupMembers.includes(u.id);
                return `
                    <div class="user-item"
                         onclick="App.toggleGroupMember(${u.id}, '${u.display_name}')">
                        <div class="avatar avatar-sm" style="position:relative;">
                            ${App.getAvatarHtml(u)}
                            ${u.is_online
                                ? '<div class="online-dot online-dot-sm"></div>' : ''}
                        </div>
                        <div>
                            <div class="user-item-name">${u.display_name}</div>
                            <div class="user-item-username"
                                 style="color:${u.is_online ? 'var(--accent-green)' : ''}">
                                ${u.is_online
                                    ? '● онлайн'
                                    : (u.username ? '@' + u.username : u.phone)}
                            </div>
                        </div>
                        ${isSelected
                            ? '<i class="fas fa-check" style="color:var(--accent);margin-left:auto;"></i>'
                            : ''}
                    </div>`;
            }).join('');
        } catch (error) {
            list.innerHTML = '';
        }
    },

    toggleGroupMember(userId, name) {
        const idx = this.selectedGroupMembers.indexOf(userId);
        if (idx > -1) this.selectedGroupMembers.splice(idx, 1);
        else this.selectedGroupMembers.push(userId);
        const container = document.getElementById('selected-members');
        const searchVal = document.getElementById('group-member-search').value;
        this.searchUsersForGroup(searchVal);
        container.innerHTML = this.selectedGroupMembers.length > 0
            ? `<span class="selected-member">${this.selectedGroupMembers.length} выбрано</span>`
            : '';
    },

    async createGroup() {
        const name = document.getElementById('group-name').value.trim();
        if (!name) { Toast.show('Введите название группы', 'error'); return; }
        try {
            const data = await API.chats.createGroup(name, this.selectedGroupMembers);
            this.selectedGroupMembers = [];
            UI.closeModal('modal-new-group');
            await this.loadChats();
            await ChatUI.openChat(data.chat.id);
            Toast.show('Группа создана!', 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка', 'error');
        }
    },

    async createChannel() {
        const name = document.getElementById('channel-create-name').value.trim();
        const handle = document.getElementById('channel-create-handle').value.trim();
        const desc = document.getElementById('channel-create-desc').value.trim();
        if (!name || !handle) {
            Toast.show('Заполните обязательные поля', 'error');
            return;
        }
        try {
            const data = await API.channels.create(name, handle, desc);
            UI.closeModal('modal-new-channel');
            await this.loadChannels();
            await ChannelUI.openChannel(data.channel.id);
            Toast.show('Канал создан!', 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка', 'error');
        }
    },

    async updateProfile() {
        const name = document.getElementById('profile-name').value.trim();
        const username = document.getElementById('profile-username').value.trim();
        const bio = document.getElementById('profile-bio').value.trim();
        try {
            const data = await API.users.updateProfile({
                display_name: name, username: username || null, bio
            });
            Auth.currentUser = data.user;
            localStorage.setItem('novachat_user', JSON.stringify(data.user));
            this.updateUserInfo();
            UI.closeModal('modal-profile');
            Toast.show('Профиль обновлён!', 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка', 'error');
        }
    },

    async uploadAvatar(input) {
        const file = input.files[0];
        if (!file) return;
        const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (!allowed.includes(file.type)) {
            Toast.show('Формат не поддерживается', 'error');
            input.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('profile-avatar-preview').innerHTML =
                `<img src="${e.target.result}" alt="">`;
        };
        reader.readAsDataURL(file);
        Toast.show('Загрузка аватарки...', 'info');
        try {
            const data = await API.users.uploadAvatar(file);
            Auth.currentUser = data.user;
            localStorage.setItem('novachat_user', JSON.stringify(data.user));
            this.updateUserInfo();
            const backendBase = 'https://novachat-backend-55fr.onrender.com';
            const src = data.avatar_url.startsWith('http')
                ? data.avatar_url
                : backendBase + data.avatar_url;
            const fallback = data.user.display_name.charAt(0);
            document.getElementById('profile-avatar-preview').innerHTML =
                `<img src="${src}" alt=""
                      onerror="this.parentElement.innerHTML='${fallback}'">`;
            Toast.show('Аватарка обновлена! ✓', 'success');
        } catch (error) {
            Toast.show(error.error || 'Ошибка загрузки', 'error');
        }
        input.value = '';
    },

    async showUserProfile(userId) {
        try {
            const data = await API.users.getUser(userId);
            const user = data.user;
            const backendBase = 'https://novachat-backend-55fr.onrender.com';

            const avatarEl = document.getElementById('view-profile-avatar');
            if (user.avatar_url && !user.avatar_url.startsWith('/uploads/')) {
                const src = user.avatar_url.startsWith('http')
                    ? user.avatar_url
                    : backendBase + user.avatar_url;
                avatarEl.innerHTML =
                    `<img src="${src}" alt=""
                          onerror="this.textContent='${user.display_name.charAt(0)}'">`;
            } else {
                avatarEl.textContent = user.display_name.charAt(0).toUpperCase();
            }

            document.getElementById('view-profile-name').textContent = user.display_name;

            const usernameEl = document.getElementById('view-profile-username');
            if (user.username) {
                usernameEl.textContent = '@' + user.username;
                usernameEl.style.display = 'block';
            } else {
                usernameEl.style.display = 'none';
            }

            const statusEl = document.getElementById('view-profile-status');
            if (user.is_online) {
                statusEl.textContent = '● онлайн';
                statusEl.className = 'profile-status-big online';
            } else {
                statusEl.textContent = this.formatLastSeen(user.last_seen);
                statusEl.className = 'profile-status-big';
            }

            const bioSection = document.getElementById('view-profile-bio-section');
            if (user.bio && user.bio.trim()) {
                document.getElementById('view-profile-bio').textContent = user.bio;
                bioSection.style.display = 'block';
            } else {
                bioSection.style.display = 'none';
            }

            document.getElementById('view-profile-phone').textContent =
                user.phone || 'Скрыт';

            const msgBtn = document.getElementById('view-profile-message-btn');
            if (user.id === Auth.currentUser.id) {
                msgBtn.style.display = 'none';
            } else {
                msgBtn.style.display = 'flex';
                msgBtn.onclick = () => {
                    UI.closeModal('modal-user-profile');
                    App.startChatWith(user.id);
                };
            }

            UI.openModal('modal-user-profile');
        } catch (error) {
            Toast.show('Ошибка загрузки профиля', 'error');
        }
    },

    async showGroupInfo() {
        if (!ChatUI.currentChat) return;
        const chat = ChatUI.currentChat;
        const backendBase = 'https://novachat-backend-55fr.onrender.com';
        const currentUserId = Auth.currentUser.id;
        const isOwner = chat.created_by === currentUserId;

        const avatarEl = document.getElementById('group-info-avatar');
        if (chat.avatar_url && !chat.avatar_url.startsWith('/uploads/')) {
            const src = chat.avatar_url.startsWith('http')
                ? chat.avatar_url
                : backendBase + chat.avatar_url;
            avatarEl.innerHTML = `<img src="${src}" alt="">`;
        } else {
            avatarEl.innerHTML = chat.name
                ? chat.name.charAt(0).toUpperCase()
                : '<i class="fas fa-users"></i>';
        }

        document.getElementById('group-info-name').textContent = chat.name || 'Группа';

        const members = chat.members_list || [];
        const onlineCount = members.filter(m => m.is_online).length;

        document.getElementById('group-info-count').innerHTML = `
            <span>${members.length} участников</span>
            ${onlineCount > 0
                ? `<span style="color:var(--accent-green);margin-left:8px;">
                       ● ${onlineCount} онлайн
                   </span>`
                : ''}`;

        const membersList = document.getElementById('group-info-members');

        if (members.length > 0) {
            const sorted = [...members].sort((a, b) => {
                if (a.is_online && !b.is_online) return -1;
                if (!a.is_online && b.is_online) return 1;
                return a.display_name.localeCompare(b.display_name);
            });

            membersList.innerHTML = sorted.map(m => {
                const isMe = m.id === currentUserId;
                const isCreator = m.id === chat.created_by;

                const badge = isCreator
                    ? '<span class="member-badge owner">👑 Создатель</span>'
                    : isMe
                        ? '<span class="member-badge me">Вы</span>'
                        : '';

                const onlineStatus = m.is_online
                    ? '<span class="member-online-status">● онлайн</span>'
                    : '<span class="member-offline-status">● оффлайн</span>';

                const kickBtn = (isOwner && !isMe && !isCreator)
                    ? `<button class="btn-kick"
                               onclick="event.stopPropagation(); App.kickMember(${m.id}, '${m.display_name.replace(/'/g, "\\'")}')"
                               title="Выгнать">
                           <i class="fas fa-user-slash"></i>
                       </button>`
                    : '';

                return `
                    <div class="member-item" onclick="App.showUserProfile(${m.id})">
                        <div class="avatar avatar-sm" style="position:relative;flex-shrink:0;">
                            ${App.getAvatarHtml(m)}
                            ${m.is_online
                                ? '<div class="online-dot online-dot-sm"></div>'
                                : ''}
                        </div>
                        <div class="member-info">
                            <div class="member-name">
                                ${m.display_name}
                                ${badge}
                            </div>
                            ${onlineStatus}
                        </div>
                        ${kickBtn}
                    </div>`;
            }).join('');
        } else {
            membersList.innerHTML =
                '<div class="empty-state"><p>Нет участников</p></div>';
        }

        const leaveBtn = document.getElementById('group-info-leave-btn');
        leaveBtn.style.display = 'block';
        leaveBtn.onclick = async () => {
            if (!confirm('Покинуть группу?')) return;
            try {
                await API.chats.leave(chat.id);
                UI.closeModal('modal-group-info');
                UI.closeChat();
                await App.loadChats();
                Toast.show('Вы покинули группу', 'success');
            } catch (e) {
                Toast.show('Ошибка', 'error');
            }
        };

        UI.openModal('modal-group-info');
    },

    async kickMember(userId, userName) {
        if (!ChatUI.currentChat) return;
        if (!confirm(`Выгнать ${userName} из группы?`)) return;

        try {
            await API.chats.kickMember(ChatUI.currentChat.id, userId);
            Toast.show(`${userName} выгнан из группы`, 'success');

            const chatData = await API.chats.getChat(ChatUI.currentChat.id);
            ChatUI.currentChat = chatData.chat;
            ChatUI.currentChat.members_list = chatData.members;

            await App.showGroupInfo();
        } catch (error) {
            Toast.show(error.error || 'Ошибка', 'error');
        }
    },

    formatLastSeen(dateStr) {
        if (!dateStr) return 'был(а) давно';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return 'был(а) давно';
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        if (diff < 60) return 'был(а) только что';
        if (diff < 300) return 'был(а) недавно';
        const minutes = Math.floor(diff / 60);
        if (minutes < 60) return `был(а) ${minutes} мин. назад`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `был(а) ${hours} ${this.pluralize(hours, 'час', 'часа', 'часов')} назад`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `был(а) ${days} ${this.pluralize(days, 'день', 'дня', 'дней')} назад`;
        return 'был(а) ' + date.toLocaleDateString(undefined, {
            day: 'numeric', month: 'long',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    },

    pluralize(n, one, few, many) {
        const mod10 = n % 10, mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 19) return many;
        if (mod10 === 1) return one;
        if (mod10 >= 2 && mod10 <= 4) return few;
        return many;
    }
};

const ThemeManager = {
    themes: {
        discord: {
            name: '🎮 Discord',
            vars: {
                '--bg-primary': '#1e2030',
                '--bg-secondary': '#181a26',
                '--bg-chat': '#222538',
                '--bg-message-out': '#3d4567',
                '--bg-message-in': '#2a2d42',
                '--bg-hover': '#2a2d42',
                '--bg-active': '#3d4567',
                '--bg-input': '#252839',
                '--bg-modal': '#1f2235',
                '--text-primary': '#e4e7f1',
                '--text-secondary': '#8a90a8',
                '--text-time': '#6a6f85',
                '--accent': '#5865f2',
                '--accent-hover': '#4752c4',
                '--accent-glow': '#818cf8',
                '--accent-deep': '#3b41a3',
                '--accent-green': '#57f287',
                '--accent-red': '#ed4245',
                '--accent-orange': '#fee75c',
                '--border': '#2a2d42',
            }
        },
        telegram: {
            name: '✈️ Telegram',
            vars: {
                '--bg-primary': '#f0f4f8',
                '--bg-secondary': '#ffffff',
                '--bg-chat': '#e8eef4',
                '--bg-message-out': '#effdde',
                '--bg-message-in': '#ffffff',
                '--bg-hover': '#e8eef4',
                '--bg-active': '#d5e6f3',
                '--bg-input': '#ffffff',
                '--bg-modal': '#ffffff',
                '--text-primary': '#1a1a2e',
                '--text-secondary': '#6b7fa3',
                '--text-time': '#9aabb8',
                '--accent': '#0088cc',
                '--accent-hover': '#006fa8',
                '--accent-glow': '#33aaff',
                '--accent-deep': '#005fa0',
                '--accent-green': '#4caf50',
                '--accent-red': '#e53935',
                '--accent-orange': '#ff9800',
                '--border': '#dce8f0',
            }
        },
        darkred: {
            name: '🔴 Тёмно-красный',
            vars: {
                '--bg-primary': '#120808',
                '--bg-secondary': '#1a0a0a',
                '--bg-chat': '#160d0d',
                '--bg-message-out': '#4a1515',
                '--bg-message-in': '#1f0f0f',
                '--bg-hover': '#1f0f0f',
                '--bg-active': '#3a1010',
                '--bg-input': '#1a0a0a',
                '--bg-modal': '#1f0a0a',
                '--text-primary': '#f0d8d8',
                '--text-secondary': '#a07070',
                '--text-time': '#7a5050',
                '--accent': '#c0392b',
                '--accent-hover': '#a93226',
                '--accent-glow': '#e74c3c',
                '--accent-deep': '#8b1a1a',
                '--accent-green': '#27ae60',
                '--accent-red': '#ff5252',
                '--accent-orange': '#e67e22',
                '--border': '#2a1010',
            }
        }
    },

    init() {
        const saved = localStorage.getItem('novachat_theme') || 'discord';
        this.apply(saved);
    },

    apply(themeKey) {
        const theme = this.themes[themeKey];
        if (!theme) return;
        const root = document.documentElement;
        Object.entries(theme.vars).forEach(([key, value]) => {
            root.style.setProperty(key, value);
        });
        localStorage.setItem('novachat_theme', themeKey);
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === themeKey);
        });
    }
};

const UI = {
    toggleMenu() {
        document.getElementById('slide-menu').classList.toggle('open');
        document.getElementById('menu-overlay').classList.toggle('active');
    },
    switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        document.getElementById('chat-list').style.display =
            tab === 'chats' ? '' : 'none';
        document.getElementById('channel-list').style.display =
            tab === 'channels' ? '' : 'none';
    },
    showNewChat() {
        this.openModal('modal-new-chat');
        document.getElementById('new-chat-search').value = '';
        document.getElementById('new-chat-users').innerHTML = '';
    },
    showNewGroup() {
        this.toggleMenu();
        App.selectedGroupMembers = [];
        document.getElementById('group-name').value = '';
        document.getElementById('group-member-search').value = '';
        document.getElementById('selected-members').innerHTML = '';
        document.getElementById('group-users-list').innerHTML = '';
        this.openModal('modal-new-group');
    },
    showNewChannel() {
        this.toggleMenu();
        document.getElementById('channel-create-name').value = '';
        document.getElementById('channel-create-handle').value = '';
        document.getElementById('channel-create-desc').value = '';
        this.openModal('modal-new-channel');
    },
    showProfile() {
        this.toggleMenu();
        const user = Auth.currentUser;
        const backendBase = 'https://novachat-backend-55fr.onrender.com';
        document.getElementById('profile-name').value = user.display_name || '';
        document.getElementById('profile-username').value = user.username || '';
        document.getElementById('profile-bio').value = user.bio || '';
        const avatarEl = document.getElementById('profile-avatar-preview');
        if (user.avatar_url && !user.avatar_url.startsWith('/uploads/')) {
            const src = user.avatar_url.startsWith('http')
                ? user.avatar_url
                : backendBase + user.avatar_url;
            avatarEl.innerHTML =
                `<img src="${src}" alt=""
                      onerror="this.parentElement.innerHTML='<span>${user.display_name.charAt(0)}</span>'">`;
        } else {
            avatarEl.innerHTML =
                `<span>${user.display_name.charAt(0).toUpperCase()}</span>`;
        }
        const saved = localStorage.getItem('novachat_theme') || 'discord';
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === saved);
        });
        
        const notifsEnabled = localStorage.getItem('novachat_notifications') !== 'false' 
                             && Notifications.permission === 'granted';
        const soundEnabled = localStorage.getItem('novachat_sound') !== 'false';
        const notifsEl = document.getElementById('settings-notifications');
        const soundEl = document.getElementById('settings-sound');
        if (notifsEl) notifsEl.checked = notifsEnabled;
        if (soundEl) soundEl.checked = soundEnabled;
        
        this.openModal('modal-profile');
    },
    showDeleteAccount() {
        const passwordInput = document.getElementById('delete-password');
        const errorEl = document.getElementById('delete-error');
        const btn = document.getElementById('btn-confirm-delete');
        if (passwordInput) passwordInput.value = '';
        if (errorEl) errorEl.textContent = '';
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash"></i> Удалить навсегда';
        }
        this.openModal('modal-delete-account');
    },
    showSearchUsers() { this.showNewChat(); },
    showSearchChannels() {
        this.switchTab('channels');
        document.getElementById('search-input').focus();
    },
    showChatInfo() {
        if (!ChatUI.currentChat) return;
        const chat = ChatUI.currentChat;
        if (chat.chat_type === 'private' && chat.other_user) {
            App.showUserProfile(chat.other_user.id);
        } else if (chat.chat_type === 'group') {
            App.showGroupInfo();
        }
    },
    closeChat() {
        document.getElementById('main-panel').classList.remove('active');
        document.getElementById('chat-view').style.display = 'none';
        document.getElementById('channel-view').style.display = 'none';
        document.getElementById('empty-chat').style.display = 'flex';
        ChatUI.currentChat = null;
        ChannelUI.currentChannel = null;
    },
    async toggleNotifications(checked) {
        const success = await Notifications.toggle(checked);
        if (!success) {
            document.getElementById('settings-notifications').checked = false;
        }
    },
    toggleSound(checked) {
        Notifications.toggleSound(checked);
        Toast.show(checked ? 'Звук включён' : 'Звук выключен', 'success');
    },
    openModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
    },
    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    }
};

const Toast = {
    show(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            toast.style.transition = '0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

document.addEventListener('DOMContentLoaded', () => { App.init(); });