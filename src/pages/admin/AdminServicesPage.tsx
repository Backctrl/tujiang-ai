import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import {
  Settings,
  Bot,
  MessageSquare,
  Mail,
  Database,
  Shield,
  ChevronRight,
  Eye,
  EyeOff,
  Save,
  Send,
  Upload,
  Check,
  X,
  Globe,
  Plug,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { storage, delay } from '@/lib/storage';

interface ServiceConfig {
  id: string;
  name: string;
  category: 'ai-image' | 'sms' | 'email' | 'storage' | 'content-audit';
  icon: string;
  enabled: boolean;
  configured: boolean;
  config: Record<string, any>;
}

const SERVICE_CATEGORIES = [
  { key: 'ai-image', label: 'AI生图服务', icon: Bot, color: 'from-violet-500 to-indigo-500' },
  { key: 'sms', label: '短信服务', icon: MessageSquare, color: 'from-blue-500 to-cyan-500' },
  { key: 'email', label: '邮件服务', icon: Mail, color: 'from-emerald-500 to-teal-500' },
  { key: 'storage', label: '存储服务', icon: Database, color: 'from-amber-500 to-orange-500' },
  { key: 'content-audit', label: '内容审核服务', icon: Shield, color: 'from-rose-500 to-pink-500' },
];

const INITIAL_SERVICES: ServiceConfig[] = [
  // AI生图
  { id: 'dalle', name: 'OpenAI DALL-E', category: 'ai-image', icon: '🟢', enabled: false, configured: false, config: {} },
  { id: 'stability', name: 'Stability AI', category: 'ai-image', icon: '🟠', enabled: true, configured: true, config: { apiKey: 'sk-xxx...' } },
  { id: 'flux', name: 'Flux API', category: 'ai-image', icon: '🔵', enabled: true, configured: true, config: {} },
  { id: 'tongyi', name: '通义万相', category: 'ai-image', icon: '🟣', enabled: false, configured: true, config: {} },
  { id: 'wenxin', name: '文心一格', category: 'ai-image', icon: '🔴', enabled: false, configured: false, config: {} },
  { id: 'keling', name: '可灵AI', category: 'ai-image', icon: '🟡', enabled: true, configured: true, config: {} },
  // 短信
  { id: 'aliyun-sms', name: '阿里云短信', category: 'sms', icon: '☁️', enabled: true, configured: true, config: {} },
  { id: 'tencent-sms', name: '腾讯云短信', category: 'sms', icon: '💬', enabled: false, configured: false, config: {} },
  { id: 'huawei-sms', name: '华为云短信', category: 'sms', icon: '📱', enabled: false, configured: true, config: {} },
  { id: 'other-sms', name: '其他', category: 'sms', icon: '➕', enabled: false, configured: false, config: {} },
  // 邮件
  { id: 'smtp', name: 'SMTP通用', category: 'email', icon: '📧', enabled: true, configured: true, config: {} },
  { id: 'sendgrid', name: 'SendGrid', category: 'email', icon: '🌐', enabled: false, configured: false, config: {} },
  { id: 'aliyun-mail', name: '阿里云邮件推送', category: 'email', icon: '☁️', enabled: false, configured: true, config: {} },
  { id: 'tencent-mail', name: '腾讯云邮件', category: 'email', icon: '💌', enabled: false, configured: false, config: {} },
  // 存储
  { id: 'aliyun-oss', name: '阿里云OSS', category: 'storage', icon: '🪣', enabled: true, configured: true, config: {} },
  { id: 'tencent-cos', name: '腾讯云COS', category: 'storage', icon: '☁️', enabled: false, configured: false, config: {} },
  { id: 'aws-s3', name: 'AWS S3', category: 'storage', icon: '🟧', enabled: false, configured: true, config: {} },
  { id: 'qiniu', name: '七牛云', category: 'storage', icon: '🐮', enabled: false, configured: false, config: {} },
  // 内容审核
  { id: 'aliyun-content', name: '阿里云内容安全', category: 'content-audit', icon: '🛡️', enabled: true, configured: true, config: {} },
  { id: 'tencent-content', name: '腾讯云内容安全', category: 'content-audit', icon: '🔒', enabled: false, configured: false, config: {} },
  { id: 'baidu-content', name: '百度内容审核', category: 'content-audit', icon: '🐾', enabled: false, configured: true, config: {} },
];

export default function AdminServicesPage() {
  const [services, setServices] = useState<ServiceConfig[]>(INITIAL_SERVICES);
  const [configOpen, setConfigOpen] = useState(false);
  const [currentService, setCurrentService] = useState<ServiceConfig | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [localConfig, setLocalConfig] = useState<Record<string, any>>({});

  function openConfig(service: ServiceConfig) {
    setCurrentService(service);
    setLocalConfig({ ...service.config });
    setShowSecret(false);
    setTestResult(null);
    setConfigOpen(true);
  }

  async function toggleService(service: ServiceConfig) {
    if (service.enabled) {
      if (!confirm(`确认禁用「${service.name}」？相关功能将不可用。`)) return;
    }
    const updated = services.map((s) =>
      s.id === service.id ? { ...s, enabled: !s.enabled } : s
    );
    setServices(updated);
    toast.success(`${service.enabled ? '已禁用' : '已启用'} ${service.name}`);
  }

  function toggleCategoryAll(category: string, enabled: boolean) {
    if (!enabled) {
      if (!confirm(`确认禁用该分类下所有服务？`)) return;
    }
    setServices((prev) =>
      prev.map((s) => (s.category === category ? { ...s, enabled } : s))
    );
    toast.success(`已${enabled ? '启用' : '禁用'} ${category}分类所有服务`);
  }

  async function handleSave() {
    if (!currentService) return;
    setSaving(true);
    await delay(500);
    setServices((prev) =>
      prev.map((s) =>
        s.id === currentService.id ? { ...s, config: localConfig, configured: true } : s
      )
    );
    setSaving(false);
    toast.success('配置已保存');
  }

  async function handleTest() {
    if (!currentService) return;
    setTesting(true);
    setTestResult(null);
    await delay(1500);
    setTesting(false);
    const success = Math.random() > 0.2;
    setTestResult({
      success,
      message: success
        ? `连接成功！响应时间 ${Math.floor(Math.random() * 200 + 50)}ms`
        : '连接失败：API Key 无效或网络超时',
    });
  }

  function getServicesByCategory(category: string) {
    return services.filter((s) => s.category === category);
  }

  function renderConfigFields() {
    if (!currentService) return null;
    const cat = currentService.category;

    switch (cat) {
      case 'ai-image':
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>API Key *</Label>
              <div className="relative">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={localConfig.apiKey || ''}
                  onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                  placeholder="请输入API Key"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>API Secret（如需要）</Label>
              <Input
                type={showSecret ? 'text' : 'password'}
                value={localConfig.apiSecret || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, apiSecret: e.target.value })}
                placeholder="请输入API Secret"
              />
            </div>
            <div className="space-y-1.5">
              <Label>API Endpoint</Label>
              <Input
                value={localConfig.endpoint || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, endpoint: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>默认模型</Label>
                <Select value={localConfig.defaultModel || ''} onValueChange={(v) => setLocalConfig({ ...localConfig, defaultModel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dall-e-3">DALL-E 3</SelectItem>
                    <SelectItem value="sdxl">Stable Diffusion XL</SelectItem>
                    <SelectItem value="flux-pro">Flux Pro</SelectItem>
                    <SelectItem value="flux-dev">Flux Dev</SelectItem>
                    <SelectItem value="wanx-v1">通义万相 v1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>备用模型</Label>
                <Select value={localConfig.backupModel || ''} onValueChange={(v) => setLocalConfig({ ...localConfig, backupModel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">无</SelectItem>
                    <SelectItem value="dall-e-3">DALL-E 3</SelectItem>
                    <SelectItem value="sdxl">Stable Diffusion XL</SelectItem>
                    <SelectItem value="flux-pro">Flux Pro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>优先级（数字越小越优先）</Label>
                <Input
                  type="number"
                  value={localConfig.priority || 1}
                  onChange={(e) => setLocalConfig({ ...localConfig, priority: Number(e.target.value) })}
                  min={1}
                />
              </div>
              <div className="space-y-1.5">
                <Label>单价（元/张）</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={localConfig.price || ''}
                  onChange={(e) => setLocalConfig({ ...localConfig, price: e.target.value })}
                  placeholder="0.08"
                />
              </div>
            </div>
          </div>
        );

      case 'sms':
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>AccessKey ID *</Label>
              <Input
                value={localConfig.accessKey || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, accessKey: e.target.value })}
                placeholder="请输入AccessKey ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label>AccessKey Secret *</Label>
              <div className="relative">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={localConfig.accessSecret || ''}
                  onChange={(e) => setLocalConfig({ ...localConfig, accessSecret: e.target.value })}
                  placeholder="请输入AccessKey Secret"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>签名名称 *</Label>
              <Input
                value={localConfig.signName || ''}
                onChange={(e) => setLocalConfig({ ...localConfig, signName: e.target.value })}
                placeholder="图匠AI"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>验证码模板ID</Label>
                <Input value={localConfig.verifyTpl || ''} onChange={(e) => setLocalConfig({ ...localConfig, verifyTpl: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>通知模板ID</Label>
                <Input value={localConfig.noticeTpl || ''} onChange={(e) => setLocalConfig({ ...localConfig, noticeTpl: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>营销模板ID</Label>
                <Input value={localConfig.marketingTpl || ''} onChange={(e) => setLocalConfig({ ...localConfig, marketingTpl: e.target.value })} />
              </div>
            </div>
            <div className="p-3 bg-muted/20 rounded-lg space-y-2">
              <Label className="text-xs text-muted-foreground">测试发送</Label>
              <div className="flex gap-2">
                <Input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="输入手机号"
                  maxLength={11}
                  className="h-9"
                />
                <Select value={localConfig.testTpl || 'verify'} onValueChange={(v) => setLocalConfig({ ...localConfig, testTpl: v })}>
                  <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verify">验证码</SelectItem>
                    <SelectItem value="notice">通知</SelectItem>
                    <SelectItem value="marketing">营销</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleTest} disabled={testing}>
                  {testing ? '发送中...' : '发送测试'}
                </Button>
              </div>
            </div>
          </div>
        );

      case 'email':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>SMTP服务器 *</Label>
                <Input value={localConfig.host || ''} onChange={(e) => setLocalConfig({ ...localConfig, host: e.target.value })} placeholder="smtp.example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>端口 *</Label>
                <Select value={localConfig.port || '465'} onValueChange={(v) => setLocalConfig({ ...localConfig, port: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="465">465 (SSL)</SelectItem>
                    <SelectItem value="587">587 (TLS)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>加密方式</Label>
              <div className="flex gap-3">
                {['none', 'ssl', 'tls'].map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={(localConfig.encryption || 'ssl') === opt}
                      onChange={() => setLocalConfig({ ...localConfig, encryption: opt })}
                      className="size-3.5"
                    />
                    {opt === 'none' ? '无' : opt.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>用户名 *</Label>
                <Input value={localConfig.username || ''} onChange={(e) => setLocalConfig({ ...localConfig, username: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>密码 *</Label>
                <div className="relative">
                  <Input
                    type={showSecret ? 'text' : 'password'}
                    value={localConfig.password || ''}
                    onChange={(e) => setLocalConfig({ ...localConfig, password: e.target.value })}
                  />
                  <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>发件人邮箱</Label>
                <Input value={localConfig.fromEmail || ''} onChange={(e) => setLocalConfig({ ...localConfig, fromEmail: e.target.value })} placeholder="noreply@tujiang.ai" />
              </div>
              <div className="space-y-1.5">
                <Label>发件人名称</Label>
                <Input value={localConfig.fromName || ''} onChange={(e) => setLocalConfig({ ...localConfig, fromName: e.target.value })} placeholder="图匠AI" />
              </div>
            </div>
            <div className="p-3 bg-muted/20 rounded-lg flex gap-2 items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">测试收件邮箱</Label>
                <Input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="test@example.com" className="h-9" />
              </div>
              <Button size="sm" onClick={handleTest} disabled={testing}>
                {testing ? '发送中...' : '发送测试'}
              </Button>
            </div>
          </div>
        );

      case 'storage':
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>AccessKey ID *</Label>
              <Input value={localConfig.accessKey || ''} onChange={(e) => setLocalConfig({ ...localConfig, accessKey: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>AccessKey Secret *</Label>
              <div className="relative">
                <Input type={showSecret ? 'text' : 'password'} value={localConfig.accessSecret || ''} onChange={(e) => setLocalConfig({ ...localConfig, accessSecret: e.target.value })} />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Bucket名称 *</Label>
                <Input value={localConfig.bucket || ''} onChange={(e) => setLocalConfig({ ...localConfig, bucket: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>区域/Region</Label>
                <Input value={localConfig.region || ''} onChange={(e) => setLocalConfig({ ...localConfig, region: e.target.value })} placeholder="cn-hangzhou" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>访问域名</Label>
              <Input value={localConfig.domain || ''} onChange={(e) => setLocalConfig({ ...localConfig, domain: e.target.value })} placeholder="https://cdn.example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>存储路径前缀</Label>
                <Input value={localConfig.pathPrefix || ''} onChange={(e) => setLocalConfig({ ...localConfig, pathPrefix: e.target.value })} placeholder="tujiang/" />
              </div>
              <div className="space-y-1.5">
                <Label>CDN域名（可选）</Label>
                <Input value={localConfig.cdnDomain || ''} onChange={(e) => setLocalConfig({ ...localConfig, cdnDomain: e.target.value })} />
              </div>
            </div>
            <div className="p-3 bg-muted/20 rounded-lg">
              <Button size="sm" onClick={handleTest} disabled={testing}>
                {testing ? '上传测试中...' : '上传测试文件'}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">上传一个测试文件，验证存储服务配置是否正确</p>
            </div>
          </div>
        );

      case 'content-audit':
        return (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input value={localConfig.apiKey || ''} onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>API Secret</Label>
              <div className="relative">
                <Input type={showSecret ? 'text' : 'password'} value={localConfig.apiSecret || ''} onChange={(e) => setLocalConfig({ ...localConfig, apiSecret: e.target.value })} />
                <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>API Endpoint</Label>
              <Input value={localConfig.endpoint || ''} onChange={(e) => setLocalConfig({ ...localConfig, endpoint: e.target.value })} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="!m-0">图片审核</Label>
                <Switch checked={!!localConfig.imageAudit} onCheckedChange={(c) => setLocalConfig({ ...localConfig, imageAudit: c })} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="!m-0">文本审核</Label>
                <Switch checked={!!localConfig.textAudit} onCheckedChange={(c) => setLocalConfig({ ...localConfig, textAudit: c })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>审核阈值（0-100）</Label>
              <Input type="number" min={0} max={100} value={localConfig.threshold || 90} onChange={(e) => setLocalConfig({ ...localConfig, threshold: Number(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label>违规处理方式</Label>
              <Select value={localConfig.handleMode || 'block'} onValueChange={(v) => setLocalConfig({ ...localConfig, handleMode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">拦截</SelectItem>
                  <SelectItem value="mark">标记</SelectItem>
                  <SelectItem value="manual">人工复审</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">第三方服务配置</h1>
          <p className="text-sm text-muted-foreground mt-0.5">配置和管理系统集成的各类第三方服务</p>
        </div>
      </div>

      <div className="space-y-6">
        {SERVICE_CATEGORIES.map((cat) => {
          const list = getServicesByCategory(cat.key);
          const enabledCount = list.filter((s) => s.enabled).length;
          const Icon = cat.icon;
          const allEnabled = list.length > 0 && list.every((s) => s.enabled);
          return (
            <Card key={cat.key} className="border border-border/50 overflow-hidden">
              <CardHeader className="pb-3 border-b border-border/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`size-10 rounded-lg bg-gradient-to-br ${cat.color} flex items-center justify-center text-white`}>
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{cat.label}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        共 {list.length} 个服务，已启用 {enabledCount} 个
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">启用/禁用全部</span>
                    <Switch checked={allEnabled} onCheckedChange={(c) => toggleCategoryAll(cat.key, c)} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {list.map((service) => (
                  <div
                    key={service.id}
                    className="flex items-center justify-between p-4 border-b border-border/30 last:border-b-0 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-9 rounded-lg bg-muted/30 flex items-center justify-center text-lg">
                        {service.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{service.name}</span>
                          {service.configured ? (
                            <Badge variant="outline" className="h-5 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                              已配置
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="h-5 text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                              未配置
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {service.configured ? `单价: ¥${service.config.price || '0.08'}/张` : '点击配置按钮进行设置'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch checked={service.enabled} onCheckedChange={() => toggleService(service)} />
                      <Button variant="outline" size="sm" onClick={() => openConfig(service)}>
                        <Settings className="size-3.5 mr-1" />
                        配置
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setCurrentService(service); setLocalConfig(service.config); handleTest(); }}
                      >
                        <Plug className="size-3.5 mr-1" />
                        测试
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 配置弹窗 */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Settings className="size-4 text-indigo-500" />
              配置 - {currentService?.name}
            </DialogTitle>
            <DialogDescription>
              配置服务参数，保存后立即生效
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {renderConfigFields()}

            <div className="mt-4 flex items-center justify-between p-3 bg-muted/20 rounded-lg">
              <div className="flex items-center gap-2">
                <Label>启用服务</Label>
              </div>
              <Switch
                checked={currentService?.enabled || false}
                onCheckedChange={(c) => {
                  if (currentService) {
                    setServices((prev) => prev.map((s) => (s.id === currentService.id ? { ...s, enabled: c } : s)));
                    setCurrentService({ ...currentService, enabled: c });
                  }
                }}
              />
            </div>

            {testResult && (
              <div className={`mt-4 p-3 rounded-lg flex items-start gap-2 ${
                testResult.success
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border border-rose-200 text-rose-700'
              }`}>
                {testResult.success ? <Check className="size-5 shrink-0" /> : <X className="size-5 shrink-0" />}
                <div className="text-sm">{testResult.message}</div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              <Save className="size-4 mr-1.5" />
              保存配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
