"""
Config API routes — read/update active profile configuration.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict, Optional

router = APIRouter()


@router.get("/config")
async def get_config():
    """Read current active profile values."""
    from coresimrunner.config_loader import ConfigLoader
    config = ConfigLoader()
    return {
        "profile": config.get_active_profile(),
        "values": config.get_all_config(),
    }


class ConfigUpdate(BaseModel):
    values: Dict[str, str]
    profile: Optional[str] = None


@router.put("/config")
async def update_config(req: ConfigUpdate):
    """Update current active profile values."""
    from coresimrunner.config_loader import ConfigLoader
    config = ConfigLoader(profile_name=req.profile)
    config.update_config(req.values)
    return {"status": "updated", "profile": config.get_active_profile()}


@router.get("/config/networks")
async def get_network_configs():
    """List available core network types."""
    return {
        "networks": [
            {"id": "free5gc", "name": "Free5GC", "default_port": 5000},
            {"id": "open5gs", "name": "Open5GS", "default_port": 9999},
        ]
    }
