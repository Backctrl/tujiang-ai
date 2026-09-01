import { useState, useRef, type ChangeEvent } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  User,
  Mail,
  Phone,
  Calendar,
  Camera,
  Pencil,
  Check,
  Shield,
  Settings,
  Monitor,
  Trash2,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { authService } from '@/services/authService';
import { MOCK_STYLES } from '@/data/styles';
import { Image } from '@/components/ui/image';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { useNavigate } from 'react-router-dom';

const SIZE_OPTIONS = [
  { value: '2k-1-1', label: '2K 1:1' },
  { value: '2k-3-4', label: '2K 3:4' },
  { value: '1k-9-16', label: '1K 9:16' },
  { value: '2k-9-16', label: '2K 9:16' },
];

const LOGIN_DEVICES = [
  {
    id: 'current',
    name: '当前设备 · Chrome on MacOS',
    ip: '192.168.1.100',
    location: '上海',
    lastActive: '刚刚',
    current: true,
  },
  {
    id: '1',
    name: 'iPhone 15 Pro',
    ip: '114.88.12.33',
    location: '上海',
    lastActive: '2小时前',
    current: false,
  },
  {
    id: '2',
    name: 'Safari on iPad',
    ip: '223.104.5.67',
    location: '北京',
    lastActive: '昨天 14:30',
    current: false,
  },
];

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout, updateUser, refreshUser } = useAuth();

  const [editingNickname, setEditingNickname] = useState(false);
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [phoneCode, setPhoneCode] = useState('');
  const [bindingPhone, setBindingPhone] = useState(false);

  // 账号安全 - 修改密码
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPwd, setIsChangingPwd] = useState(false);

  // 偏好设置
  const [defaultStyleId, setDefaultStyleId] = useState(user?.settings.defaultStyleId || '1');
  const [defaultSize, setDefaultSize] = useState(user?.settings.defaultSize || '2k-1-1');
  const [autoSaveResults, setAutoSaveResults] = useState(user?.settings.autoSaveResults ?? true);
  const [emailNotification, setEmailNotification] = useState(
    user?.settings.emailNotification ?? false,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 类型校验：必须是图片文件
    if (!file.type?.startsWith('image/')) {
      toast.error('请上传图片文件作为头像');
      e.target.value = '';
      return;
    }
    // 大小校验：≤ 5MB
    if (file.size > 5 * 1024 * 1024) {
      toast.error('头像图片不能超过 5MB');
      e.target.value = '';
      return;
    }

    // 读取图片并校验有效性
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      // 预加载校验图片内容是否有效
      const img = new window.Image();
      img.onload = async () => {
        const res = await authService.uploadAvatar(dataUrl);
        if (res.code === 0 && res.data) {
          updateUser({ avatar: res.data.avatarUrl });
          toast.success('头像更新成功');
        } else {
          toast.error(res.message || '更新失败');
        }
      };
      img.onerror = () => {
        toast.error('图片文件损坏或格式不支持');
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      toast.error('读取文件失败');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveNickname = async () => {
    if (!nickname.trim() || nickname.length < 2 || nickname.length > 20) {
      toast.error('昵称长度需在2-20字符之间');
      return;
    }
    const res = await authService.updateProfile({ nickname: nickname.trim() });
    if (res.code === 0 && res.data) {
      updateUser({ nickname: res.data.nickname });
      setEditingNickname(false);
      toast.success('昵称修改成功');
    } else {
      toast.error(res.message || '修改失败');
    }
  };

  const handleBindPhone = async () => {
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      toast.error('请输入正确的手机号');
      return;
    }
    if (!phoneCode || phoneCode.length !== 6) {
      toast.error('请输入6位验证码');
      return;
    }
    const res = await authService.updateProfile({ phone });
    if (res.code === 0 && res.data) {
      updateUser({ phone: res.data.phone });
      setBindingPhone(false);
      setPhoneCode('');
      toast.success('手机号绑定成功');
    } else {
      toast.error(res.message || '绑定失败');
    }
  };

  const handleSendPhoneCode = () => {
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      toast.error('请输入正确的手机号');
      return;
    }
    toast.success('验证码已发送（演示：123456）');
    // 模拟验证码
    // eslint-disable-next-line no-console
    logger.info('[图匠AI] 手机验证码：123456');
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      toast.error('请填写所有密码字段');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setIsChangingPwd(true);
    try {
      const res = await authService.changePassword({ oldPassword, newPassword });
      if (res.code === 0) {
        toast.success('密码修改成功');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(res.message || '修改失败');
      }
    } finally {
      setIsChangingPwd(false);
    }
  };

  const handleSaveSettings = async () => {
    const res = await authService.updateProfile({
      settings: {
        defaultStyleId,
        defaultSize,
        autoSaveResults,
        emailNotification,
      },
    });
    if (res.code === 0 && res.data) {
      updateUser({ settings: res.data.settings });
      toast.success('偏好设置已保存');
    } else {
      toast.error(res.message || '保存失败');
    }
  };

  const handleRemoveDevice = (id: string) => {
    toast.info('设备已下线（演示）');
  };

  const registerDate = format(new Date(user.createdAt), 'yyyy年MM月dd日', { locale: zhCN });

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <User className="size-6 text-primary" />
            个人中心
          </h1>
          <p className="text-muted-foreground mt-1">管理你的账号信息和偏好设置</p>
        </div>

        <div className="space-y-6">
          {/* 基本信息 */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="size-5 text-primary" />
                基本信息
              </CardTitle>
              <CardDescription>你的个人资料和账号信息</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 头像 */}
              <div className="flex items-center gap-6">
                <div className="relative group">
                  <div className="size-20 rounded-full overflow-hidden ring-4 ring-primary/10">
                    <Image src={user.avatar} alt="头像" className="w-full h-full object-cover" />
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                  >
                    <Camera className="size-6" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </div>
                <div>
                  <div className="text-lg font-semibold">{user.nickname}</div>
                  <div className="text-sm text-muted-foreground">{user.email}</div>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="secondary" className="text-xs">
                      注册于 {registerDate}
                    </Badge>
                  </div>
                </div>
              </div>

              <Separator />

              {/* 昵称 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                    <User className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">昵称</div>
                    {editingNickname ? (
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                          className="h-8 w-48 text-sm"
                          maxLength={20}
                          autoFocus
                        />
                        <Button size="sm" variant="default" onClick={handleSaveNickname}>
                          <Check className="size-3.5 mr-1" />
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingNickname(false);
                            setNickname(user.nickname);
                          }}
                        >
                          取消
                        </Button>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground mt-0.5">{user.nickname}</div>
                    )}
                  </div>
                </div>
                {!editingNickname && (
                  <Button variant="ghost" size="sm" onClick={() => setEditingNickname(true)}>
                    <Pencil className="size-3.5 mr-1.5" />
                    修改
                  </Button>
                )}
              </div>

              {/* 邮箱 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                    <Mail className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">邮箱</div>
                    <div className="text-sm text-muted-foreground mt-0.5">{user.email}</div>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">
                  不可修改
                </Badge>
              </div>

              {/* 手机号 */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                    <Phone className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">手机号</div>
                    {bindingPhone ? (
                      <div className="space-y-2 mt-2">
                        <div className="flex gap-2">
                          <Input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="请输入手机号"
                            className="h-9 w-48 text-sm"
                          />
                          <Button size="sm" variant="secondary" onClick={handleSendPhoneCode}>
                            发送验证码
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            value={phoneCode}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                              setPhoneCode(v);
                            }}
                            placeholder="6位验证码"
                            className="h-9 w-48 text-sm"
                            maxLength={6}
                          />
                          <Button size="sm" onClick={handleBindPhone}>
                            确认绑定
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setBindingPhone(false);
                              setPhone(user.phone);
                              setPhoneCode('');
                            }}
                          >
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {user.phone || '未绑定'}
                      </div>
                    )}
                  </div>
                </div>
                {!bindingPhone && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBindingPhone(true)}
                  >
                    {user.phone ? '修改' : '绑定'}
                  </Button>
                )}
              </div>

              {/* 注册时间 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                    <Calendar className="size-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">注册时间</div>
                    <div className="text-sm text-muted-foreground mt-0.5">{registerDate}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 账号安全 */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="size-5 text-primary" />
                账号安全
              </CardTitle>
              <CardDescription>管理你的密码和登录设备</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 修改密码 */}
              <div>
                <div className="text-sm font-medium mb-3">修改密码</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">当前密码</Label>
                    <Input
                      type="password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      placeholder="请输入当前密码"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">新密码</Label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="至少8位，含字母数字"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">确认新密码</Label>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="再次输入"
                        className="h-9 text-sm flex-1"
                      />
                      <Button
                        size="sm"
                        onClick={handleChangePassword}
                        disabled={isChangingPwd}
                      >
                        确认
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* 登录设备 */}
              <div>
                <div className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Monitor className="size-4 text-muted-foreground" />
                  登录设备管理
                </div>
                <div className="space-y-2">
                  {LOGIN_DEVICES.map((device) => (
                    <div
                      key={device.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-border/60 hover:border-border/80 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Monitor className="size-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium flex items-center gap-2">
                            {device.name}
                            {device.current && (
                              <Badge variant="default" className="text-[10px] h-4 px-1.5">
                                当前
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
                            <span>{device.ip}</span>
                            <span>{device.location}</span>
                            <span>{device.lastActive}</span>
                          </div>
                        </div>
                      </div>
                      {!device.current && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveDevice(device.id)}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        >
                          <Trash2 className="size-3.5 mr-1" />
                          下线
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 偏好设置 */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="size-5 text-primary" />
                偏好设置
              </CardTitle>
              <CardDescription>自定义你的生成偏好</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">默认生成风格</Label>
                  <Select value={defaultStyleId} onValueChange={setDefaultStyleId}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MOCK_STYLES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} · {s.categoryLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">默认图片尺寸</Label>
                  <Select value={defaultSize} onValueChange={setDefaultSize}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SIZE_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-sm font-medium">自动保存生成结果</div>
                    <div className="text-xs text-muted-foreground">生成结果自动保存到历史记录</div>
                  </div>
                  <Switch checked={autoSaveResults} onCheckedChange={setAutoSaveResults} />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-sm font-medium">邮件通知</div>
                    <div className="text-xs text-muted-foreground">生成完成时通过邮件提醒</div>
                  </div>
                  <Switch checked={emailNotification} onCheckedChange={setEmailNotification} />
                </div>
              </div>

              <Button
                onClick={handleSaveSettings}
                className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
              >
                <Check className="size-4 mr-2" />
                保存设置
              </Button>
            </CardContent>
          </Card>

          {/* 退出登录 */}
          <Card className="border-border/60">
            <CardContent className="pt-6 pb-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">退出登录</div>
                  <div className="text-xs text-muted-foreground">退出当前账号，返回登录页</div>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  <LogOut className="size-4 mr-2" />
                  退出登录
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
