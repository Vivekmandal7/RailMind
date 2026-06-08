"""LLM provider abstraction with graceful degradation.

Wraps Anthropic / OpenAI / AWS Bedrock behind one ``complete()`` call. Uses
``httpx`` directly (already a dependency) so no heavy SDKs are required. If no
API key is configured for a provider it is simply reported as unavailable and
callers fall back to rule-based behaviour — the app always runs.

Environment:
    OPENAI_API_KEY              -> OpenAI provider
    OPENAI_MODEL                (default: gpt-4o-mini)
    ANTHROPIC_API_KEY           -> Anthropic provider
    ANTHROPIC_MODEL             (default: claude-3-5-sonnet-20241022)
    AWS_BEDROCK_MODEL + AWS creds (via boto3, optional) -> Bedrock provider
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional

try:  # httpx is a base dependency, but stay defensive
    import httpx
except Exception:  # pragma: no cover
    httpx = None  # type: ignore


@dataclass(frozen=True)
class Provider:
    key: str          # stable id: "openai" | "anthropic" | "bedrock"
    label: str        # human label for the UI
    model: str
    available: bool


def _openai_model() -> str:
    return os.environ.get("OPENAI_MODEL", "gpt-4o-mini")


def _anthropic_model() -> str:
    return os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")


def _bedrock_model() -> str:
    return os.environ.get("AWS_BEDROCK_MODEL", "anthropic.claude-3-5-sonnet-20240620-v1:0")


def providers() -> list[Provider]:
    """All providers the engine knows about, with live availability."""
    out = [
        Provider("anthropic", "Claude", _anthropic_model(),
                 bool(os.environ.get("ANTHROPIC_API_KEY")) and httpx is not None),
        Provider("openai", "GPT", _openai_model(),
                 bool(os.environ.get("OPENAI_API_KEY")) and httpx is not None),
    ]
    if os.environ.get("AWS_BEDROCK_MODEL") and (
        os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE")
    ):
        out.append(Provider("bedrock", "Bedrock", _bedrock_model(), True))
    return out


def available_providers() -> list[Provider]:
    return [p for p in providers() if p.available]


def any_available() -> bool:
    return len(available_providers()) > 0


# --------------------------------------------------------------------------- #
def complete(
    provider: Provider,
    system: str,
    user: str,
    *,
    timeout: float = 8.0,
    max_tokens: int = 512,
    temperature: float = 0.0,
) -> Optional[str]:
    """Return the model's text, or None on any failure (caller falls back)."""
    if not provider.available or httpx is None:
        return None
    try:
        if provider.key == "openai":
            return _openai(provider, system, user, timeout, max_tokens, temperature)
        if provider.key == "anthropic":
            return _anthropic(provider, system, user, timeout, max_tokens, temperature)
        if provider.key == "bedrock":
            return _bedrock(provider, system, user, timeout, max_tokens, temperature)
    except Exception:
        return None
    return None


def complete_json(provider: Provider, system: str, user: str, **kw) -> Optional[dict]:
    """Convenience: ask for JSON and parse the first JSON object in the reply."""
    txt = complete(provider, system, user, **kw)
    if not txt:
        return None
    return _extract_json(txt)


# ---- provider implementations -------------------------------------------- #
def _openai(p, system, user, timeout, max_tokens, temperature) -> Optional[str]:
    key = os.environ["OPENAI_API_KEY"]
    r = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": p.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
        timeout=timeout,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _anthropic(p, system, user, timeout, max_tokens, temperature) -> Optional[str]:
    key = os.environ["ANTHROPIC_API_KEY"]
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": p.model,
            "system": system,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": user}],
        },
        timeout=timeout,
    )
    r.raise_for_status()
    parts = r.json().get("content", [])
    return "".join(b.get("text", "") for b in parts) or None


def _bedrock(p, system, user, timeout, max_tokens, temperature) -> Optional[str]:
    try:
        import boto3  # type: ignore
    except Exception:
        return None
    client = boto3.client("bedrock-runtime")
    body = {
        "anthropic_version": "bedrock-2023-31",
        "system": system,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": [{"type": "text", "text": user}]}],
    }
    resp = client.invoke_model(modelId=p.model, body=json.dumps(body))
    payload = json.loads(resp["body"].read())
    parts = payload.get("content", [])
    return "".join(b.get("text", "") for b in parts) or None


def _extract_json(txt: str) -> Optional[dict]:
    txt = txt.strip()
    if txt.startswith("```"):
        txt = txt.strip("`")
        if txt.lower().startswith("json"):
            txt = txt[4:]
    start = txt.find("{")
    end = txt.rfind("}")
    if start < 0 or end < 0:
        return None
    try:
        return json.loads(txt[start : end + 1])
    except Exception:
        return None
