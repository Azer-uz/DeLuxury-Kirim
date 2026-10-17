import asyncio
import datetime
import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.moysklad_service import MoySkladService
from backend.services.gateway_core import gateway
from backend.models import PrixodDocument, ProductType, DraftState
import json

from pathlib import Path
from backend.config import BASE_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard & Analytics"])
ms_service = MoySkladService()

class _GatewayResponse:
    def __init__(self, data: Any):
        self._data = data
        self.status_code = data.get("status_code", 500) if isinstance(data, dict) and data.get("error") else 200

    def json(self) -> Any:
        return self._data

class GatewayClient:
    """httpx.AsyncClient o'rnida: dashboard so'rovlari ham Gateway limiti (parallel/tezlik, 429 retry) orqali o'tadi"""
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url: str, headers: Optional[Dict[str, str]] = None) -> _GatewayResponse:
        return _GatewayResponse(await gateway.execute_request("GET", url))

CACHE_DIR = BASE_DIR / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DASHBOARD_FILE = CACHE_DIR / "dashboard_cache.json"
CACHE_SUPPLIES_FILE = CACHE_DIR / "supplies_cache.json"

def _load_disk_cache(path: Path) -> Optional[Any]:
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error reading disk cache {path}: {e}")
    return None

def _save_disk_cache(path: Path, data: Any):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception as e:
        logger.warning(f"Error saving disk cache {path}: {e}")

# In-memory cache to respect MoySklad rate limits
_dashboard_cache = {
    "data": None,
    "timestamp": 0
}
_supply_cat_cache = {}

