import httpx
from lib.encryption import decrypt


async def call_ai(
    provider: dict,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 2048,
    json_mode: bool = False,
) -> str:
    """Call the AI provider and return the text response.

    json_mode=True tells each provider to return strict JSON where supported,
    which eliminates markdown fences, prose preambles, and other junk.
    """
    api_key = decrypt(provider["encryptedApiKey"])
    p = provider["provider"]
    model = model or provider["defaultModel"]

    if p in ("openai", "openrouter", "ollama"):
        return await _openai_compat(provider["baseUrl"], api_key, model, messages, max_tokens, json_mode)
    elif p == "anthropic":
        return await _anthropic(api_key, model, messages, max_tokens, json_mode)
    elif p == "gemini":
        return await _gemini(api_key, model, messages, max_tokens, json_mode)
    else:
        raise ValueError(f"Unknown provider type: {p}")


async def call_ai_vision(
    provider: dict,
    text_prompt: str,
    images: list[dict],  # [{"data": "base64string", "mime_type": "image/jpeg"}]
    model: str | None = None,
    max_tokens: int = 2048,
) -> str:
    """Call the AI provider with a text prompt and one or more images."""
    api_key = decrypt(provider["encryptedApiKey"])
    p = provider["provider"]
    model = model or provider["defaultModel"]

    if p in ("openai", "openrouter", "ollama"):
        return await _openai_vision(provider["baseUrl"], api_key, model, text_prompt, images, max_tokens)
    elif p == "anthropic":
        return await _anthropic_vision(api_key, model, text_prompt, images, max_tokens)
    elif p == "gemini":
        return await _gemini_vision(api_key, model, text_prompt, images, max_tokens)
    else:
        raise ValueError(f"Unknown provider type: {p}")


# ── Text-only helpers ─────────────────────────────────────────────────────────

async def _openai_compat(
    base_url: str, api_key: str, model: str, messages: list, max_tokens: int,
    json_mode: bool = False,
) -> str:
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload: dict = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.3}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, json=payload, headers=headers)
        if not r.is_success:
            raise httpx.HTTPStatusError(
                f"Client error '{r.status_code}' — {r.text}",
                request=r.request, response=r,
            )
        return r.json()["choices"][0]["message"]["content"]


async def _anthropic(
    api_key: str, model: str, messages: list, max_tokens: int,
    json_mode: bool = False,
) -> str:
    system = None
    user_msgs = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            user_msgs.append(m)

    if json_mode:
        # Anthropic has no native json_mode. Enforce it via:
        # 1. A system instruction demanding pure JSON output.
        # 2. Assistant pre-fill with "{" so the model must continue in JSON.
        json_instruction = "Respond with valid JSON only. No markdown fences, no prose outside the JSON."
        system = (system + "\n\n" + json_instruction) if system else json_instruction
        user_msgs = user_msgs + [{"role": "assistant", "content": "{"}]

    payload: dict = {"model": model, "max_tokens": max_tokens, "messages": user_msgs}
    if system:
        payload["system"] = system

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
        if not r.is_success:
            raise httpx.HTTPStatusError(
                f"Client error '{r.status_code}' — {r.text}",
                request=r.request, response=r,
            )
        text = r.json()["content"][0]["text"]
        # When using assistant prefill the response is the continuation after "{".
        return ("{" + text) if json_mode else text


async def _gemini(
    api_key: str, model: str, messages: list, max_tokens: int,
    json_mode: bool = False,
) -> str:
    contents = []
    system_text = None
    for m in messages:
        if m["role"] == "system":
            system_text = m["content"]
        elif m["role"] == "user":
            contents.append({"role": "user", "parts": [{"text": m["content"]}]})
        elif m["role"] == "assistant":
            contents.append({"role": "model", "parts": [{"text": m["content"]}]})

    gen_config: dict = {"maxOutputTokens": max_tokens, "temperature": 0.3}
    if json_mode:
        gen_config["responseMimeType"] = "application/json"

    payload: dict = {"contents": contents, "generationConfig": gen_config}
    if system_text:
        payload["systemInstruction"] = {"parts": [{"text": system_text}]}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, json=payload, params={"key": api_key})
        if not r.is_success:
            raise httpx.HTTPStatusError(
                f"Client error '{r.status_code}' — {r.text}",
                request=r.request, response=r,
            )
        return r.json()["candidates"][0]["content"]["parts"][0]["text"]


# ── Vision helpers ────────────────────────────────────────────────────────────

async def _openai_vision(
    base_url: str, api_key: str, model: str,
    text_prompt: str, images: list[dict], max_tokens: int,
) -> str:
    url = f"{base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    content: list = [{"type": "text", "text": text_prompt}]
    for img in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{img['mime_type']};base64,{img['data']}"},
        })

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": max_tokens,
        "temperature": 0.1,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(url, json=payload, headers=headers)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


async def _anthropic_vision(
    api_key: str, model: str,
    text_prompt: str, images: list[dict], max_tokens: int,
) -> str:
    content: list = []
    for img in images:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": img["mime_type"], "data": img["data"]},
        })
    content.append({"type": "text", "text": text_prompt})

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": content}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
        r.raise_for_status()
        return r.json()["content"][0]["text"]


async def _gemini_vision(
    api_key: str, model: str,
    text_prompt: str, images: list[dict], max_tokens: int,
) -> str:
    parts: list = [{"text": text_prompt}]
    for img in images:
        parts.append({"inlineData": {"mimeType": img["mime_type"], "data": img["data"]}})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.1},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(url, json=payload, params={"key": api_key})
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"]
