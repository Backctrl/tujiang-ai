import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { adminService } from '@/services/adminService';
import type { IAdmin } from '@/data/admin';
import { toast } from 'sonner';

interface AdminAuthContextValue {
  admin: IAdmin | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (params: { email: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshAdmin: () => void;
  updateAdmin: (updates: Partial<IAdmin>) => void;
  hasPermission: (permission: string) => boolean;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<IAdmin | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const current = adminService.getCurrentAdmin();
    setAdmin(current);
    setIsLoading(false);
  }, []);

  const login = useCallback(async (params: { email: string; password: string }) => {
    const res = await adminService.login(params);
    if (res.code === 0 && res.data) {
      setAdmin(res.data.admin);
      toast.success('登录成功，欢迎回来');
      return true;
    }
    toast.error(res.message || '登录失败');
    return false;
  }, []);

  const logout = useCallback(async () => {
    await adminService.logout();
    setAdmin(null);
    toast.success('已退出登录');
  }, []);

  const refreshAdmin = useCallback(() => {
    const current = adminService.getCurrentAdmin();
    setAdmin(current);
  }, []);

  const updateAdmin = useCallback((updates: Partial<IAdmin>) => {
    setAdmin((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!admin) return false;
      if (admin.isSuperAdmin) return true;
      // 角色权限判断（简化，基于角色ID）
      // 实际项目中需要查 role.permissions
      return true; // 原型简化：所有登录管理员都可以访问
    },
    [admin],
  );

  return (
    <AdminAuthContext.Provider
      value={{
        admin,
        isLoading,
        isLoggedIn: !!admin,
        login,
        logout,
        refreshAdmin,
        updateAdmin,
        hasPermission,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider');
  }
  return ctx;
}
