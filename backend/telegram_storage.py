"""
Модуль для работы с Telegram как файловым хранилищем
"""
import os
import requests

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
TELEGRAM_API = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}'


def is_configured():
    """Проверяет настроен ли Telegram"""
    has_token = bool(TELEGRAM_BOT_TOKEN)
    has_chat = bool(TELEGRAM_CHAT_ID)
    print(f'🔍 Telegram check: token={has_token}, chat_id={has_chat}')
    if has_token:
        print(f'🔍 Token starts with: {TELEGRAM_BOT_TOKEN[:10]}...')
    if has_chat:
        print(f'🔍 Chat ID: {TELEGRAM_CHAT_ID}')
    return has_token and has_chat


def upload_photo(file_data, filename='photo.jpg'):
    """Загружает фото в Telegram канал"""
    print(f'📤 Trying to upload photo: {filename}, size={len(file_data)} bytes')
    
    if not is_configured():
        print('❌ Telegram NOT configured!')
        return None, 'Telegram не настроен'
    
    try:
        files = {'photo': (filename, file_data, 'application/octet-stream')}
        data = {'chat_id': TELEGRAM_CHAT_ID}
        
        print(f'📤 Sending to Telegram API: {TELEGRAM_API}/sendPhoto')
        print(f'📤 Chat ID: {TELEGRAM_CHAT_ID}')
        
        response = requests.post(
            f'{TELEGRAM_API}/sendPhoto',
            data=data,
            files=files,
            timeout=30
        )
        
        print(f'📥 Response status: {response.status_code}')
        print(f'📥 Response text: {response.text[:500]}')
        
        result = response.json()
        if not result.get('ok'):
            error_desc = result.get('description', 'unknown')
            print(f'❌ Telegram error: {error_desc}')
            return None, f"Telegram error: {error_desc}"
        
        photo_array = result['result']['photo']
        largest_photo = photo_array[-1]
        file_id = largest_photo['file_id']
        
        print(f'✅ Upload success! file_id: {file_id}')
        return file_id, None
        
    except Exception as e:
        print(f'❌ Ошибка загрузки фото: {type(e).__name__}: {e}')
        import traceback
        traceback.print_exc()
        return None, str(e)


def upload_video(file_data, filename='video.mp4'):
    """Загружает видео в Telegram канал"""
    print(f'📤 Trying to upload video: {filename}, size={len(file_data)} bytes')
    
    if not is_configured():
        return None, 'Telegram не настроен'
    
    try:
        files = {'video': (filename, file_data, 'application/octet-stream')}
        data = {'chat_id': TELEGRAM_CHAT_ID}
        
        response = requests.post(
            f'{TELEGRAM_API}/sendVideo',
            data=data,
            files=files,
            timeout=120
        )
        
        print(f'📥 Video upload status: {response.status_code}')
        
        result = response.json()
        if not result.get('ok'):
            error_desc = result.get('description', 'unknown')
            print(f'❌ Telegram video error: {error_desc}')
            return None, f"Telegram error: {error_desc}"
        
        file_id = result['result']['video']['file_id']
        print(f'✅ Video upload success! file_id: {file_id}')
        return file_id, None
        
    except Exception as e:
        print(f'❌ Ошибка загрузки видео: {e}')
        import traceback
        traceback.print_exc()
        return None, str(e)


def upload_document(file_data, filename='file.dat'):
    """Загружает файл как документ"""
    if not is_configured():
        return None, 'Telegram не настроен'
    
    try:
        files = {'document': (filename, file_data, 'application/octet-stream')}
        data = {'chat_id': TELEGRAM_CHAT_ID}
        
        response = requests.post(
            f'{TELEGRAM_API}/sendDocument',
            data=data,
            files=files,
            timeout=60
        )
        
        result = response.json()
        if not result.get('ok'):
            return None, f"Telegram error: {result.get('description', 'unknown')}"
        
        file_id = result['result']['document']['file_id']
        return file_id, None
        
    except Exception as e:
        print(f'❌ Ошибка загрузки документа: {e}')
        return None, str(e)


def get_file_url(file_id):
    """Получает прямой URL файла по file_id"""
    if not is_configured():
        return None
    
    try:
        response = requests.get(
            f'{TELEGRAM_API}/getFile',
            params={'file_id': file_id},
            timeout=10
        )
        
        result = response.json()
        if not result.get('ok'):
            print(f'❌ getFile error: {result.get("description")}')
            return None
        
        file_path = result['result']['file_path']
        url = f'https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file_path}'
        return url
        
    except Exception as e:
        print(f'❌ Ошибка getFile: {e}')
        return None