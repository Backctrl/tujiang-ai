// EXPORTS: ORDER_STORAGE_KEY, IOrder, IFeedback, IStyleTemplate, ICase, IAnnouncement, IApiKey, IApiLog, IAuditLog, IErrorLog, ILoginLog, IRechargePackage, ISystemSettings
export interface IOrder {
  id: string;
  orderNo: string;
  userId: string;
  userName: string;
  userAvatar: string;
  packageId: string;
  packageName: string;
  amount: number;
  credits: number;
  payMethod: 'wechat' | 'alipay' | 'other';
  status: 'pending' | 'paid' | 'refunded' | 'cancelled';
  createdAt: string;
  paidAt?: string;
  transactionId?: string;
}

export interface IFeedback {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  type: 'suggestion' | 'bug' | 'other';
  content: string;
  status: 'pending' | 'processing' | 'resolved';
  reply?: string;
  createdAt: string;
  repliedAt?: string;
}

export interface IStyleCategory {
  id: string;
  name: string;
  sort: number;
}

export interface IStyleTemplate {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  description: string;
  previewImage: string;
  tags: string[];
  usageCount: number;
  favoriteCount: number;
  status: 'online' | 'offline';
  prompt: string;
  colors: string[];
  categories: string[];
  createdAt: string;
}

export interface ICase {
  id: string;
  name: string;
  category: string;
  style: string;
  coverImage: string;
  detailImages: string[];
  description: string;
  imageCount: number;
  status: 'online' | 'offline';
  createdAt: string;
}

export interface IAnnouncement {
  id: string;
  title: string;
  type: 'system' | 'activity' | 'update';
  content: string;
  status: 'draft' | 'published' | 'offline';
  publishedAt?: string;
  createdAt: string;
}

export interface IApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  keySuffix: string;
  fullKey?: string;
  userId?: string;
  userName?: string;
  isSystem: boolean;
  permissions: string[];
  callCount: number;
  status: 'active' | 'disabled';
  createdAt: string;
  lastUsedAt: string;
  expiresAt?: string;
  rateLimit?: { perMinute: number; perDay: number; perMonth: number };
}

export interface IApiLog {
  id: string;
  requestId: string;
  timestamp: string;
  userId?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  endpoint: string;
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  ip: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseHeaders: Record<string, string>;
  responseBody?: string;
  errorMessage?: string;
}

export interface IAuditLog {
  id: string;
  timestamp: string;
  adminId: string;
  adminName: string;
  adminAvatar: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'other';
  module: string;
  summary: string;
  ip: string;
  requestParams?: Record<string, any>;
  beforeData?: Record<string, any>;
  afterData?: Record<string, any>;
}

export interface IErrorLog {
  id: string;
  timestamp: string;
  level: 'ERROR' | 'WARN' | 'INFO';
  type: string;
  message: string;
  url?: string;
  userId?: string;
  stack?: string;
  requestHeaders?: Record<string, string>;
  requestParams?: Record<string, any>;
  userAgent?: string;
  isRead: boolean;
}

export interface ILoginLog {
  id: string;
  timestamp: string;
  userType: 'admin' | 'user';
  username: string;
  email: string;
  ip: string;
  location: string;
  device: string;
  status: 'success' | 'failed';
  failReason?: string;
}

export interface IRechargePackage {
  id: string;
  name: string;
  price: number;
  baseCredits: number;
  bonusCredits: number;
  totalCredits: number;
  description: string;
  tag?: string;
  status: 'online' | 'offline';
  sort: number;
  createdAt: string;
}

export interface ISystemSettings {
  siteName: string;
  siteLogo: string;
  siteDescription: string;
  keywords: string;
  icp: string;
  supportEmail: string;
  supportPhone: string;
  homeTitle: string;
  homeSubtitle: string;
  bannerImage: string;
  features: { icon: string; title: string; description: string }[];
  allowRegister: boolean;
  newUserCredits: number;
  requireEmailVerify: boolean;
  registerAgreement: string;
  defaultModel: string;
  defaultImageSize: string;
  dailyGenerateLimit: number;
  concurrentLimit: number;
  pointRules: {
    masterPlan: Record<string, number>;
    cloneMaster: number;
    createWorkshop: Record<string, number>;
    upscale: number;
    matting: number;
    newUserBonus: number;
    dailyLoginBonus: number;
    inviteReward: { inviter: number; invitee: number };
    inviteFirstRechargePercent: number;
    refundOnFailure: boolean;
    refundDeductPercent: number;
  };
}

export const ORDERS_KEY = '__app_tujiang_admin_orders';
export const FEEDBACK_KEY = '__app_tujiang_admin_feedback';
export const STYLES_KEY = '__app_tujiang_admin_styles';
export const STYLE_CATEGORIES_KEY = '__app_tujiang_admin_style_categories';
export const CASES_KEY = '__app_tujiang_admin_cases';
export const ANNOUNCEMENTS_KEY = '__app_tujiang_admin_announcements';
export const API_KEYS_KEY = '__app_tujiang_admin_api_keys';
export const API_LOGS_KEY = '__app_tujiang_admin_api_logs';
export const AUDIT_LOGS_KEY = '__app_tujiang_admin_audit_logs';
export const ERROR_LOGS_KEY = '__app_tujiang_admin_error_logs';
export const LOGIN_LOGS_KEY = '__app_tujiang_admin_login_logs';
export const PACKAGES_KEY = '__app_tujiang_admin_packages';
export const SETTINGS_KEY = '__app_tujiang_admin_settings';
export const REFUNDS_KEY = '__app_tujiang_admin_refunds';