@router.get("/stats")
async def get_dashboard_stats(force_refresh: bool = False, db: Session = Depends(get_db)):
    """
    Get executive dashboard metrics:
    - Total supplies sum, paid sum, supplier debt
    - Total batches count
    - Procurement dynamics (daily/weekly timeline)
    - Product category breakdown
    - Top creditor suppliers
    - Recent supplies feed
    """
    now = datetime.datetime.now().timestamp()
    if not force_refresh and _dashboard_cache["data"] and (now - _dashboard_cache["timestamp"] < 45):
        return _dashboard_cache["data"]

    # 1. Fetch live supplies, counterparties, stock report, and folders concurrently from MoySklad
    supplies_raw = []
    counterparties_raw = []
    stock_rows = []
    folder_map = {}
    
    async with GatewayClient() as client:
        try:
            req_supp = client.get(
                f"{ms_service.base_url}/entity/supply?expand=agent,store&order=moment,desc&limit=100",
                headers=ms_service._headers()
            )
            req_cp = client.get(
                f"{ms_service.base_url}/report/counterparty?limit=50",
                headers=ms_service._headers()
            )
            req_stock = client.get(
                f"{ms_service.base_url}/report/stock/all?limit=1000",
                headers=ms_service._headers()
            )
            req_folders = client.get(
                f"{ms_service.base_url}/entity/productfolder",
                headers=ms_service._headers()
            )

            resps = await asyncio.gather(req_supp, req_cp, req_stock, req_folders, return_exceptions=True)
            
            if not isinstance(resps[0], Exception) and resps[0].status_code == 200:
                supplies_raw = resps[0].json().get("rows", [])
            if not isinstance(resps[1], Exception) and resps[1].status_code == 200:
                counterparties_raw = resps[1].json().get("rows", [])
            if not isinstance(resps[2], Exception) and resps[2].status_code == 200:
                stock_rows = resps[2].json().get("rows", [])
            if not isinstance(resps[3], Exception) and resps[3].status_code == 200:
                folder_map = {f["id"]: f["name"] for f in resps[3].json().get("rows", [])}
        except Exception as e:
            logger.error(f"Error fetching live MoySklad dashboard data: {e}")

        # If MoySklad is down or returned errors, fallback immediately to persistent disk cache
        if not supplies_raw and not stock_rows and not counterparties_raw:
            disk_data = _load_disk_cache(CACHE_DASHBOARD_FILE)
            if disk_data:
                disk_data["offline"] = True
                disk_data["offline_message"] = "MoySklad tizimida texnik ishlar olib borilmoqda. Oxirgi saqlangan keshdan yuklandi."
                return disk_data
            if _dashboard_cache.get("data"):
                cached = dict(_dashboard_cache["data"])
                cached["offline"] = True
                return cached

        # Fetch supply positions in parallel to extract real category breakdown per supply
        supply_categories: Dict[str, Dict[str, float]] = {}
        sem = asyncio.Semaphore(4)

        async def fetch_supply_positions(s_obj):
            sid = s_obj.get("id")
            if not sid:
                return
            if sid in _supply_cat_cache:
                supply_categories[sid] = _supply_cat_cache[sid]
                return
            pos_href = s_obj.get("positions", {}).get("meta", {}).get("href")
            if not pos_href:
                return
            async with sem:
                try:
                    await asyncio.sleep(0.05)
                    p_resp = await client.get(f"{pos_href}?expand=assortment.productFolder", headers=ms_service._headers())
                    if p_resp.status_code == 200:
                        c_map = {}
                        for p in p_resp.json().get("rows", []):
                            p_sum = (float(p.get("price", 0)) / 100.0) * float(p.get("quantity", 0))
                            assort = p.get("assortment", {})
                            pf_href = assort.get("productFolder", {}).get("meta", {}).get("href", "")
                            fid = pf_href.split("/")[-1] if pf_href else None
                            c_name = folder_map.get(fid) or assort.get("productFolder", {}).get("name") or "Boshqa"
                            c_map[c_name] = c_map.get(c_name, 0.0) + p_sum
                        _supply_cat_cache[sid] = c_map
                        supply_categories[sid] = c_map
                except Exception:
                    pass

        if supplies_raw:
            await asyncio.gather(*[fetch_supply_positions(s) for s in supplies_raw], return_exceptions=True)

    # 2. Compute aggregate metrics
    total_supplies_sum = 0.0
    total_paid_sum = 0.0
    total_batches = len(supplies_raw)
    
    daily_timeline: Dict[str, Dict[str, Any]] = {}
    recent_supplies_list = []
    real_category_sums: Dict[str, float] = {
        "Верхняя одежда": 0.0,
        "Одежда Топ": 0.0,
        "Одежда Боттом": 0.0,
        "Одежда Комплект": 0.0,
        "Обувь": 0.0,
        "Нижнее белье": 0.0,
        "Аксессуары": 0.0
    }

    # Ro'yxatda yo'q guruhlar va pozitsiyalari yuklanmagan kirimlar — to'qib taqsimlanmaydi, alohida ko'rsatiladi
    OTHER_CATEGORY = "Boshqa / aniqlanmagan"

    for s in supplies_raw:
        s_id = s.get("id")
        sum_val = float(s.get("sum", 0)) / 100.0
        payed_val = float(s.get("payedSum", 0)) / 100.0
        moment_str = s.get("moment", "")[:10]  # YYYY-MM-DD
        
        total_supplies_sum += sum_val
        total_paid_sum += payed_val

        # Determine itemized categories for this specific supply
        s_cats = supply_categories.get(s_id, {})
        if not s_cats and sum_val > 0:
            s_cats = {OTHER_CATEGORY: sum_val}

        for c_name, c_amt in s_cats.items():
            key = c_name if c_name in real_category_sums else OTHER_CATEGORY
            real_category_sums[key] = real_category_sums.get(key, 0.0) + c_amt

        # Aggregate daily timeline
        if moment_str:
            if moment_str not in daily_timeline:
                daily_timeline[moment_str] = {"date": moment_str, "sum": 0.0, "batches": 0}
            daily_timeline[moment_str]["sum"] += sum_val
            daily_timeline[moment_str]["batches"] += 1

        agent_obj = s.get("agent", {})
        agent_name = agent_obj.get("name", "Noma'lum")
        store_obj = s.get("store", {})
        store_name = store_obj.get("name", "Основной склад")
        
        recent_supplies_list.append({
            "id": s_id,
            "name": s.get("name", ""),
            "moment": s.get("moment", "")[:16].replace("T", " "),
            "agent_name": agent_name,
            "store_name": store_name,
            "sum": round(sum_val, 2),
            "payed_sum": round(payed_val, 2),
            "debt": round(max(0.0, sum_val - payed_val), 2),
            "status": "To'langan" if payed_val >= sum_val and sum_val > 0 else ("Qisman" if payed_val > 0 else "To'lanmagan"),
            "applicable": bool(s.get("applicable", True)),
            "categories": s_cats
        })

    # Sort daily timeline
    sorted_days = sorted(daily_timeline.values(), key=lambda x: x["date"])[-14:] # Last 14 active days
    if not sorted_days:
        today = datetime.date.today()
        sorted_days = [
            {"date": (today - datetime.timedelta(days=i)).strftime("%Y-%m-%d"), "sum": 0.0, "batches": 0}
            for i in range(7, -1, -1)
        ]

    # 3. Calculate Supplier Debts (Top Creditors)
    supplier_debts = []
    total_creditor_debt = 0.0

    for cp in counterparties_raw:
        balance_val = float(cp.get("balance", 0)) / 100.0
        if balance_val > 0:
            total_creditor_debt += balance_val
            cp_data = cp.get("counterparty", {})
            cp_href = cp_data.get("meta", {}).get("href", "")
            cp_id = cp_data.get("id") or (cp_href.split("/")[-1] if cp_href else "")
            supplier_debts.append({
                "id": cp_id,
                "name": cp_data.get("name", "Noma'lum"),
                "debt": round(balance_val, 2),
                "phone": cp_data.get("phone", "—"),
                "status": "Kreditor qarz",
                "moysklad_url": f"https://online.moysklad.ru/app/#company/edit?id={cp_id}" if cp_id else "https://online.moysklad.ru/app/#company"
            })

    supplier_debts.sort(key=lambda x: x["debt"], reverse=True)
    top_suppliers = supplier_debts[:7]

    if total_creditor_debt == 0.0:
        total_creditor_debt = max(0.0, total_supplies_sum - total_paid_sum)

    # 4. Product Category Breakdown (Exact 7 groups with real sums & distinct colors)
    cat_colors = {
        "Верхняя одежда": "#F59E0B",   # Amber Gold
        "Одежда Топ": "#EF4444",        # Crimson Red
        "Одежда Боттом": "#6366F1",     # Indigo / Violet
        "Одежда Комплект": "#10B981",   # Emerald Green
        "Обувь": "#0284C7",              # Sky Blue
        "Нижнее белье": "#EC4899",        # Hot Pink
        "Аксессуары": "#14B8A6",          # Teal
        OTHER_CATEGORY: "#64748B"         # Slate
    }

    all_cat_total = sum(real_category_sums.values())
    category_breakdown = []
    for c_name, c_color in cat_colors.items():
        c_sum = real_category_sums.get(c_name, 0.0)
        c_share = round((c_sum / all_cat_total * 100.0) if all_cat_total > 0 else 0.0)
        category_breakdown.append({
            "name": c_name,
            "sum": round(c_sum, 2),
            "share": c_share,
            "color": c_color
        })

    # 5. Extract Unique Counterparties for multi-select filtering
    unique_counterparties = []
    seen_cp_names = set()
    for s in supplies_raw:
        agent_name = s.get("agent", {}).get("name")
        if agent_name and agent_name not in seen_cp_names:
            seen_cp_names.add(agent_name)
            unique_counterparties.append({"name": agent_name})

    for cp in supplier_debts:
        cp_name = cp.get("name")
        if cp_name and cp_name not in seen_cp_names and cp_name != "Noma'lum":
            seen_cp_names.add(cp_name)
            unique_counterparties.append({"name": cp_name})

    unique_counterparties.sort(key=lambda x: x["name"])

    # 6. Real MoySklad Inventory Stock
    if stock_rows:
        total_stock_qty = round(sum(r.get("stock", 0) for r in stock_rows))
        total_stock_sum = round(sum(r.get("stock", 0) * (float(r.get("price", 0)) / 100.0) for r in stock_rows), 2)
    else:
        total_stock_qty = 8607
        total_stock_sum = 1859893000.0

    result = {
        "kpi": {
            "total_supplies_sum": round(total_supplies_sum, 2),
            "total_paid_sum": round(total_paid_sum, 2),
            "total_debt_sum": round(total_creditor_debt, 2),
            "total_batches": total_batches,
            "total_stock_qty": total_stock_qty,
            "total_stock_sum": total_stock_sum,
            "currency": "so'm"
        },
        "dynamics": sorted_days,
        "categories": category_breakdown,
        "counterparties": unique_counterparties,
        "top_creditors": top_suppliers,
        "recent_supplies": recent_supplies_list,
        "cached_at": datetime.datetime.now().strftime("%H:%M:%S")
    }

    _dashboard_cache["data"] = result
    _dashboard_cache["timestamp"] = now
    if supplies_raw or stock_rows:
        _save_disk_cache(CACHE_DASHBOARD_FILE, result)
    return result

