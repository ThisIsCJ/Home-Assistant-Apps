import base64
import json
import re
import traceback
from datetime import datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from auth.middleware import require_auth
from database import get_app_db, get_user_db
from lib.ai_client import call_ai, call_ai_vision
from lib.audit import log_action
from lib.encryption import encrypt
from lib.serializer import doc_to_dict

router = APIRouter()

DISCLAIMER = (
    "This information is for personal tracking only and is NOT medical advice. "
    "Always consult a qualified clinician or pharmacist before making any changes "
    "to your medications."
)

PROVIDER_TYPES = ["openai", "anthropic", "gemini", "openrouter", "ollama"]

DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "anthropic": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com",
    "ollama": "http://localhost:11434/v1",
}


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProviderCreate(BaseModel):
    provider: str
    displayName: str
    baseUrl: Optional[str] = None
    defaultModel: str
    apiKey: str
    enabled: bool = True


class ProviderUpdate(BaseModel):
    displayName: Optional[str] = None
    baseUrl: Optional[str] = None
    defaultModel: Optional[str] = None
    apiKey: Optional[str] = None
    enabled: Optional[bool] = None


class MedInteractionRequest(BaseModel):
    providerId: Optional[str] = None


class FoodAnalysisRequest(BaseModel):
    description: str
    providerId: Optional[str] = None


class HealthReportRequest(BaseModel):
    providerId: Optional[str] = None
    days: int = 7


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_key(doc: dict) -> dict:
    d = {**doc}
    d.pop("encryptedApiKey", None)
    d["hasKey"] = True
    return d


def _clean_json(raw: str) -> str:
    """Extract JSON from an AI response, handling fences, preambles, and BOM."""
    raw = raw.strip().lstrip('﻿')

    # Strip markdown code fences (```json\n...\n``` or ```\n...\n```)
    if raw.startswith("```"):
        raw = re.sub(r'^```[a-zA-Z]*\s*\n?', '', raw)
        raw = re.sub(r'\n?```\s*$', '', raw)
        raw = raw.strip()

    # If it starts cleanly with { or [, return as-is
    if raw.startswith(('{', '[')):
        return raw

    # Extract the first complete JSON object or array from surrounding prose.
    # Use a simple brace-depth scan so nested braces are handled correctly.
    for open_ch, close_ch in [('{', '}'), ('[', ']')]:
        start = raw.find(open_ch)
        if start == -1:
            continue
        depth = 0
        in_str = False
        esc = False
        for i, ch in enumerate(raw[start:], start):
            if esc:
                esc = False
                continue
            if ch == '\\' and in_str:
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
            elif not in_str:
                if ch == open_ch:
                    depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        return raw[start:i + 1]

    return raw  # return as-is; let json.loads raise a clear error


async def _resolve_provider(user_id: str, provider_id: str | None) -> dict:
    """Find the AI provider to use: explicit ID, user default, or first enabled."""
    user_db = get_user_db(user_id)
    app_db = get_app_db()

    if provider_id:
        doc = await user_db.ai_providers.find_one(
            {"_id": ObjectId(provider_id), "userId": user_id, "enabled": True, "deletedAt": None}
        )
        if not doc:
            raise HTTPException(404, "AI provider not found")
        return doc

    user = await app_db.users.find_one({"_id": ObjectId(user_id)})
    default_id = user.get("preferences", {}).get("defaultAiProviderId") if user else None
    if default_id:
        doc = await user_db.ai_providers.find_one(
            {"_id": ObjectId(default_id), "userId": user_id, "enabled": True, "deletedAt": None}
        )
        if doc:
            return doc

    doc = await user_db.ai_providers.find_one(
        {"userId": user_id, "enabled": True, "deletedAt": None},
        sort=[("createdAt", 1)],
    )
    if not doc:
        raise HTTPException(400, "No AI provider configured. Add one in Settings → AI Providers.")
    return doc


# ── Provider CRUD ─────────────────────────────────────────────────────────────

