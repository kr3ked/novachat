"""
Модуль для работы с Telegram как файловым хранилищем
"""
import os
import requests
from io import BytesIO

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
TELEGRAM_API = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}'


def is_configured():
    """Проверяет настроен ли Telegram"""
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


def upload_photo(file_data, filename='photo.jpg'):
    """
    Загружает фото в Telegram канал
    Возвращает file_id и file_path для постоянного доступа
    """
    if not is_configured():
        return None, 'Telegram не настроен'
    
    try:
        files = {'photo': (filename, file_data, 'application/octet-stream')}
        data = {'chat_id': TELEGRAM_CHAT_ID}
        
        response = requests.post(
            f'{TELEGRAM_API}/sendPhoto',
            data=data,
            files=files,
            timeout=30
        )
        
        result = response.json()
        if not result.get('ok'):
            return None, f"Telegram error: {result.get('description', 'unknown')}"
        
        # Берём наибольшее качество (последний элемент массива photo)
        photo_array = result['result']['photo']
        largest_photo = photo_array[-1]
        file_id = largest_photo['file_id']
        
        return file_id, None
        
    except Exception as e:
        print(f'❌ Ошибка загрузки фото в Telegram: {e}')
        return None, str(e)


def upload_video(file_data, filename='video.mp4'):
    """
    Загружает видео в Telegram канал
    """
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
        
        result = response.json()
        if not result.get('ok'):
            return None, f"Telegram error: {result.get('description', 'unknown')}"
        
        file_id = result['result']['video']['file_id']
        return file_id, None
        
    except Exception as e:
        print(f'❌ Ошибка загрузки видео в Telegram: {e}')
        return None, str(e)


def upload_document(file_data, filename='file.dat'):
    """
    Загружает любой файл как документ (если не фото/видео)
    """
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
    """
    Получает прямой URL файла по file_id
    Возвращает ссылку на файл в Telegram CDN
    """
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
            return None
        
        file_path = result['result']['file_path']
        url = f'https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file_path}'
        return url
        
    except Exception as e:
        print(f'❌ Ошибка получения URL: {e}')
        return None