// 一键启动：FastAPI 后端 (8787) + Vite 前端 (默认 3000)
// 用法：npm run dev [-- --port 7100 --host 127.0.0.1]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");          // novel_platform/frontend
const backend = path.resolve(__dirname, "..", "..", "backend"); // novel_platform/backend
// 含中文路径统一用正斜杠，规避个别 Windows 环境下 spawn 的编码问题
const fw = (p) => p.replace(/\\/g, "/");
const rootFw = fw(frontendDir);
const backendFw = fw(backend);

// 透传 CLI host/port 参数给 Vite（flag 及其取值成对保留）
const args = process.argv.slice(2);
const viteArgs = [];
for (let i = 0; i < args.length; i++) {
  if (/^--(port|host|open)/.test(args[i])) {
    viteArgs.push(args[i]);
    if (args[i + 1] !== undefined && !args[i + 1].startsWith("--")) {
      viteArgs.push(args[i + 1]);
      i++;
    }
  } else if (/^--strictPort/.test(args[i])) {
    viteArgs.push(args[i]);
  }
}

// 解析 Python：环境变量 > Kimi Work 托管运行时 > PATH
const PY_CANDIDATES = [
  process.env.PYTHON,
  "C:/Users/李俊辰/AppData/Roaming/kimi-desktop/daimon-share/daimon/runtime/python/.venv/Scripts/python.exe",
  "py",
  "python",
  "python3",
];
const py = PY_CANDIDATES.find((c) => {
  if (!c) return false;
  if (c.includes(path.sep) || c.includes("/")) return fs.existsSync(c);
  return true; // PATH 上的命令名，交给 spawn 解析
});
if (!py) {
  console.error("找不到 Python，请设置 PYTHON 环境变量");
  process.exit(1);
}

const viteBin = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");

const backendProc = spawn(py, ["-m", "uvicorn", "app.main:app", "--port", "8787"], {
  cwd: backendFw,
  stdio: ["ignore", "inherit", "inherit"],
});

const viteProc = spawn(process.execPath, [viteBin, ...viteArgs], {
  cwd: rootFw,
  stdio: ["ignore", "inherit", "inherit"],
});

function shutdown(code) {
  try { backendProc.kill("SIGTERM"); } catch {}
  try { viteProc.kill("SIGTERM"); } catch {}
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
backendProc.on("exit", (c) => shutdown(c ?? 1));
viteProc.on("exit", (c) => shutdown(c ?? 1));
