// EXPORTS: authService
import type { IUser } from '@/data/user';
import { USERS_KEY, CURRENT_USER_KEY, TOKEN_KEY } from '@/data/user';
import { storage, generateId, delay, success, fail, type ApiResponse } from '@/lib/storage';
import { PRODUCT_IMAGES } from '@/data/history';
import { avatarImages, logger } from '@lark-apaas/client-toolkit-lite';

// 初始化演示账号
function initDemoUser(): IUser {
  const now = new Date().toISOString();
  return {
    id: 'user_demo',
    email: 'demo@tujiang.ai',
    nickname: '演示用户',
    password: 'Demo123456',
    avatar: avatarImages.avatarImg3,
    phone: '',
    createdAt: now,
    lastLoginAt: now,
    credits: 10000,
    settings: {
      defaultStyleId: '1',
      defaultSize: '2k-1-1',
      autoSaveResults: true,
      emailNotification: false,
    },
  };
}

// 确保用户表初始化
function ensureUsers(): IUser[] {
  const users = storage.get<IUser[]>(USERS_KEY, []);
  if (users.length === 0) {
    const demo = initDemoUser();
    users.push(demo);
    storage.set(USERS_KEY, users);
  }
  return users;
}

// 密码校验
function validatePassword(pwd: string): string | null {
  if (pwd.length < 8) return '密码至少8位';
  if (!/[a-zA-Z]/.test(pwd)) return '密码必须包含字母';
  if (!/\d/.test(pwd)) return '密码必须包含数字';
  return null;
}

