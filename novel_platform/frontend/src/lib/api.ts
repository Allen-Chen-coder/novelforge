/** API 客户端：统一携带 Token，错误抛出中文消息。 */
const TOKEN_KEY = "nvf_token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const resp = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (resp.status === 401) {
    clearToken();
    window.location.hash = "";
    if (!location.pathname.startsWith("/login")) location.href = "/login";
    throw new Error("登录已失效，请重新登录");
  }
  const text = await resp.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* 纯文本响应 */
  }
  if (!resp.ok) {
    throw new Error(data?.detail || `请求失败（${resp.status}）`);
  }
  return data as T;
}
