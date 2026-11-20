"""
One place for AI chat calls that answer in JSON.

  - smart_json(): Claude (Anthropic) when ANTHROPIC_API_KEY is set in engine/.env, for the step that
    decides what is worth posting. If Claude fails or is not set up, Groq answers instead.
  - chat_json(): Groq (free tier), for quick jobs like caption clean-up, and as the backup.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import requests

CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"
CLAUDE_URL = "https://api.anthropic.com/v1/messages"
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")


def chat_json(key: str, messages: list[dict], reasoning: str = "medium", temperature: float = 0.2) -> dict:
    bad_json = 0
    for _ in range(12):
        r = requests.post(
            CHAT_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={"model": MODEL, "temperature": temperature, "reasoning_effort": reasoning,
                  "response_format": {"type": "json_object"}, "messages": messages},
            timeout=180,
        )
        if r.status_code == 429:
            wait = float(r.headers.get("retry-after", 15))
            print(f"    free-tier limit, waiting {wait:.0f} s")
            time.sleep(wait + 1)
            continue
        if r.status_code >= 500:
            time.sleep(5)
            continue
        if r.status_code == 400 and "json_validate_failed" in r.text:
            # The model sometimes produces empty or broken JSON; asking again usually works.
            bad_json += 1
            if bad_json >= 3:
                print("    AI gave no usable answer 3 times; skipping this part", flush=True)
                return {}
            time.sleep(2)
            continue
        if r.status_code != 200:
            sys.exit(f"Groq error {r.status_code}: {r.text[:400]}")
        return json.loads(r.json()["choices"][0]["message"]["content"])
    sys.exit("Groq kept refusing after 10 tries.")


def claude_key() -> str:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        env = Path(__file__).with_name(".env")
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("ANTHROPIC_API_KEY="):
                    os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip().strip('"')
    return os.environ.get("ANTHROPIC_API_KEY", "")


def claude_json(messages: list[dict], max_tokens: int = 6000) -> dict | None:
    """Claude's answer parsed as JSON, or None if Claude is not set up or keeps failing."""
    key = claude_key()
    if not key:
        return None
    system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
    chat = [m for m in messages if m["role"] != "system"]
    system += "\n\nAnswer with the JSON object only: no text before or after it, no code fences."
    for attempt in range(4):
        try:
            r = requests.post(CLAUDE_URL, timeout=240,
                              headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                              json={"model": CLAUDE_MODEL, "max_tokens": max_tokens, "system": system, "messages": chat})
        except requests.RequestException as e:
            print(f"    Claude unreachable ({e.__class__.__name__}), retrying", flush=True)
            time.sleep(5 * (attempt + 1))
            continue
        if r.status_code in (429, 529) or r.status_code >= 500:
            wait = float(r.headers.get("retry-after", 10 * (attempt + 1)))
            print(f"    Claude busy ({r.status_code}), waiting {wait:.0f} s", flush=True)
            time.sleep(min(wait, 60) + 1)
            continue
        if r.status_code != 200:
            print(f"    Claude error {r.status_code}: {r.text[:200]}", flush=True)
            return None
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        m = re.search(r"\{.*\}", text, re.S)
        try:
            return json.loads(m.group(0)) if m else None
        except json.JSONDecodeError:
            print("    Claude answer was not valid JSON, asking again", flush=True)
    return None


def smart_json(groq_key: str, messages: list[dict]) -> dict:
    """Claude first (better at judging what is funny and writing titles); Groq if that fails."""
    res = claude_json(messages)
    if res is not None:
        return res
    if claude_key():
        print("    Claude failed for this part; Groq answers instead", flush=True)
    return chat_json(groq_key, messages)


def using_claude() -> bool:
    return bool(claude_key())
