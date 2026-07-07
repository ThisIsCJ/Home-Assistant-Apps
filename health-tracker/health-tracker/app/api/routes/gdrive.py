"""
Google Drive integration endpoints.

Each user stores their own OAuth2 client credentials (client_id + client_secret)
encrypted in their gdrive_config document. Setup flow per user:

  1. User creates an OAuth 2.0 Client ID at Google Console and enters the
     credentials in Settings → Google Drive Sync.
  2. User clicks "Connect" → GET /api/gdrive/auth-url → redirects to Google.
  3. Google redirects → GET /api/gdrive/callback → stores tokens → /settings?gdrive=connected
  4. User picks folders via GET /api/gdrive/folders, saves via PUT /api/gdrive/config.
  5. Background task (gdrive_sync_loop) runs syncs on each user's schedule.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from auth.middleware import require_auth
from config import get_settings
from database import get_app_db, get_user_db
from lib.encryption import encrypt, decrypt
from lib.gdrive_sync import (
    SCOPES, _AUTH_URI, _TOKEN_URI,
    get_drive_service, list_drive_folders,
    make_oauth_state, verify_oauth_state,
    sync_user,
)
from lib.serializer import doc_to_dict

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Pydantic models ────────────────────────────────────────────────────────────

class GDriveCredentials(BaseModel):
    clientId: str
    clientSecret: str


class FolderMapping(BaseModel):
    folderId: str
    folderName: str
    enabled: bool = True


class GDriveConfig(BaseModel):
    folderMappings: list[FolderMapping] = []
    syncIntervalHours: int = 6


# ── Credentials ────────────────────────────────────────────────────────────────

@router.put('/credentials')
async def save_credentials(body: GDriveCredentials, user: dict = Depends(require_auth)):
    """Store the user's own Google OAuth client credentials, encrypted."""
    if not body.clientId.strip() or not body.clientSecret.strip():
        raise HTTPException(400, 'Client ID and Client Secret are required')

    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    now = datetime.utcnow()

    await user_db.gdrive_config.update_one(
        {'_id': 'gdrive_config'},
        {
            '$set': {
                'encryptedClientId': encrypt(body.clientId.strip()),
                'encryptedClientSecret': encrypt(body.clientSecret.strip()),
                'updatedAt': now,
            },
            '$setOnInsert': {
                'userId': user_id,
                'folderMappings': [],
                'syncIntervalHours': 6,
                'lastSyncAt': None,
                'nextSyncAt': None,
                'connectedAt': None,
                'createdAt': now,
            },
        },
        upsert=True,
    )
    return {'ok': True}


@router.delete('/credentials', status_code=204)
async def delete_credentials(user: dict = Depends(require_auth)):
    """Remove all Drive config including credentials and tokens."""
    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    app_db = get_app_db()
    await user_db.gdrive_config.delete_one({'_id': 'gdrive_config'})
    await app_db.gdrive_sync_registry.delete_one({'_id': user_id})


# ── Status ─────────────────────────────────────────────────────────────────────

