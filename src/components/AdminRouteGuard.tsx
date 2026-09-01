import { useEffect, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAdminAuth } from '@/context/AdminAuthContext';

// 后台登录页路径
const ADMIN_LOGIN_PATH = '/admin/login';

export default function AdminRouteGuard({ children }: { children: ReactNode }) {
  const { isLoggedIn, isLoading } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLoading) return;

    const path = location.pathname;

    // 登录页本身不需要守卫
    if (path === ADMIN_LOGIN_PATH) return;

    // 未登录访问后台页面 → 跳登录
    if (!isLoggedIn) {
      navigate(ADMIN_LOGIN_PATH, { replace: true, state: { from: path } });
    }
  }, [isLoggedIn, isLoading, location.pathname, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
