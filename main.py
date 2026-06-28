import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from database import init_db
from routers import auth, channels, settings, logs, proxy
from config import PORT

app = FastAPI()

NO_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache", "Expires": "0"}


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    resp = await call_next(request)
    p = request.url.path
    if p.startswith("/static/") or p == "/" or p == "/dashboard" or p.startswith("/page/"):
        for k, v in NO_CACHE.items():
            resp.headers[k] = v
    return resp


@app.on_event("startup")
async def startup():
    await init_db()


# ===== 管理面板页面（必须在 proxy 通配路由之前注册）=====
@app.get("/")
async def index():
    return FileResponse("static/index.html")


@app.get("/dashboard")
async def dashboard_page():
    return FileResponse("static/dashboard.html")


@app.get("/page/channels")
async def channels_page():
    return FileResponse("static/channels.html")


@app.get("/page/settings")
async def settings_page():
    return FileResponse("static/settings.html")


@app.get("/page/usage")
async def usage_page():
    return FileResponse("static/usage.html")


@app.get("/page/logs")
async def logs_page():
    return FileResponse("static/logs.html")


os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# ===== API 路由 =====
app.include_router(auth.router)
app.include_router(channels.router)
app.include_router(settings.router)
app.include_router(logs.router)

# ===== 反代通配路由（最后注册，避免吃掉上面的具体路径）=====
app.include_router(proxy.router)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
