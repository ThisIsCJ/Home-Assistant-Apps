from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    mongodb_url: str = "mongodb://mongo:27017"
    db_name: str = "healthtracker"  # base name: <db_name>_app + <db_name>_u_<user_id>
    auth_method: str = "home_assistant"  # home_assistant | oidc
    ha_url: str = ""            # HA URL the user's browser can reach (login redirect)
    ha_internal_url: str = ""   # HA URL reachable from this container; falls back to ha_url
    session_ttl_days: int = 30
    oidc_authority: str = ""
    oidc_client_id: str = ""
    oidc_audience: str = ""
    secret_key: str = "dev-secret"
    environment: str = "production"
    redis_url: str = "redis://redis:6379"
    upload_dir: str = "/data/uploads"
    config_dir: str = "/data/config"
    usda_api_key: str = ""
    cors_origins: str = ""
    app_base_url: str = "http://localhost"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
