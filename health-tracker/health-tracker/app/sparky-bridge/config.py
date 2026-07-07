from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # MongoDB — same connection string and database name as the Health Tracker API
    mongodb_url: str = "mongodb://localhost:27017"
    db_name: str = "healthtracker"  # base name: <db_name>_app + <db_name>_u_<user_id>

    # Session-login mode only: email/password Sparky will accept at sign-in,
    # and the ht_ token returned as the session token.
    # Not needed when using API-key mode (paste your ht_ token directly into Sparky).
    bridge_email:    str = "admin@example.com"
    bridge_password: str = "changeme"
    ht_api_token:    str = ""   # returned at session sign-in

    # Default daily goals shown in the Sparky app
    goal_calories:  int = 2000
    goal_protein_g: int = 150
    goal_carbs_g:   int = 225
    goal_fat_g:     int = 65
    goal_water_ml:  int = 2500
    goal_steps:     int = 10000

    # Comma-separated metric keys the bridge must NOT write (e.g. "steps").
    # Used when another pipeline (Health Sync → Drive CSVs) is the authoritative
    # source for a metric and Sparky's Health Connect numbers would clobber it.
    ignored_metrics: str = ""

    @property
    def ignored_metric_keys(self) -> set[str]:
        return {k.strip() for k in self.ignored_metrics.split(",") if k.strip()}

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
