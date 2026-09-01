import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { authService } from '@/services/authService';
import type { IUser } from '@/data/user';
import { toast } from 'sonner';
import { recordsService } from '@/services/recordsService';

interface AuthContextValue {
  user: IUser | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (params: { email: string; password: string; remember?: boolean }) => Promise<boolean>;
  register: (params: { email: string; nickname: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => void;
  updateUser: (updates: Partial<IUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<IUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化：检查登录状态
  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    setUser(currentUser);
    setIsLoading(false);

    // 如果已登录，确保演示数据就绪
    if (currentUser) {
      recordsService.ensureRecords();
    }
  }, []);

  const login = useCallback(async (params: { email: string; password: string; remember?: boolean }) => {
    const res = await authService.login(params);
    if (res.code === 0 && res.data) {
      setUser(res.data.user);
      recordsService.ensureRecords();
      toast.success('登录成功');
      return true;
    }
    toast.error(res.message || '登录失败');
    return false;
  }, []);

  const register = useCallback(async (params: { email: string; nickname: string; password: string }) => {
    const res = await authService.register(params);
    if (res.code === 0 && res.data) {
      setUser(res.data.user);
      toast.success('注册成功，欢迎加入图匠AI');
      return true;
    }
    toast.error(res.message || '注册失败');
    return false;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    toast.success('已退出登录');
  }, []);

  const refreshUser = useCallback(() => {
    const current = authService.getCurrentUser();
    setUser(current);
  }, []);

  const updateUser = useCallback((updates: Partial<IUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isLoggedIn: !!user,
        login,
        register,
        logout,
        refreshUser,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
