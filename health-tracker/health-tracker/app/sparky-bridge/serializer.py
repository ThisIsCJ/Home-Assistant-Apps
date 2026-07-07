"""Convert MongoDB documents to JSON-serialisable dicts (same conventions as the HT API)."""
from bson import ObjectId
from datetime import datetime


def to_dict(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    out = {}
    for k, v in doc.items():
        key = "id" if k == "_id" else k
        if isinstance(v, ObjectId):
            out[key] = str(v)
        elif isinstance(v, datetime):
            out[key] = v.isoformat() + "Z"
        elif isinstance(v, list):
            out[key] = [to_dict(i) if isinstance(i, dict) else i for i in v]
        elif isinstance(v, dict):
            out[key] = to_dict(v)
        else:
            out[key] = v
    return out
