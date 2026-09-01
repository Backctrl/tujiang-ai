// EXPORTS: mockDataService
import { storage, generateId } from '@/lib/storage';
import { avatarImages, bannerImages } from '@lark-apaas/client-toolkit-lite';
import {
  ORDERS_KEY,
  FEEDBACK_KEY,
  STYLES_KEY,
  STYLE_CATEGORIES_KEY,
  CASES_KEY,
  ANNOUNCEMENTS_KEY,
  API_KEYS_KEY,
  API_LOGS_KEY,
  AUDIT_LOGS_KEY,
  ERROR_LOGS_KEY,
  LOGIN_LOGS_KEY,
  PACKAGES_KEY,
  SETTINGS_KEY,
  REFUNDS_KEY,
  type IOrder,
  type IFeedback,
  type IStyleTemplate,
  type IStyleCategory,
  type ICase,
  type IAnnouncement,
  type IApiKey,
  type IApiLog,
  type IAuditLog,
  type IErrorLog,
  type ILoginLog,
  type IRechargePackage,
  type ISystemSettings,
} from '@/data/admin-models';
import { USERS_KEY, type IUser } from '@/data/user';

const STYLE_CATEGORIES: IStyleCategory[] = [
  { id: 'cat_home', name: '家居家具', sort: 1 },
  { id: 'cat_3c', name: '3C数码', sort: 2 },
  { id: 'cat_clothing', name: '服装服饰', sort: 3 },
  { id: 'cat_beauty', name: '美妆护肤', sort: 4 },
  { id: 'cat_food', name: '食品生鲜', sort: 5 },
];

const STYLE_NAMES = [
  { name: '北欧简约', category: 'cat_home', desc: '简约自然的北欧家居风格' },
  { name: '日式原木', category: 'cat_home', desc: '温馨治愈的日式原木风' },
  { name: '现代轻奢', category: 'cat_home', desc: '高端质感的现代轻奢风' },
  { name: '科技未来', category: 'cat_3c', desc: '充满科技感的未来主义' },
  { name: '极简黑白', category: 'cat_3c', desc: '高级感黑白极简风格' },
  { name: '赛博朋克', category: 'cat_3c', desc: '霓虹光影的赛博朋克' },
  { name: '杂志大片', category: 'cat_clothing', desc: '时尚杂志大片风格' },
  { name: '街头潮牌', category: 'cat_clothing', desc: '街头潮流穿搭风格' },
  { name: '法式优雅', category: 'cat_beauty', desc: '浪漫法式优雅风格' },
  { name: '国潮新中式', category: 'cat_beauty', desc: '国风新潮的东方美学' },
];