@router.get("/providers")
async def list_providers(user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    docs = await db.ai_providers.find(
        {"userId": user_id, "deletedAt": None}
    ).sort("createdAt", 1).to_list(50)
    return [doc_to_dict(_strip_key(d)) for d in docs]


@router.post("/providers", status_code=201)
async def create_provider(body: ProviderCreate, user: dict = Depends(require_auth)):
    if body.provider not in PROVIDER_TYPES:
        raise HTTPException(400, f"provider must be one of: {', '.join(PROVIDER_TYPES)}")
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    now = datetime.utcnow()
    base_url = body.baseUrl or DEFAULT_BASE_URLS.get(body.provider, "")
    doc = {
        "userId": user_id,
        "provider": body.provider,
        "displayName": body.displayName,
        "baseUrl": base_url,
        "defaultModel": body.defaultModel,
        "encryptedApiKey": encrypt(body.apiKey),
        "enabled": body.enabled,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await db.ai_providers.insert_one(doc)
    doc["_id"] = result.inserted_id
    await log_action(
        user_id, "ai_provider.created", "ai_provider", str(result.inserted_id),
        after=_strip_key(doc_to_dict(doc)),
    )
    return doc_to_dict(_strip_key(doc))


@router.put("/providers/{provider_id}")
async def update_provider(
    provider_id: str, body: ProviderUpdate, user: dict = Depends(require_auth)
):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    existing = await db.ai_providers.find_one(
        {"_id": ObjectId(provider_id), "userId": user_id, "deletedAt": None}
    )
    if not existing:
        raise HTTPException(404, "Provider not found")

    update: dict = {"updatedAt": datetime.utcnow()}
    if body.displayName is not None:
        update["displayName"] = body.displayName
    if body.baseUrl is not None:
        update["baseUrl"] = body.baseUrl
    if body.defaultModel is not None:
        update["defaultModel"] = body.defaultModel
    if body.enabled is not None:
        update["enabled"] = body.enabled
    if body.apiKey is not None:
        update["encryptedApiKey"] = encrypt(body.apiKey)

    result = await db.ai_providers.find_one_and_update(
        {"_id": ObjectId(provider_id)}, {"$set": update}, return_document=True
    )
    await log_action(
        user_id, "ai_provider.updated", "ai_provider", provider_id,
        before=_strip_key(doc_to_dict(existing)), after=_strip_key(doc_to_dict(result)),
    )
    return doc_to_dict(_strip_key(result))


@router.delete("/providers/{provider_id}", status_code=204)
async def delete_provider(provider_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    result = await db.ai_providers.find_one_and_update(
        {"_id": ObjectId(provider_id), "userId": user_id, "deletedAt": None},
        {"$set": {"deletedAt": datetime.utcnow(), "enabled": False}},
    )
    if not result:
        raise HTTPException(404, "Provider not found")
    await log_action(user_id, "ai_provider.deleted", "ai_provider", provider_id)


@router.post("/providers/{provider_id}/test")
async def test_provider(provider_id: str, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    db = get_user_db(user_id)
    provider = await db.ai_providers.find_one(
        {"_id": ObjectId(provider_id), "userId": user_id, "deletedAt": None}
    )
    if not provider:
        raise HTTPException(404, "Provider not found")

    try:
        response = await call_ai(
            provider,
            [{"role": "user", "content": 'Reply with exactly the JSON: {"ok": true}'}],
            max_tokens=20,
        )
        return {"success": True, "response": response.strip()}
    except Exception as e:
        msg = re.sub(r"for url '.*?'", "", str(e)).strip()
        return {"success": False, "error": msg or "Connection failed"}


# ── AI Tasks ──────────────────────────────────────────────────────────────────

@router.post("/tasks/medication-interactions")
async def medication_interactions(
    body: MedInteractionRequest, user: dict = Depends(require_auth)
):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)

    meds = await user_db.medications.find(
        {"userId": user_id, "active": True, "deletedAt": None}
    ).to_list(200)
    if not meds:
        return {
            "checkedAt": datetime.utcnow().isoformat() + "Z",
            "medications": [],
            "possibleInteractions": [],
            "questionsForClinician": [],
            "summary": "No active medications found.",
            "disclaimer": DISCLAIMER,
            "source": "none",
        }

    med_names = [m["name"] + (f" {m['dose']}" if m.get("dose") else "") for m in meds]
    provider = await _resolve_provider(user_id, body.providerId)

    prompt = f"""You are a pharmacy information assistant. Help the user understand potential interactions between their medications for personal awareness.

Medications: {', '.join(med_names)}

Return ONLY valid JSON with no markdown fences or extra text:
{{
  "possibleInteractions": [
    {{
      "medications": ["medication name 1", "medication name 2"],
      "severity": "low|moderate|high",
      "explanation": "brief description of the interaction"
    }}
  ],
  "questionsForClinician": ["question 1", "question 2"],
  "summary": "brief overview under 120 words",
  "confidence": 0.0
}}

Rules:
- Never diagnose disease or tell the user to change medications
- Never claim combinations are definitively safe
- Include 2–4 practical questions for their clinician
- confidence: 0.0–1.0 reflecting how confident you are in the interaction data"""

    try:
        raw = await call_ai(provider, [{"role": "user", "content": prompt}], max_tokens=1024, json_mode=True)
        result = json.loads(_clean_json(raw))
    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        print(f"[ai] medication-interactions JSON parse error: {e}\nRaw response:\n{raw!r}")
        raise HTTPException(500, "The AI returned an unreadable response. Try a different model or provider.")
    except Exception as e:
        raise HTTPException(500, f"AI request failed: {e}")

    await log_action(user_id, "ai.medication_interactions", "ai_task", None)

    return {
        "checkedAt": datetime.utcnow().isoformat() + "Z",
        "medications": med_names,
        "possibleInteractions": result.get("possibleInteractions", []),
        "questionsForClinician": result.get("questionsForClinician", []),
        "summary": result.get("summary", ""),
        "confidence": result.get("confidence", 0),
        "disclaimer": DISCLAIMER,
        "source": "ai",
        "provider": provider["provider"],
        "model": provider["defaultModel"],
    }


@router.post("/tasks/food-analysis")
async def food_analysis(body: FoodAnalysisRequest, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    provider = await _resolve_provider(user_id, body.providerId)

    prompt = f"""Estimate the nutritional content for this food item or meal description.

Food: "{body.description}"

Return ONLY valid JSON with no markdown fences or extra text:
{{
  "name": "display name",
  "servingSize": "human-readable serving size",
  "servingSizeG": 0,
  "calories": 0,
  "proteinG": 0.0,
  "carbsG": 0.0,
  "fatG": 0.0,
  "fiberG": 0.0,
  "sugarG": 0.0,
  "sodiumMg": 0.0,
  "confidence": 0.0,
  "notes": "any caveats about the estimate"
}}

All numeric values must be numbers. confidence: 0.0–1.0 based on how specific the description is."""

    try:
        raw = await call_ai(provider, [{"role": "user", "content": prompt}], max_tokens=512, json_mode=True)
        result = json.loads(_clean_json(raw))
    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        print(f"[ai] food-analysis JSON parse error: {e}\nRaw response:\n{raw!r}")
        raise HTTPException(500, "AI returned unparseable JSON. Please try again.")
    except Exception as e:
        raise HTTPException(500, f"AI request failed: {e}")

    result["aiGenerated"] = True
    result["provider"] = provider["provider"]
    result["model"] = provider["defaultModel"]
    return result


@router.post("/tasks/health-report")
async def health_report(body: HealthReportRequest, user: dict = Depends(require_auth)):
    user_id = str(user["_id"])
    user_db = get_user_db(user_id)
    provider = await _resolve_provider(user_id, body.providerId)

    cutoff = datetime.utcnow() - timedelta(days=body.days)

    food_logs = await user_db.food_logs.find(
        {"userId": user_id, "deletedAt": None, "loggedAt": {"$gte": cutoff}}
    ).to_list(500)
    health_readings = await user_db.health_readings.find(
        {"userId": user_id, "deletedAt": None, "takenAt": {"$gte": cutoff}}
    ).to_list(200)
    meds = await user_db.medications.find(
        {"userId": user_id, "active": True, "deletedAt": None}
    ).to_list(100)
    workout_sessions = await user_db.workout_sessions.find(
        {"userId": user_id, "deletedAt": None, "startedAt": {"$gte": cutoff}}
    ).to_list(100)

    nutrition_by_day: dict = {}
    for log in food_logs:
        day = str(log.get("loggedAt", ""))[:10]
        if day not in nutrition_by_day:
            nutrition_by_day[day] = {"calories": 0, "proteinG": 0, "carbsG": 0, "fatG": 0}
        n = log.get("nutritionSnapshot", {})
        nutrition_by_day[day]["calories"] += n.get("calories", 0)
        nutrition_by_day[day]["proteinG"] += n.get("proteinG", 0)
        nutrition_by_day[day]["carbsG"] += n.get("carbsG", 0)
        nutrition_by_day[day]["fatG"] += n.get("fatG", 0)

    data_summary = {
        "period_days": body.days,
        "nutrition_days_logged": len(nutrition_by_day),
        "avg_daily_calories": (
            round(sum(v["calories"] for v in nutrition_by_day.values()) / len(nutrition_by_day))
            if nutrition_by_day else None
        ),
        "health_readings_count": len(health_readings),
        "active_medications": [m["name"] for m in meds],
        "workout_sessions_count": len(workout_sessions),
    }

    prompt = f"""Generate a brief, encouraging health summary based on the user's tracking data for the past {body.days} days.

Data summary:
{json.dumps(data_summary, indent=2)}

Write a friendly 150–250 word plain-text summary covering:
1. Nutrition (if food was logged)
2. Activity (if workouts were logged)
3. One or two practical suggestions

Rules:
- Never give medical advice or diagnose
- Be encouraging and focus on patterns
- If data is sparse, briefly acknowledge it"""

    try:
        report = await call_ai(provider, [{"role": "user", "content": prompt}], max_tokens=512)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI request failed: {e}")

    await log_action(user_id, "ai.health_report", "ai_task", None)

    return {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "periodDays": body.days,
        "report": report.strip(),
        "provider": provider["provider"],
        "model": provider["defaultModel"],
        "disclaimer": "This summary is based on your personal tracking data and is not medical advice.",
    }


@router.post("/tasks/medication-photo")
async def medication_from_photo(
    images: list[UploadFile] = File(...),
    provider_id: Optional[str] = Form(None),
    user: dict = Depends(require_auth),
):
    """Analyse one or more medication label photos and extract structured details."""
    if not images:
        raise HTTPException(400, "At least one image is required")
    if len(images) > 4:
        raise HTTPException(400, "Maximum 4 images allowed")

    user_id = str(user["_id"])
    provider = await _resolve_provider(user_id, provider_id)

    encoded: list[dict] = []
    for img in images:
        data = await img.read()
        mime = img.content_type or "image/jpeg"
        if not mime.startswith("image/"):
            raise HTTPException(400, f"File '{img.filename}' is not an image")
        encoded.append({"data": base64.b64encode(data).decode(), "mime_type": mime})

    prompt = """Analyse this prescription medication label or medication packaging. Extract every piece of information that is visible.

Return ONLY valid JSON with no markdown fences or extra text:
{
  "name": "medication brand or trade name",
  "genericName": "generic or active ingredient name",
  "dose": "strength e.g. 10 mg or 500 mg/5 mL",
  "form": "tablet|capsule|liquid|injection|patch|other",
  "route": "oral|topical|injection|inhaled|other",
  "frequency": "human-readable e.g. Once daily or Twice daily",
  "prescriber": "prescriber name if on label",
  "pharmacy": "pharmacy name if on label",
  "reason": "indication or condition if on label",
  "warnings": ["warning text from label"],
  "refillInfo": "refill count and date if visible",
  "notes": "any other useful information from the label",
  "confidence": 0.0
}

Rules:
- Use null for any field not visible on the label — never guess or invent
- confidence: 0.0–1.0 based on label clarity and how much you could read
- Convert medical shorthand: QD → Once daily, BID → Twice daily, TID → Three times daily, QID → Four times daily, PRN → As needed
- If multiple photos are provided, combine information from all of them"""

    try:
        raw = await call_ai_vision(provider, prompt, encoded, max_tokens=1024)
        result = json.loads(_clean_json(raw))
    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        print(f"[ai] medication-photo JSON parse error: {e}\nRaw response:\n{raw!r}")
        raise HTTPException(500, "AI returned unparseable data. Please try again or use a clearer photo.")
    except Exception as e:
        traceback.print_exc()
        msg = re.sub(r"for url '.*?'", "", str(e)).strip()
        raise HTTPException(500, f"AI analysis failed: {msg or 'please try again'}")

    await log_action(user_id, "ai.medication_photo", "ai_task", None)

    result["aiGenerated"] = True
    result["provider"] = provider["provider"]
    result["model"] = provider["defaultModel"]
    return result
