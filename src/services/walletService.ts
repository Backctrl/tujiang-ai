// EXPORTS: ICreditTransaction, walletService
import type { IUser } from '@/data/user';
import { USERS_KEY } from '@/data/user';
import { authService } from './authService';
import { storage, generateId, delay, success, fail, type ApiResponse } from '@/lib/storage';

export interface ICreditTransaction {
  id: string;
  userId: string;
  type: 'recharge' | 'consume' | 'gift' | 'refund';
  typeLabel: string;
  amount: number;
  balance: number;
  relatedRecordId?: string;
  remark: string;
  createdAt: string;
}

const TRANSACTIONS_KEY = '__app_tujiang_transactions';

const TYPE_LABELS: Record<ICreditTransaction['type'], string> = {
  recharge: '充值',
  consume: '消耗',
  gift: '赠送',
  refund: '退款',
};

async function addTransaction(params: {
  type: ICreditTransaction['type'];
  amount: number;
  relatedRecordId?: string;
  remark: string;
}): Promise<ICreditTransaction | null> {
  const user = authService.getCurrentUser();
  if (!user) return null;

  const tx: ICreditTransaction = {
    id: generateId('tx'),
    userId: user.id,
    type: params.type,
    typeLabel: TYPE_LABELS[params.type],
    amount: params.amount,
    balance: user.credits + (params.type === 'consume' ? -params.amount : params.amount),
    relatedRecordId: params.relatedRecordId,
    remark: params.remark,
    createdAt: new Date().toISOString(),
  };

  const txs = storage.get<ICreditTransaction[]>(TRANSACTIONS_KEY, []);
  txs.unshift(tx);
  storage.set(TRANSACTIONS_KEY, txs);

  return tx;
}

async function getBalance(): Promise<ApiResponse<{ balance: number } | null>> {
  await delay(100);
  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);
  return success({ balance: user.credits });
}

async function getTransactions(params: {
  page?: number;
  pageSize?: number;
  type?: 'all' | 'recharge' | 'consume' | 'gift' | 'refund';
}): Promise<
  ApiResponse<{
    list: ICreditTransaction[];
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

  const all = storage.get<ICreditTransaction[]>(TRANSACTIONS_KEY, []);
  let filtered = all.filter((t) => t.userId === user.id);

  if (params.type && params.type !== 'all') {
    filtered = filtered.filter((t) => t.type === params.type);
  }

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const list = filtered.slice(start, start + pageSize);

  return success({ list, total, page, pageSize });
}

async function recharge(params: {
  packageId: string;
  amount: number;
  credits: number;
  paymentMethod?: string;
}): Promise<ApiResponse<{ balance: number; transaction: ICreditTransaction } | null>> {
  await delay(800); // 模拟支付

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  // 更新用户余额
  const users = storage.get<IUser[]>(USERS_KEY, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx === -1) return fail('用户不存在', 404);

  const creditAmount = params.credits > 0 ? params.credits : params.amount; // 兼容旧调用
  users[idx].credits += creditAmount;
  storage.set(USERS_KEY, users);

  // 写入流水
  const tx = await addTransaction({
    type: 'recharge',
    amount: creditAmount,
    remark: `充值套餐 ${params.packageId}，支付 ¥${params.amount}`,
  });

  if (!tx) return fail('流水记录失败');

  return success(
    { balance: users[idx].credits, transaction: tx },
    '充值成功',
  );
}

async function deductCredits(params: {
  amount: number;
  relatedRecordId?: string;
  remark: string;
}): Promise<ApiResponse<{ balance: number; transaction: ICreditTransaction } | null>> {
  await delay(150);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  if (user.credits < params.amount) {
    return fail('积分不足，请充值');
  }

  const users = storage.get<IUser[]>(USERS_KEY, []);
  const idx = users.findIndex((u) => u.id === user.id);
  if (idx === -1) return fail('用户不存在', 404);

  users[idx].credits -= params.amount;
  storage.set(USERS_KEY, users);

  const tx = await addTransaction({
    type: 'consume',
    amount: params.amount,
    relatedRecordId: params.relatedRecordId,
    remark: params.remark,
  });

  if (!tx) return fail('流水记录失败');

  return success(
    { balance: users[idx].credits, transaction: tx },
    '扣减成功',
  );
}

export const walletService = {
  getBalance,
  getTransactions,
  recharge,
  deductCredits,
};