const PACKAGES: IRechargePackage[] = [
  {
    id: 'pkg_49',
    name: '入门套餐',
    price: 49,
    baseCredits: 3000,
    bonusCredits: 300,
    totalCredits: 3300,
    description: '适合轻度用户',
    status: 'online',
    sort: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'pkg_99',
    name: '标准套餐',
    price: 99,
    baseCredits: 7500,
    bonusCredits: 800,
    totalCredits: 8300,
    description: '性价比之选',
    tag: '热门',
    status: 'online',
    sort: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'pkg_199',
    name: '专业套餐',
    price: 199,
    baseCredits: 18000,
    bonusCredits: 2000,
    totalCredits: 20000,
    description: '专业创作者首选',
    tag: '超值',
    status: 'online',
    sort: 3,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'pkg_499',
    name: '企业套餐',
    price: 499,
    baseCredits: 60000,
    bonusCredits: 8000,
    totalCredits: 68000,
    description: '企业/团队专用',
    tag: '新品',
    status: 'online',
    sort: 4,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];

const DEFAULT_SETTINGS: ISystemSettings = {
  siteName: '图匠AI',
  siteLogo: '',
  siteDescription: 'AI电商详情页生成平台',
  keywords: 'AI生图,电商详情页,商品主图',
  icp: '京ICP备2024000000号',
  supportEmail: 'support@tujiang.ai',
  supportPhone: '400-888-8888',
  homeTitle: '让AI为您打造专业电商详情页',
  homeSubtitle: '一键生成高质量商品主图和详情图',
  bannerImage: bannerImages.minimalismBannerImg1,
  features: [
    { icon: 'Sparkles', title: 'AI智能生成', description: '基于大模型智能生成专业电商图片' },
    { icon: 'Palette', title: '百种风格模板', description: '覆盖各品类的精选风格模板' },
    { icon: 'Zap', title: '秒级出图', description: '快速生成，效率提升10倍' },
    { icon: 'Download', title: '一键下载', description: '高清原图，支持批量下载' },
  ],
  allowRegister: true,
  newUserCredits: 500,
  requireEmailVerify: false,
  registerAgreement: '用户注册协议内容...',
  defaultModel: 'flux-pro',
  defaultImageSize: '2K 1:1',
  dailyGenerateLimit: 100,
  concurrentLimit: 5,
  pointRules: {
    masterPlan: { '2K 1:1': 10, '2K 3:4': 12, '香蕉模型2K 1:1': 15 },
    cloneMaster: 20,
    createWorkshop: { '标准模型': 5, '高级模型': 10, '专业模型': 20 },
    upscale: 3,
    matting: 2,
    newUserBonus: 500,
    dailyLoginBonus: 5,
    inviteReward: { inviter: 100, invitee: 50 },
    inviteFirstRechargePercent: 10,
    refundOnFailure: true,
    refundDeductPercent: 100,
  },
};

// 生成随机日期（最近N天）
function randomDate(daysAgo: number): string {
  const now = Date.now();
  const randomMs = Math.floor(Math.random() * daysAgo * 24 * 60 * 60 * 1000);
  return new Date(now - randomMs).toISOString();
}

// 生成模拟用户
function generateMockUsers(): IUser[] {
  const firstNames = ['张', '王', '李', '赵', '陈', '刘', '杨', '黄', '周', '吴'];
  const lastNames = ['伟', '芳', '娜', '敏', '静', '强', '磊', '洋', '艳', '杰'];
  const users: IUser[] = [];

  for (let i = 0; i < 100; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const nickname = firstName + lastName + (i > 10 ? i : '');
    const emailNum = 1000 + i;
    const avatarIdx = (i % 11) + 1;
    const avatarKey = `avatarImg${avatarIdx}` as keyof typeof avatarImages;

    users.push({
      id: `user_${i + 1}`,
      email: `user${emailNum}@example.com`,
      nickname,
      password: '123456',
      avatar: avatarImages[avatarKey],
      phone: `138${String(10000000 + i).slice(-8)}`,
      createdAt: randomDate(90),
      lastLoginAt: randomDate(7),
      credits: Math.floor(Math.random() * 10000),
      settings: {
        defaultStyleId: '',
        defaultSize: '2K 1:1',
        autoSaveResults: true,
        emailNotification: true,
      },
    });
  }
  return users.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// 生成模拟订单
function generateMockOrders(users: IUser[]): IOrder[] {
  const orders: IOrder[] = [];
  const statuses: IOrder['status'][] = ['paid', 'paid', 'paid', 'paid', 'pending', 'refunded', 'cancelled'];
  const payMethods: IOrder['payMethod'][] = ['wechat', 'alipay', 'other'];

  for (let i = 0; i < 50; i++) {
    const user = users[Math.floor(Math.random() * users.length)];
    const pkg = PACKAGES[Math.floor(Math.random() * PACKAGES.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const createdAt = randomDate(30);
    const paidAt = status === 'paid' || status === 'refunded'
      ? new Date(new Date(createdAt).getTime() + Math.random() * 3600000).toISOString()
      : undefined;

    orders.push({
      id: `order_${i + 1}`,
      orderNo: `TJ${Date.now()}${String(i).padStart(4, '0')}`,
      userId: user.id,
      userName: user.nickname,
      userAvatar: user.avatar,
      packageId: pkg.id,
      packageName: pkg.name,
      amount: pkg.price,
      credits: pkg.totalCredits,
      payMethod: payMethods[Math.floor(Math.random() * payMethods.length)],
      status,
      createdAt,
      paidAt,
      transactionId: paidAt ? `TXN${Date.now()}${i}` : undefined,
    });
  }
  return orders.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// 生成模拟反馈
function generateMockFeedback(users: IUser[]): IFeedback[] {
  const feedbacks: IFeedback[] = [];
  const types: IFeedback['type'][] = ['suggestion', 'bug', 'other'];
  const contents = [
    '希望增加更多风格模板，尤其是国潮风格',
    '生成的图片有时候会变形，能否优化一下？',
    '建议增加批量生成功能',
    '下载图片速度有点慢',
    '客服响应很及时，点赞',
    '能否支持更多尺寸比例？',
    '生成的文案质量有待提升',
    '建议增加历史记录搜索功能',
    '移动端体验不太好',
    '积分有点贵，希望出更多优惠活动',
  ];

  for (let i = 0; i < 20; i++) {
    const user = users[Math.floor(Math.random() * users.length)];
    feedbacks.push({
      id: `feedback_${i + 1}`,
      userId: user.id,
      userName: user.nickname,
      userAvatar: user.avatar,
      type: types[Math.floor(Math.random() * types.length)],
      content: contents[i % contents.length],
      status: i < 10 ? 'resolved' : i < 15 ? 'processing' : 'pending',
      createdAt: randomDate(30),
    });
  }
  return feedbacks.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

// 生成模拟风格模板
function generateMockStyles(): IStyleTemplate[] {
  return STYLE_NAMES.map((s, i) => ({
    id: `style_${i + 1}`,
    name: s.name,
    categoryId: s.category,
    categoryName: STYLE_CATEGORIES.find((c) => c.id === s.category)?.name || '',
    description: s.desc,
    previewImage: bannerImages.minimalismBannerImg1,
    tags: ['热销', '精选', '新品', '推荐'].slice(0, Math.floor(Math.random() * 3) + 1),
    usageCount: Math.floor(Math.random() * 5000) + 100,
    favoriteCount: Math.floor(Math.random() * 500) + 10,
    status: i < 8 ? 'online' : 'offline',
    prompt: `professional product photography, ${s.name} style, high quality`,
    colors: ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef'].slice(0, 3 + Math.floor(Math.random() * 2)),
    categories: [s.category],
    createdAt: randomDate(60),
  }));
}

// 生成模拟案例
function generateMockCases(): ICase[] {
  const cases: ICase[] = [];
  const categories = ['家居家具', '3C数码', '服装服饰', '美妆护肤', '食品生鲜'];
  const styles = ['北欧简约', '科技未来', '杂志大片', '法式优雅', '国潮新中式'];
  const names = [
    '北欧风沙发主图案例',
    '蓝牙耳机科技风详情',
    '连衣裙时尚大片',
    '护肤品法式优雅风',
    '零食国潮风包装',
    '智能手表科技感',
    '瑜伽服运动风',
    '咖啡机现代轻奢',
  ];

  for (let i = 0; i < 12; i++) {
    cases.push({
      id: `case_${i + 1}`,
      name: names[i % names.length] + (i >= names.length ? ` ${i - names.length + 1}` : ''),
      category: categories[i % categories.length],
      style: styles[i % styles.length],
      coverImage: bannerImages.minimalismBannerImg2,
      detailImages: [bannerImages.minimalismBannerImg1, bannerImages.minimalismBannerImg3],
      description: '高质量AI生成的电商详情页案例',
      imageCount: 6 + Math.floor(Math.random() * 5),
      status: i < 10 ? 'online' : 'offline',
      createdAt: randomDate(60),
    });
  }
  return cases;
}

// 生成模拟公告
function generateMockAnnouncements(): IAnnouncement[] {
  return [
    {
      id: 'ann_1',
      title: '系统升级维护通知',
      type: 'system',
      content: '系统将于本周六凌晨2:00-4:00进行升级维护，届时服务将暂时中断，请提前做好安排。',
      status: 'published',
      publishedAt: randomDate(3),
      createdAt: randomDate(5),
    },
    {
      id: 'ann_2',
      title: '新功能上线：AI克隆大师',
      type: 'update',
      content: 'AI克隆大师功能正式上线！一键复刻竞品图文，快速生成自家产品营销图。',
      status: 'published',
      publishedAt: randomDate(7),
      createdAt: randomDate(10),
    },
    {
      id: 'ann_3',
      title: '双11充值优惠活动',
      type: 'activity',
      content: '双11期间充值享8折优惠，最高赠送20000积分！活动时间：11月1日-11月11日。',
      status: 'offline',
      createdAt: randomDate(30),
    },
    {
      id: 'ann_4',
      title: '风格模板征集活动',
      type: 'activity',
      content: '欢迎设计师投稿风格模板，一经采纳可获得丰厚积分奖励！',
      status: 'draft',
      createdAt: randomDate(20),
    },
  ];
}

// 生成模拟API密钥
function generateMockApiKeys(users: IUser[]): IApiKey[] {
  const keys: IApiKey[] = [
    {
      id: 'api_key_1',
      name: '系统主密钥',
      keyPrefix: 'tj_sys_',
      keySuffix: '8x2k9m',
      isSystem: true,
      permissions: ['*'],
      callCount: 125680,
      status: 'active',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastUsedAt: randomDate(0),
    },
    {
      id: 'api_key_2',
      name: '前端应用Key',
      keyPrefix: 'tj_web_',
      keySuffix: '3f7q2w',
      isSystem: true,
      permissions: ['generate:image', 'user:read'],
      callCount: 89450,
      status: 'active',
      createdAt: randomDate(90),
      lastUsedAt: randomDate(0),
    },
  ];

  for (let i = 0; i < 5; i++) {
    const user = users[Math.floor(Math.random() * 10)];
    keys.push({
      id: `api_key_${i + 3}`,
      name: `${user.nickname}的开发密钥`,
      keyPrefix: `tj_${i}p_`,
      keySuffix: `${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      userName: user.nickname,
      isSystem: false,
      permissions: ['generate:image'],
      callCount: Math.floor(Math.random() * 1000),
      status: i < 3 ? 'active' : 'disabled',
      createdAt: randomDate(60),
      lastUsedAt: randomDate(7),
    });
  }
  return keys;
}

// 生成模拟API调用日志
function generateMockApiLogs(): IApiLog[] {
  const logs: IApiLog[] = [];
  const endpoints = [
    '/api/v1/generate/master-plan',
    '/api/v1/generate/clone',
    '/api/v1/generate/image',
    '/api/v1/user/profile',
    '/api/v1/user/credits',
    '/api/v1/records/list',
    '/api/v1/styles/list',
    '/api/v1/upload/image',
  ];
  const methods = ['GET', 'POST'];

  for (let i = 0; i < 200; i++) {
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const isSuccess = Math.random() > 0.05;
    logs.push({
      id: `api_log_${i + 1}`,
      requestId: `req_${Date.now()}_${i}`,
      timestamp: randomDate(7),
      apiKeyName: Math.random() > 0.5 ? '前端应用Key' : '系统主密钥',
      endpoint,
      method: endpoint.includes('/upload') || endpoint.includes('/generate') ? 'POST' : 'GET',
      url: endpoint,
      statusCode: isSuccess ? (Math.random() > 0.5 ? 200 : 201) : 400 + Math.floor(Math.random() * 100),
      responseTime: Math.floor(Math.random() * 2000) + 50,
      ip: `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      requestHeaders: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
      responseHeaders: {
        'content-type': 'application/json',
        'x-request-id': `req_${Date.now()}_${i}`,
      },
      errorMessage: isSuccess ? undefined : '请求参数错误',
    });
  }
  return logs.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

// 生成模拟操作日志
function generateMockAuditLogs(): IAuditLog[] {
  const logs: IAuditLog[] = [];
  const actions: IAuditLog['action'][] = ['create', 'update', 'delete', 'login', 'logout', 'other'];
  const modules = ['用户管理', '订单管理', '风格模板', '系统设置', '角色管理', 'API密钥'];
  const summaries = [
    '新增用户张三',
    '修改订单状态为已退款',
    '下架风格模板"赛博朋克"',
    '更新系统设置',
    '新增角色"运营管理员"',
    '重置API密钥',
    '管理员登录',
    '管理员退出',
    '删除用户',
    '调整用户积分',
  ];

  for (let i = 0; i < 50; i++) {
    const action = actions[Math.floor(Math.random() * actions.length)];
    const module = modules[Math.floor(Math.random() * modules.length)];
    logs.push({
      id: `audit_${i + 1}`,
      timestamp: randomDate(30),
      adminId: 'admin_super',
      adminName: '超级管理员',
      adminAvatar: avatarImages.avatarImg1,
      action,
      module,
      summary: summaries[i % summaries.length],
      ip: `127.0.0.${Math.floor(Math.random() * 10)}`,
    });
  }
  return logs.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

// 生成模拟错误日志
function generateMockErrorLogs(): IErrorLog[] {
  const logs: IErrorLog[] = [];
  const levels: IErrorLog['level'][] = ['ERROR', 'WARN', 'INFO'];
  const types = [
    'NetworkError',
    'TypeError',
    'ValidationError',
    'AuthenticationError',
    'RateLimitError',
  ];
  const messages = [
    '网络连接超时',
    'Cannot read property of undefined',
    '参数校验失败：邮箱格式不正确',
    'Token已过期',
    '调用频率超出限制',
    '数据库连接失败',
    '文件上传失败',
    '图片生成超时',
  ];

  for (let i = 0; i < 30; i++) {
    logs.push({
      id: `error_${i + 1}`,
      timestamp: randomDate(7),
      level: levels[Math.floor(Math.random() * levels.length)],
      type: types[Math.floor(Math.random() * types.length)],
      message: messages[i % messages.length],
      url: '/api/v1/generate',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      isRead: Math.random() > 0.3,
      stack:
        'Error: Network timeout\n    at generateImage (/app/services/ai.ts:123:15)\n    at processTicksAndRejections (node:internal/process/task_queues:96:5)',
    });
  }
  return logs.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

// 生成模拟登录日志
function generateMockLoginLogs(users: IUser[]): ILoginLog[] {
  const logs: ILoginLog[] = [];
  const locations = ['北京市', '上海市', '广州市', '深圳市', '杭州市', '成都市', '武汉市'];
  const devices = [
    'Chrome 120 / Windows 10',
    'Safari 17 / macOS 14',
    'Edge 120 / Windows 11',
    'Firefox 121 / macOS 13',
    'Chrome Mobile / Android 14',
    'Safari Mobile / iOS 17',
  ];

  for (let i = 0; i < 80; i++) {
    const isAdmin = Math.random() > 0.8;
    const user = users[Math.floor(Math.random() * users.length)];
    const isSuccess = Math.random() > 0.1;

    logs.push({
      id: `login_${i + 1}`,
      timestamp: randomDate(30),
      userType: isAdmin ? 'admin' : 'user',
      username: isAdmin ? 'admin' : user.nickname,
      email: isAdmin ? 'admin@tujiang.ai' : user.email,
      ip: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      location: locations[Math.floor(Math.random() * locations.length)],
      device: devices[Math.floor(Math.random() * devices.length)],
      status: isSuccess ? 'success' : 'failed',
      failReason: isSuccess ? undefined : Math.random() > 0.5 ? '密码错误' : '验证码错误',
    });
  }
  return logs.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

// 生成模拟退款申请
function generateMockRefunds(orders: IOrder[]) {
  const paidOrders = orders.filter((o) => o.status === 'paid' || o.status === 'refunded');
  const refunds = paidOrders.slice(0, 8).map((o, i) => ({
    id: `refund_${i + 1}`,
    orderId: o.id,
    orderNo: o.orderNo,
    userId: o.userId,
    userName: o.userName,
    userAvatar: o.userAvatar,
    amount: o.amount,
    reason: i % 3 === 0 ? '用户申请' : i % 3 === 1 ? '重复支付' : '其他',
    remark: '用户要求退款，已确认',
    status: (i < 3 ? 'approved' : i < 6 ? 'pending' : 'rejected') as
      | 'approved'
      | 'pending'
      | 'rejected',
    createdAt: randomDate(15),
    processedAt: i < 3 || i >= 6 ? randomDate(10) : undefined,
  }));
  return refunds;
}

export function initMockData() {
  // 用户数据（和前台共享，如果没有就初始化）
  const users = storage.get<IUser[]>(USERS_KEY, []);
  if (users.length < 10) {
    const mockUsers = generateMockUsers();
    storage.set(USERS_KEY, mockUsers);
  }

  const currentUsers = storage.get<IUser[]>(USERS_KEY, []);

  // 订单
  if (storage.get<IOrder[]>(ORDERS_KEY, []).length === 0) {
    storage.set(ORDERS_KEY, generateMockOrders(currentUsers));
  }

  // 反馈
  if (storage.get<IFeedback[]>(FEEDBACK_KEY, []).length === 0) {
    storage.set(FEEDBACK_KEY, generateMockFeedback(currentUsers));
  }

  // 风格分类
  if (storage.get<IStyleCategory[]>(STYLE_CATEGORIES_KEY, []).length === 0) {
    storage.set(STYLE_CATEGORIES_KEY, STYLE_CATEGORIES);
  }

  // 风格模板
  if (storage.get<IStyleTemplate[]>(STYLES_KEY, []).length === 0) {
    storage.set(STYLES_KEY, generateMockStyles());
  }

  // 案例
  if (storage.get<ICase[]>(CASES_KEY, []).length === 0) {
    storage.set(CASES_KEY, generateMockCases());
  }

  // 公告
  if (storage.get<IAnnouncement[]>(ANNOUNCEMENTS_KEY, []).length === 0) {
    storage.set(ANNOUNCEMENTS_KEY, generateMockAnnouncements());
  }

  // API密钥
  if (storage.get<IApiKey[]>(API_KEYS_KEY, []).length === 0) {
    storage.set(API_KEYS_KEY, generateMockApiKeys(currentUsers));
  }

  // API日志
  if (storage.get<IApiLog[]>(API_LOGS_KEY, []).length === 0) {
    storage.set(API_LOGS_KEY, generateMockApiLogs());
  }

  // 操作日志
  if (storage.get<IAuditLog[]>(AUDIT_LOGS_KEY, []).length === 0) {
    storage.set(AUDIT_LOGS_KEY, generateMockAuditLogs());
  }

  // 错误日志
  if (storage.get<IErrorLog[]>(ERROR_LOGS_KEY, []).length === 0) {
    storage.set(ERROR_LOGS_KEY, generateMockErrorLogs());
  }

  // 登录日志
  if (storage.get<ILoginLog[]>(LOGIN_LOGS_KEY, []).length === 0) {
    storage.set(LOGIN_LOGS_KEY, generateMockLoginLogs(currentUsers));
  }

  // 充值套餐
  if (storage.get<IRechargePackage[]>(PACKAGES_KEY, []).length === 0) {
    storage.set(PACKAGES_KEY, PACKAGES);
  }

  // 系统设置
  if (!storage.get<ISystemSettings>(SETTINGS_KEY, null)) {
    storage.set(SETTINGS_KEY, DEFAULT_SETTINGS);
  }

  // 退款申请
  if (storage.get<any[]>(REFUNDS_KEY, []).length === 0) {
    const orders = storage.get<IOrder[]>(ORDERS_KEY, []);
    storage.set(REFUNDS_KEY, generateMockRefunds(orders));
  }
}

export const mockDataService = {
  initMockData,
};
