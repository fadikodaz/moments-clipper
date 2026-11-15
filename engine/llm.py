"""One place for Groq chat calls: JSON replies, and waiting politely when the free tier says slow down."""

import json
import sys
import time

import requests

CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"


def chat_json(key: str, messages: list[dict], reasoning: str = "medium", temperature: float = 0.2) -> dict:
    for _ in range(10):
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
        if r.status_code != 200:
            sys.exit(f"Groq error {r.status_code}: {r.text[:400]}")
        return json.loads(r.json()["choices"][0]["message"]["content"])
    sys.exit("Groq kept refusing after 10 tries.")
