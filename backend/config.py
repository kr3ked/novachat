import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'novachat-super-secret-key-2024')
    
    # Получаем URL базы данных
    database_url = os.environ.get('DATABASE_URL', 'sqlite:///novachat.db')
    
    # PostgreSQL на Render использует postgres://, но SQLAlchemy требует postgresql://
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql://', 1)
    
    SQLALCHEMY_DATABASE_URI = database_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }
    
    # Токен живёт 30 дней (продлевается автоматически при активности)
    JWT_EXPIRATION_HOURS = 24 * 30
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    UPLOAD_FOLDER = '/tmp/uploads'