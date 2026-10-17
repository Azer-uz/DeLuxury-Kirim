import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
import pytz
from fastapi import APIRouter, Query, BackgroundTasks, Request
from backend.services.gateway_core import gateway
from backend.config import get_settings

router = APIRouter(prefix="/api/gateway", tags=["MoySklad Gateway & Bot Sync"])
settings = get_settings()
tz = pytz.timezone(settings.timezone)

def to_msk_filter_str(uz_dt_str: str) -> str:
    """Toshkent (UTC+5) vaqtini MoySklad (Moskva UTC+3, -2 soat) vaqtiga o'tkazish"""
    if not uz_dt_str:
        return ""
    try:
        clean = uz_dt_str.split(".")[0].strip()
        if len(clean) == 10:
            clean += " 00:00:00"
        dt = datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")
        return (dt - timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return uz_dt_str

def to_tashkent_dt(moment_str: str) -> Optional[datetime]:
    """MoySklad (Moskva UTC+3) momentini Toshkent (UTC+5, +2 soat) ga o'tkazish"""
    if not moment_str:
        return None
    try:
        clean = moment_str.split(".")[0].strip()
        dt = datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")
        return dt + timedelta(hours=2)
    except Exception:
        return None

@router.get("/health")
async def gateway_health():
    """Health status, rate limit budget and cached keys."""
    return {
        "status": "online",
        "rate_limit_remaining": gateway.rate_limit_remaining,
        "cached_entries": len(gateway._cache),
        "gateway_time": datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")
    }

# ================= 1. SOATLIK VA KUNLIK SAVDO =================
@router.get("/sales/hourly")
async def get_hourly_sales(target_date: Optional[str] = Query(None, description="Format: YYYY-MM-DD")):
    """
    Soatlik va umumiy kunlik savdoni hisoblash (Kesh bilan tezkor javob, Toshkent vaqti +2 soat sinxron).
    """
    now = datetime.now(tz)
    if not target_date:
        date_str = now.strftime("%Y-%m-%d")
        is_today = True
    else:
        date_str = target_date
        is_today = (date_str == now.strftime("%Y-%m-%d"))

    cache_key = f"hourly_sales_{date_str}"
    # Agar bugungi kun bo'lsa 60 soniya kesh, o'tgan kun bo'lsa 1 soat kesh
    ttl = 60 if is_today else 3600
    cached = gateway.get_cached(cache_key, ttl_seconds=ttl)
    if cached:
        return cached

    start_msk = to_msk_filter_str(f"{date_str} 00:00:00")
    end_msk = to_msk_filter_str(f"{date_str} 23:59:59")
    filter_str = f"moment>={start_msk};moment<={end_msk};applicable=true"

    rd_task = gateway.execute_request("GET", "entity/retaildemand", params={"filter": filter_str, "limit": 1000})
    dem_task = gateway.execute_request("GET", "entity/demand", params={"filter": filter_str, "limit": 1000})

    rd_data, dem_data = await asyncio.gather(rd_task, dem_task)

    all_sales = []
    if isinstance(rd_data, dict) and "rows" in rd_data:
        all_sales.extend(rd_data["rows"])
    if isinstance(dem_data, dict) and "rows" in dem_data:
        all_sales.extend(dem_data["rows"])

    # 0..23 — ish vaqtidan tashqaridagi savdo ham soatlar kesimida ko'rinsin (jami summaga teng bo'lsin)
    hourly_data = {hour: {"count": 0, "sum": 0.0} for hour in range(24)}
    total_sum = 0.0
    total_count = len(all_sales)

    for sale in all_sales:
        moment_str = sale.get("moment", "")
        sale_sum = (sale.get("sum", 0) or 0) / 100.0
        total_sum += sale_sum

        if moment_str:
            try:
                dt_uz = to_tashkent_dt(moment_str)
                if dt_uz:
                    hour = dt_uz.hour
                    if hour in hourly_data:
                        hourly_data[hour]["count"] += 1
                        hourly_data[hour]["sum"] += sale_sum
            except Exception:
                pass

    avg_check = (total_sum / total_count) if total_count > 0 else 0.0

    result = {
        "date": datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y"),
        "current_hour": now.hour,
        "total_sum": total_sum,
        "total_count": total_count,
        "avg_check": avg_check,
        "hourly": hourly_data
    }

    gateway.set_cache(cache_key, result)
    return result

# ================= 2. PRIYOMKA / SUPPLY =================
@router.get("/supplies")
async def get_supplies(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    agent_id: Optional[str] = None
):
    """Priyomka (kirim) hujjatlari ro'yxati."""
    cache_key = f"supplies_{date_from}_{date_to}_{agent_id}"
    cached = gateway.get_cached(cache_key, ttl_seconds=60)
    if cached:
        return cached

    params = {"limit": 100, "expand": "agent,positions.assortment", "order": "moment,desc"}
    filters = []
    if date_from:
        filters.append(f"moment>={to_msk_filter_str(f'{date_from} 00:00:00')}")
    if date_to:
        filters.append(f"moment<={to_msk_filter_str(f'{date_to} 23:59:59')}")
    if agent_id:
        filters.append(f"agent=https://api.moysklad.ru/api/remap/1.2/entity/counterparty/{agent_id}")

    if filters:
        params["filter"] = ";".join(filters)

    data = await gateway.execute_request("GET", "entity/supply", params=params)
    
    supplies_list = []
    total_sum = 0.0
    by_agent = {}

    if isinstance(data, dict) and "rows" in data:
        for row in data["rows"]:
            s_sum = (row.get("sum", 0) or 0) / 100.0
            total_sum += s_sum
            agent_name = row.get("agent", {}).get("name", "Noma'lum")
            pos_meta_size = row.get("positions", {}).get("meta", {}).get("size", 0)

            if agent_name not in by_agent:
                by_agent[agent_name] = {"count": 0, "sum": 0.0}
            by_agent[agent_name]["count"] += 1
            by_agent[agent_name]["sum"] += s_sum

            moment_raw = row.get("moment", "")
            moment_fmt = ""
            if moment_raw:
                try:
                    dt_uz = to_tashkent_dt(moment_raw)
                    moment_fmt = dt_uz.strftime("%d.%m.%Y %H:%M") if dt_uz else moment_raw[:16]
                except Exception:
                    moment_fmt = moment_raw[:16]

            supplies_list.append({
                "id": row.get("id"),
                "name": row.get("name"),
                "moment": moment_fmt,
                "agent": agent_name,
                "sum": s_sum,
                "positions_count": pos_meta_size
            })

    result = {
        "total_count": len(supplies_list),
        "total_sum": total_sum,
        "by_agent": by_agent,
        "rows": supplies_list
    }
    gateway.set_cache(cache_key, result)
    return result

# ================= 3. TOVAR QOLDIQLARI (OSTATKI) =================
@router.get("/stock/report")
async def get_stock_report(folder_id: Optional[str] = None):
    """Barcha tovarlar qoldig'i va tannarxi (Kesh bilan tezkor)."""
    cache_key = f"stock_report_{folder_id}"
    cached = gateway.get_cached(cache_key, ttl_seconds=120)
    if cached:
        return cached

    params = {"limit": 1000}
    if folder_id:
        params["productFolder"] = f"https://api.moysklad.ru/api/remap/1.2/entity/productfolder/{folder_id}"

    stock_task = gateway.execute_request("GET", "report/stock/all", params=params)
    prod_task = gateway.execute_request("GET", "entity/product", params={"limit": 1000, "expand": "productFolder,attributes"})
    
    stock_data, prod_data = await asyncio.gather(stock_task, prod_task)

    prod_map = {}
    if isinstance(prod_data, dict) and "rows" in prod_data:
        for p in prod_data["rows"]:
            attrs = {}
            for a in p.get("attributes", []):
                val = a.get("value", "")
                if isinstance(val, dict):
                    val = val.get("name", "")
                attrs[a.get("name", "")] = str(val)

            prod_map[p.get("id")] = {
                "code": p.get("code", ""),
                "article": p.get("article", ""),
                "folder": p.get("pathName") or p.get("productFolder", {}).get("name", "Guruhsiz"),
                "category": attrs.get("Категория", "") or attrs.get("Kategoriya", ""),
                "vid_tovara": attrs.get("Вид товара", "") or attrs.get("Vid tovara", "")
            }

    items = []
    total_qty = 0.0
    total_cost_price = 0.0
    total_sale_price = 0.0
    by_folder = {}

    if isinstance(stock_data, dict) and "rows" in stock_data:
        for row in stock_data["rows"]:
            qty = float(row.get("quantity", 0) or 0)
            cost_price = (row.get("price", 0) or 0) / 100.0
            sale_price = (row.get("salePrice", 0) or 0) / 100.0

            total_qty += qty
            total_cost_price += qty * cost_price
            total_sale_price += qty * sale_price

            meta = row.get("meta", {})
            href = meta.get("href", "")
            p_id = href.split("/")[-1].split("?")[0] if "/" in href else ""
            p_info = prod_map.get(p_id, {})

            folder_name = p_info.get("folder") or row.get("folder", {}).get("name", "Guruhsiz")
            if folder_name not in by_folder:
                by_folder[folder_name] = {"qty": 0.0, "cost_sum": 0.0, "sale_sum": 0.0}
            by_folder[folder_name]["qty"] += qty
            by_folder[folder_name]["cost_sum"] += qty * cost_price
            by_folder[folder_name]["sale_sum"] += qty * sale_price

            items.append({
                "code": p_info.get("code") or row.get("code", ""),
                "article": p_info.get("article") or row.get("article", ""),
                "name": row.get("name", "Noma'lum"),
                "folder": folder_name,
                "category": p_info.get("category", ""),
                "vid_tovara": p_info.get("vid_tovara", ""),
                "quantity": qty,
                "cost_price": cost_price,
                "sale_price": sale_price,
                "cost_sum": qty * cost_price,
                "sale_sum": qty * sale_price
            })

    result = {
        "total_items": len(items),
        "total_qty": total_qty,
        "total_cost_price": total_cost_price,
        "total_sale_price": total_sale_price,
        "by_folder": by_folder,
        "rows": items
    }
    gateway.set_cache(cache_key, result)
    return result

# ================= 4. ENG KO'P SOTILGAN TOVARLAR =================
@router.get("/stock/top")
async def get_top_selling_products(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 10
):
    """Eng ko'p sotilgan tovarlar reytingi."""
    cache_key = f"top_products_{date_from}_{date_to}_{limit}"
    cached = gateway.get_cached(cache_key, ttl_seconds=120)
    if cached:
        return cached

    filters = []
    if date_from:
        filters.append(f"moment>={date_from} 00:00:00")
    if date_to:
        filters.append(f"moment<={date_to} 23:59:59")

    params = {"limit": 1000, "expand": "positions.assortment"}
    if filters:
        params["filter"] = ";".join(filters)

    rd_task = gateway.execute_request("GET", "entity/retaildemand", params=params)
    dem_task = gateway.execute_request("GET", "entity/demand", params=params)
    rd_data, dem_data = await asyncio.gather(rd_task, dem_task)

    all_docs = []
    if isinstance(rd_data, dict) and "rows" in rd_data:
        all_docs.extend(rd_data["rows"])
    if isinstance(dem_data, dict) and "rows" in dem_data:
        all_docs.extend(dem_data["rows"])

    products_sales = {}
    for doc in all_docs:
        for pos in doc.get("positions", {}).get("rows", []):
            assortment = pos.get("assortment", {})
            p_name = assortment.get("name", "Noma'lum")
            p_code = assortment.get("code", "")
            qty = float(pos.get("quantity", 0) or 0)
            price = (pos.get("price", 0) or 0) / 100.0

            key = (p_name, p_code)
            if key not in products_sales:
                products_sales[key] = {"name": p_name, "code": p_code, "qty": 0.0, "sum": 0.0}
            products_sales[key]["qty"] += qty
            products_sales[key]["sum"] += qty * price

    sorted_prods = sorted(products_sales.values(), key=lambda x: x["qty"], reverse=True)
    result = {
        "total_sold_types": len(products_sales),
        "top": sorted_prods[:limit]
    }
    gateway.set_cache(cache_key, result)
    return result

# ================= 5. KONTRAGENTLAR QARZDORLIGI =================
@router.get("/counterparties/debts")
async def get_counterparties_debts():
    """Barcha kontragentlar balansi va qarz hisoboti."""
    cached = gateway.get_cached("cp_debts", ttl_seconds=120)
    if cached:
        return cached

    data = await gateway.execute_request("GET", "report/counterparty/all", params={"limit": 1000})
    
    we_owe = []
    they_owe = []
    total_we_owe = 0.0
    total_they_owe = 0.0

    if isinstance(data, dict) and "rows" in data:
        for row in data["rows"]:
            cp = row.get("counterparty", {})
            name = cp.get("name", "Noma'lum")
            balance = (row.get("balance", 0) or 0) / 100.0

            if balance < 0:
                debt = abs(balance)
                we_owe.append({"name": name, "amount": debt})
                total_we_owe += debt
            elif balance > 0:
                they_owe.append({"name": name, "amount": balance})
                total_they_owe += balance

    we_owe.sort(key=lambda x: x["amount"], reverse=True)
    they_owe.sort(key=lambda x: x["amount"], reverse=True)

    result = {
        "total_we_owe": total_we_owe,
        "total_they_owe": total_they_owe,
        "we_owe": we_owe,
        "they_owe": they_owe
    }
    gateway.set_cache("cp_debts", result)
    return result

# ================= 6. MAHSULOT GURUHLARI (FOLDERS) =================
@router.get("/folders")
async def get_folders():
    """Guruhlar ro'yxati."""
    cached = gateway.get_cached("folders_list", ttl_seconds=300)
    if cached:
        return cached

    data = await gateway.execute_request("GET", "entity/productfolder", params={"limit": 100})
    folders = []
    if isinstance(data, dict) and "rows" in data:
        folders = [{"id": f.get("id"), "name": f.get("name")} for f in data["rows"] if not f.get("archived")]

    gateway.set_cache("folders_list", folders)
    return folders

# ================= 7. WEBHOOK RECEIVER =================
@router.post("/webhooks/moysklad")
@router.post("/webhooks")
async def receive_moysklad_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    MoySklad webhook qabul qiluvchi endpoint.
    MoySklad o'zi hujjat o'zgarganda xabar yuboradi va gateway keshini yangilaydi.
    """
    try:
        payload = await request.json()
        events = payload.get("events", [])
        
        # Invalidate related caches immediately on push
        gateway.invalidate_cache()
        
        return {"status": "received", "events_count": len(events)}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
