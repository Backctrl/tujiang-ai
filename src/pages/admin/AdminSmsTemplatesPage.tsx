import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  MessageSquare,
  Plus,
  Search,
  Save,
  Send,
  Tag,
  Sparkles,
  ChevronRight,
  Smartphone,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { delay } from '@/lib/storage';

interface SmsTemplate {
  id: string;
  name: string;
  type: 'verify' | 'notice' | 'marketing';
  provider: string;
  providerTemplateId: string;
  content: string;
  variables: { key: string; label: string; example: string }[];
  status: 'active' | 'disabled';
  updatedAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  verify: '验证码类',
  notice: '通知类',
  marketing: '营销类',
};

const TYPE_COLORS: Record<string, string> = {
  verify: 'bg-blue-100 text-blue-700',
  notice: 'bg-emerald-100 text-emerald-700',
  marketing: 'bg-amber-100 text-amber-700',
};

const PROVIDERS = [
  { value: 'aliyun', label: '阿里云短信' },
  { value: 'tencent', label: '腾讯云短信' },
  { value: 'huawei', label: '华为云短信' },
];

const DEFAULT_TEMPLATES: SmsTemplate[] = [
  {
    id: 'sms-register',
    name: '注册验证码',
    type: 'verify',
    provider: 'aliyun',
    providerTemplateId: 'SMS_123456789',
    content: '【图匠AI】您的注册验证码是${code}，${expire}内有效，请勿泄露给他人。',
    variables: [
      { key: '${code}', label: '验证码', example: '885623' },
      { key: '${expire}', label: '有效期', example: '5分钟' },
    ],
    status: 'active',
    updatedAt: '2024-01-15T10:30:00Z',
  },
  {
    id: 'sms-login',
    name: '登录验证码',
    type: 'verify',
    provider: 'aliyun',
    providerTemplateId: 'SMS_123456790',
    content: '【图匠AI】您的登录验证码是${code}，${expire}内有效。如非本人操作，请忽略本短信。',
    variables: [
      { key: '${code}', label: '验证码', example: '456123' },
      { key: '${expire}', label: '有效期', example: '5分钟' },
    ],
    status: 'active',
    updatedAt: '2024-01-15T10:20:00Z',
  },
  {
    id: 'sms-reset',
    name: '重置密码验证码',
    type: 'verify',
    provider: 'tencent',
    providerTemplateId: '1234567',
    content: '【图匠AI】您正在重置密码，验证码是${code}，${expire}内有效。',
    variables: [
      { key: '${code}', label: '验证码', example: '789012' },
      { key: '${expire}', label: '有效期', example: '10分钟' },
    ],
    status: 'active',
    updatedAt: '2024-01-14T14:00:00Z',
  },
  {
    id: 'sms-recharge',
    name: '充值成功通知',
    type: 'notice',
    provider: 'aliyun',
    providerTemplateId: 'SMS_123456791',
    content: '【图匠AI】尊敬的${name}，您已成功充值${amount}元，到账${credits}积分，当前余额${balance}积分。',
    variables: [
      { key: '${name}', label: '用户名', example: 'demo_user' },
      { key: '${amount}', label: '充值金额', example: '99' },
      { key: '${credits}', label: '到账积分', example: '8300' },
      { key: '${balance}', label: '当前余额', example: '9200' },
    ],
    status: 'active',
    updatedAt: '2024-01-13T16:20:00Z',
  },
  {
    id: 'sms-generate',
    name: '生成完成通知',
    type: 'notice',
    provider: 'huawei',
    providerTemplateId: 'hw-tpl-001',
    content: '【图匠AI】${name}您好，您的${type}任务已生成完成，共${count}张，点击查看详情。',
    variables: [
      { key: '${name}', label: '用户名', example: 'demo_user' },
      { key: '${type}', label: '任务类型', example: '主图全案' },
      { key: '${count}', label: '图片数量', example: '9' },
    ],
    status: 'active',
    updatedAt: '2024-01-12T09:30:00Z',
  },
];

