const App = {
    socket: null,
    selectedGroupMembers: [],

    init() {
        Auth.init();
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.reactions-picker') && !e.target.closest('.message-action-btn')) {
                document.getElementById('reactions-picker').style.display = 'none';
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
            if (now - lastActivity > 30000) {
                lastActivity = now;
                this.sendPing();
            }
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
        const avatarEl = document.getElementById('menu-avatar');
        avatarEl.innerHTML = this.getAvatarHtml(user, 'avatar-lg');
    },

    // Возвращает HTML аватара с правильным базовым URL
    getAvatarHtml(user, extraClass = '') {
        const backendBase = 'https://novachat-backend-55fr.onrender.com';
        if (user.avatar_url) {
            const src = user.avatar_url.startsWith('http')
                ? user.avatar_url
                : backendBase + user.avatar_url;
            return `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        }
        return user.display_name.charAt(0).toUpperCase();
    },

    // Устаревший метод — оставляем для совместимости
    getAvatarContent(user) {
        return this.getAvatarHtml(user);
    },

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
        });
        this.socket.on('chat_updated', (data) => {
            console.log('💬 Chat updated:', data);
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
                    <button class="btn btn-small" onclick="UI.showNewChat()">Найти собеседника</button>
                </div>`;
            return;
        }

        list.innerHTML = chats.map(chat => {
            const isActive = ChatUI.currentChat && ChatUI.currentChat.id === chat.id;
            const icon = chat.chat_type === 'group' ? 'fa-users' : 'fa-user';
            const preview = chat.last_message
                ? (chat.last_message.text || (chat.last_message.message_type === 'video' ? '🎥 Видео' : '🖼 Фото')).substring(0, 40)
                : 'Нет сообщений';
            const time = chat.last_message ? ChatUI.formatTime(chat.last_message.created_at) : '';

            let avatarContent;
            if (chat.avatar_url) {
                const src = chat.avatar_url.startsWith('http') ? chat.avatar_url : backendBase + chat.avatar_url;
                avatarContent = `<img src="${src}" alt="">`;
            } else {
                avatarContent = chat.name
                    ? chat.name.charAt(0).toUpperCase()
                    : `<i class="fas ${icon}"></i>`;
            }

            return `
                <div class="chat-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}" onclick="ChatUI.openChat(${chat.id})">
                    <div class="avatar">${avatarContent}</div>
                    <div class="chat-item-info">
                        <div class="chat-item-top">
                            <span class="chat-item-name">${chat.name || 'Чат'}</span>
                            <span class="chat-item-time">${time}</span>
                        </div>
                        <div class="chat-item-preview">${ChatUI.escapeHtml(preview)}</div>
                    </div>
                </div>`;
        }).join('');
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
                    <button class="btn btn-small" onclick="UI.showNewChannel()">Создать канал</button>
                </div>`;
            return;
        }
        list.innerHTML = channels.map(ch => {
            const avatarContent = ch.avatar_url
                ? `<img src="${ch.avatar_url}" alt="">`
                : ch.name.charAt(0).toUpperCase();
            const preview = ch.last_post ? (ch.last_post.text || '').substring(0, 40) : 'Нет постов';
            const time = ch.last_post ? ChatUI.formatTime(ch.last_post.created_at) : '';
            return `
                <div class="channel-item" onclick="ChannelUI.openChannel(${ch.id})">
                    <div class="avatar">${avatarContent}</div>
                    <div class="channel-item-info">
                        <div class="chat-item-top">
                            <span class="chat-item-name">${ch.name}</span>
                            <span class="chat-item-time">${time}</span>
                        </div>
                        <div class="chat-item-preview">${ChatUI.escapeHtml(preview)}</div>
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
                        <div class="avatar">${App.getAvatarHtml(u)}</div>
                        <div class="chat-item-info">
                            <div class="chat-item-name">${u.display_name}</div>
                            <div class="chat-item-preview">@${u.username || u.phone}</div>
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
                            <div class="chat-item-preview">@${ch.handle} · ${ch.subscribers_count} подписчиков</div>
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
                    <div class="avatar avatar-sm">${App.getAvatarHtml(u)}</div>
                    <div>
                        <div class="user-item-name">${u.display_name}</div>
                        <div class="user-item-username">${u.username ? '@' + u.username : u.phone}</div>
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
                    <div class="user-item" onclick="App.toggleGroupMember(${u.id}, '${u.display_name}')">
                        <div class="avatar avatar-sm">${App.getAvatarHtml(u)}</div>
                        <div>
                            <div class="user-item-name">${u.display_name}</div>
                            <div class="user-item-username">${u.username ? '@' + u.username : u.phone}</div>
                        </div>
                        ${isSelected ? '<i class="fas fa-check" style="color:var(--accent);margin-left:auto;"></i>' : ''}
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
        if (!name || !handle) { Toast.show('Заполните обязательные поля', 'error'); return; }
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
                display_name: name,
                username: username || null,
                bio: bio
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

    // Загрузка аватарки
    async uploadAvatar(input) {
        const file = input.files[0];
        if (!file) return;

        const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (!allowed.includes(file.type)) {
            Toast.show('Формат не поддерживается', 'error');
            input.value = '';
            return;
        }

        // Показываем превью сразу
        const reader = new FileReader();
        reader.onload = (e) => {
            const avatarEl = document.getElementById('profile-avatar-preview');
            avatarEl.innerHTML = `<img src="${e.target.result}" alt="">`;
        };
        reader.readAsDataURL(file);

        Toast.show('Загрузка аватарки...', 'info');
        try {
            const data = await API.users.uploadAvatar(file);

            // Обновляем данные пользователя
            Auth.currentUser = data.user;
            localStorage.setItem('novachat_user', JSON.stringify(data.user));

            // Обновляем аватар в шапке меню
            this.updateUserInfo();

            // Обновляем аватар в модале профиля
            const backendBase = 'https://novachat-backend-55fr.onrender.com';
            const src = data.avatar_url.startsWith('http') ? data.avatar_url : backendBase + data.avatar_url;
            document.getElementById('profile-avatar-preview').innerHTML =
                `<img src="${src}" alt="">`;

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
            if (user.avatar_url) {
                const src = user.avatar_url.startsWith('http') ? user.avatar_url : backendBase + user.avatar_url;
                avatarEl.innerHTML = `<img src="${src}" alt="">`;
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
                statusEl.textContent = 'онлайн';
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

            document.getElementById('view-profile-phone').textContent = user.phone || 'Скрыт';

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

const UI = {
    toggleMenu() {
        document.getElementById('slide-menu').classList.toggle('open');
        document.getElementById('menu-overlay').classList.toggle('active');
    },
    switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        document.getElementById('chat-list').style.display = tab === 'chats' ? '' : 'none';
        document.getElementById('channel-list').style.display = tab === 'channels' ? '' : 'none';
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

        // Показываем текущую аватарку
        const avatarEl = document.getElementById('profile-avatar-preview');
        if (user.avatar_url) {
            const src = user.avatar_url.startsWith('http') ? user.avatar_url : backendBase + user.avatar_url;
            avatarEl.innerHTML = `<img src="${src}" alt="">`;
        } else {
            avatarEl.innerHTML = `<span>${user.display_name.charAt(0).toUpperCase()}</span>`;
        }

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
        if (ChatUI.currentChat && ChatUI.currentChat.other_user) {
            App.showUserProfile(ChatUI.currentChat.other_user.id);
        } else {
            Toast.show('Информация о группе (в разработке)');
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
    openModal(id) {
        const modal = document.getElementById(id);
        if (modal) modal.classList.add('active');
        else console.error('Modal not found:', id);
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

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});