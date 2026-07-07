import base64
import hashlib
from cryptography.fernet import Fernet
from config import get_settings


def _make_fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(get_settings().secret_key.encode()).digest())
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    return _make_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _make_fernet().decrypt(ciphertext.encode()).decode()
