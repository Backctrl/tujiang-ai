import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Settings,
  Globe,
  Home,
  UserPlus,
  Wand2,
  Shield,
  Save,
  RotateCcw,
  Upload,
  Plus,
  X,
  Palette,
  Layers,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { storage, delay } from '@/lib/storage';
import { bannerImages } from '@lark-apaas/client-toolkit-lite';
import { Image as ImageComponent } from '@/components/ui/image';

const SETTINGS_KEY = '__app_tujiang_admin_settings_basic';

const DEFAULT_SETTINGS = {
  // 网站信息
  siteName: '图匠AI',
  siteLogo: '',
  siteDesc: '专业电商AI生图平台，一键生成高质量商品主图和详情页',
  seoKeywords: ['AI生图', '电商主图', '详情页生成', '商品图片'],
  icp: '浙ICP备2024000000号',
  serviceEmail: 'service@tujiang.ai',
  servicePhone: '400-888-8888',
  serviceHours: '周一至周日 9:00-21:00',

  // 首页设置
  homeTitle: 'AI驱动的电商视觉解决方案',
  homeSubtitle: '一键生成专业级商品主图与详情页，让你的产品脱颖而出',
  homeBanner: '',
  features: [
    { icon: 'sparkles', title: '智能生图', desc: 'AI自动识别商品，生成高质量主图' },
    { icon: 'palette', title: '百种风格', desc: '覆盖全品类风格模板，满足多样需求' },
    { icon: 'zap', title: '秒级生成', desc: '高效AI模型，30秒生成全套方案' },
    { icon: 'shield', title: '商用授权', desc: '生成图片可用于商业，无版权纠纷' },
  ],

  // 注册设置
  openRegister: true,
  emailVerify: true,
  newUserPoints: 100,
  dailyRegisterIpLimit: 5,
  registerAgreement: '欢迎使用图匠AI服务...\n\n1. 用户需遵守相关法律法规\n2. 不得利用服务从事违法活动\n3. 服务内容仅供参考',

  // 生成设置
  defaultModel: 'flux-pro',
  defaultMainSize: '2k-1x1',
  defaultDetailSize: '2k-3x4',
  dailyGenerateLimit: 0,
  concurrentLimit: 3,
  retryCount: 2,
  queueMaxLength: 100,

  // 安全设置
  loginFailThreshold: 5,
  loginLockDuration: 30,
  passwordMinLength: 8,
  passwordRequire: { letter: true, number: true, special: false },
  sessionTimeout: 1440,
  maxDevices: 3,
};

