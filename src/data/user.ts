// EXPORTS: IUser, USER_STORAGE_KEY, CURRENT_USER_KEY
export interface IUser {
  id: string;
  email: string;
  nickname: string;
  password: string; // 注意：原型用明文存储，生产环境需加密
  avatar: string;
  phone: string;
  createdAt: string;
  lastLoginAt: string;
  credits: number;
  settings: {
    defaultStyleId: string;
    defaultSize: string;
    autoSaveResults: boolean;
    emailNotification: boolean;
  };
}

export const USERS_KEY = '__app_tujiang_users';
export const CURRENT_USER_KEY = '__app_tujiang_current_user';
export const TOKEN_KEY = '__app_tujiang_token';
