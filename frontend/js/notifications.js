/**
 * Модуль уведомлений
 */
const Notifications = {
    permission: 'default',
    enabled: true,
    soundEnabled: true,
    unreadCount: 0,
    originalTitle: 'NovaChat',
    titleInterval: null,

    init() {
        this.enabled = localStorage.getItem('novachat_notifications') !== 'false';
        this.soundEnabled = localStorage.getItem('novachat_sound') !== 'false';
        
        if ('Notification' in window) {
            this.permission = Notification.permission;
        }

        window.addEventListener('focus', () => this.clearUnread());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.clearUnread();
        });
    },

    playSound() {
        if (!this.soundEnabled) return;

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const ctx = new AudioContext();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            // Приятный звук "тинь" — двойной тон
            oscillator.frequency.setValueAtTime(800, ctx.currentTime);
            oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.1);

            gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.3);
        } catch (e) {
            console.log('Sound error:', e);
        }
    },

    async requestPermission() {
        if (!('Notification' in window)) {
            Toast.show('Браузер не поддерживает уведомления', 'error');
            return false;
        }

        if (Notification.permission === 'granted') {
            this.permission = 'granted';
            return true;
        }

        if (Notification.permission === 'denied') {
            Toast.show('Уведомления заблокированы. Разрешите их в настройках браузера 🔒', 'error');
            return false;
        }

        const result = await Notification.requestPermission();
        this.permission = result;

        if (result === 'granted') {
            Toast.show('Уведомления включены! 🔔', 'success');
            this.show('NovaChat', 'Уведомления успешно подключены!', '🎉');
            return true;
        } else {
            Toast.show('Уведомления отклонены', 'error');
            return false;
        }
    },

    notify(msg, chat) {
        if (!this.enabled) return;
        
        // Не уведомляем о своих сообщениях
        if (msg.sender && msg.sender.id === Auth.currentUser.id) return;
        
        // Не уведомляем если этот чат открыт И окно в фокусе
        if (!document.hidden && 
            ChatUI.currentChat && 
            ChatUI.currentChat.id === msg.chat_id) {
            return;
        }

        this.incrementUnread();
        this.playSound();

        const senderName = msg.sender ? msg.sender.display_name : 'Кто-то';
        let chatName = senderName;
        let text = msg.text || (msg.message_type === 'video' ? '🎥 Видео' : '🖼 Фото');

        if (chat && chat.chat_type === 'group') {
            chatName = `${chat.name} · ${senderName}`;
        }

        this.show(chatName, text, senderName.charAt(0).toUpperCase(), msg.chat_id);
    },

    show(title, body, avatarLetter = 'N', chatId = null) {
        if (this.permission !== 'granted') return;
        if (document.hasFocus() && !document.hidden) return;

        try {
            const icon = this.generateIconDataUrl(avatarLetter);

            const notification = new Notification(title, {
                body: body,
                icon: icon,
                badge: icon,
                tag: `novachat-${chatId || 'default'}`,
                requireInteraction: false,
                silent: true
            });

            notification.onclick = () => {
                window.focus();
                if (chatId && ChatUI.openChat) {
                    ChatUI.openChat(chatId);
                }
                notification.close();
            };

            setTimeout(() => notification.close(), 5000);

        } catch (e) {
            console.log('Notification error:', e);
        }
    },

    generateIconDataUrl(letter) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 128, 128);
        gradient.addColorStop(0, '#5865f2');
        gradient.addColorStop(1, '#3b41a3');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(64, 64, 64, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 64px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(letter, 64, 70);

        return canvas.toDataURL('image/png');
    },

    incrementUnread() {
        this.unreadCount++;
        this.updateTitle();
    },

    clearUnread() {
        this.unreadCount = 0;
        document.title = this.originalTitle;
        if (this.titleInterval) {
            clearInterval(this.titleInterval);
            this.titleInterval = null;
        }
    },

    updateTitle() {
        if (this.unreadCount === 0) {
            document.title = this.originalTitle;
            return;
        }

        const newTitle = `(${this.unreadCount}) ${this.originalTitle}`;

        if (this.titleInterval) clearInterval(this.titleInterval);

        let flipped = false;
        document.title = `🔔 ${newTitle}`;
        
        this.titleInterval = setInterval(() => {
            document.title = flipped ? `🔔 ${newTitle}` : newTitle;
            flipped = !flipped;
        }, 1500);
    },

    async toggle(enabled) {
        if (enabled && this.permission !== 'granted') {
            const granted = await this.requestPermission();
            if (!granted) return false;
        }
        
        this.enabled = enabled;
        localStorage.setItem('novachat_notifications', enabled ? 'true' : 'false');
        return true;
    },

    toggleSound(enabled) {
        this.soundEnabled = enabled;
        localStorage.setItem('novachat_sound', enabled ? 'true' : 'false');
        if (enabled) {
            this.playSound();
        }
    }
};