import logging
from contextlib import asynccontextmanager
from pathlib import Path
import hmac
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from backend.config import get_settings
from backend.database import engine, Base, SessionLocal
from backend.seed import seed_database
from backend.migrations import add_missing_columns, fill_missing_color_codes
from backend.services.auth_service import SESSION_COOKIE, read_session_token
from backend.routers import telegram as telegram_router
from backend.routers import (
    references, articul, ai, documents, moysklad, gateway, dashboard, auth, attributes
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("kirim-app")

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Initialize DB tables
    logger.info("Initializing database tables...")
    Base.metadata.create_all(bind=engine)
    # Eski bazada yetishmayotgan ustunlar (create_all mavjud jadvallarni o'zgartirmaydi)
    add_missing_columns(engine, Base.metadata)

    # 2. Seed default reference data from CSV files
    logger.info("Checking and seeding reference dictionaries from CSV files...")
    db = SessionLocal()
    try:
        seed_database(db)
        logger.info("Database seeding completed successfully.")
    except Exception as e:
        logger.exception("Error during database seeding:")
    finally:
        db.close()
    fill_missing_color_codes(engine)

    yield

    logger.info("Application shutdown.")

app = FastAPI(
    title="Kirim (Приход) & MoySklad Sync Gateway",
    description="MoySklad integratsiyalashgan, AI quvvatli kiyim-kechak qabul qilish tizimi va markaziy API Gateway",
    version="2.0.0",
    lifespan=lifespan
)

PUBLIC_API = {"/api/auth/login", "/api/auth/logout", "/api/auth/sso"}

def _is_local_direct(request: Request) -> bool:
    """To'g'ridan-to'g'ri localhost ulanishi (nginx orqali kelgan tashqi so'rov emas)"""
    host = request.client.host if request.client else ""
    proxied = "x-forwarded-for" in request.headers or "x-real-ip" in request.headers
    return host in ("127.0.0.1", "::1", "localhost") and not proxied

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Barcha /api so'rovlari — faqat kirgan foydalanuvchiga. Gateway — localhost'dagi xizmatlar (bot) yoki GATEWAY_TOKEN bilan"""
    path = request.url.path
    request.state.user = None
    if not path.startswith("/api/") or path in PUBLIC_API:
        return await call_next(request)

    if path.startswith("/api/gateway/"):
        token = settings.gateway_token
        header_token = request.headers.get("x-gateway-token", "")
        if _is_local_direct(request) or (token and hmac.compare_digest(header_token, token)):
            return await call_next(request)
        return JSONResponse({"detail": "Gateway faqat ichki xizmatlar uchun"}, status_code=403)

    db = SessionLocal()
    try:
        user = read_session_token(db, request.cookies.get(SESSION_COOKIE))
    finally:
        db.close()
    if not user:
        return JSONResponse({"detail": "Tizimga kiring", "auth_required": True}, status_code=401)
    request.state.user = user
    return await call_next(request)

# Include Routers
app.include_router(auth.router)
app.include_router(attributes.router)
app.include_router(gateway.router)
app.include_router(references.router)
app.include_router(articul.router)
app.include_router(ai.router)
app.include_router(documents.router)
app.include_router(moysklad.router)
app.include_router(dashboard.router)
app.include_router(telegram_router.router)

# Mount Frontend static files
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.app_host, port=settings.app_port, reload=True)
