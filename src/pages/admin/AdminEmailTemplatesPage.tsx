import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  BookOpen,
  Mail,
  Bell,
  Tag,
  Eye,
  Plus,
  Search,
  Check,
  Save,
  Send,
  Image,
  Link,
  Code,
  List,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { storage, delay } from '@/lib/storage';

interface EmailTemplate {
  id: string;
  name: string;
  type: 'system' | 'behavior' | 'marketing';
  subject: string;
  content: string;
  variables: { key: string; label: string; example: string }[];
  status: 'active' | 'disabled';
  updatedAt: string;
  senderName?: string;
}

const TYPE_LABELS: Record<string, string> = {
  system: '系统通知类',
  behavior: '用户行为类',
  marketing: '营销类',
};

const TYPE_COLORS: Record<string, string> = {
  system: 'bg-blue-100 text-blue-700',
  behavior: 'bg-emerald-100 text-emerald-700',
  marketing: 'bg-amber-100 text-amber-700',
};

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: 'register-verify',
    name: '注册验证邮件',
    type: 'system',
    subject: '欢迎注册图匠AI - 请验证您的邮箱',
    content: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; color: white; text-align: center;">
    <h2 style="margin: 0; font-size: 24px;">图匠AI</h2>
  </div>
  <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <h3 style="margin-top: 0; color: #1f2937;">欢迎注册，{{用户名}}！</h3>
    <p style="color: #4b5563; line-height: 1.6;">感谢您注册图匠AI电商生图平台。请点击下方按钮完成邮箱验证：</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{验证链接}}" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block;">
        立即验证邮箱
      </a>
    </div>
    <p style="color: #6b7280; font-size: 14px;">如果按钮无法点击，请复制以下链接到浏览器打开：</p>
    <p style="background: #f3f4f6; padding: 10px; border-radius: 6px; word-break: break-all; font-size: 13px; color: #6366f1;">
      {{验证链接}}
    </p>
    <p style="color: #6b7280; font-size: 13px; margin-top: 20px;">此验证码将在 {{有效期}} 后失效。</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
      © 2024 图匠AI. 保留所有权利.
    </p>
  </div>
