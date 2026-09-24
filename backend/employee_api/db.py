from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine() -> Engine:
    # Sessions run in UTC so every timestamp leaves the database as UTC; the
    # site time zone is applied explicitly where local dates matter.
    return create_engine(get_settings().database_url, pool_pre_ping=True, future=True,
                         connect_args={"options": "-c timezone=UTC"})


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)


def new_session() -> Session:
    return _session_factory()()


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, committed by the route."""
    db = new_session()
    try:
        yield db
    finally:
        db.close()
