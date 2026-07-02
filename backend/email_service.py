"""
Модуль для отправки email через Gmail SMTP
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

GMAIL_USER = os.environ.get('GMAIL_USER', '')
GMAIL_APP_PASSWORD = os.environ.get('GMAIL_APP_PASSWORD', '')
EMAIL_FROM_NAME = os.environ.get('EMAIL_FROM_NAME', 'NovaChat')


def is_configured():
    """Проверка что email настроен"""
    return bool(GMAIL_USER and GMAIL_APP_PASSWORD)


def send_verification_code(to_email, code, user_name='Пользователь'):
    """Отправить код подтверждения на email"""
    if not is_configured():
        print('❌ Email не настроен (нет GMAIL_USER или GMAIL_APP_PASSWORD)')
        return False, 'Email сервис не настроен'

    try:
        # Создаём письмо
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f'🔐 Код подтверждения NovaChat: {code}'
        msg['From'] = f'{EMAIL_FROM_NAME} <{GMAIL_USER}>'
        msg['To'] = to_email

        # HTML версия письма (красивая)
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
        </head>
        <body style="margin:0;padding:0;background:#0a0612;font-family:Arial,sans-serif;">
            <table role="presentation" style="width:100%;border-collapse:collapse;background:#0a0612;">
                <tr>
                    <td align="center" style="padding:40px 20px;">
                        <table role="presentation" style="width:100%;max-width:500px;border-collapse:collapse;background:linear-gradient(135deg,#1a0f2e 0%,#0a0612 100%);border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                            
                            <!-- Заголовок -->
                            <tr>
                                <td align="center" style="padding:40px 30px 20px;background:linear-gradient(135deg,#5865f2 0%,#3b41a3 100%);">
                                    <div style="width:80px;height:80px;background:rgba(255,255,255,0.15);border-radius:20px;display:inline-block;line-height:80px;margin-bottom:16px;">
                                        <span style="font-size:40px;">💬</span>
                                    </div>
                                    <h1 style="margin:0;color:white;font-size:28px;font-weight:700;">NovaChat</h1>
                                    <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Общение нового поколения</p>
                                </td>
                            </tr>
                            
                            <!-- Тело -->
                            <tr>
                                <td style="padding:40px 30px;">
                                    <h2 style="margin:0 0 16px;color:#e4e7f1;font-size:22px;">Привет, {user_name}! 👋</h2>
                                    <p style="margin:0 0 30px;color:#8a90a8;font-size:15px;line-height:1.6;">
                                        Ваш код подтверждения для регистрации в NovaChat:
                                    </p>
                                    
                                    <!-- Код -->
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
                            
                            <!-- Футер -->
                            <tr>
                                <td style="padding:20px 30px 40px;border-top:1px solid #2a2d42;text-align:center;">
                                    <p style="margin:0;color:#6a6f85;font-size:12px;line-height:1.5;">
                                        Если вы не запрашивали код — просто игнорируйте это письмо.<br>
                                        <br>
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

        # Текстовая версия (fallback)
        text = f"""
NovaChat — Код подтверждения

Привет, {user_name}!

Ваш код подтверждения: {code}

Код действителен 10 минут.
Никому не сообщайте этот код.

Если вы не запрашивали код — просто игнорируйте это письмо.

© 2025 NovaChat
        """

        # Прикрепляем обе версии
        msg.attach(MIMEText(text, 'plain', 'utf-8'))
        msg.attach(MIMEText(html, 'html', 'utf-8'))

        # Подключаемся к Gmail SMTP и отправляем
        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls()
            server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.send_message(msg)

        print(f'✅ Email отправлен на {to_email}')
        return True, None

    except smtplib.SMTPAuthenticationError as e:
        error_msg = f'Ошибка авторизации Gmail: {e}'
        print(f'❌ {error_msg}')
        return False, 'Ошибка авторизации email сервиса'

    except Exception as e:
        error_msg = f'Ошибка отправки email: {type(e).__name__}: {e}'
        print(f'❌ {error_msg}')
        return False, str(e)


def send_welcome_email(to_email, user_name):
    """Приветственное письмо после успешной регистрации"""
    if not is_configured():
        return False, 'Email сервис не настроен'

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f'🎉 Добро пожаловать в NovaChat, {user_name}!'
        msg['From'] = f'{EMAIL_FROM_NAME} <{GMAIL_USER}>'
        msg['To'] = to_email

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

        msg.attach(MIMEText(html, 'html', 'utf-8'))

        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls()
            server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.send_message(msg)

        print(f'✅ Welcome email отправлен на {to_email}')
        return True, None

    except Exception as e:
        print(f'❌ Ошибка welcome email: {e}')
        return False, str(e)