"""请求/响应模型。"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

# 流水线角色（模型路由的合法取值）
ROLES = ("planner", "writer", "critic", "reviser", "summarizer", "judge")


class RegisterIn(BaseModel):
    phone: str                 # 手机号（注册锚点，验证码校验）
    code: str                  # 短信验证码
    invite: str = Field(min_length=6, max_length=6)   # 内测码（唯一 6 位，注册成功后核销）
    password: str = Field(min_length=6, max_length=64)
    email: Optional[str] = None    # 选填，填写即绑定（邮箱登录的前提）
    penname: Optional[str] = None  # 选填，站内显示的笔名


class LoginIn(BaseModel):
    account: str = Field(min_length=1, max_length=64)   # 手机号 / 邮箱 / 用户名
    password: str


class SmsSendIn(BaseModel):
    phone: str
    scene: str = "register"    # register / bind


class BindPhoneIn(BaseModel):
    phone: str
    code: str


class InviteCreateIn(BaseModel):
    count: int = Field(default=1, ge=1, le=200)   # 一次最多生成 200 个


class ProjectCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    idea: str = Field(min_length=4, max_length=2000)
    genre: str = ""
    target_chapters: int = Field(ge=1, le=200)
    target_words: int = Field(default=3000, ge=500, le=20000)


class ProjectExtendIn(BaseModel):
    chapters: int = Field(ge=1, le=200)


class ProviderIn(BaseModel):
    base_url: str = "https://api.moonshot.cn/v1"
    api_key: Optional[str] = None      # 不传表示保持原 Key 不变
    model: str = "kimi-k3"
    temperature: float = 0.8
    max_tokens: int = 8192


class UserPatchIn(BaseModel):
    enabled: Optional[bool] = None
    quota_chapters: Optional[int] = Field(default=None, ge=1, le=100000)
    extra_chapters: Optional[int] = Field(default=None, ge=0, le=1000000)


class OrderCreateIn(BaseModel):
    product_code: str = Field(min_length=1, max_length=32)


class MyProviderIn(BaseModel):
    base_url: str = Field(min_length=1, max_length=256)
    api_key: Optional[str] = None    # 留空表示保持原 Key
    model: str = Field(min_length=1, max_length=128)
    temperature: float = 0.8
    max_tokens: int = 8192
    enabled: bool = True


class ModelRouteIn(BaseModel):
    """模型路由：某角色使用独立服务商。api_key 留空表示保持原 Key。"""
    role: str = Field(min_length=1, max_length=32)
    base_url: str = Field(min_length=1, max_length=256)
    api_key: Optional[str] = None
    model: str = Field(min_length=1, max_length=128)
    temperature: float = 0.8
    max_tokens: int = 8192
    enabled: bool = True
