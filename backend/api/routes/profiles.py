"""
Profile API routes — manage named config profiles and JSON templates.
"""

import os
import shutil
import json
from typing import Dict
from fastapi import APIRouter
from pydantic import BaseModel
from loguru import logger

router = APIRouter()

_PROFILES_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "profiles"
)
os.makedirs(_PROFILES_DIR, exist_ok=True)

_TEMPLATES_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "config"
)


class ProfileCreate(BaseModel):
    name: str
    values: Dict[str, str] = {}


class ProfileUpdate(BaseModel):
    values: Dict[str, str]


@router.get("/profiles")
async def list_profiles():
    """List all saved profiles."""
    from coresimrunner.config_loader import ConfigLoader
    config = ConfigLoader()
    active = config.get_active_profile()
    profiles = config.list_profiles()
    return {
        "profiles": [
            {"name": p, "active": p == active} for p in profiles
        ],
        "active": active,
    }


@router.get("/profiles/{name}")
async def get_profile(name: str):
    """Get a specific profile's config."""
    path = os.path.join(_PROFILES_DIR, f"{name}.env")
    if not os.path.exists(path):
        return {"error": f"Profile '{name}' not found"}

    from coresimrunner.config_loader import ConfigLoader
    config = ConfigLoader(profile_name=name)
    return {"name": name, "values": config.get_all_config()}


@router.post("/profiles")
async def create_profile(req: ProfileCreate):
    """Create a new profile."""
    path = os.path.join(_PROFILES_DIR, f"{req.name}.env")
    if os.path.exists(path):
        return {"error": f"Profile '{req.name}' already exists"}

    # Write config values
    with open(path, "w") as f:
        f.write(f"# CoreSimRunner Profile: {req.name}\n\n")
        for key, value in req.values.items():
            f.write(f"{key}={value}\n")

    logger.info(f"Profile created: {req.name}")
    return {"status": "created", "name": req.name}


@router.put("/profiles/{name}")
async def update_profile(name: str, req: ProfileUpdate):
    """Update an existing profile."""
    path = os.path.join(_PROFILES_DIR, f"{name}.env")
    if not os.path.exists(path):
        return {"error": f"Profile '{name}' not found"}

    from coresimrunner.config_loader import ConfigLoader
    config = ConfigLoader(profile_name=name)
    config.update_config(req.values)

    logger.info(f"Profile updated: {name}")
    return {"status": "updated", "name": name}


@router.delete("/profiles/{name}")
async def delete_profile(name: str):
    """Delete a profile."""
    if name == "default":
        return {"error": "Cannot delete the default profile"}

    path = os.path.join(_PROFILES_DIR, f"{name}.env")
    if not os.path.exists(path):
        return {"error": f"Profile '{name}' not found"}

    os.remove(path)
    logger.info(f"Profile deleted: {name}")
    return {"status": "deleted", "name": name}


@router.post("/profiles/{name}/activate")
async def activate_profile(name: str):
    """Set a profile as active."""
    path = os.path.join(_PROFILES_DIR, f"{name}.env")
    if not os.path.exists(path):
        return {"error": f"Profile '{name}' not found"}

    from coresimrunner.config_loader import ConfigLoader
    config = ConfigLoader()
    config.set_active_profile(name)

    logger.info(f"Profile activated: {name}")
    return {"status": "activated", "name": name}


# ─── JSON Template endpoints ──────────────────────────────────────────────────

class TemplateUpdate(BaseModel):
    content: str


@router.get("/templates")
async def list_templates():
    """List all JSON template files."""
    if not os.path.isdir(_TEMPLATES_DIR):
        return {"templates": []}
    templates = [
        {"name": f, "size": os.path.getsize(os.path.join(_TEMPLATES_DIR, f))}
        for f in sorted(os.listdir(_TEMPLATES_DIR))
        if f.endswith(".json")
    ]
    return {"templates": templates}


@router.get("/templates/{name}")
async def get_template(name: str):
    """Get raw JSON content of a template file."""
    path = os.path.join(_TEMPLATES_DIR, name)
    if not os.path.exists(path):
        return {"error": f"Template '{name}' not found"}
    with open(path, "r") as f:
        content = f.read()
    return {"name": name, "content": content}


@router.put("/templates/{name}")
async def update_template(name: str, req: TemplateUpdate):
    """Save updated JSON content to a template file."""
    # Validate it's valid JSON
    try:
        json.loads(req.content)
    except json.JSONDecodeError as e:
        return {"error": f"Invalid JSON: {e}"}

    path = os.path.join(_TEMPLATES_DIR, name)
    if not os.path.exists(path):
        return {"error": f"Template '{name}' not found"}
    with open(path, "w") as f:
        f.write(req.content)
    logger.info(f"Template updated: {name}")
    return {"status": "updated", "name": name}