@router.get('/status')
async def get_gdrive_status(user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    config = await user_db.gdrive_config.find_one({'_id': 'gdrive_config'})

    has_credentials = bool(
        config
        and config.get('encryptedClientId')
        and config.get('encryptedClientSecret')
    )
    is_connected = bool(config and config.get('encryptedRefreshToken'))

    settings = get_settings()
    redirect_uri = f"{settings.app_base_url.rstrip('/')}/api/gdrive/callback"

    result = {
        'hasCredentials': has_credentials,
        'connected': is_connected,
        'redirectUri': redirect_uri,
    }

    if has_credentials:
        # Return a masked client ID so the UI can show what's saved
        raw_id = decrypt(config['encryptedClientId'])
        result['maskedClientId'] = raw_id[:20] + '…' if len(raw_id) > 20 else raw_id

    if is_connected:
        result['connectedAt'] = config.get('connectedAt')
        result['lastSyncAt'] = config.get('lastSyncAt')
        result['nextSyncAt'] = config.get('nextSyncAt')
        result['syncIntervalHours'] = config.get('syncIntervalHours', 6)
        result['folderCount'] = len([f for f in config.get('folderMappings', []) if f.get('enabled')])
        result['syncStatus'] = config.get('syncStatus', 'ok')
        result['lastError'] = config.get('lastError')
        result['lastErrorAt'] = config.get('lastErrorAt')

    return result


# ── OAuth flow ─────────────────────────────────────────────────────────────────

@router.get('/auth-url')
async def get_auth_url(user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    config = await user_db.gdrive_config.find_one({'_id': 'gdrive_config'})

    if not config or not config.get('encryptedClientId'):
        raise HTTPException(400, 'Enter your Google OAuth credentials first.')

    client_id = decrypt(config['encryptedClientId'])
    settings = get_settings()
    redirect_uri = f"{settings.app_base_url.rstrip('/')}/api/gdrive/callback"
    state = make_oauth_state(user_id)

    params = urlencode({
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': ' '.join(SCOPES),
        'access_type': 'offline',
        'prompt': 'consent',
        'state': state,
    })
    return {'url': f"{_AUTH_URI}?{params}"}


@router.get('/callback')
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    error: Optional[str] = Query(None),
):
    """Google redirects here. No auth header — user identity is in the signed state param."""
    if error:
        return RedirectResponse(url=f'/settings?gdrive=error&reason={error}')

    user_id = verify_oauth_state(state)
    if not user_id:
        return RedirectResponse(url='/settings?gdrive=error&reason=invalid_state')

    user_db = get_user_db(user_id)
    config = await user_db.gdrive_config.find_one({'_id': 'gdrive_config'})

    if not config or not config.get('encryptedClientId') or not config.get('encryptedClientSecret'):
        return RedirectResponse(url='/settings?gdrive=error&reason=no_credentials')

    client_id = decrypt(config['encryptedClientId'])
    client_secret = decrypt(config['encryptedClientSecret'])
    settings = get_settings()
    redirect_uri = f"{settings.app_base_url.rstrip('/')}/api/gdrive/callback"

    async with httpx.AsyncClient() as client:
        resp = await client.post(_TOKEN_URI, data={
            'code': code,
            'client_id': client_id,
            'client_secret': client_secret,
            'redirect_uri': redirect_uri,
            'grant_type': 'authorization_code',
        })

    if resp.status_code != 200:
        logger.error("GDrive token exchange failed: %s", resp.text)
        return RedirectResponse(url='/settings?gdrive=error&reason=token_exchange')

    token_data = resp.json()
    refresh_token = token_data.get('refresh_token')
    access_token = token_data.get('access_token')

    if not refresh_token:
        return RedirectResponse(url='/settings?gdrive=error&reason=no_refresh_token')

    now = datetime.utcnow()
    await user_db.gdrive_config.update_one(
        {'_id': 'gdrive_config'},
        {'$set': {
            'encryptedAccessToken': encrypt(access_token),
            'encryptedRefreshToken': encrypt(refresh_token),
            'connectedAt': now,
            'updatedAt': now,
            'syncStatus': 'ok',
            'lastError': None,
            'lastErrorAt': None,
        }, '$unset': {'tokenExpiry': ''}},
    )

    # Resume scheduled syncing if folders were already configured (a dead grant
    # removes the registry entry; reconnecting must restore it).
    if any(f.get('enabled') for f in config.get('folderMappings', [])):
        await get_app_db().gdrive_sync_registry.update_one(
            {'_id': user_id},
            {'$set': {
                'nextSyncAt': now,
                'syncIntervalHours': config.get('syncIntervalHours', 6),
            }},
            upsert=True,
        )

    return RedirectResponse(url='/settings?gdrive=connected')


# ── Disconnect (OAuth tokens only — keeps credentials) ────────────────────────

@router.delete('/disconnect', status_code=204)
async def disconnect(user: dict = Depends(require_auth)):
    """Remove OAuth tokens but keep the client credentials so reconnecting is easy."""
    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    app_db = get_app_db()
    await user_db.gdrive_config.update_one(
        {'_id': 'gdrive_config'},
        {'$unset': {
            'encryptedAccessToken': '',
            'encryptedRefreshToken': '',
            'connectedAt': '',
            'lastSyncAt': '',
            'nextSyncAt': '',
        }},
    )
    await app_db.gdrive_sync_registry.delete_one({'_id': user_id})


# ── Folders ────────────────────────────────────────────────────────────────────

@router.get('/folders')
async def get_folders(user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    try:
        folders = await list_drive_folders(user_id)
    except Exception as e:
        raise HTTPException(502, f'Failed to list Drive folders: {e}')
    return {'folders': folders}


# ── Sync config ────────────────────────────────────────────────────────────────

@router.get('/config')
async def get_config(user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    config = await user_db.gdrive_config.find_one({'_id': 'gdrive_config'})
    if not config:
        return {'folderMappings': [], 'syncIntervalHours': 6}
    return {
        'folderMappings': config.get('folderMappings', []),
        'syncIntervalHours': config.get('syncIntervalHours', 6),
    }


@router.put('/config')
async def save_config(body: GDriveConfig, user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    app_db = get_app_db()

    config = await user_db.gdrive_config.find_one({'_id': 'gdrive_config'})
    if not config:
        raise HTTPException(400, 'Not connected to Google Drive')

    now = datetime.utcnow()
    next_sync = now + timedelta(hours=body.syncIntervalHours)

    await user_db.gdrive_config.update_one(
        {'_id': 'gdrive_config'},
        {'$set': {
            'folderMappings': [m.model_dump() for m in body.folderMappings],
            'syncIntervalHours': body.syncIntervalHours,
            'nextSyncAt': next_sync,
            'updatedAt': now,
        }},
    )

    await app_db.gdrive_sync_registry.update_one(
        {'_id': user_id},
        {'$set': {'nextSyncAt': next_sync, 'syncIntervalHours': body.syncIntervalHours}},
        upsert=True,
    )

    return {'ok': True, 'nextSyncAt': next_sync.isoformat()}


# ── Manual sync ────────────────────────────────────────────────────────────────

@router.post('/sync')
async def trigger_sync(user: dict = Depends(require_auth)):
    user_id = str(user['_id'])
    try:
        result = await sync_user(user_id)
    except Exception as e:
        raise HTTPException(502, f'Sync failed: {e}')
    if 'error' in result:
        raise HTTPException(400, result['error'])
    return result


# ── Sync history ───────────────────────────────────────────────────────────────

@router.get('/sync-history')
async def get_sync_history(
    limit: int = Query(20, le=100),
    user: dict = Depends(require_auth),
):
    user_id = str(user['_id'])
    user_db = get_user_db(user_id)
    docs = await user_db.gdrive_sync_log.find(
        {'userId': user_id}
    ).sort('startedAt', -1).limit(limit).to_list(limit)
    return [doc_to_dict(d) for d in docs]