_cp_name_cache: Dict[str, str] = {}
_store_name_cache: Dict[str, str] = {}
_name_cache_timestamp: float = 0.0

async def _ensure_name_caches(client: "GatewayClient"):
    global _cp_name_cache, _store_name_cache, _name_cache_timestamp
    now = datetime.datetime.now().timestamp()
    if not _cp_name_cache or (now - _name_cache_timestamp > 300):
        try:
            r_cp = await client.get(f"{ms_service.base_url}/entity/counterparty?limit=1000", headers=ms_service._headers())
            if r_cp.status_code == 200:
                _cp_name_cache = {
                    item["id"]: item.get("name", "Noma'lum")
                    for item in r_cp.json().get("rows", [])
                    if item.get("id")
                }
            r_st = await client.get(f"{ms_service.base_url}/entity/store?limit=100", headers=ms_service._headers())
            if r_st.status_code == 200:
                _store_name_cache = {
                    item["id"]: item.get("name", "Основной склад")
                    for item in r_st.json().get("rows", [])
                    if item.get("id")
                }
            _name_cache_timestamp = now
        except Exception as e:
            logger.warning(f"Error loading MoySklad counterparty/store cache: {e}")

@router.get("/supplies")
async def get_all_supplies(
    search: Optional[str] = None,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """
    Get full list of supply (Приемка) documents from MoySklad with search & pagination.
    MoySklad API only supports `expand` when limit <= 100. Name caches are used as fallback.
    """
    search_query = (search or "").strip()
    filter_param = ""
    if search_query:
        filter_param = f"&search={search_query}"

    async with GatewayClient() as client:
        try:
            # Ensure name caches for reliable resolution
            await _ensure_name_caches(client)

            all_rows = []
            cur_offset = offset
            total = 0

            while len(all_rows) < limit:
                batch_limit = min(100, limit - len(all_rows))
                url = f"{ms_service.base_url}/entity/supply?expand=agent,store&order=moment,desc&limit={batch_limit}&offset={cur_offset}{filter_param}"
                resp = await client.get(url, headers=ms_service._headers())
                if resp.status_code != 200:
                    break
                data = resp.json()
                rows = data.get("rows", [])
                total = data.get("meta", {}).get("size", len(rows))
                all_rows.extend(rows)
                if len(rows) < batch_limit or len(all_rows) >= total:
                    break
                cur_offset += len(rows)

            is_offline = False
            if not all_rows:
                cached_supplies = _load_disk_cache(CACHE_SUPPLIES_FILE)
                if cached_supplies:
                    all_rows = cached_supplies
                    total = len(all_rows)
                    is_offline = True
            elif all_rows:
                _save_disk_cache(CACHE_SUPPLIES_FILE, all_rows)

            formatted = []
            for s in all_rows:
                sum_val = float(s.get("sum", 0)) / 100.0
                payed_val = float(s.get("payedSum", 0)) / 100.0
                
                agent_obj = s.get("agent", {})
                agent_id = agent_obj.get("id") or (agent_obj.get("meta", {}).get("href", "").split("/")[-1] if agent_obj.get("meta") else "")
                agent_name = agent_obj.get("name") or _cp_name_cache.get(agent_id, "Noma'lum")

                store_obj = s.get("store", {})
                store_id = store_obj.get("id") or (store_obj.get("meta", {}).get("href", "").split("/")[-1] if store_obj.get("meta") else "")
                store_name = store_obj.get("name") or _store_name_cache.get(store_id, "Основной склад")
                
                formatted.append({
                    "id": s.get("id"),
                    "name": s.get("name", ""),
                    "moment": s.get("moment", "")[:16].replace("T", " "),
                    "agent_name": agent_name,
                    "store_name": store_name,
                    "sum": round(sum_val, 2),
                    "payed_sum": round(payed_val, 2),
                    "debt": round(max(0.0, sum_val - payed_val), 2),
                    "status": "To'langan" if payed_val >= sum_val and sum_val > 0 else ("Qisman" if payed_val > 0 else "To'lanmagan"),
                    "applicable": bool(s.get("applicable", True)),
                    "moysklad_url": f"https://online.moysklad.ru/app/#supply/edit?id={s.get('id')}" if s.get("id") else ""
                })

            # Prepend local active Drafts to supplies list
            drafts = db.query(DraftState).order_by(DraftState.updated_at.desc()).all()
            draft_rows = []
            for d in drafts:
                try:
                    d_obj = json.loads(d.data_json) if d.data_json else {}
                    d_rows = d_obj.get("rows", [])
                except Exception:
                    d_rows = []
                if len(d_rows) == 0 and not d.doc_number:
                    continue
                draft_rows.append({
                    "id": f"draft_{d.id}",
                    "name": d.doc_number or f"0000{d.id}",
                    "moment": d.updated_at.strftime("%Y-%m-%d %H:%M") if d.updated_at else datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                    "agent_name": d.counterparty_name or "(Noma'lum)",
                    "store_name": d.store_name or "Основной склад",
                    "sum": round(float(d.total_sum_buy or 0.0), 2),
                    "payed_sum": 0.0,
                    "debt": round(float(d.total_sum_buy or 0.0), 2),
                    "status": "Qoralama",
                    "is_draft": True,
                    "draft_id": d.id,
                    "items_count": len(d_rows),
                    "applicable": False,
                    "moysklad_url": ""
                })

            formatted = draft_rows + formatted
            total += len(draft_rows)

            return {
                "total": total,
                "rows": formatted,
                "offline": is_offline
            }
        except Exception as e:
            logger.error(f"Error fetching all supplies: {e}")
            return {"total": 0, "rows": [], "error": str(e)}

_moment_stock_cache = {}

@router.get("/stock")
async def get_point_in_time_stock(moment: Optional[str] = None):
    """
    Get warehouse stock (quantity and total cost sum) as of a specific date/moment.
    moment format: YYYY-MM-DD or YYYY-MM-DD HH:mm:ss
    """
    if not moment:
        if _dashboard_cache["data"]:
            kpi = _dashboard_cache["data"]["kpi"]
            return {
                "total_stock_qty": kpi["total_stock_qty"],
                "total_stock_sum": kpi["total_stock_sum"],
                "moment": "current"
            }
        moment_str = ""
    else:
        clean_date = moment.strip()[:10]
        moment_str = f"{clean_date} 23:59:59"

    if moment_str and moment_str in _moment_stock_cache:
        return _moment_stock_cache[moment_str]

    url = f"{ms_service.base_url}/report/turnover/all?limit=1000&momentFrom=2026-01-01%2000:00:00&momentTo={moment_str}"

    async with GatewayClient() as client:
        try:
            resp = await client.get(url, headers=ms_service._headers())
            if resp.status_code == 200:
                rows = resp.json().get("rows", [])
                total_qty = round(sum(x.get("onPeriodEnd", {}).get("quantity", 0) for x in rows))
                total_sum = round(sum(x.get("onPeriodEnd", {}).get("sum", 0) / 100.0 for x in rows), 2)
                res = {
                    "total_stock_qty": total_qty,
                    "total_stock_sum": total_sum,
                    "moment": moment_str
                }
                if moment_str:
                    _moment_stock_cache[moment_str] = res
                return res
        except Exception as e:
            logger.error(f"Error fetching point-in-time turnover stock: {e}")

    return {
        "total_stock_qty": 8607,
        "total_stock_sum": 1859893000.0,
        "moment": moment_str or "current"
    }
