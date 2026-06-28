import os

class Config:
    SECRET_KEY = 'novachat-super-secret-key-2024'
    SQLALCHEMY_DATABASE_URI = 'sqlite:///novachat.db'
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_EXPIRATION_HOURS = 72
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    UPLOAD_FOLDER = 'uploads'