</div>`,
    variables: [
      { key: '{{用户名}}', label: '用户名', example: 'demo_user' },
      { key: '{{验证链接}}', label: '验证链接', example: 'https://tujiang.ai/verify?token=xxx' },
      { key: '{{有效期}}', label: '有效期', example: '24小时' },
    ],
    status: 'active',
    updatedAt: '2024-01-15T10:30:00Z',
    senderName: '图匠AI官方',
  },
  {
    id: 'reset-password',
    name: '重置密码邮件',
    type: 'system',
    subject: '图匠AI - 重置您的密码',
    content: '<p>您好 {{用户名}}，</p><p>您请求了密码重置。请点击以下链接重置密码：</p><p><a href="{{重置链接}}">{{重置链接}}</a></p><p>链接有效期：{{有效期}}</p>',
    variables: [
      { key: '{{用户名}}', label: '用户名', example: 'demo_user' },
      { key: '{{重置链接}}', label: '重置链接', example: 'https://tujiang.ai/reset?token=xxx' },
      { key: '{{有效期}}', label: '有效期', example: '1小时' },
    ],
    status: 'active',
    updatedAt: '2024-01-15T10:20:00Z',
  },
  {
    id: 'login-alert',
    name: '登录异常提醒',
    type: 'behavior',
    subject: '⚠️ 图匠AI - 检测到异常登录',
    content: '<p>您好 {{用户名}}，</p><p>我们检测到一次异常登录：</p><p>登录时间：{{登录时间}}</p><p>登录地点：{{登录地点}}</p><p>IP地址：{{登录IP}}</p><p>设备：{{设备信息}}</p><p>如果这不是您的操作，请立即修改密码。</p>',
    variables: [
      { key: '{{用户名}}', label: '用户名', example: 'demo_user' },
      { key: '{{登录时间}}', label: '登录时间', example: '2024-01-15 10:30' },
      { key: '{{登录地点}}', label: '登录地点', example: '北京市' },
      { key: '{{登录IP}}', label: '登录IP', example: '192.168.1.1' },
      { key: '{{设备信息}}', label: '设备信息', example: 'Chrome / Windows' },
    ],
    status: 'active',
    updatedAt: '2024-01-10T08:00:00Z',
  },
  {
    id: 'recharge-success',
    name: '充值成功通知',
    type: 'behavior',
    subject: '🎉 充值成功 - 积分已到账',
    content: '<p>您好 {{用户名}}，</p><p>您的充值已成功到账！</p><p>充值金额：{{充值金额}} 元</p><p>到账积分：{{到账积分}}</p><p>当前余额：{{当前积分}}</p><p>感谢您对图匠AI的支持！</p>',
    variables: [
      { key: '{{用户名}}', label: '用户名', example: 'demo_user' },
      { key: '{{充值金额}}', label: '充值金额', example: '99' },
      { key: '{{到账积分}}', label: '到账积分', example: '8300' },
      { key: '{{当前积分}}', label: '当前积分', example: '9200' },
    ],
    status: 'active',
    updatedAt: '2024-01-12T14:00:00Z',
  },
  {
    id: 'credits-change',
    name: '积分变动通知',
    type: 'behavior',
    subject: '图匠AI - 您的积分有变动',
    content: '<p>您好 {{用户名}}，</p><p>您的积分发生了变动：</p><p>变动类型：{{变动类型}}</p><p>变动积分：{{变动积分}}</p><p>当前余额：{{当前积分}}</p><p>变动时间：{{变动时间}}</p>',
    variables: [
      { key: '{{用户名}}', label: '用户名', example: 'demo_user' },
      { key: '{{变动类型}}', label: '变动类型', example: '生成消耗' },
      { key: '{{变动积分}}', label: '变动积分', example: '-50' },
      { key: '{{当前积分}}', label: '当前积分', example: '450' },
      { key: '{{变动时间}}', label: '变动时间', example: '2024-01-15 10:30' },
    ],
    status: 'active',
    updatedAt: '2024-01-14T16:30:00Z',
  },
  {
    id: 'generate-complete',
    name: '生成完成通知',
    type: 'behavior',
    subject: '✅ 图片生成完成 - 图匠AI',
    content: '<p>您好 {{用户名}}，</p><p>您的图片已经生成完成！</p><p>任务类型：{{任务类型}}</p><p>生成数量：{{生成数量}}</p><p>消耗积分：{{消耗积分}}</p><p>点击查看结果：<a href="{{任务链接}}">{{任务链接}}</a></p>',
    variables: [
      { key: '{{用户名}}', label: '用户名', example: 'demo_user' },
      { key: '{{任务类型}}', label: '任务类型', example: '主图全案' },
      { key: '{{生成数量}}', label: '生成数量', example: '9张' },
      { key: '{{消耗积分}}', label: '消耗积分', example: '200' },
      { key: '{{任务链接}}', label: '任务链接', example: 'https://tujiang.ai/result/xxx' },
    ],
    status: 'active',
    updatedAt: '2024-01-13T11:20:00Z',
  },
  {
    id: 'system-notice',
    name: '系统公告邮件',
    type: 'system',
    subject: '【系统公告】{{公告标题}}',
    content: '<h2>{{公告标题}}</h2><p>{{公告内容}}</p><p>发布时间：{{发布时间}}</p><p>感谢您对图匠AI的支持！</p>',
    variables: [
      { key: '{{公告标题}}', label: '公告标题', example: '系统升级通知' },
      { key: '{{公告内容}}', label: '公告内容', example: '系统将于本周末进行升级维护...' },
      { key: '{{发布时间}}', label: '发布时间', example: '2024-01-15' },
    ],
    status: 'active',
    updatedAt: '2024-01-10T09:00:00Z',
  },
  {
    id: 'promotion',
    name: '活动营销邮件',
    type: 'marketing',
    subject: '🎁 限时优惠 - {{优惠内容}}',
    content: '<div style="text-align: center;"><h2>{{活动标题}}</h2><p>{{活动描述}}</p><p>优惠力度：{{优惠力度}}</p><p>活动时间：{{活动时间}}</p><a href="{{活动链接}}" style="background: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px;">立即参与</a></div>',
    variables: [
      { key: '{{优惠内容}}', label: '优惠内容', example: '全场8折起' },
      { key: '{{活动标题}}', label: '活动标题', example: '新春特惠活动' },
      { key: '{{活动描述}}', label: '活动描述', example: '限时充值享额外赠送...' },
      { key: '{{优惠力度}}', label: '优惠力度', example: '最高赠送50%' },
      { key: '{{活动时间}}', label: '活动时间', example: '2024.01.15 - 2024.02.15' },
      { key: '{{活动链接}}', label: '活动链接', example: 'https://tujiang.ai/promo' },
    ],
    status: 'active',
    updatedAt: '2024-01-08T15:00:00Z',
  },
];

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>(DEFAULT_TEMPLATES);
  const [selectedId, setSelectedId] = useState(DEFAULT_TEMPLATES[0].id);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
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
    const groups: Record<string, EmailTemplate[]> = {};
    filtered.forEach((t) => {
      if (!groups[t.type]) groups[t.type] = [];
      groups[t.type].push(t);
    });
    return groups;
  }, [filtered]);

  function updateTemplate(updates: Partial<EmailTemplate>) {
    setTemplates((prev) => prev.map((t) => (t.id === selectedId ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)));
  }

  async function handleSave() {
    setSaving(true);
    await delay(400);
    setSaving(false);
    toast.success('模板已保存');
  }

  function insertVariable(variable: string) {
    // 简化：通过toast提示
    updateTemplate({ content: selected.content + variable });
    toast.success(`已插入变量 ${variable}`);
  }

  function addNewTemplate() {
    const newT: EmailTemplate = {
      id: `tpl_${Date.now()}`,
      name: '新邮件模板',
      type: 'system',
      subject: '请输入邮件标题',
      content: '<p>请输入邮件内容...</p>',
      variables: [{ key: '{{用户名}}', label: '用户名', example: 'demo_user' }],
      status: 'active',
      updatedAt: new Date().toISOString(),
    };
    setTemplates((prev) => [newT, ...prev]);
    setSelectedId(newT.id);
    toast.success('已创建新模板');
  }

  async function handleTest() {
    if (!testEmail || !testEmail.includes('@')) {
      toast.warning('请输入有效的邮箱地址');
      return;
    }
    setTestLoading(true);
    await delay(1500);
    setTestLoading(false);
    setTestOpen(false);
    setTestEmail('');
    toast.success(`测试邮件已发送到 ${testEmail}`);
  }

  const previewContent = selected.content
    .replace(/\{\{用户名\}\}/g, 'demo_user')
    .replace(/\{\{验证链接\}\}/g, 'https://tujiang.ai/verify?token=demo123')
    .replace(/\{\{有效期\}\}/g, '24小时')
    .replace(/\{\{.+?\}\}/g, (m) => `<span style="color: #6366f1; background: #eef2ff; padding: 1px 4px; border-radius: 3px;">${m}</span>`);

  return (
    <div className="p-6 h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">邮件模板管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理系统邮件模板的内容和变量</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            <Eye className="size-4 mr-1.5" />
            预览
          </Button>
          <Button size="sm" onClick={addNewTemplate}>
            <Plus className="size-4 mr-1.5" />
            新增模板
          </Button>
        </div>
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
              {['all', 'system', 'behavior', 'marketing'].map((t) => (
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
                    <div className="text-xs text-muted-foreground mt-1 truncate">{t.subject}</div>
                    <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
                      <span>{t.variables.length} 个变量</span>
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
              <Mail className="size-5 text-indigo-500" />
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
                <Label className="text-xs text-muted-foreground">发件人名称（可选）</Label>
                <Input
                  value={selected.senderName || ''}
                  onChange={(e) => updateTemplate({ senderName: e.target.value })}
                  placeholder="不填则使用全局设置"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">邮件标题（支持变量）</Label>
              <Input
                value={selected.subject}
                onChange={(e) => updateTemplate({ subject: e.target.value })}
                className="h-9"
              />
            </div>
          </div>

          {/* 编辑器 + 变量 */}
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-2 border-b border-border/40 bg-muted/20 flex items-center gap-1 text-xs">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal">
                  <Bold className="size-3.5 mr-1" />
                  加粗
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal italic">
                  I
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal">
                  <Image className="size-3.5 mr-1" />
                  图片
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal">
                  <Link className="size-3.5 mr-1" />
                  链接
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal">
                  <List className="size-3.5 mr-1" />
                  列表
                </Button>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-normal">
                  <Code className="size-3.5 mr-1" />
                  代码
                </Button>
              </div>
              <div className="flex-1 p-0 overflow-hidden">
                <Textarea
                  value={selected.content}
                  onChange={(e) => updateTemplate({ content: e.target.value })}
                  className="w-full h-full resize-none rounded-none border-0 p-4 font-mono text-sm focus-visible:ring-0"
                  placeholder="输入邮件HTML内容..."
                />
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
                  id="tpl-status"
                />
                <Label htmlFor="tpl-status" className="text-sm cursor-pointer">
                  {selected.status === 'active' ? '已启用' : '已禁用'}
                </Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}>
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

      {/* 预览弹窗 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-4 py-3 border-b border-border/40">
            <DialogTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-indigo-500" />
              邮件预览 - {selected.name}
            </DialogTitle>
            <DialogDescription>
              主题: {selected.subject}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 bg-muted/20">
            <div className="max-w-md mx-auto bg-white rounded-lg shadow-sm border border-border/40 overflow-hidden">
              <div className="p-2 bg-muted/30 border-b border-border/40 flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="size-3.5" />
                <span>收件人: test@example.com</span>
              </div>
              <div
                className="p-4"
                dangerouslySetInnerHTML={{ __html: previewContent }}
              />
            </div>
          </div>
          <DialogFooter className="px-4 py-3 border-t border-border/40">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>关闭</Button>
            <Button onClick={() => setTestOpen(true)}>
              <Send className="size-3.5 mr-1.5" />
              发送测试
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 测试发送弹窗 */}
      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Send className="size-4 text-indigo-500" />
              发送测试邮件
            </DialogTitle>
            <DialogDescription>向指定邮箱发送当前模板的测试邮件</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>收件邮箱 *</Label>
              <Input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="example@email.com"
                type="email"
              />
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-700">
                💡 测试邮件中的变量将使用示例值替换，便于查看最终效果。
              </p>
            </div>
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

function Bold({ className }: { className?: string }) {
  return <span className={className}>B</span>;
}
