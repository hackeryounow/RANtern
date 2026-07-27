"""
Docs API — serve markdown documentation files.

Documentation lives in per-language subdirectories (``docs/zh`` and
``docs/en``), each with its own ``index.json`` and ``<doc_id>.md`` files.
Both endpoints take a ``lang`` query parameter and transparently fall back to
the other language when a file is missing, so partially-translated docs still
render instead of returning an error.
"""

import json
import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse

router = APIRouter()

# docs/ directory at project root
_DOCS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "docs",
)

_SUPPORTED_LANGS = ("zh", "en")
_DEFAULT_LANG = "zh"


def _resolve(lang: str, filename: str) -> str:
    """Validate ``lang`` and return an existing file path under ``docs/<lang>/``.

    Falls back to the other supported language when the requested file is
    absent. Raises 400 for an unsupported language and 404 when no language
    has the file.
    """
    if lang not in _SUPPORTED_LANGS:
        raise HTTPException(status_code=400, detail=f"Unsupported lang '{lang}'")
    ordered = [lang] + [l for l in _SUPPORTED_LANGS if l != lang]
    for candidate in ordered:
        path = os.path.join(_DOCS_DIR, candidate, filename)
        if os.path.isfile(path):
            return path
    raise HTTPException(status_code=404, detail=f"Doc '{filename}' not found")


@router.get("/docs/index")
async def docs_index(lang: str = Query(_DEFAULT_LANG)):
    """Return the documentation table of contents for ``lang``."""
    path = _resolve(lang, "index.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.get("/docs/{doc_id}", response_class=PlainTextResponse)
async def docs_content(doc_id: str, lang: str = Query(_DEFAULT_LANG)):
    """Return the markdown content for a given doc id and language."""
    # Prevent path traversal
    if "/" in doc_id or "\\" in doc_id or ".." in doc_id:
        raise HTTPException(status_code=400, detail="Invalid doc id")
    path = _resolve(lang, f"{doc_id}.md")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()
