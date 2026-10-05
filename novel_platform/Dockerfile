# 墨卷 NovelForge · 全栈单容器镜像
# 构建:  docker build -f Dockerfile -t novelforge .
# 运行:  docker run -p 8787:8787 -v novelforge-data:/app/data novelforge
# 访问:  http://localhost:8787  （admin / admin123，首次登录请立即改密）
FROM node:20-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
# 后端依赖（uvicorn + fastapi 等，见 backend/requirements.txt）
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY --from=frontend /build/frontend/dist ./frontend/dist
EXPOSE 8787
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
