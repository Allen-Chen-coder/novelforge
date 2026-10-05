"""OpenAI 兼容的云端微调客户端。

适用：暴露了 /v1/fine_tuning/jobs 与 /v1/files 端点的第三方服务
（OpenAI 官方、阿里云百炼兼容模式、SiliconFlow、火山方舟兼容接口等）。

注意：Kimi K3 官方 API 不开放云端微调；若用 Kimi 生态，请走
     (a) 开源权重（Kimi K2 系列）本地 LoRA 微调，见 train_lora/；
     (b) Moonshot 企业通道的专属微调；
     (c) 把本客户端指向其它支持微调的 OpenAI 兼容服务。
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests


@dataclass
class FineTuneClient:
    base_url: str
    api_key: str
    timeout: int = 120

    @classmethod
    def from_env(cls) -> "FineTuneClient":
        return cls(
            base_url=os.environ.get("FINE_TUNE_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
            api_key=os.environ.get("FINE_TUNE_API_KEY") or os.environ.get("OPENAI_API_KEY", ""),
        )

    def _headers(self) -> dict:
        if not self.api_key:
            raise RuntimeError("缺少 FINE_TUNE_API_KEY / OPENAI_API_KEY 环境变量")
        return {"Authorization": f"Bearer {self.api_key}"}

    # ------------------------------------------------------------------ #
    def upload_file(self, file_path: Path, purpose: str = "fine-tune") -> str:
        """上传 JSONL 训练集，返回 file_id。"""
        url = f"{self.base_url}/files"
        with open(file_path, "rb") as f:
            resp = requests.post(
                url,
                headers=self._headers(),
                files={"file": (Path(file_path).name, f, "application/jsonl")},
                data={"purpose": purpose},
                timeout=self.timeout,
            )
        resp.raise_for_status()
        return resp.json()["id"]

    def create_job(
        self,
        training_file: str,
        model: str,
        suffix: str = "novel-style",
        hyperparameters: Optional[dict] = None,
    ) -> dict:
        """创建微调任务，返回 job 对象。"""
        payload = {
            "training_file": training_file,
            "model": model,
            "suffix": suffix,
        }
        if hyperparameters:
            payload["hyperparameters"] = hyperparameters
        resp = requests.post(
            f"{self.base_url}/fine_tuning/jobs",
            headers={**self._headers(), "Content-Type": "application/json"},
            json=payload,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def get_job(self, job_id: str) -> dict:
        resp = requests.get(
            f"{self.base_url}/fine_tuning/jobs/{job_id}",
            headers=self._headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()

    def wait_job(self, job_id: str, poll_seconds: int = 60) -> dict:
        """轮询直到成功/失败/取消，返回最终 job 对象（含 fine_tuned_model）。"""
        while True:
            job = self.get_job(job_id)
            status = job.get("status")
            if status in ("succeeded", "failed", "cancelled"):
                return job
            print(f"[fine-tune] job={job_id} status={status}，{poll_seconds}s 后重查…")
            time.sleep(poll_seconds)

    def list_jobs(self, limit: int = 20) -> list:
        resp = requests.get(
            f"{self.base_url}/fine_tuning/jobs?limit={limit}",
            headers=self._headers(),
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json().get("data", [])
