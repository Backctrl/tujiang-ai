// EXPORTS: IGenerationRecord, recordsService
import { authService } from './authService';
import { storage, generateId, delay, success, fail, type ApiResponse } from '@/lib/storage';
import { PRODUCT_IMAGES } from '@/data/history';
import type { IStyle } from '@/data/styles';

export interface IGenerationRecord {
  id: string;
  userId: string;
  type: 'masterplan' | 'clone' | 'workshop';
  typeLabel: string;
  thumbnail: string;
  images: string[];
  creditsCost: number;
  status: 'success' | 'failed' | 'processing';
  config: Record<string, unknown>;
  createdAt: string;
  imageCount: number;
  deleted?: boolean;
}

const RECORDS_KEY = '__app_tujiang_records';

const TYPE_LABELS: Record<IGenerationRecord['type'], string> = {
  masterplan: 'AI主图详情全案',
  clone: 'AI克隆大师',
  workshop: 'AI创图工坊',
};

// 初始化演示数据（属于演示账号）
function ensureDemoRecords(userId: string) {
  const all = storage.get<IGenerationRecord[]>(RECORDS_KEY, []);
  if (all.length > 0) return;

  const baseTime = Date.now();
  const demoRecords: IGenerationRecord[] = [
    {
      id: 'rec_demo_1',
      userId,
      type: 'masterplan',
      typeLabel: TYPE_LABELS.masterplan,
      thumbnail: PRODUCT_IMAGES[0],
      images: PRODUCT_IMAGES.slice(0, 6),
      creditsCost: 80,
      status: 'success',
      config: { style: '北欧简约', count: 6 },
      createdAt: new Date(baseTime - 1000 * 60 * 30).toISOString(),
      imageCount: 6,
    },
    {
      id: 'rec_demo_2',
      userId,
      type: 'clone',
      typeLabel: TYPE_LABELS.clone,
      thumbnail: PRODUCT_IMAGES[1],
      images: PRODUCT_IMAGES.slice(0, 4),
      creditsCost: 40,
      status: 'success',
      config: { mode: '一键克隆', ratio: '1:1' },
      createdAt: new Date(baseTime - 1000 * 60 * 60 * 2).toISOString(),
      imageCount: 4,
    },
    {
      id: 'rec_demo_3',
      userId,
      type: 'masterplan',
      typeLabel: TYPE_LABELS.masterplan,
      thumbnail: PRODUCT_IMAGES[2],
      images: PRODUCT_IMAGES.slice(0, 9),
      creditsCost: 120,
      status: 'success',
      config: { style: '高级冷淡', count: 9 },
      createdAt: new Date(baseTime - 1000 * 60 * 60 * 24).toISOString(),
      imageCount: 9,
    },
    {
      id: 'rec_demo_4',
      userId,
      type: 'workshop',
      typeLabel: TYPE_LABELS.workshop,
      thumbnail: PRODUCT_IMAGES[3],
      images: PRODUCT_IMAGES.slice(0, 2),
      creditsCost: 10,
      status: 'success',
      config: { prompt: '夏季连衣裙', style: '电商产品图' },
      createdAt: new Date(baseTime - 1000 * 60 * 60 * 24 * 2).toISOString(),
      imageCount: 2,
    },
    {
      id: 'rec_demo_5',
      userId,
      type: 'masterplan',
      typeLabel: TYPE_LABELS.masterplan,
      thumbnail: PRODUCT_IMAGES[4],
      images: PRODUCT_IMAGES.slice(0, 8),
      creditsCost: 60,
      status: 'success',
      config: { style: '科技未来', count: 8 },
      createdAt: new Date(baseTime - 1000 * 60 * 60 * 24 * 3).toISOString(),
      imageCount: 8,
    },
    {
      id: 'rec_demo_6',
      userId,
      type: 'clone',
      typeLabel: TYPE_LABELS.clone,
      thumbnail: PRODUCT_IMAGES[5],
      images: PRODUCT_IMAGES.slice(0, 5),
      creditsCost: 50,
      status: 'processing',
      config: { mode: '自定义克隆' },
      createdAt: new Date(baseTime - 1000 * 60 * 10).toISOString(),
      imageCount: 5,
    },
  ];

  storage.set(RECORDS_KEY, demoRecords);
}

// 初次加载时确保演示数据存在
export function ensureRecords() {
  const user = authService.getCurrentUser();
  if (user) {
    ensureDemoRecords(user.id);
  }
}

async function getRecords(params: {
  page?: number;
  pageSize?: number;
  type?: 'all' | 'masterplan' | 'clone' | 'workshop';
  sort?: 'desc' | 'asc';
}): Promise<
  ApiResponse<{
    list: IGenerationRecord[];
    total: number;
    page: number;
    pageSize: number;
  } | null>
> {
  await delay(200);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const sort = params.sort ?? 'desc';

  ensureDemoRecords(user.id);
  const all = storage.get<IGenerationRecord[]>(RECORDS_KEY, []);
  let filtered = all.filter((r) => r.userId === user.id && !r.deleted);

  if (params.type && params.type !== 'all') {
    filtered = filtered.filter((r) => r.type === params.type);
  }

  filtered.sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sort === 'desc' ? -diff : diff;
  });

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const list = filtered.slice(start, start + pageSize);

  return success({ list, total, page, pageSize });
}

async function getRecord(id: string): Promise<ApiResponse<IGenerationRecord | null>> {
  await delay(100);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  const all = storage.get<IGenerationRecord[]>(RECORDS_KEY, []);
  const record = all.find((r) => r.id === id && r.userId === user.id && !r.deleted);

  if (!record) return fail('记录不存在', 404);
  return success(record);
}

async function createRecord(params: {
  type: IGenerationRecord['type'];
  images: string[];
  creditsCost: number;
  status?: IGenerationRecord['status'];
  config: Record<string, unknown>;
}): Promise<ApiResponse<IGenerationRecord | null>> {
  await delay(150);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  ensureDemoRecords(user.id);

  const record: IGenerationRecord = {
    id: generateId('rec'),
    userId: user.id,
    type: params.type,
    typeLabel: TYPE_LABELS[params.type],
    thumbnail: params.images[0] || '',
    images: params.images,
    creditsCost: params.creditsCost,
    status: params.status ?? 'success',
    config: params.config,
    createdAt: new Date().toISOString(),
    imageCount: params.images.length,
  };

  const all = storage.get<IGenerationRecord[]>(RECORDS_KEY, []);
  all.unshift(record);
  storage.set(RECORDS_KEY, all);

  return success(record, '创建成功');
}

async function deleteRecord(id: string): Promise<ApiResponse<boolean>> {
  await delay(200);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  const all = storage.get<IGenerationRecord[]>(RECORDS_KEY, []);
  const idx = all.findIndex((r) => r.id === id && r.userId === user.id);

  if (idx === -1) return fail('记录不存在', 404);

  all[idx].deleted = true;
  storage.set(RECORDS_KEY, all);

  return success(true, '删除成功');
}

export const recordsService = {
  getRecords,
  getRecord,
  createRecord,
  deleteRecord,
  ensureRecords,
};
