import { useEffect, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

// 需要登录才能访问的页面前缀
const PROTECTED_PATHS = [
  '/',
  '/masterplan',
  '/clone',
  '/create',
  '/tools',
  '/style-library',
  '/history',
  '/wallet',
  '/profile',
];

// 登录后重定向到首页（已登录用户访问登录/注册页时）
const AUTH_PATHS = ['/login', '/register', '/forgot-password'];

export default function RouteGuard({ children }: { children: ReactNode }) {
  const { isLoggedIn, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLoading) return;

    const path = location.pathname;

    // 未登录访问受保护页面 → 跳登录
    if (!isLoggedIn && PROTECTED_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
      // 首页 / 也是受保护的
      navigate('/login', { replace: true, state: { from: path } });
      return;
    }

    // 已登录访问 auth 页面 → 跳工作台
    if (isLoggedIn && AUTH_PATHS.some((p) => path === p)) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, isLoading, location.pathname, navigate]);

  // 加载中返回 null 或 loading
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
