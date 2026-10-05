import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, getToken, setToken, clearToken } from "@/lib/api";

export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  quota_chapters: number;
  used_chapters: number;
  plan: string;
  plan_name: string;
  plan_chapters: number;
  plan_reset_at: string | null;
  extra_chapters: number;
  remaining_chapters: number;
  byok: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api<User>("GET", "/api/auth/me"));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>("POST", "/api/auth/login", {
      username,
      password,
    });
    setToken(r.token);
    setUser(r.user);
  };

  const register = async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>("POST", "/api/auth/register", {
      username,
      password,
    });
    setToken(r.token);
    setUser(r.user);
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
