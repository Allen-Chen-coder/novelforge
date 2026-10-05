import { Navigate, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import LoginPage from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import ProjectDetail from "@/pages/ProjectDetail";
import AdminPage from "@/pages/Admin";
import Billing from "@/pages/Billing";
import NotFound from "@/pages/NotFound";

function Guard({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  if (loading)
    // 骨架屏贴合登录后布局：品牌顶栏 + 内容占位（redesign-skill：Loading 贴合布局形状，禁裸 spinner）
    return (
      <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 ink-bg">
        <div className="ink-grain" aria-hidden />
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/75 backdrop-blur-xl">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-3">
            <div className="skeleton h-8 w-8 !rounded-lg" />
            <div className="skeleton h-4 w-20" />
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-10 space-y-6">
          <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6 items-end">
            <div className="space-y-3">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-9 w-56" />
            </div>
            <div className="hidden lg:block justify-self-end">
              <div className="skeleton h-[68px] w-72 !rounded-2xl" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-5 space-y-4">
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-4 w-full" />
                <div className="skeleton h-4 w-4/5" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (admin && !user.is_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Guard><Dashboard /></Guard>} />
        <Route path="/project/:id" element={<Guard><ProjectDetail /></Guard>} />
        <Route path="/billing" element={<Guard><Billing /></Guard>} />
        <Route path="/admin" element={<Guard admin><AdminPage /></Guard>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
