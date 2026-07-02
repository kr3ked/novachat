const Auth = {
    currentUser: null,
    pendingEmail: null,
    resendTimer: null,

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
        document.getElementById('verify-form').classList.remove('active');
        document.getElementById('auth-error').textContent = '';
    },

    showRegister() {
        document.getElementById('login-form').classList.remove('active');
        document.getElementById('register-form').classList.add('active');
        document.getElementById('verify-form').classList.remove('active');
        document.getElementById('auth-error').textContent = '';
    },

    showVerify() {
        document.getElementById('login-form').classList.remove('active');
        document.getElementById('register-form').classList.remove('active');
        document.getElementById('verify-form').classList.add('active');
        document.getElementById('auth-error').textContent = '';
        
        // Показываем email в подсказке
        const emailHint = document.getElementById('verify-email-hint');
        if (emailHint && this.pendingEmail) {
            emailHint.textContent = this.pendingEmail;
        }
        
        // Фокус на первой ячейке кода
        setTimeout(() => {
            const firstInput = document.querySelector('.code-input');
            if (firstInput) firstInput.focus();
        }, 100);
    },

    async login() {
        const loginField = document.getElementById('login-field').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const errorEl = document.getElementById('auth-error');

        if (!loginField || !password) {
            errorEl.textContent = 'Заполните все поля';
            return;
        }

        try {
            // Пробуем логин (backend сам определит email это или телефон)
            const body = loginField.includes('@') 
                ? { email: loginField, password }
                : { phone: loginField, password };
            
            const data = await API.request('/auth/login', {
                method: 'POST',
                body: body
            });
            
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
        const email = document.getElementById('reg-email').value.trim().toLowerCase();
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value.trim();
        const errorEl = document.getElementById('auth-error');
        const btn = document.getElementById('btn-register');

        if (!name || !email || !password) {
            errorEl.textContent = 'Заполните обязательные поля';
            return;
        }

        if (!email.includes('@') || !email.includes('.')) {
            errorEl.textContent = 'Неверный формат email';
            return;
        }

        // Блокируем кнопку
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка кода...';
        errorEl.textContent = '';

        try {
            await API.request('/auth/send-code', {
                method: 'POST',
                body: {
                    email: email,
                    password: password,
                    display_name: name,
                    username: username || null
                }
            });
            
            this.pendingEmail = email;
            
            // Очищаем поля кода
            document.querySelectorAll('.code-input').forEach(inp => inp.value = '');
            
            // Переключаемся на форму ввода кода
            this.showVerify();
            
            // Запускаем таймер повторной отправки
            this.startResendTimer();
            
            Toast.show('📧 Код отправлен на ' + email, 'success');
        } catch (error) {
            errorEl.textContent = error.error || 'Ошибка отправки кода';
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-envelope"></i> Отправить код';
    },

    async verifyCode() {
        const errorEl = document.getElementById('auth-error');
        const btn = document.getElementById('btn-verify');
        
        // Собираем код из 6 инпутов
        const inputs = document.querySelectorAll('.code-input');
        const code = Array.from(inputs).map(i => i.value).join('');
        
        if (code.length !== 6) {
            errorEl.textContent = 'Введите все 6 цифр кода';
            return;
        }

        if (!this.pendingEmail) {
            errorEl.textContent = 'Ошибка сессии. Начните регистрацию заново.';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Проверка...';
        errorEl.textContent = '';

        try {
            const data = await API.request('/auth/verify-code', {
                method: 'POST',
                body: {
                    email: this.pendingEmail,
                    code: code
                }
            });
            
            API.setToken(data.token);
            this.currentUser = data.user;
            localStorage.setItem('novachat_user', JSON.stringify(data.user));
            
            // Очистка
            this.pendingEmail = null;
            if (this.resendTimer) {
                clearInterval(this.resendTimer);
                this.resendTimer = null;
            }
            
            App.showMainScreen();
            Toast.show('🎉 Аккаунт создан! Добро пожаловать!', 'success');
        } catch (error) {
            errorEl.textContent = error.error || 'Ошибка проверки кода';
            // Очищаем поля кода
            inputs.forEach(i => i.value = '');
            inputs[0].focus();
        }

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Подтвердить';
    },

    async resendCode() {
        if (!this.pendingEmail) return;
        
        const btn = document.getElementById('btn-resend');
        const errorEl = document.getElementById('auth-error');
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Отправка...';
        errorEl.textContent = '';

        try {
            await API.request('/auth/resend-code', {
                method: 'POST',
                body: { email: this.pendingEmail }
            });
            
            Toast.show('📧 Код отправлен повторно', 'success');
            
            // Очищаем поля
            document.querySelectorAll('.code-input').forEach(inp => inp.value = '');
            document.querySelector('.code-input').focus();
            
            // Перезапускаем таймер
            this.startResendTimer();
        } catch (error) {
            errorEl.textContent = error.error || 'Ошибка отправки';
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-redo"></i> Отправить повторно';
        }
    },

    startResendTimer() {
        const btn = document.getElementById('btn-resend');
        if (!btn) return;
        
        if (this.resendTimer) clearInterval(this.resendTimer);
        
        let seconds = 60;
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-clock"></i> Повторно через ${seconds} сек`;
        
        this.resendTimer = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
                clearInterval(this.resendTimer);
                this.resendTimer = null;
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-redo"></i> Отправить повторно';
            } else {
                btn.innerHTML = `<i class="fas fa-clock"></i> Повторно через ${seconds} сек`;
            }
        }, 1000);
    },

    // Автопереход между полями кода
    handleCodeInput(input, index) {
        const value = input.value.replace(/[^0-9]/g, '');
        input.value = value;
        
        if (value && index < 5) {
            const next = document.querySelectorAll('.code-input')[index + 1];
            if (next) next.focus();
        }
        
        // Если все 6 заполнены — автоматически проверяем
        const inputs = document.querySelectorAll('.code-input');
        const code = Array.from(inputs).map(i => i.value).join('');
        if (code.length === 6) {
            setTimeout(() => this.verifyCode(), 200);
        }
    },

    handleCodeKeydown(event, index) {
        // Backspace на пустом поле — переход к предыдущему
        if (event.key === 'Backspace' && !event.target.value && index > 0) {
            const prev = document.querySelectorAll('.code-input')[index - 1];
            if (prev) {
                prev.focus();
                prev.value = '';
            }
        }
    },

    handleCodePaste(event) {
        event.preventDefault();
        const paste = (event.clipboardData || window.clipboardData).getData('text');
        const digits = paste.replace(/[^0-9]/g, '').substring(0, 6);
        
        const inputs = document.querySelectorAll('.code-input');
        inputs.forEach((inp, i) => {
            inp.value = digits[i] || '';
        });
        
        if (digits.length === 6) {
            setTimeout(() => this.verifyCode(), 200);
        } else if (digits.length > 0) {
            inputs[Math.min(digits.length, 5)].focus();
        }
    },

    backToRegister() {
        this.pendingEmail = null;
        if (this.resendTimer) {
            clearInterval(this.resendTimer);
            this.resendTimer = null;
        }
        this.showRegister();
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