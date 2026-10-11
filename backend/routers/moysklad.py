from fastapi import APIRouter
from typing import Dict, Any, List
from backend.services.moysklad_service import MoySkladService

router = APIRouter(prefix="/api/moysklad", tags=["MoySklad Integration"])
ms_service = MoySkladService()

@router.get("/status")
async def check_status():
    """Check connection to MoySklad API."""
    return await ms_service.test_connection()

@router.get("/stores")
async def get_stores():
    """Get list of warehouses/stores from MoySklad."""
    stores = await ms_service.get_stores()
    return [
        {
            "id": s.get("id"),
            "name": s.get("name"),
            "address": s.get("address", ""),
            "archived": s.get("archived", False)
        }
        for s in stores if not s.get("archived")
    ]

@router.get("/counterparties")
async def get_counterparties():
    """Get list of suppliers/counterparties from MoySklad."""
    counterparties = await ms_service.get_counterparties()
    return [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "phone": c.get("phone", ""),
            "email": c.get("email", "")
        }
        for c in counterparties if not c.get("archived")
    ]

@router.post("/counterparties")
async def create_counterparty_endpoint(data: Dict[str, Any]):
    """Create a new supplier/counterparty in MoySklad."""
    name = (data.get("name") or "").strip()
    if not name:
        return {"status": "error", "message": "Kontragent nomi bo'sh bo'lishi mumkin emas"}
    phone = data.get("phone")
    desc = data.get("description")
    tag = data.get("tag") or data.get("group")
    return await ms_service.create_counterparty(name=name, phone=phone, description=desc, tag=tag)

@router.get("/next-doc-number")
async def get_next_doc_number_endpoint():
    """Get the next 5-digit document number matching MoySklad sequence (e.g. 00035)."""
    next_num = await ms_service.get_next_supply_number()
    return {"next_number": next_num}

@router.get("/organizations")
async def get_organizations():
    """Get list of legal entities/organizations from MoySklad."""
    orgs = await ms_service.get_organizations()
    return [
        {
            "id": o.get("id"),
            "name": o.get("name")
        }
        for o in orgs if not o.get("archived")
    ]
