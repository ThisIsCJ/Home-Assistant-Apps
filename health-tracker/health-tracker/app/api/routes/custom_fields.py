from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
import re
from auth.middleware import require_auth
from database import get_user_db
from lib.serializer import doc_to_dict

router = APIRouter()

VALID_ENTITIES = {"food", "medication"}
VALID_FIELD_TYPES = {"text", "number", "dropdown", "boolean"}

SECTION_LABELS = {
    "food":       {"nutrition": "Nutrition", "general": "General"},
    "medication": {"general": "General", "details": "Details"},
}


class CustomFieldCreate(BaseModel):
    entity: str           # food | medication
    section: str          # nutrition | general | details
    name: str
    fieldType: str        # text | number | dropdown | boolean
    unit: Optional[str] = None
    options: Optional[List[str]] = None  # for dropdown
    required: bool = False


class CustomFieldUpdate(BaseModel):
    name: Optional[str] = None
    section: Optional[str] = None
    unit: Optional[str] = None
    options: Optional[List[str]] = None
    required: Optional[bool] = None


def _make_key(name: str) -> str:
    key = re.sub(r"[^a-z0-9_]", "", name.lower().replace(" ", "_"))
    return key or f"field_{int(datetime.utcnow().timestamp())}"


@router.get("")
async def list_custom_fields(
    entity: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    query: dict = {"userId": user_id, "deletedAt": None}
    if entity:
        query["entity"] = entity
    fields = await db.custom_fields.find(query).sort("createdAt", 1).to_list(200)
    return [doc_to_dict(f) for f in fields]


@router.post("", status_code=201)
async def create_custom_field(body: CustomFieldCreate, user: dict = Depends(require_auth)):
    if body.entity not in VALID_ENTITIES:
        raise HTTPException(400, f"entity must be one of: {', '.join(VALID_ENTITIES)}")
    if body.fieldType not in VALID_FIELD_TYPES:
        raise HTTPException(400, f"fieldType must be one of: {', '.join(VALID_FIELD_TYPES)}")
    if not body.name.strip():
        raise HTTPException(400, "name is required")

    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    doc = {
        "userId": user_id,
        "entity": body.entity,
        "section": body.section,
        "name": body.name.strip(),
        "fieldKey": _make_key(body.name),
        "fieldType": body.fieldType,
        "unit": body.unit or None,
        "options": body.options or [],
        "required": body.required,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await db.custom_fields.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc_to_dict(doc)


@router.put("/{field_id}")
async def update_custom_field(field_id: str, body: CustomFieldUpdate, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    if not ObjectId.is_valid(field_id):
        raise HTTPException(404, "Field not found")
    existing = await db.custom_fields.find_one({"_id": ObjectId(field_id), "userId": user_id, "deletedAt": None})
    if not existing:
        raise HTTPException(404, "Field not found")

    upd: dict = {"updatedAt": datetime.utcnow()}
    if body.name is not None:
        upd["name"] = body.name.strip()
        upd["fieldKey"] = _make_key(body.name)
    if body.section is not None:
        upd["section"] = body.section
    if body.unit is not None:
        upd["unit"] = body.unit or None
    if body.options is not None:
        upd["options"] = body.options
    if body.required is not None:
        upd["required"] = body.required

    await db.custom_fields.update_one({"_id": ObjectId(field_id), "userId": user_id, "deletedAt": None}, {"$set": upd})
    doc = await db.custom_fields.find_one({"_id": ObjectId(field_id), "userId": user_id, "deletedAt": None})
    return doc_to_dict(doc)


@router.delete("/{field_id}", status_code=204)
async def delete_custom_field(field_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    if not ObjectId.is_valid(field_id):
        raise HTTPException(404, "Field not found")
    result = await db.custom_fields.update_one(
        {"_id": ObjectId(field_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow()}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Field not found")
