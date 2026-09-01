// EXPORTS: IAdmin, IRole, ADMINS_KEY, CURRENT_ADMIN_KEY, ADMIN_TOKEN_KEY
export interface IRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem?: boolean;
  createdAt: string;
}

export interface IAdmin {
  id: string;
  username: string;
  email: string;
  password: string;
  nickname: string;
  avatar: string;
  roleId: string;
  status: 'active' | 'disabled';
  isSuperAdmin?: boolean;
  lastLoginAt: string;
  lastLoginIp: string;
  createdAt: string;
}

export const ADMINS_KEY = '__app_tujiang_admins';
export const ROLES_KEY = '__app_tujiang_roles';
export const CURRENT_ADMIN_KEY = '__app_tujiang_current_admin';
export const ADMIN_TOKEN_KEY = '__app_tujiang_admin_token';

// 预置角色
export const DEFAULT_ROLES: IRole[] = [
  {
    id: 'role_super',
    name: '超级管理员',
    description: '拥有系统全部权限',
    permissions: ['*'],
    isSystem: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'role_operation',
    name: '运营管理员',
    description: '负责用户管理、内容管理、订单管理',
    permissions: [
      'dashboard:view',
      'users:view', 'users:edit',
      'feedback:view', 'feedback:edit',
      'orders:view', 'orders:edit',
      'revenue:view',
      'styles:view', 'styles:edit',
      'cases:view', 'cases:edit',
      'announcements:view', 'announcements:edit',
    ],
    isSystem: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'role_finance',
    name: '财务管理员',
    description: '负责订单、营收、退款管理',
    permissions: [
      'dashboard:view',
      'orders:view',
      'revenue:view',
      'refunds:view', 'refunds:edit',
    ],
    isSystem: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'role_tech',
    name: '技术管理员',
    description: '负责API管理、系统设置、系统监控',
    permissions: [
      'dashboard:view',
      'api-keys:view', 'api-keys:edit',
      'api-logs:view',
      'services:view', 'services:edit',
      'settings:view', 'settings:edit',
      'audit-logs:view',
      'error-logs:view',
      'login-logs:view',
      'system-status:view',
    ],
    isSystem: true,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];
