import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime,
    ForeignKey, Text, UniqueConstraint
)
from sqlalchemy.orm import relationship
from backend.database import Base

class Group(Base):
    __tablename__ = "guruhlar"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)  # e.g. "Одежда Топ"
    code = Column(String(20), nullable=False, index=True)  # e.g. "TOP"
    moysklad_id = Column(String(100), nullable=True)
    status = Column(String(20), default="local_only")  # synced, local_only, conflict

    product_types = relationship("ProductType", back_populates="group")

class Season(Base):
    __tablename__ = "mavsumlar"

    id = Column(Integer, primary_key=True, index=True)
    collection = Column(String(50), unique=True, nullable=False, index=True)  # e.g. "AW26"
    code = Column(String(20), nullable=False, index=True)  # e.g. "A26"
    moysklad_id = Column(String(100), nullable=True)
    status = Column(String(20), default="local_only")

class Category(Base):
    __tablename__ = "kategoriyalar"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)  # e.g. "Футболки и поло"
    moysklad_id = Column(String(100), nullable=True)
    status = Column(String(20), default="local_only")

    product_types = relationship("ProductType", back_populates="category")

class ProductType(Base):
    __tablename__ = "tovar_turlari"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), unique=True, nullable=False, index=True)  # e.g. "Футболка"
    category_id = Column(Integer, ForeignKey("kategoriyalar.id"), nullable=True)
    group_id = Column(Integer, ForeignKey("guruhlar.id"), nullable=True)
    moysklad_id = Column(String(100), nullable=True)
    status = Column(String(20), default="local_only")

    category = relationship("Category", back_populates="product_types")
    group = relationship("Group", back_populates="product_types")

class Brand(Base):
    __tablename__ = "brendlar"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    moysklad_id = Column(String(100), nullable=True)
    status = Column(String(20), default="local_only")

class Color(Base):
    __tablename__ = "ranglar"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)  # e.g. "Черный"
    code_no = Column(Integer, nullable=True)  # e.g. 51
    rgb = Column(String(30), nullable=True)
    moysklad_id = Column(String(100), nullable=True)
    status = Column(String(20), default="local_only")

class Country(Base):
    __tablename__ = "mamlakatlar"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)  # e.g. "Турция"
    moysklad_id = Column(String(100), nullable=True)
    status = Column(String(20), default="local_only")

class SeasonType(Base):
    __tablename__ = "fasllar"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)  # e.g. "Весна-Осень", "Зима", "Лето"
    status = Column(String(20), default="local_only")

class SizeItem(Base):
    __tablename__ = "razmerlar"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)  # e.g. "S", "M", "L", "42"
    sort_order = Column(Integer, default=0)
    status = Column(String(20), default="local_only")

class ArticulCounter(Base):
    __tablename__ = "artikul_counter"

    id = Column(Integer, primary_key=True, index=True)
    group_code = Column(String(20), nullable=False, index=True)   # e.g. "UND" or "ALL"
    season_code = Column(String(20), nullable=False, index=True)  # e.g. "A26" or "ALL"
    last_number = Column(Integer, default=0, nullable=False)

    __table_args__ = (
        UniqueConstraint('group_code', 'season_code', name='uix_group_season_counter'),
    )

class PrixodDocument(Base):
    __tablename__ = "prixod_hujjatlari"

    id = Column(Integer, primary_key=True, index=True)
    doc_number = Column(String(50), nullable=True, index=True)
    doc_date = Column(DateTime, default=datetime.datetime.utcnow)
    counterparty_name = Column(String(150), nullable=True)
    counterparty_id = Column(String(100), nullable=True)
    store_name = Column(String(150), nullable=True)
    store_id = Column(String(100), nullable=True)
    currency = Column(String(10), default="USD")  # USD, UZS, RUB
    total_sum_buy = Column(Float, default=0.0)
    total_sum_sale = Column(Float, default=0.0)
    total_qty = Column(Float, default=0.0)
    total_items = Column(Integer, default=0)
    status = Column(String(30), default="draft")  # draft, validated, sending, sent, error
    moysklad_document_id = Column(String(100), nullable=True)
    moysklad_document_name = Column(String(100), nullable=True)
    error_message = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    items = relationship("PrixodItem", back_populates="document", cascade="all, delete-orphan")

class PrixodItem(Base):
    __tablename__ = "prixod_qatorlari"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("prixod_hujjatlari.id"), nullable=False)
    row_index = Column(Integer, default=0)
    
    # Input & Lookup fields
    country = Column(String(100), nullable=True)
    product_type = Column(String(150), nullable=False)
    category = Column(String(100), nullable=True)
    group_name = Column(String(100), nullable=True)
    brand = Column(String(100), nullable=True)
    collection = Column(String(50), nullable=True)
    season = Column(String(50), nullable=True)
    size = Column(String(50), nullable=True)
    description = Column(String(255), nullable=True)
    model_code = Column(String(100), nullable=True)
    color = Column(String(100), nullable=True)
    
    # Numbers
    quantity = Column(Float, default=1.0)
    price_buy = Column(Float, default=0.0)
    price_sale = Column(Float, default=0.0)
    sum_buy = Column(Float, default=0.0)
    sum_sale = Column(Float, default=0.0)
    markup_pct = Column(Float, default=0.0)  # (price_sale / price_buy - 1) * 100
    
    # Auto-calculated
    articul = Column(String(100), nullable=True, index=True)
    full_name = Column(String(255), nullable=True)
    
    # AI info
    ai_generated = Column(Boolean, default=False)
    ai_confidence = Column(Float, nullable=True)  # 0.0 - 1.0
    ai_low_confidence_fields = Column(Text, nullable=True)  # JSON or comma-separated field names
    
    # MoySklad sync
    moysklad_product_id = Column(String(100), nullable=True)
    moysklad_variant_id = Column(String(100), nullable=True)
    sync_status = Column(String(30), default="pending")  # pending, created, matched, error
    error_message = Column(Text, nullable=True)

    document = relationship("PrixodDocument", back_populates="items")

class DraftState(Base):
    __tablename__ = "draft_state"

    id = Column(Integer, primary_key=True)
    draft_key = Column(String(50), unique=True, default="current_grid")
    data_json = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
