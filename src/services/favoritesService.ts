// EXPORTS: favoritesService
import { authService } from './authService';
import { storage, delay, success, fail, type ApiResponse } from '@/lib/storage';

export interface IFavorite {
  userId: string;
  styleId: string;
  createdAt: string;
}

const FAVORITES_KEY = '__app_tujiang_favorites';

function getKey(userId: string, styleId: string): string {
  return `${userId}:${styleId}`;
}

async function getFavorites(): Promise<ApiResponse<{ styleIds: string[] } | null>> {
  await delay(100);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  const all = storage.get<IFavorite[]>(FAVORITES_KEY, []);
  const styleIds = all.filter((f) => f.userId === user.id).map((f) => f.styleId);

  return success({ styleIds });
}

async function isFavorite(styleId: string): Promise<boolean> {
  const user = authService.getCurrentUser();
  if (!user) return false;

  const all = storage.get<IFavorite[]>(FAVORITES_KEY, []);
  return all.some((f) => f.userId === user.id && f.styleId === styleId);
}

async function addFavorite(styleId: string): Promise<ApiResponse<boolean>> {
  await delay(150);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  const all = storage.get<IFavorite[]>(FAVORITES_KEY, []);
  if (all.some((f) => f.userId === user.id && f.styleId === styleId)) {
    return success(true, '已收藏');
  }

  all.push({
    userId: user.id,
    styleId,
    createdAt: new Date().toISOString(),
  });
  storage.set(FAVORITES_KEY, all);

  return success(true, '收藏成功');
}

async function removeFavorite(styleId: string): Promise<ApiResponse<boolean>> {
  await delay(150);

  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  const all = storage.get<IFavorite[]>(FAVORITES_KEY, []);
  const filtered = all.filter((f) => !(f.userId === user.id && f.styleId === styleId));
  storage.set(FAVORITES_KEY, filtered);

  return success(true, '取消收藏');
}

async function toggleFavorite(styleId: string): Promise<ApiResponse<{ favorited: boolean } | null>> {
  const user = authService.getCurrentUser();
  if (!user) return fail('未登录', 401);

  const all = storage.get<IFavorite[]>(FAVORITES_KEY, []);
  const exists = all.some((f) => f.userId === user.id && f.styleId === styleId);

  if (exists) {
    await removeFavorite(styleId);
    return success({ favorited: false }, '取消收藏');
  } else {
    await addFavorite(styleId);
    return success({ favorited: true }, '收藏成功');
  }
}

export const favoritesService = {
  getFavorites,
  isFavorite,
  addFavorite,
  removeFavorite,
  toggleFavorite,
};
