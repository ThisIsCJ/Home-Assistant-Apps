import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from auth.middleware import require_auth
from config import get_settings
from database import get_app_db
from lib.audit import log_action
from lib.serializer import doc_to_dict

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_EXT_MAP = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}

router = APIRouter()


class ProfileUpdate(BaseModel):
    displayName: Optional[str] = None
    avatarUrl: Optional[str] = None
    preferences: Optional[dict] = None


@router.get("/me")
async def get_me(user: dict = Depends(require_auth)):
    return doc_to_dict(user)


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    content_type = file.content_type or ""
    if content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(415, "Unsupported image type. Use JPEG, PNG, WebP, or GIF.")

    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Avatar must be under 5 MB.")

    settings = get_settings()
    avatar_dir = os.path.join(settings.upload_dir, "avatars")
    os.makedirs(avatar_dir, exist_ok=True)

    user_id = str(user["_id"])
    ext = _EXT_MAP.get(content_type, ".jpg")
    filename = f"{user_id}{ext}"

    # Remove any previous avatar files with different extensions
    for old_ext in _EXT_MAP.values():
        old_path = os.path.join(avatar_dir, f"{user_id}{old_ext}")
        if old_ext != ext and os.path.exists(old_path):
            os.remove(old_path)

    with open(os.path.join(avatar_dir, filename), "wb") as f:
        f.write(data)

    avatar_url = f"/api/avatars/{filename}"
    db = get_app_db()
    result = await db.users.find_one_and_update(
        {"_id": user["_id"]},
        {"$set": {"avatarUrl": avatar_url, "updatedAt": datetime.utcnow()}},
        return_document=True,
    )
    await log_action(user_id, "user.avatar_uploaded", "user", user_id)
    return {"avatarUrl": avatar_url, "user": doc_to_dict(result)}


@router.put("/me")
async def update_me(body: ProfileUpdate, user: dict = Depends(require_auth)):
    db = get_app_db()
    update: dict = {"updatedAt": datetime.utcnow()}
    if body.displayName is not None:
        update["displayName"] = body.displayName
    if body.avatarUrl is not None:
        update["avatarUrl"] = body.avatarUrl
    if body.preferences is not None:
        for k, v in body.preferences.items():
            update[f"preferences.{k}"] = v

    before = doc_to_dict(user)
    result = await db.users.find_one_and_update(
        {"_id": user["_id"]},
        {"$set": update},
        return_document=True,
    )
    await log_action(
        str(user["_id"]), "user.updated", "user",
        str(user["_id"]), before=before, after=doc_to_dict(result)
    )
    return doc_to_dict(result)