export default function AdminBasicSettingsPage() {
  const [settings, setSettings] = useState<any>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');

  useEffect(() => {
    const saved = storage.get<any>(SETTINGS_KEY, null);
    if (saved) {
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
    }
  }, []);

  function updateField(key: string, value: any) {
    setSettings((prev: any) => ({ ...prev, [key]: value }));
  }

  function updateNested(group: string, key: string, value: any) {
    setSettings((prev: any) => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: value,
      },
    }));
  }

  function addKeyword() {
    if (!newKeyword.trim()) return;
    if (settings.seoKeywords.includes(newKeyword.trim())) {
      toast.warning('关键词已存在');
      return;
    }
    updateField('seoKeywords', [...settings.seoKeywords, newKeyword.trim()]);
    setNewKeyword('');
  }

  function removeKeyword(kw: string) {
    updateField('seoKeywords', settings.seoKeywords.filter((k: string) => k !== kw));
  }

  function updateFeature(index: number, key: string, value: string) {
    const updated = [...settings.features];
    updated[index] = { ...updated[index], [key]: value };
    updateField('features', updated);
  }

  async function handleSave() {
    setSaving(true);
    await delay(800);
    storage.set(SETTINGS_KEY, settings);
    setSaving(false);
    toast.success('设置已保存');
  }

  function handleReset() {
    if (!confirm('确认恢复默认设置？所有修改将丢失。')) return;
    setSettings(DEFAULT_SETTINGS);
    toast.success('已恢复默认设置');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">基础设置</h1>
          <p className="text-sm text-muted-foreground mt-0.5">配置网站基础信息和系统参数</p>
        </div>
      </div>

      <div className="space-y-5 max-w-4xl">
        {/* 网站信息 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Globe className="size-4 text-indigo-600" />
              </div>
              <CardTitle className="text-base">网站信息</CardTitle>
            </div>
            <CardDescription>网站基本展示信息与联系方式</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>网站名称</Label>
              <Input
                value={settings.siteName}
                onChange={(e) => updateField('siteName', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>网站Logo</Label>
              <div className="flex items-start gap-4">
                {settings.siteLogo ? (
                  <div className="relative w-20 h-20 rounded-lg border border-border/40 overflow-hidden bg-muted/20">
                    <ImageComponent src={settings.siteLogo} alt="logo" className="w-full h-full object-contain p-2" />
                    <button
                      onClick={() => updateField('siteLogo', '')}
                      className="absolute top-1 right-1 size-5 rounded-full bg-rose-500 text-white flex items-center justify-center"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => updateField('siteLogo', bannerImages.minimalismBannerImg1)}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-border/60 flex items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
                  >
                    <Upload className="size-5 text-muted-foreground" />
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-1">
                  建议尺寸：200x60px，支持PNG/SVG透明背景
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>网站描述</Label>
              <Textarea
                value={settings.siteDesc}
                onChange={(e) => updateField('siteDesc', e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>SEO关键词</Label>
              <div className="flex flex-wrap gap-2 p-2 border border-border/40 rounded-lg min-h-[42px]">
                {settings.seoKeywords.map((kw: string) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs"
                  >
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="hover:text-indigo-900">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <div className="flex gap-1 flex-1 min-w-[120px]">
                  <Input
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                    placeholder="输入关键词回车添加"
                    className="h-7 text-xs"
                  />
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={addKeyword}>
                    <Plus className="size-3" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>备案号</Label>
                <Input
                  value={settings.icp}
                  onChange={(e) => updateField('icp', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>客服邮箱</Label>
                <Input
                  value={settings.serviceEmail}
                  onChange={(e) => updateField('serviceEmail', e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>客服电话</Label>
                <Input
                  value={settings.servicePhone}
                  onChange={(e) => updateField('servicePhone', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>客服工作时间</Label>
                <Input
                  value={settings.serviceHours}
                  onChange={(e) => updateField('serviceHours', e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 首页设置 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-violet-100 flex items-center justify-center">
                <Home className="size-4 text-violet-600" />
              </div>
              <CardTitle className="text-base">首页设置</CardTitle>
            </div>
            <CardDescription>首页Banner和特色功能展示</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>首页主标题</Label>
              <Input
                value={settings.homeTitle}
                onChange={(e) => updateField('homeTitle', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>首页副标题</Label>
              <Input
                value={settings.homeSubtitle}
                onChange={(e) => updateField('homeSubtitle', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>首页Banner图</Label>
              {settings.homeBanner ? (
                <div className="relative rounded-lg overflow-hidden border border-border/40 aspect-[21/9]">
                  <ImageComponent src={settings.homeBanner} alt="banner" className="w-full h-full object-cover" />
                  <button
                    onClick={() => updateField('homeBanner', '')}
                    className="absolute top-2 right-2 size-7 rounded-full bg-rose-500 text-white flex items-center justify-center"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => updateField('homeBanner', bannerImages.minimalismBannerImg5)}
                  className="border-2 border-dashed border-border/60 rounded-lg aspect-[21/9] flex items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
                >
                  <div className="text-center">
                    <Upload className="size-6 mx-auto text-muted-foreground mb-1" />
                    <p className="text-sm text-muted-foreground">点击上传Banner图</p>
                    <p className="text-xs text-muted-foreground">建议尺寸 2560x1080</p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label className="text-sm">特色功能（4组）</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                {settings.features.map((f: any, idx: number) => (
                  <div key={idx} className="p-3 border border-border/40 rounded-lg space-y-2">
                    <div className="text-xs text-muted-foreground">第 {idx + 1} 个</div>
                    <Input
                      value={f.title}
                      onChange={(e) => updateFeature(idx, 'title', e.target.value)}
                      placeholder="功能标题"
                      className="h-8 text-sm"
                    />
                    <Textarea
                      value={f.desc}
                      onChange={(e) => updateFeature(idx, 'desc', e.target.value)}
                      placeholder="功能描述"
                      rows={2}
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 注册设置 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <UserPlus className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-base">注册设置</CardTitle>
            </div>
            <CardDescription>用户注册相关的参数配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
              <div>
                <Label className="text-sm font-medium">开放注册</Label>
                <p className="text-xs text-muted-foreground mt-0.5">关闭后新用户无法注册账号</p>
              </div>
              <Switch checked={settings.openRegister} onCheckedChange={(c) => updateField('openRegister', c)} />
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
              <div>
                <Label className="text-sm font-medium">邮箱验证</Label>
                <p className="text-xs text-muted-foreground mt-0.5">注册时需要验证邮箱有效性</p>
              </div>
              <Switch checked={settings.emailVerify} onCheckedChange={(c) => updateField('emailVerify', c)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>新用户赠送积分</Label>
                <Input
                  type="number"
                  value={settings.newUserPoints}
                  onChange={(e) => updateField('newUserPoints', Number(e.target.value))}
                  min={0}
                />
              </div>
              <div className="space-y-1.5">
                <Label>单IP每日注册限制</Label>
                <Input
                  type="number"
                  value={settings.dailyRegisterIpLimit}
                  onChange={(e) => updateField('dailyRegisterIpLimit', Number(e.target.value))}
                  min={0}
                />
              </div>
            </div>

            <Accordion type="single" collapsible defaultValue="agreement">
              <AccordionItem value="agreement" className="border border-border/40 rounded-lg px-3">
                <AccordionTrigger className="py-2 text-sm font-medium">
                  注册协议内容
                </AccordionTrigger>
                <AccordionContent>
                  <Textarea
                    value={settings.registerAgreement}
                    onChange={(e) => updateField('registerAgreement', e.target.value)}
                    rows={8}
                    className="text-sm font-mono"
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* 生成设置 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <Wand2 className="size-4 text-amber-600" />
              </div>
              <CardTitle className="text-base">生成设置</CardTitle>
            </div>
            <CardDescription>AI生图相关的默认参数和限制</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>默认生成模型</Label>
                <Select value={settings.defaultModel} onValueChange={(v) => updateField('defaultModel', v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flux-pro">Flux Pro</SelectItem>
                    <SelectItem value="flux-dev">Flux Dev</SelectItem>
                    <SelectItem value="sdxl">Stable Diffusion XL</SelectItem>
                    <SelectItem value="dalle-3">DALL-E 3</SelectItem>
                    <SelectItem value="wanx-v1">通义万相</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>默认主图尺寸</Label>
                <Select value={settings.defaultMainSize} onValueChange={(v) => updateField('defaultMainSize', v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2k-1x1">2K 1:1</SelectItem>
                    <SelectItem value="2k-3x4">2K 3:4</SelectItem>
                    <SelectItem value="1k-1x1">1K 1:1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>默认详情图尺寸</Label>
                <Select value={settings.defaultDetailSize} onValueChange={(v) => updateField('defaultDetailSize', v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2k-3x4">2K 3:4</SelectItem>
                    <SelectItem value="1k-9x16">1K 9:16</SelectItem>
                    <SelectItem value="2k-9x16">2K 9:16</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label>每日生成上限</Label>
                <Input
                  type="number"
                  value={settings.dailyGenerateLimit}
                  onChange={(e) => updateField('dailyGenerateLimit', Number(e.target.value))}
                  min={0}
                />
                <p className="text-[10px] text-muted-foreground">0表示不限</p>
              </div>
              <div className="space-y-1.5">
                <Label>并发生成限制</Label>
                <Input
                  type="number"
                  value={settings.concurrentLimit}
                  onChange={(e) => updateField('concurrentLimit', Number(e.target.value))}
                  min={1}
                />
              </div>
              <div className="space-y-1.5">
                <Label>失败自动重试</Label>
                <Input
                  type="number"
                  value={settings.retryCount}
                  onChange={(e) => updateField('retryCount', Number(e.target.value))}
                  min={0}
                />
                <p className="text-[10px] text-muted-foreground">次</p>
              </div>
              <div className="space-y-1.5">
                <Label>队列最大长度</Label>
                <Input
                  type="number"
                  value={settings.queueMaxLength}
                  onChange={(e) => updateField('queueMaxLength', Number(e.target.value))}
                  min={10}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 安全设置 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-rose-100 flex items-center justify-center">
                <Lock className="size-4 text-rose-600" />
              </div>
              <CardTitle className="text-base">安全设置</CardTitle>
            </div>
            <CardDescription>账号安全与访问策略配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>登录失败锁定阈值</Label>
                <Input
                  type="number"
                  value={settings.loginFailThreshold}
                  onChange={(e) => updateField('loginFailThreshold', Number(e.target.value))}
                  min={1}
                />
                <p className="text-[10px] text-muted-foreground">次，超过则锁定账号</p>
              </div>
              <div className="space-y-1.5">
                <Label>锁定时长</Label>
                <Input
                  type="number"
                  value={settings.loginLockDuration}
                  onChange={(e) => updateField('loginLockDuration', Number(e.target.value))}
                  min={1}
                />
                <p className="text-[10px] text-muted-foreground">分钟</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">密码复杂度要求</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>最小长度</Label>
                  <Input
                    type="number"
                    value={settings.passwordMinLength}
                    onChange={(e) => updateField('passwordMinLength', Number(e.target.value))}
                    min={4}
                  />
                </div>
                <div className="flex items-center gap-2 p-2 border border-border/40 rounded-lg">
                  <input
                    type="checkbox"
                    checked={settings.passwordRequire.letter}
                    onChange={(e) =>
                      updateField('passwordRequire', { ...settings.passwordRequire, letter: e.target.checked })
                    }
                    className="size-4"
                  />
                  <span className="text-sm">含字母</span>
                </div>
                <div className="flex items-center gap-2 p-2 border border-border/40 rounded-lg">
                  <input
                    type="checkbox"
                    checked={settings.passwordRequire.number}
                    onChange={(e) =>
                      updateField('passwordRequire', { ...settings.passwordRequire, number: e.target.checked })
                    }
                    className="size-4"
                  />
                  <span className="text-sm">含数字</span>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 border border-border/40 rounded-lg w-fit">
                <input
                  type="checkbox"
                  checked={settings.passwordRequire.special}
                  onChange={(e) =>
                    updateField('passwordRequire', { ...settings.passwordRequire, special: e.target.checked })
                  }
                  className="size-4"
                />
                <span className="text-sm">含特殊字符</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>会话超时时间</Label>
                <Input
                  type="number"
                  value={settings.sessionTimeout}
                  onChange={(e) => updateField('sessionTimeout', Number(e.target.value))}
                  min={5}
                />
                <p className="text-[10px] text-muted-foreground">分钟，无操作自动登出</p>
              </div>
              <div className="space-y-1.5">
                <Label>允许同时登录设备数</Label>
                <Input
                  type="number"
                  value={settings.maxDevices}
                  onChange={(e) => updateField('maxDevices', Number(e.target.value))}
                  min={1}
                />
                <p className="text-[10px] text-muted-foreground">超过则挤掉最早登录</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 保存按钮 */}
        <div className="flex items-center justify-end gap-3 sticky bottom-6">
          <Button variant="outline" onClick={handleReset} disabled={resetting}>
            <RotateCcw className="size-4 mr-1.5" />
            恢复默认
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
            )}
            <Save className="size-4 mr-1.5" />
            保存设置
          </Button>
        </div>
      </div>
    </div>
  );
}
