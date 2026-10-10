import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from backend.config import get_settings
from backend.database import engine, Base, SessionLocal
from backend.seed import seed_database
from backend.routers import (
    references, articul, ai, documents, moysklad, gateway
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

    yield

    logger.info("Application shutdown.")

app = FastAPI(
    title="De Luxury — Kirim (Приход) & MoySklad Sync Gateway",
    description="MoySklad integratsiyalashgan, AI quvvatli kiyim-kechak qabul qilish tizimi va markaziy API Gateway",
    version="1.1.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Include Routers
app.include_router(gateway.router)
app.include_router(references.router)
app.include_router(articul.router)
app.include_router(ai.router)
app.include_router(documents.router)
app.include_router(moysklad.router)

# Mount Frontend static files
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.app_host, port=settings.app_port, reload=True)