export default function AdminSmsTemplatesPage() {
  const [templates, setTemplates] = useState<SmsTemplate[]>(DEFAULT_TEMPLATES);
  const [selectedId, setSelectedId] = useState(DEFAULT_TEMPLATES[0].id);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const [testOpen, setTestOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testVars, setTestVars] = useState<Record<string, string>>({});
  const [testLoading, setTestLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = templates.find((t) => t.id === selectedId)!;

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (search.trim() && !t.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [templates, typeFilter, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, SmsTemplate[]> = {};
    filtered.forEach((t) => {
      if (!groups[t.type]) groups[t.type] = [];
      groups[t.type].push(t);
    });
    return groups;
  }, [filtered]);

  const charCount = selected.content.replace(/\$\{[^}]+\}/g, '字').length;
  const varCount = selected.variables.length;

  function updateTemplate(updates: Partial<SmsTemplate>) {
    setTemplates((prev) =>
      prev.map((t) => (t.id === selectedId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t))
    );
  }

  async function handleSave() {
    if (!selected.name.trim()) {
      toast.warning('请输入模板名称');
      return;
    }
    if (!selected.providerTemplateId.trim()) {
      toast.warning('请输入第三方模板ID');
      return;
    }
    setSaving(true);
    await delay(400);
    setSaving(false);
    toast.success('模板已保存');
  }

  function insertVariable(variable: string) {
    updateTemplate({ content: selected.content + variable });
    toast.success(`已插入变量 ${variable}`);
  }

  function addNewTemplate() {
    const newT: SmsTemplate = {
      id: `sms_${Date.now()}`,
      name: '新短信模板',
      type: 'verify',
      provider: 'aliyun',
      providerTemplateId: '',
      content: '【图匠AI】',
      variables: [],
      status: 'active',
      updatedAt: new Date().toISOString(),
    };
    setTemplates((prev) => [newT, ...prev]);
    setSelectedId(newT.id);
    toast.success('已创建新模板');
  }

  function openTest() {
    const vars: Record<string, string> = {};
    selected.variables.forEach((v) => {
      vars[v.key] = v.example;
    });
    setTestVars(vars);
    setTestOpen(true);
  }

  async function handleTest() {
    if (!testPhone || testPhone.length < 11) {
      toast.warning('请输入有效的手机号');
      return;
    }
    setTestLoading(true);
    await delay(1500);
    setTestLoading(false);
    setTestOpen(false);
    setTestPhone('');
    toast.success(`测试短信已发送到 ${testPhone.slice(0, 3)}****${testPhone.slice(-4)}`);
  }

  return (
    <div className="p-6 h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">短信模板管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理系统短信模板和第三方服务商配置</p>
        </div>
        <Button size="sm" onClick={addNewTemplate}>
          <Plus className="size-4 mr-1.5" />
          新增模板
        </Button>
      </div>

      <div className="flex gap-4 h-full">
        {/* 左侧模板列表 */}
        <div className="w-80 shrink-0 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card">
          <div className="p-3 border-b border-border/40 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索模板..."
                className="h-9 pl-8"
              />
            </div>
            <div className="flex gap-1">
              {['all', 'verify', 'notice', 'marketing'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                    typeFilter === t
                      ? 'bg-indigo-100 text-indigo-700 font-medium'
                      : 'text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {t === 'all' ? '全部' : TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {Object.entries(grouped).map(([type, list]) => (
              <div key={type}>
                <div className="px-3 py-2 bg-muted/20 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Tag className="size-3" />
                  {TYPE_LABELS[type]}
                </div>
                {list.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full p-3 text-left border-b border-border/30 last:border-b-0 transition-colors ${
                      selectedId === t.id
                        ? 'bg-indigo-50 border-l-2 border-l-indigo-500'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{t.name}</span>
                      <Badge
                        variant="outline"
                        className={t.status === 'active'
                          ? 'h-5 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'h-5 text-[10px] bg-slate-50 text-slate-600 border-slate-200'
                        }
                      >
                        {t.status === 'active' ? '启用' : '禁用'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate font-mono">
                      {t.providerTemplateId || '未配置模板ID'}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
                      <span>{t.variables.length} 变量</span>
                      <span className="tabular-nums">{format(new Date(t.updatedAt), 'MM-dd HH:mm')}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card">
          <div className="p-4 border-b border-border/40 space-y-3">
            <div className="flex items-center gap-3">
              <MessageSquare className="size-5 text-indigo-500" />
              <h3 className="font-semibold">{selected.name}</h3>
              <Badge variant="outline" className={TYPE_COLORS[selected.type]}>
                {TYPE_LABELS[selected.type]}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">模板名称</Label>
                <Input
                  value={selected.name}
                  onChange={(e) => updateTemplate({ name: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">模板类型</Label>
                <Select value={selected.type} onValueChange={(v: any) => updateTemplate({ type: v })}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verify">验证码类</SelectItem>
                    <SelectItem value="notice">通知类</SelectItem>
                    <SelectItem value="marketing">营销类</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">第三方服务商</Label>
                <Select value={selected.provider} onValueChange={(v) => updateTemplate({ provider: v })}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">第三方模板ID</Label>
                <Input
                  value={selected.providerTemplateId}
                  onChange={(e) => updateTemplate({ providerTemplateId: e.target.value })}
                  placeholder="需在服务商后台申请"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>
          </div>

          {/* 编辑器 + 变量 */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">模板内容</Label>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span>字数: <span className="font-medium text-foreground tabular-nums">{charCount}</span></span>
                  <span>变量: <span className="font-medium text-foreground tabular-nums">{varCount}</span></span>
                  <span>计费: <span className="font-medium text-amber-600 tabular-nums">{Math.ceil(charCount / 70) || 1}条</span></span>
                </div>
              </div>
              <Textarea
                value={selected.content}
                onChange={(e) => updateTemplate({ content: e.target.value })}
                className="flex-1 resize-none font-mono text-sm leading-relaxed"
                placeholder="【签名】您的验证码是${code}..."
              />
              <div className="p-3 bg-muted/20 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1.5">变量示例预览：</div>
                <div className="text-sm text-foreground">
                  {selected.content.replace(/\$\{[^}]+\}/g, (m) => {
                    const v = selected.variables.find((x) => x.key === m);
                    return `<span class="inline-block px-1 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">${v?.example || m}</span>`;
                  })}
                </div>
              </div>
            </div>

            {/* 变量侧栏 */}
            <div className="w-56 border-l border-border/40 flex flex-col shrink-0">
              <div className="px-3 py-2 border-b border-border/40 bg-muted/20">
                <span className="text-xs font-medium flex items-center gap-1">
                  <Sparkles className="size-3.5 text-indigo-500" />
                  可用变量 ({selected.variables.length})
                </span>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {selected.variables.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => insertVariable(v.key)}
                    className="w-full text-left p-2 rounded-md hover:bg-indigo-50 transition-colors group"
                  >
                    <div className="text-xs font-mono text-indigo-600 font-medium">{v.key}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center justify-between">
                      <span>{v.label}</span>
                      <ChevronRight className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 mt-0.5">示例: {v.example}</div>
                  </button>
                ))}
                {selected.variables.length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-6">
                    暂无变量
                  </div>
                )}
              </div>
              <div className="p-2 border-t border-border/40">
                <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={() => {
                  const newVar = { key: '${newVar}', label: '新变量', example: '示例值' };
                  updateTemplate({ variables: [...selected.variables, newVar] });
                }}>
                  <Plus className="size-3.5 mr-1" />
                  添加变量
                </Button>
              </div>
            </div>
          </div>

          {/* 底部操作 */}
          <div className="p-3 border-t border-border/40 flex items-center justify-between bg-muted/10">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={selected.status === 'active'}
                  onCheckedChange={(c) => updateTemplate({ status: c ? 'active' : 'disabled' })}
                  id="sms-status"
                />
                <Label htmlFor="sms-status" className="text-sm cursor-pointer">
                  {selected.status === 'active' ? '已启用' : '已禁用'}
                </Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={openTest}>
                <Send className="size-3.5 mr-1" />
                测试发送
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving && (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
                )}
                <Save className="size-3.5 mr-1" />
                保存
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 测试发送弹窗 */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Smartphone className="size-4 text-indigo-500" />
              发送测试短信
            </DialogTitle>
            <DialogDescription>向指定手机号发送当前模板的测试短信</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>测试手机号 *</Label>
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="请输入手机号"
                maxLength={11}
              />
            </div>
            {selected.variables.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">变量值（使用示例值）</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto p-3 bg-muted/20 rounded-lg">
                  {selected.variables.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <code className="text-xs w-24 shrink-0 text-indigo-600">{v.key}</code>
                      <span className="text-xs text-muted-foreground">=</span>
                      <Input
                        value={testVars[v.key] || ''}
                        onChange={(e) => setTestVars((p) => ({ ...p, [v.key]: e.target.value }))}
                        className="h-7 flex-1 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>取消</Button>
            <Button onClick={handleTest} disabled={testLoading}>
              {testLoading && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
