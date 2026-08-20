import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from database import init_db
from routers import auth, channels, settings, logs, openai, proxy
from config import PORT

app = FastAPI()

FRONTEND_VARIANTS = {"classic", "atelier"}
FRONTEND_DEFAULT = os.getenv("FRONTEND_VARIANT", "classic").strip().lower()
if FRONTEND_DEFAULT not in FRONTEND_VARIANTS:
    FRONTEND_DEFAULT = "classic"
FRONTEND_ALLOW_SWITCH = os.getenv("FRONTEND_ALLOW_SWITCH", "1") != "0"

NO_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache", "Expires": "0"}


@app.middleware("http")
async def no_cache_static(request: Request, call_next):
    resp = await call_next(request)
    p = request.url.path
    if (p.startswith("/static/") or p.startswith("/atelier-static/") or
            p == "/" or p == "/dashboard" or p.startswith("/page/")):
        for k, v in NO_CACHE.items():
            resp.headers[k] = v
    return resp


@app.on_event("startup")
async def startup():
    await init_db()


# ===== 管理面板页面（必须在 proxy 通配路由之前注册）=====
def frontend_variant(request: Request) -> str:
    if FRONTEND_ALLOW_SWITCH:
        selected = request.cookies.get("cc_frontend", "").strip().lower()
        if selected in FRONTEND_VARIANTS:
            return selected
    return FRONTEND_DEFAULT


def frontend_page(request: Request, classic_file: str, atelier_file: str = "app.html"):
    if frontend_variant(request) == "atelier":
        return FileResponse(f"static_atelier/{atelier_file}")
    return FileResponse(f"static/{classic_file}")


@app.get("/")
async def index(request: Request):
    return frontend_page(request, "index.html", "login.html")


@app.get("/dashboard")
async def dashboard_page(request: Request):
    return frontend_page(request, "dashboard.html")


@app.get("/page/channels")
async def channels_page(request: Request):
    return frontend_page(request, "channels.html")


@app.get("/page/settings")
async def settings_page(request: Request):
    return frontend_page(request, "settings.html")


@app.get("/page/usage")
async def usage_page(request: Request):
    return frontend_page(request, "usage.html")


@app.get("/page/logs")
async def logs_page(request: Request):
    return frontend_page(request, "logs.html")


@app.get("/page/openai")
async def openai_page(request: Request):
    return frontend_page(request, "openai.html")


@app.get("/ui/{variant}")
async def select_frontend(variant: str):
    selected = variant.strip().lower()
    if selected not in FRONTEND_VARIANTS:
        return RedirectResponse("/dashboard", status_code=303)
    response = RedirectResponse("/dashboard", status_code=303)
    response.set_cookie("cc_frontend", selected, max_age=31536000, samesite="lax")
    return response


os.makedirs("static", exist_ok=True)
os.makedirs("static_atelier", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/atelier-static", StaticFiles(directory="static_atelier"), name="atelier-static")

# ===== API 路由 =====
app.include_router(auth.router)
app.include_router(channels.router)
app.include_router(settings.router)
app.include_router(logs.router)
app.include_router(openai.router)

# ===== 反代通配路由（最后注册，避免吃掉上面的具体路径）=====
app.include_router(proxy.router)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=False)
