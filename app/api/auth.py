"""JWT authentication + in-memory user store for the admin console.

Routes:
    POST /v1/auth/login      — email/password → JWT
    GET  /v1/auth/me         — current user (requires token)
    GET  /v1/users           — list users     (admin only)
    POST /v1/users           — create user    (admin only)
    PATCH /v1/users/{uid}    — update user    (admin only)
    DELETE /v1/users/{uid}   — delete user    (admin only)

Password storage: PBKDF2-SHA256 with 16-byte random salt, 260 000 iterations.
No new dependencies — python-jose is already in pyproject.toml.
"""
import hashlib
import os
import secrets
import time
import uuid
from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

router = APIRouter()

_SECRET = os.getenv("JWT_SECRET", "changeme-jwt-secret")
_ALGO = os.getenv("JWT_ALGORITHM", "HS256")
_TTL = 8 * 3600  # 8 hours

_bearer = HTTPBearer(auto_error=False)

# uid → user dict
_users: OrderedDict[str, dict] = OrderedDict()


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return f"pbkdf2:{salt}:{dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, dk_hex = stored.split(":", 2)
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return secrets.compare_digest(dk.hex(), dk_hex)


# ---------------------------------------------------------------------------
# Seed default admin
# ---------------------------------------------------------------------------

def _seed():
    if not _users:
        uid = "user_admin"
        _users[uid] = {
            "uid": uid,
            "name": "管理员",
            "email": os.getenv("ADMIN_EMAIL", "admin@verity.local"),
            "roles": ["admin"],
            "password_hash": _hash_password(os.getenv("ADMIN_PASSWORD", "admin123")),
            "disabled": False,
            "created_at": time.time(),
            "last_login": None,
        }


_seed()


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def _make_token(uid: str, roles: list[str]) -> str:
    return jwt.encode(
        {"sub": uid, "roles": roles, "exp": int(time.time()) + _TTL},
        _SECRET,
        algorithm=_ALGO,
    )


def _safe(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def verify_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, _SECRET, algorithms=[_ALGO])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    uid = payload.get("sub")
    user = _users.get(uid) if uid else None
    if not user or user.get("disabled"):
        raise HTTPException(status_code=401, detail="User not found or disabled")
    return user


def require_admin(user: dict = Depends(verify_token)) -> dict:
    if "admin" not in user.get("roles", []):
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/v1/auth/login")
async def login(req: LoginRequest):
    user = next((u for u in _users.values() if u["email"] == req.email), None)
    if not user or not _verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    if user.get("disabled"):
        raise HTTPException(status_code=403, detail="账户已禁用，请联系管理员")
    _users[user["uid"]]["last_login"] = time.time()
    token = _make_token(user["uid"], user["roles"])
    return {"token": token, **_safe(user)}


@router.get("/v1/auth/me")
async def me(user: dict = Depends(verify_token)):
    return _safe(user)


# ---------------------------------------------------------------------------
# User management (admin only)
# ---------------------------------------------------------------------------

@router.get("/v1/users")
async def list_users(_: dict = Depends(require_admin)):
    return {"users": [_safe(u) for u in _users.values()]}


class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    roles: list[str] = ["ops"]


@router.post("/v1/users", status_code=201)
async def create_user(req: CreateUserRequest, _: dict = Depends(require_admin)):
    if any(u["email"] == req.email for u in _users.values()):
        raise HTTPException(status_code=409, detail="邮箱已存在")
    uid = f"user_{uuid.uuid4().hex[:8]}"
    _users[uid] = {
        "uid": uid,
        "name": req.name,
        "email": req.email,
        "roles": req.roles,
        "password_hash": _hash_password(req.password),
        "disabled": False,
        "created_at": time.time(),
        "last_login": None,
    }
    return _safe(_users[uid])


class UpdateUserRequest(BaseModel):
    name: str | None = None
    roles: list[str] | None = None
    disabled: bool | None = None
    password: str | None = None


@router.patch("/v1/users/{uid}")
async def update_user(uid: str, req: UpdateUserRequest, current: dict = Depends(require_admin)):
    user = _users.get(uid)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if uid == current["uid"] and req.disabled:
        raise HTTPException(status_code=400, detail="不能禁用自己")
    if req.name is not None:
        user["name"] = req.name
    if req.roles is not None:
        user["roles"] = req.roles
    if req.disabled is not None:
        user["disabled"] = req.disabled
    if req.password:
        user["password_hash"] = _hash_password(req.password)
    return _safe(user)


@router.delete("/v1/users/{uid}", status_code=204)
async def delete_user(uid: str, current: dict = Depends(require_admin)):
    if uid == current["uid"]:
        raise HTTPException(status_code=400, detail="不能删除自己")
    if uid not in _users:
        raise HTTPException(status_code=404, detail="用户不存在")
    del _users[uid]
