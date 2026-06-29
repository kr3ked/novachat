const API = {
    BASE_URL: 'https://novachat-backend-55fr.onrender.com/api',
    token: localStorage.getItem('novachat_token'),

    setToken(token) {
        this.token = token;
        if (token) localStorage.setItem('novachat_token', token);
        else localStorage.removeItem('novachat_token');
    },

    async request(endpoint, options = {}) {
        const url = `${this.BASE_URL}${endpoint}`;
        const config = {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options
        };
        if (this.token) config.headers['Authorization'] = `Bearer ${this.token}`;
        if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);

        try {
            const response = await fetch(url, config);
            const data = await response.json();
            if (!response.ok) throw { status: response.status, ...data };
            return data;
        } catch (error) {
            if (error.status === 401) {
                API.setToken(null);
                localStorage.removeItem('novachat_user');
                location.reload();
            }
            throw error;
        }
    },

    auth: {
        async register(phone, password, displayName, username) {
            return API.request('/auth/register', {
                method: 'POST',
                body: { phone, password, display_name: displayName, username }
            });
        },
        async login(phone, password) {
            return API.request('/auth/login', { method: 'POST', body: { phone, password } });
        },
        async logout() { return API.request('/auth/logout', { method: 'POST' }); },
        async check() { return API.request('/auth/check'); },
        async deleteAccount(password) {
            return API.request('/auth/delete-account', { method: 'POST', body: { password } });
        }
    },

    users: {
        async getProfile() { return API.request('/users/me'); },
        async updateProfile(data) { return API.request('/users/me', { method: 'PUT', body: data }); },
        async uploadAvatar(file) {
            const formData = new FormData();
            formData.append('avatar', file);
            const response = await fetch(`${API.BASE_URL}/users/me/avatar`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API.token}` },
                body: formData
            });
            const data = await response.json();
            if (!response.ok) throw data;
            return data;
        },
        async search(query) { return API.request(`/users/search?q=${encodeURIComponent(query)}`); },
        async getUser(userId) { return API.request(`/users/${userId}`); },
        async ping() { return API.request('/users/ping', { method: 'POST' }); }
    },

    chats: {
        async getAll() { return API.request('/chats/'); },
        async createPrivate(userId) {
            return API.request('/chats/private', { method: 'POST', body: { user_id: userId } });
        },
        async createGroup(name, memberIds) {
            return API.request('/chats/group', { method: 'POST', body: { name, member_ids: memberIds } });
        },
        async getChat(chatId) { return API.request(`/chats/${chatId}`); },
        async addMember(chatId, userId) {
            return API.request(`/chats/${chatId}/members`, { method: 'POST', body: { user_id: userId } });
        },
        async leave(chatId) { return API.request(`/chats/${chatId}/leave`, { method: 'POST' }); },
        async delete(chatId) { return API.request(`/chats/${chatId}/delete`, { method: 'DELETE' }); }
    },

    channels: {
        async getAll() { return API.request('/channels/'); },
        async create(name, handle, description) {
            return API.request('/channels/create', { method: 'POST', body: { name, handle, description } });
        },
        async get(channelId) { return API.request(`/channels/${channelId}`); },
        async search(query) { return API.request(`/channels/search?q=${encodeURIComponent(query)}`); },
        async subscribe(channelId) {
            return API.request(`/channels/${channelId}/subscribe`, { method: 'POST' });
        },
        async unsubscribe(channelId) {
            return API.request(`/channels/${channelId}/unsubscribe`, { method: 'POST' });
        },
        async update(channelId, data) {
            return API.request(`/channels/${channelId}`, { method: 'PUT', body: data });
        },
        async delete(channelId) {
            return API.request(`/channels/${channelId}`, { method: 'DELETE' });
        }
    },

    messages: {
        async getChatMessages(chatId, page = 1) {
            return API.request(`/messages/chat/${chatId}?page=${page}`);
        },
        async getChannelPosts(channelId, page = 1) {
            return API.request(`/messages/channel/${channelId}?page=${page}`);
        },
        async send(chatId, text, replyToId = null, fileUrl = null, fileName = null, fileType = null) {
            return API.request('/messages/send', {
                method: 'POST',
                body: { chat_id: chatId, text, reply_to_id: replyToId, file_url: fileUrl, file_name: fileName, file_type: fileType }
            });
        },
        async uploadFile(file) {
            const formData = new FormData();
            formData.append('file', file);
            const response = await fetch(`${API.BASE_URL}/messages/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${API.token}` },
                body: formData
            });
            const data = await response.json();
            if (!response.ok) throw data;
            return data;
        },
        async createPost(channelId, text, fileUrl = null, fileName = null, fileType = null) {
            return API.request(`/messages/channel/${channelId}/post`, {
                method: 'POST',
                body: { text, file_url: fileUrl, file_name: fileName, file_type: fileType }
            });
        },
        async edit(messageId, text) {
            return API.request(`/messages/${messageId}/edit`, { method: 'PUT', body: { text } });
        },
        async delete(messageId) {
            return API.request(`/messages/${messageId}/delete`, { method: 'DELETE' });
        },
        async toggleLike(messageId, reaction = '👍') {
            return API.request(`/messages/${messageId}/like`, { method: 'POST', body: { reaction } });
        },
        async getReactions(messageId) { return API.request(`/messages/${messageId}/reactions`); },
        async getComments(messageId) { return API.request(`/messages/${messageId}/comments`); },
        async addComment(messageId, text) {
            return API.request(`/messages/${messageId}/comments`, { method: 'POST', body: { text } });
        },
        async deleteComment(commentId) {
            return API.request(`/messages/comments/${commentId}`, { method: 'DELETE' });
        },
        async forward(messageId, chatId = null, channelId = null) {
            return API.request(`/messages/${messageId}/forward`, {
                method: 'POST', body: { chat_id: chatId, channel_id: channelId }
            });
        }
    }
};