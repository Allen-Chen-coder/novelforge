"""FastAPI 应用入口。"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import auth, db
from .runner import start as start_runner
from .routers import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# 生产形态：后端直接托管前端构建产物（dist 存在时启用，单进程/单容器部署）
DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app() -> FastAPI:
    app = FastAPI(title="墨卷 NovelForge API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://localhost:7100", "http://127.0.0.1:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _startup() -> None:
        db.init_db()
        auth.seed_admin()
        start_runner()

    app.include_router(router)

    if DIST_DIR.exists():
        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str) -> FileResponse:
            """SPA 托管：静态文件直出，其余路径回退 index.html（/api 除外）。"""
            if full_path.startswith("api/"):
                raise HTTPException(404)
            target = DIST_DIR / full_path
            if full_path and target.is_file():
                return FileResponse(target)
            return FileResponse(DIST_DIR / "index.html")

    return app


app = create_app()
