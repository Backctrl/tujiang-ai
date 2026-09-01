// EXPORTS: storage
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';

// 简单的 JSON 序列化/反序列化封装
export const storage = {
  get<T>(key: string, defaultValue: T): T {
    try {
      const raw = scopedStorage.getItem(key);
      if (raw === null || raw === undefined) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  },

  set<T>(key: string, value: T): void {
    try {
      scopedStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // ignore
    }
  },

  remove(key: string): void {
    try {
      scopedStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

// 生成唯一ID
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 统一响应格式
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export function success<T>(data: T, message = 'success'): ApiResponse<T> {
  return { code: 0, message, data };
}

export function fail<T>(message: string, code = 1): ApiResponse<T | null> {
  return { code, message, data: null };
}

// 模拟网络延迟
export function delay(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
