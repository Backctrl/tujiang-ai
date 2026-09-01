// EXPORTS: adminService
import { storage, generateId, delay, success, fail, type ApiResponse } from '@/lib/storage';
import {
  ADMINS_KEY,
  ROLES_KEY,
  CURRENT_ADMIN_KEY,
  ADMIN_TOKEN_KEY,
  DEFAULT_ROLES,
  type IAdmin,
  type IRole,
} from '@/data/admin';
import { avatarImages } from '@lark-apaas/client-toolkit-lite';

// 初始化超级管理员和角色
function initAdminData() {
  const roles = storage.get<IRole[]>(ROLES_KEY, []);
  if (roles.length === 0) {
    storage.set(ROLES_KEY, DEFAULT_ROLES);
  }

  const admins = storage.get<IAdmin[]>(ADMINS_KEY, []);
  if (admins.length === 0) {
    const superAdmin: IAdmin = {
      id: 'admin_super',
      username: 'admin',
      email: 'admin@tujiang.ai',
      password: 'Admin123456',
      nickname: '超级管理员',
      avatar: avatarImages.avatarImg1,
      roleId: 'role_super',
      status: 'active',
      isSuperAdmin: true,
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: '127.0.0.1',
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    storage.set(ADMINS_KEY, [superAdmin]);
  }
}

initAdminData();

function getCurrentAdmin(): IAdmin | null {
  const token = storage.get<string>(ADMIN_TOKEN_KEY, '');
  if (!token) return null;
  const adminData = storage.get<IAdmin | null>(CURRENT_ADMIN_KEY, null);
  return adminData;
}

async function login(params: {
  email: string;
  password: string;
}): Promise<ApiResponse<{ admin: IAdmin; token: string } | null>> {
  await delay(300);
  initAdminData();

  const admins = storage.get<IAdmin[]>(ADMINS_KEY, []);
  const admin = admins.find(
    (a) =>
      (a.email === params.email || a.username === params.email) &&
      a.password === params.password,
  );

  if (!admin) {
    return fail('邮箱或密码错误', 1001);
  }

  if (admin.status === 'disabled') {
    return fail('账号已被禁用，请联系超级管理员', 1002);
  }

  // 更新最后登录时间
  const idx = admins.findIndex((a) => a.id === admin.id);
  admins[idx].lastLoginAt = new Date().toISOString();
  admins[idx].lastLoginIp = '127.0.0.1';
  storage.set(ADMINS_KEY, admins);

  const token = `admin_token_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  storage.set(ADMIN_TOKEN_KEY, token);
  storage.set(CURRENT_ADMIN_KEY, admins[idx]);

  return success({ admin: admins[idx], token }, '登录成功');
}

async function logout(): Promise<ApiResponse<boolean>> {
  await delay(100);
  storage.remove(ADMIN_TOKEN_KEY);
  storage.remove(CURRENT_ADMIN_KEY);
  return success(true, '退出成功');
}

async function listAdmins(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}): Promise<
  ApiResponse<{ list: IAdmin[]; total: number; page: number; pageSize: number } | null>
> {
  await delay(200);

  const token = storage.get<string>(ADMIN_TOKEN_KEY, '');
  if (!token) return fail('未登录', 401);

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const all = storage.get<IAdmin[]>(ADMINS_KEY, []);
  let filtered = [...all];

  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    filtered = filtered.filter(
      (a) =>
        a.username.toLowerCase().includes(kw) ||
        a.email.toLowerCase().includes(kw) ||
        a.nickname.toLowerCase().includes(kw),
    );
  }
  if (params.status && params.status !== 'all') {
    filtered = filtered.filter((a) => a.status === params.status);
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const list = filtered.slice(start, start + pageSize);

  return success({ list, total, page, pageSize });
}

async function createAdmin(params: {
  username: string;
  email: string;
  password: string;
  nickname: string;
  roleId: string;
}): Promise<ApiResponse<IAdmin | null>> {
  await delay(200);
  const token = storage.get<string>(ADMIN_TOKEN_KEY, '');
  if (!token) return fail('未登录', 401);

  const all = storage.get<IAdmin[]>(ADMINS_KEY, []);
  if (all.some((a) => a.email === params.email)) {
    return fail('邮箱已存在', 1003);
  }
  if (all.some((a) => a.username === params.username)) {
    return fail('用户名已存在', 1004);
  }

  const admin: IAdmin = {
    id: generateId('admin'),
    username: params.username,
    email: params.email,
    password: params.password,
    nickname: params.nickname,
    avatar: avatarImages.avatarImg2,
    roleId: params.roleId,
    status: 'active',
    lastLoginAt: '',
    lastLoginIp: '',
    createdAt: new Date().toISOString(),
  };

  all.push(admin);
  storage.set(ADMINS_KEY, all);
  return success(admin, '创建成功');
}

async function updateAdmin(id: string, updates: Partial<IAdmin>): Promise<ApiResponse<IAdmin | null>> {
  await delay(150);
  const token = storage.get<string>(ADMIN_TOKEN_KEY, '');
  if (!token) return fail('未登录', 401);

  const all = storage.get<IAdmin[]>(ADMINS_KEY, []);
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return fail('管理员不存在', 404);
  if (all[idx].isSuperAdmin) {
    return fail('超级管理员不可修改', 1005);
  }

  all[idx] = { ...all[idx], ...updates };
  storage.set(ADMINS_KEY, all);

  // 如果是当前登录的管理员，更新缓存
  const current = getCurrentAdmin();
  if (current?.id === id) {
    storage.set(CURRENT_ADMIN_KEY, all[idx]);
  }

  return success(all[idx], '更新成功');
}

async function deleteAdmin(id: string): Promise<ApiResponse<boolean>> {
  await delay(150);
  const token = storage.get<string>(ADMIN_TOKEN_KEY, '');
  if (!token) return fail('未登录', 401);

  const all = storage.get<IAdmin[]>(ADMINS_KEY, []);
  const idx = all.findIndex((a) => a.id === id);
  if (idx === -1) return fail('管理员不存在', 404);
  if (all[idx].isSuperAdmin) {
    return fail('超级管理员不可删除', 1006);
  }

  all.splice(idx, 1);
  storage.set(ADMINS_KEY, all);
  return success(true, '删除成功');
}

async function listRoles(): Promise<ApiResponse<IRole[] | null>> {
  await delay(100);
  const roles = storage.get<IRole[]>(ROLES_KEY, []);
  return success(roles);
}

async function getRoles(): Promise<IRole[]> {
  return storage.get<IRole[]>(ROLES_KEY, []);
}

export const adminService = {
  login,
  logout,
  getCurrentAdmin,
  listAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  listRoles,
  getRoles,
};
