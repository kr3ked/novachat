const Auth = {
    currentUser: null,

    init() {
        const savedUser = localStorage.getItem('novachat_user');
        const savedToken = localStorage.getItem('novachat_token');

        if (savedUser && savedToken) {
            this.currentUser = JSON.parse(savedUser);
            API.setToken(savedToken);
            this.checkSession();
        }
    },

    async checkSession() {
        try {
            const data = await API.auth.check();
            this.currentUser = data.user;
            localStorage.setItem('novachat_user', JSON.stringify(data.user));
            App.showMainScreen();
        } catch (e) {
            this.currentUser = null;
            API.setToken(null);
            localStorage.removeItem('novachat_user');
        }
    },

    showLogin() {
        document.getElementById('login-form').classList.add('active');
        document.getElementById('register-form').classList.remove('active');
        document.getElementById('auth-error').textContent = '';
    },

    showRegister() {
        document.getElementById('login-form').classList.remove('active');
        document.getElementById('register-form').classList.add('active');
        document.getElementById('auth-error').textContent = '';
    },

    async login() {
        const phone = document.getElementById('login-phone').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const errorEl = document.getElementById('auth-error');

        if (!phone || !password) {
            errorEl.textContent = 'Заполните все поля';
            return;
        }

        try {
            const data = await API.auth.login(phone, password);
            API.setToken(data.token);
            this.currentUser = data.user;
            localStorage.setItem('novachat_user', JSON.stringify(data.user));
            errorEl.textContent = '';
            App.showMainScreen();
            Toast.show('Добро пожаловать, ' + data.user.display_name + '!', 'success');
        } catch (error) {
            errorEl.textContent = error.error || 'Ошибка входа';
        }
    },

    async register() {
        const name = document.getElementById('reg-name').value.trim();
        const phone = document.getElementById('reg-phone').value.trim();
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value.trim();
        const errorEl = document.getElementById('auth-error');

        if (!name || !phone || !password) {
            errorEl.textContent = 'Заполните обязательные поля';
            return;
        }

        try {
            const data = await API.auth.register(phone, password, name, username || undefined);
            API.setToken(data.token);
            this.currentUser = data.user;
            localStorage.setItem('novachat_user', JSON.stringify(data.user));
            errorEl.textContent = '';
            App.showMainScreen();
            Toast.show('Аккаунт создан! Добро пожаловать!', 'success');
        } catch (error) {
            errorEl.textContent = error.error || 'Ошибка регистрации';
        }
    },

    async logout() {
        try { await API.auth.logout(); } catch (e) {}

        this.currentUser = null;
        API.setToken(null);
        localStorage.removeItem('novachat_user');
        localStorage.removeItem('novachat_token');

        if (App.socket) App.socket.disconnect();

        document.getElementById('auth-screen').classList.add('active');
        document.getElementById('main-screen').classList.remove('active');
        UI.toggleMenu();
        Toast.show('Вы вышли из аккаунта');
    },

    async deleteAccount() {
        const passwordInput = document.getElementById('delete-password');
        const errorEl = document.getElementById('delete-error');
        const btn = document.getElementById('btn-confirm-delete');
        
        const password = passwordInput.value.trim();
        
        if (!password) {
            errorEl.textContent = 'Введите пароль';
            return;
        }
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Удаление...';
        errorEl.textContent = '';
        
        try {
            await API.auth.deleteAccount(password);
            
            this.currentUser = null;
            API.setToken(null);
            localStorage.removeItem('novachat_user');
            localStorage.removeItem('novachat_token');
            
            if (App.socket) App.socket.disconnect();
            
            UI.closeModal('modal-delete-account');
            UI.closeModal('modal-profile');
            
            document.getElementById('main-screen').classList.remove('active');
            document.getElementById('auth-screen').classList.add('active');
            
            Toast.show('Аккаунт удалён. Прощайте! 👋', 'success');
            
            passwordInput.value = '';
            
        } catch (error) {
            errorEl.textContent = error.error || 'Ошибка удаления';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash"></i> Удалить навсегда';
        }
    }
};