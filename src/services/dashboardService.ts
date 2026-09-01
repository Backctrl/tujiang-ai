// EXPORTS: dashboardService
import { storage, delay, success, fail, type ApiResponse } from '@/lib/storage';
import { USERS_KEY, type IUser } from '@/data/user';
import {
  ORDERS_KEY,
  API_LOGS_KEY,
  AUDIT_LOGS_KEY,
  type IOrder,
  type IApiLog,
  type IAuditLog,
} from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';

function ensureData() {
  mockDataService.initMockData();
}

export interface DashboardStats {
  totalUsers: number;
  todayNewUsers: number;
  activeUsersToday: number;
  activeUsers7d: number;
  totalImages: number;
  todayImages: number;
  totalRevenue: number;
  todayRevenue: number;
  totalApiCalls: number;
  apiSuccessRate: number;
  avgResponseTime: number;
  responseTimeTrend: number;
}

export interface DashboardCharts {
  userGrowth: { dates: string[]; values: number[] };
  revenueTrend: { dates: string[]; values: number[] };
  imageTrend: { dates: string[]; values: number[] };
  packageDistribution: { names: string[]; values: number[] };
  apiDistribution: { names: string[]; values: number[] };
  userActivity: { names: string[]; values: number[] };
}

async function getStats(): Promise<ApiResponse<DashboardStats | null>> {
  await delay(200);
  ensureData();

  const users = storage.get<IUser[]>(USERS_KEY, []);
  const orders = storage.get<IOrder[]>(ORDERS_KEY, []);
  const apiLogs = storage.get<IApiLog[]>(API_LOGS_KEY, []);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  const todayNewUsers = users.filter(
    (u) => new Date(u.createdAt).getTime() >= todayStart,
  ).length;
  const activeUsersToday = users.filter(
    (u) => new Date(u.lastLoginAt).getTime() >= todayStart,
  ).length;
  const activeUsers7d = users.filter(
    (u) => new Date(u.lastLoginAt).getTime() >= weekAgo,
  ).length;

  const paidOrders = orders.filter((o) => o.status === 'paid');
  const totalRevenue = paidOrders.reduce((sum, o) => sum + o.amount, 0);
  const todayRevenue = paidOrders
    .filter((o) => o.paidAt && new Date(o.paidAt).getTime() >= todayStart)
    .reduce((sum, o) => sum + o.amount, 0);

  const totalApiCalls = apiLogs.length;
  const successCount = apiLogs.filter((l) => l.statusCode < 400).length;
  const apiSuccessRate = totalApiCalls > 0 ? (successCount / totalApiCalls) * 100 : 100;
  const avgResponseTime =
    totalApiCalls > 0
      ? Math.round(apiLogs.reduce((sum, l) => sum + l.responseTime, 0) / totalApiCalls)
      : 0;

  return success({
    totalUsers: users.length,
    todayNewUsers,
    activeUsersToday,
    activeUsers7d,
    totalImages: 2867,
    todayImages: 128,
    totalRevenue,
    todayRevenue,
    totalApiCalls,
    apiSuccessRate: Math.round(apiSuccessRate * 100) / 100,
    avgResponseTime,
    responseTimeTrend: -12,
  });
}

async function getCharts(): Promise<ApiResponse<DashboardCharts | null>> {
  await delay(300);
  ensureData();

  // 生成近30天日期
  const dates30: string[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates30.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }

  const dates7 = dates30.slice(-7);

  // 用户增长数据
  const userGrowthValues = dates30.map((_, i) => Math.floor(5 + Math.sin(i / 3) * 3 + Math.random() * 5));

  // 营收数据
  const revenueValues = dates30.map(
    (_, i) => Math.floor(2000 + Math.sin(i / 4) * 800 + Math.random() * 600),
  );

  // 生成量数据（近7天）
  const imageValues = dates7.map(
    (_, i) => Math.floor(80 + Math.sin(i / 2) * 30 + Math.random() * 40),
  );

  // 套餐分布
  const packageDistribution = {
    names: ['入门套餐', '标准套餐', '专业套餐', '企业套餐'],
    values: [156, 328, 245, 89],
  };

  // API调用分布
  const apiDistribution = {
    names: ['主图全案', '克隆大师', '创图工坊', '用户接口', '其他'],
    values: [4520, 2890, 1560, 980, 640],
  };

  // 用户活跃度分布
  const userActivity = {
    names: ['活跃用户', '沉默用户', '新用户'],
    values: [45, 42, 13],
  };

  return success({
    userGrowth: { dates: dates30, values: userGrowthValues },
    revenueTrend: { dates: dates30, values: revenueValues },
    imageTrend: { dates: dates7, values: imageValues },
    packageDistribution,
    apiDistribution,
    userActivity,
  });
}

async function getRecentActivity(): Promise<
  ApiResponse<{
    recentUsers: IUser[];
    recentOrders: IOrder[];
    recentAudits: IAuditLog[];
  } | null>
> {
  await delay(200);
  ensureData();

  const users = storage.get<IUser[]>(USERS_KEY, []).slice(0, 5);
  const orders = storage.get<IOrder[]>(ORDERS_KEY, []).slice(0, 5);
  const audits = storage.get<IAuditLog[]>(AUDIT_LOGS_KEY, []).slice(0, 5);

  return success({
    recentUsers: users,
    recentOrders: orders,
    recentAudits: audits,
  });
}

export const dashboardService = {
  getStats,
  getCharts,
  getRecentActivity,
};
