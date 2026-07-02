"""
Модуль для отправки email через Resend API
"""
import os
import requests

RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
EMAIL_FROM = os.environ.get('EMAIL_FROM', 'NovaChat <onboarding@resend.dev>')

RESEND_URL = 'https://api.resend.com/emails'


def is_configured():
    """Проверка что email настроен"""
    return bool(RESEND_API_KEY)


def send_verification_code(to_email, code, user_name='Пользователь'):
    """Отправить код подтверждения на email через Resend"""
    if not is_configured():
        print('❌ Resend не настроен (нет RESEND_API_KEY)')
        return False, 'Email сервис не настроен'

    try:
        html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0612;font-family:Arial,sans-serif;">
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#0a0612;">
        <tr>
            <td align="center" style="padding:40px 20px;">
                <table role="presentation" style="width:100%;max-width:500px;border-collapse:collapse;background:linear-gradient(135deg,#1a0f2e 0%,#0a0612 100%);border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                    <tr>
                        <td align="center" style="padding:40px 30px 20px;background:linear-gradient(135deg,#5865f2 0%,#3b41a3 100%);">
                            <div style="width:80px;height:80px;background:rgba(255,255,255,0.15);border-radius:20px;display:inline-block;line-height:80px;margin-bottom:16px;">
                                <span style="font-size:40px;">💬</span>
                            </div>
                            <h1 style="margin:0;color:white;font-size:28px;font-weight:700;">NovaChat</h1>
                            <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Общение нового поколения</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:40px 30px;">
                            <h2 style="margin:0 0 16px;color:#e4e7f1;font-size:22px;">Привет, {user_name}! 👋</h2>
                            <p style="margin:0 0 30px;color:#8a90a8;font-size:15px;line-height:1.6;">
                                Ваш код подтверждения для регистрации в NovaChat:
                            </p>
                            <div style="text-align:center;margin:30px 0;">
                                <div style="display:inline-block;background:#1e2030;border:2px solid #5865f2;border-radius:16px;padding:20px 40px;">
                                    <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#818cf8;font-family:'Courier New',monospace;">
                                        {code}
                                    </div>
                                </div>
                            </div>
                            <p style="margin:30px 0 0;color:#6a6f85;font-size:13px;line-height:1.6;text-align:center;">
                                ⏰ Код действителен <strong>10 минут</strong><br>
                                🔒 Никому не сообщайте этот код
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:20px 30px 40px;border-top:1px solid #2a2d42;text-align:center;">
                            <p style="margin:0;color:#6a6f85;font-size:12px;line-height:1.5;">
                                Если вы не запрашивали код — просто игнорируйте это письмо.<br><br>
                                © 2025 NovaChat • Мессенджер нового поколения
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        """

        text = f"""
NovaChat — Код подтверждения

Привет, {user_name}!

Ваш код подтверждения: {code}

Код действителен 10 минут.
Никому не сообщайте этот код.

© 2025 NovaChat
        """

        # Отправляем через Resend API
        response = requests.post(
            RESEND_URL,
            headers={
                'Authorization': f'Bearer {RESEND_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'from': EMAIL_FROM,
                'to': [to_email],
                'subject': f'🔐 Код подтверждения NovaChat: {code}',
                'html': html,
                'text': text
            },
            timeout=15
        )

        print(f'📤 Resend response: {response.status_code}')
        print(f'📤 Body: {response.text[:300]}')

        if response.status_code == 200:
            print(f'✅ Email отправлен на {to_email}')
            return True, None
        else:
            error_data = response.json() if response.text else {}
            error_msg = error_data.get('message', 'Unknown error')
            print(f'❌ Resend error: {error_msg}')
            return False, f'Ошибка отправки: {error_msg}'

    except requests.exceptions.Timeout:
        print('❌ Таймаут при отправке')
        return False, 'Превышено время ожидания'
    except Exception as e:
        error_msg = f'{type(e).__name__}: {e}'
        print(f'❌ Ошибка отправки email: {error_msg}')
        import traceback
        traceback.print_exc()
        return False, str(e)


def send_welcome_email(to_email, user_name):
    """Приветственное письмо после успешной регистрации"""
    if not is_configured():
        return False, 'Email сервис не настроен'

    try:
        html = f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0612;font-family:Arial,sans-serif;">
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#0a0612;">
        <tr>
            <td align="center" style="padding:40px 20px;">
                <table role="presentation" style="width:100%;max-width:500px;background:linear-gradient(135deg,#1a0f2e 0%,#0a0612 100%);border-radius:20px;overflow:hidden;">
                    <tr>
                        <td align="center" style="padding:40px 30px;background:linear-gradient(135deg,#5865f2 0%,#3b41a3 100%);">
                            <h1 style="margin:0;color:white;font-size:32px;">🎉</h1>
                            <h1 style="margin:10px 0 0;color:white;font-size:26px;">Добро пожаловать!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:40px 30px;">
                            <h2 style="margin:0 0 16px;color:#e4e7f1;font-size:22px;">Привет, {user_name}! 👋</h2>
                            <p style="margin:0 0 20px;color:#8a90a8;font-size:15px;line-height:1.6;">
                                Твой аккаунт в NovaChat успешно создан! 🎊
                            </p>
                            <p style="margin:0 0 20px;color:#8a90a8;font-size:15px;line-height:1.6;">
                                <strong style="color:#818cf8;">Что можно делать:</strong>
                            </p>
                            <ul style="color:#8a90a8;font-size:14px;line-height:1.8;padding-left:20px;">
                                <li>💬 Общаться в личных чатах</li>
                                <li>👥 Создавать группы</li>
                                <li>📢 Вести каналы</li>
                                <li>📸 Отправлять фото и видео</li>
                                <li>📞 Совершать звонки</li>
                                <li>🎨 Настраивать темы</li>
                            </ul>
                            <div style="text-align:center;margin:30px 0 0;">
                                <a href="https://novachat-n8pj.onrender.com" style="display:inline-block;padding:14px 40px;background:#5865f2;color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">
                                    Открыть NovaChat
                                </a>
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        """

        response = requests.post(
            RESEND_URL,
            headers={
                'Authorization': f'Bearer {RESEND_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'from': EMAIL_FROM,
                'to': [to_email],
                'subject': f'🎉 Добро пожаловать в NovaChat, {user_name}!',
                'html': html
            },
            timeout=15
        )

        if response.status_code == 200:
            print(f'✅ Welcome email отправлен на {to_email}')
            return True, None
        else:
            return False, 'Ошибка отправки'

    except Exception as e:
        print(f'❌ Ошибка welcome email: {e}')
        return False, str(e)