// 邮箱校验
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 生成 token（简单模拟）
function generateToken(userId: string): string {
  return `tk_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function register(params: {
  email: string;
  nickname: string;
  password: string;
}): Promise<ApiResponse<{ user: IUser; token: string } | null>> {
  await delay(500);

  if (!validateEmail(params.email)) {
    return fail('邮箱格式不正确');
  }
  if (params.nickname.length < 2 || params.nickname.length > 20) {
    return fail('昵称长度需在2-20字符之间');
  }
  const pwdError = validatePassword(params.password);
  if (pwdError) return fail(pwdError);

  const users = ensureUsers();
  if (users.some((u) => u.email.toLowerCase() === params.email.toLowerCase())) {
    return fail('该邮箱已被注册');
  }

  const now = new Date().toISOString();
  const newUser: IUser = {
    id: generateId('user'),
    email: params.email,
    nickname: params.nickname,
    password: params.password,
    avatar: avatarImages.avatarImg2,
    phone: '',
    createdAt: now,
    lastLoginAt: now,
    credits: 500, // 新用户赠送500积分
    settings: {
      defaultStyleId: '1',
      defaultSize: '2k-1-1',
      autoSaveResults: true,
      emailNotification: false,
    },
  };

  users.push(newUser);
  storage.set(USERS_KEY, users);

  const token = generateToken(newUser.id);
  storage.set(CURRENT_USER_KEY, newUser.id);
  storage.set(TOKEN_KEY, token);

  return success({ user: newUser, token }, '注册成功');
}

async function login(params: {
  email: string;
  password: string;
  remember?: boolean;
}): Promise<ApiResponse<{ user: IUser; token: string } | null>> {
  await delay(400);

  const users = ensureUsers();
  const user = users.find(
    (u) => u.email.toLowerCase() === params.email.toLowerCase() && u.password === params.password,
  );

  if (!user) {
    return fail('邮箱或密码错误');
  }

  // 更新最后登录时间
  user.lastLoginAt = new Date().toISOString();
  storage.set(USERS_KEY, users);

  const token = generateToken(user.id);
  storage.set(CURRENT_USER_KEY, user.id);
  storage.set(TOKEN_KEY, token);

  // 记住我：通过 token 过期时间模拟（原型简化）
  if (params.remember) {
    storage.set('__app_tujiang_remember', '1');
  } else {
    storage.remove('__app_tujiang_remember');
  }

  return success({ user, token }, '登录成功');
}

async function logout(): Promise<ApiResponse<boolean>> {
  await delay(150);
  storage.remove(CURRENT_USER_KEY);
  storage.remove(TOKEN_KEY);
  return success(true, '已退出登录');
}

// 检查当前登录状态
function getCurrentUser(): IUser | null {
  const userId = storage.get<string | null>(CURRENT_USER_KEY, null);
  if (!userId) return null;

  const token = storage.get<string | null>(TOKEN_KEY, null);
  if (!token) return null;

  const users = storage.get<IUser[]>(USERS_KEY, []);
  return users.find((u) => u.id === userId) || null;
}

// 忘记密码 - 发送验证码（模拟）
const verificationCodes = new Map<string, { code: string; expires: number }>();

async function sendVerificationCode(email: string): Promise<ApiResponse<boolean>> {
  await delay(600);

  if (!validateEmail(email)) {
    return fail('邮箱格式不正确');
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes.set(email.toLowerCase(), {
    code,
    expires: Date.now() + 5 * 60 * 1000, // 5分钟有效
  });

  // 原型：在控制台和 toast 中显示验证码
  // eslint-disable-next-line no-console
  logger.info(`[图匠AI] 重置密码验证码：${code}（邮箱：${email}）`);

  return success(true, `验证码已发送（演示：${code}）`);
}

async function resetPassword(params: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<ApiResponse<boolean>> {
  await delay(400);

  const pwdError = validatePassword(params.newPassword);
  if (pwdError) return fail(pwdError);

  const entry = verificationCodes.get(params.email.toLowerCase());
  if (!entry) return fail('请先获取验证码');
  if (entry.expires < Date.now()) return fail('验证码已过期');
  if (entry.code !== params.code) return fail('验证码错误');

  const users = ensureUsers();
  const user = users.find((u) => u.email.toLowerCase() === params.email.toLowerCase());
  if (!user) return fail('该邮箱未注册');

  user.password = params.newPassword;
  storage.set(USERS_KEY, users);
  verificationCodes.delete(params.email.toLowerCase());

  return success(true, '密码重置成功');
}

// 更新用户信息
async function updateProfile(updates: Partial<IUser>): Promise<ApiResponse<IUser | null>> {
  await delay(300);

  const user = getCurrentUser();
  if (!user) return fail('未登录', 401);

  const users = storage.get<IUser[]>(USERS_KEY, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx === -1) return fail('用户不存在', 404);

  // 不允许直接修改 id / email / password / credits
  const { id, email, password, credits, ...safeUpdates } = updates;
  users[idx] = { ...users[idx], ...safeUpdates };
  storage.set(USERS_KEY, users);

  return success(users[idx], '更新成功');
}

// 修改密码
async function changePassword(params: {
  oldPassword: string;
  newPassword: string;
}): Promise<ApiResponse<boolean>> {
  await delay(300);

  const user = getCurrentUser();
  if (!user) return fail('未登录', 401);

  if (user.password !== params.oldPassword) {
    return fail('当前密码错误');
  }

  const pwdError = validatePassword(params.newPassword);
  if (pwdError) return fail(pwdError);

  const users = storage.get<IUser[]>(USERS_KEY, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx !== -1) {
    users[idx].password = params.newPassword;
    storage.set(USERS_KEY, users);
  }

  return success(true, '密码修改成功');
}

// 上传头像
async function uploadAvatar(dataUrl: string): Promise<ApiResponse<{ avatarUrl: string } | null>> {
  await delay(400);

  const user = getCurrentUser();
  if (!user) return fail('未登录', 401);

  const users = storage.get<IUser[]>(USERS_KEY, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx !== -1) {
    users[idx].avatar = dataUrl;
    storage.set(USERS_KEY, users);
    return success({ avatarUrl: dataUrl }, '头像更新成功');
  }

  return fail('用户不存在', 404);
}

export const authService = {
  register,
  login,
  logout,
  getCurrentUser,
  sendVerificationCode,
  resetPassword,
  updateProfile,
  changePassword,
  uploadAvatar,
  validateEmail,
};
