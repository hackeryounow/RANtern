"""
NF component catalog API routes.

The NF building-block catalog (kind, image, interfaces, runtime metadata,
config-field schema) is persisted in PostgreSQL (``nf_components``), seeded
from the built-in catalog at startup. These endpoints expose it for
inspection and user-defined components. When PostgreSQL is unavailable the
registry transparently falls back to the static built-in catalog.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api import db
from coresimrunner import nf_registry

router = APIRouter()


class ComponentPayload(BaseModel):
    kind: str
    label: Optional[str] = None
    category: str = "network"
    cores: List[str] = Field(default_factory=list)
    runtime: Dict[str, Any] = Field(default_factory=dict)
    interfaces: List[str] = Field(default_factory=list)
    config_fields: Optional[List[Dict[str, Any]]] = None
    description: str = ""


class ComponentUpdate(BaseModel):
    label: Optional[str] = None
    category: Optional[str] = None
    cores: Optional[List[str]] = None
    runtime: Optional[Dict[str, Any]] = None
    interfaces: Optional[List[str]] = None
    config_fields: Optional[List[Dict[str, Any]]] = None
    description: Optional[str] = None


@router.get("/nf-components")
async def list_components(core: Optional[str] = None):
    """All NF components (DB-backed; falls back to the built-in catalog)."""
    return {
        "components": nf_registry.list_nf_kinds(core),
        "categories": nf_registry.categories(),
    }


@router.get("/nf-components/{component_id}")
async def get_component(component_id: str):
    comp = db.get_nf_component_by_id(component_id)
    if not comp:
        raise HTTPException(status_code=404, detail="Component not found")
    return {"component": comp}


@router.post("/nf-components")
async def create_component(payload: ComponentPayload):
    """Register a user-defined NF component (persisted in PostgreSQL)."""
    if not payload.kind.strip():
        raise HTTPException(status_code=400, detail="kind is required")
    if not payload.cores:
        raise HTTPException(status_code=400, detail="cores must list at least one core type")
    comp = db.create_nf_component(payload.model_dump(exclude_none=True))
    if not comp:
        raise HTTPException(
            status_code=500,
            detail="Failed to persist component (is PostgreSQL available? A component "
                   "with this kind/cores pair may already exist)",
        )
    return {"status": "created", "component": comp}


@router.put("/nf-components/{component_id}")
async def update_component(component_id: str, payload: ComponentUpdate):
    comp = db.update_nf_component(component_id, payload.model_dump(exclude_none=True))
    if not comp:
        raise HTTPException(status_code=404, detail="Component not found")
    return {"status": "updated", "component": comp}


@router.delete("/nf-components/{component_id}")
async def delete_component(component_id: str):
    if not db.delete_nf_component(component_id):
        raise HTTPException(status_code=404, detail="Component not found")
    return {"status": "deleted", "id": component_id}
