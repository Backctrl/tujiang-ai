import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Key,
  Plus,
  Search,
  Eye,
  Copy,
  RefreshCw,
  Trash2,
  Shield,
  Clock,
  Activity,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Zap,
  User,
  Calendar,
  AlertTriangle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { storage, delay } from '@/lib/storage';
import { API_KEYS_KEY, API_LOGS_KEY, type IApiKey, type IApiLog } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';

const PAGE_SIZE = 20;

const PERMISSION_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: '生成服务',
    items: [
      { key: 'masterplan.generate', label: '主图全案生成' },
      { key: 'clone.generate', label: '克隆大师生成' },
      { key: 'create.text2img', label: '文生图' },
      { key: 'create.img2img', label: '图生图' },
      { key: 'tools.remove-bg', label: '智能抠图' },
      { key: 'tools.upscale', label: '图片放大' },
      { key: 'tools.replace-bg', label: '背景替换' },
    ],
  },
  {
    group: '用户相关',
    items: [
      { key: 'user.info', label: '获取用户信息' },
      { key: 'user.balance', label: '查询积分余额' },
      { key: 'user.history', label: '获取历史记录' },
    ],
  },
  {
    group: '内容相关',
    items: [
      { key: 'styles.list', label: '风格模板列表' },
      { key: 'styles.detail', label: '风格详情' },
      { key: 'cases.list', label: '案例列表' },
      { key: 'cases.detail', label: '案例详情' },
    ],
  },
];

export default function AdminApiKeysPage() {
  const [keys, setKeys] = useState<IApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [newKeyDisplay, setNewKeyDisplay] = useState('');
  const [detailDrawer, setDetailDrawer] = useState(false);
  const [selectedKey, setSelectedKey] = useState<IApiKey | null>(null);
  const [recentLogs, setRecentLogs] = useState<IApiLog[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    userId: 'system',
    permissions: [] as string[],
    validPeriod: 'forever' as 'forever' | '30d' | '90d' | 'custom',
    customDate: '',
    perMinute: 0,
    perDay: 0,
    perMonth: 0,
  });

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    const list = storage.get<IApiKey[]>(API_KEYS_KEY, []);
    setKeys(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return keys.filter((k) => {
      if (statusFilter !== 'all' && k.status !== statusFilter) return false;
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        if (!k.name.toLowerCase().includes(kw) && !(k.userName?.toLowerCase().includes(kw))) return false;
      }
      return true;
    });
  }, [keys, statusFilter, keyword]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter]);

  const totalCount = keys.length;
  const activeCount = keys.filter((k) => k.status === 'active').length;
  const disabledCount = keys.filter((k) => k.status === 'disabled').length;
  const todayCalls = keys.reduce((s, k) => s + Math.floor(k.callCount * 0.1), 0);

  function openCreate() {
    setForm({
      name: '',
      userId: 'system',
      permissions: [],
      validPeriod: 'forever',
      customDate: '',
      perMinute: 0,
      perDay: 0,
      perMonth: 0,
    });
    setCreateOpen(true);
  }

  function togglePermission(key: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  }

  function toggleGroup(groupKey: string) {
    const group = PERMISSION_GROUPS.find((g) => g.group === groupKey);
    if (!group) return;
    const allKeys = group.items.map((i) => i.key);
    const allSelected = allKeys.every((k) => form.permissions.includes(k));
    setForm((f) => ({
      ...f,
      permissions: allSelected
        ? f.permissions.filter((p) => !allKeys.includes(p))
        : [...new Set([...f.permissions, ...allKeys])],
    }));
  }

  function toggleAll() {
    const allKeys = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));
    const allSelected = allKeys.every((k) => form.permissions.includes(k));
    setForm((f) => ({
      ...f,
      permissions: allSelected ? [] : allKeys,
    }));
  }

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.warning('请输入密钥名称');
      return;
    }
    setSubmitting(true);
    await delay(400);

    const randomPart = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    const fullKey = `tk_${randomPart}`;
    const prefix = fullKey.slice(0, 8);
    const suffix = fullKey.slice(-4);

    let expiresAt: string | undefined;
    if (form.validPeriod === '30d') {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      expiresAt = d.toISOString();
    } else if (form.validPeriod === '90d') {
      const d = new Date();
      d.setDate(d.getDate() + 90);
      expiresAt = d.toISOString();
    } else if (form.validPeriod === 'custom' && form.customDate) {
      expiresAt = new Date(form.customDate).toISOString();
    }

    const newKey: IApiKey = {
      id: `api_key_${Date.now()}`,
      name: form.name,
      keyPrefix: prefix,
      keySuffix: suffix,
      fullKey,
      userId: form.userId === 'system' ? undefined : form.userId,
      userName: form.userId === 'system' ? '系统级' : '指定用户',
      isSystem: form.userId === 'system',
      permissions: form.permissions,
      callCount: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: '',
      expiresAt,
      rateLimit: {
        perMinute: form.perMinute,
        perDay: form.perDay,
        perMonth: form.perMonth,
      },
    };

    const all = storage.get<IApiKey[]>(API_KEYS_KEY, []);
    all.push(newKey);
    storage.set(API_KEYS_KEY, all);
    setKeys([newKey, ...all]);

    setNewKeyDisplay(fullKey);
    setSubmitting(false);
    setCreateOpen(false);
    setShowKeyModal(true);
  }

  async function toggleKeyStatus(key: IApiKey) {
    const all = storage.get<IApiKey[]>(API_KEYS_KEY, []);
    const idx = all.findIndex((k) => k.id === key.id);
    if (idx !== -1) {
      all[idx].status = all[idx].status === 'active' ? 'disabled' : 'active';
      storage.set(API_KEYS_KEY, all);
      setKeys([...all]);
      toast.success(all[idx].status === 'active' ? '已启用' : '已禁用');
    }
  }

  function handleDelete(key: IApiKey) {
    if (!confirm(`确认删除密钥「${key.name}」？删除后立即失效，不可恢复。`)) return;
    const all = storage.get<IApiKey[]>(API_KEYS_KEY, []).filter((k) => k.id !== key.id);
    storage.set(API_KEYS_KEY, all);
    setKeys([...all]);
    toast.success('密钥已删除');
  }

  function copyKey(key: string) {
    navigator.clipboard?.writeText(key);
    toast.success('已复制到剪贴板');
  }

  async function openDetail(key: IApiKey) {
    setSelectedKey(key);
    const logs = storage.get<IApiLog[]>(API_LOGS_KEY, []);
    const related = logs
      .filter((l) => l.apiKeyName === key.name)
      .slice(0, 10);
    setRecentLogs(related);
    setDetailDrawer(true);
  }

  async function resetKey(key: IApiKey) {
    if (!confirm(`确认重置密钥「${key.name}」？旧密钥将立即失效。`)) return;
    const all = storage.get<IApiKey[]>(API_KEYS_KEY, []);
    const idx = all.findIndex((k) => k.id === key.id);
    if (idx === -1) return;

    const randomPart = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    const fullKey = `tk_${randomPart}`;
    all[idx].keyPrefix = fullKey.slice(0, 8);
    all[idx].keySuffix = fullKey.slice(-4);
    all[idx].fullKey = fullKey;
    storage.set(API_KEYS_KEY, all);
    setKeys([...all]);
    setNewKeyDisplay(fullKey);
    setShowKeyModal(true);
    toast.success('密钥已重置');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">API密钥管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理API密钥的创建、权限和调用限制</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4 mr-1.5" />
          新增密钥
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Key className="size-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{totalCount}</div>
              <div className="text-xs text-muted-foreground">总密钥数</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-emerald-200/60 bg-emerald-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700 tabular-nums">{activeCount}</div>
              <div className="text-xs text-emerald-600">启用中</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200/60 bg-slate-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-slate-400 flex items-center justify-center">
              <XCircle className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-600 tabular-nums">{disabledCount}</div>
              <div className="text-xs text-slate-500">已禁用</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-violet-200/60 bg-violet-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-violet-500 flex items-center justify-center">
              <Zap className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-violet-700 tabular-nums">{todayCalls.toLocaleString()}</div>
              <div className="text-xs text-violet-600">今日调用</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 筛选 */}
      <Card className="border border-border/50 mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索密钥名称、关联用户..."
              className="bg-background pl-9 h-9"
            />
          </div>
          <div className="w-40">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">启用</SelectItem>
                <SelectItem value="disabled">禁用</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 表格 */}
      <Card className="border border-border/50">
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">密钥名称</TableHead>
                  <TableHead className="whitespace-nowrap">密钥前缀</TableHead>
                  <TableHead className="whitespace-nowrap">关联用户</TableHead>
                  <TableHead className="whitespace-nowrap">权限数</TableHead>
                  <TableHead className="whitespace-nowrap">调用次数</TableHead>
                  <TableHead className="whitespace-nowrap">状态</TableHead>
                  <TableHead className="whitespace-nowrap">创建时间</TableHead>
                  <TableHead className="whitespace-nowrap">最后使用</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 9 }).map((__, j) => (
                          <TableCell key={j}>
                            <div className="h-4 bg-muted/40 rounded animate-pulse" style={{ width: `${40 + Math.random() * 80}px` }} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : paged.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                          暂无API密钥
                        </TableCell>
                      </TableRow>
                    )
                  : paged.map((k) => (
                      <TableRow key={k.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium">{k.name}</TableCell>
                        <TableCell>
                          <code className="px-2 py-1 bg-muted/50 rounded text-xs font-mono">
                            {k.keyPrefix}****{k.keySuffix}
                          </code>
                        </TableCell>
                        <TableCell className="text-sm">
                          {k.isSystem ? (
                            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                              系统级
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">{k.userName}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">{k.permissions.length}</TableCell>
                        <TableCell className="text-sm tabular-nums">{k.callCount.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch checked={k.status === 'active'} onCheckedChange={() => toggleKeyStatus(k)} />
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                          {format(new Date(k.createdAt), 'yyyy-MM-dd')}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                          {k.lastUsedAt ? format(new Date(k.lastUsedAt), 'MM-dd HH:mm') : '从未使用'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openDetail(k)}>
                              <Eye className="size-3.5 mr-1" />
                              详情
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-violet-600" onClick={() => resetKey(k)}>
                              <RefreshCw className="size-3.5 mr-1" />
                              重置
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-rose-500" onClick={() => handleDelete(k)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </div>

          {!loading && filtered.length > 0 && (
            <div className="flex items-center justify-between p-4 border-t border-border/40">
              <div className="text-sm text-muted-foreground">
                共 <span className="font-medium text-foreground">{filtered.length}</span> 条记录
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                  上一页
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新增密钥弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新增API密钥</DialogTitle>
            <DialogDescription>创建新的API密钥，配置权限和调用限制</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label>密钥名称 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例：生产环境主密钥"
              />
            </div>

            <div className="space-y-1.5">
              <Label>关联用户</Label>
              <Select value={form.userId} onValueChange={(v) => setForm({ ...form, userId: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">系统级（不关联具体用户）</SelectItem>
                  <SelectItem value="user_1">用户 - demo@tujiang.ai</SelectItem>
                  <SelectItem value="user_2">用户 - test@example.com</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>权限范围</Label>
                <div className="flex items-center gap-2 text-xs">
                  <button onClick={toggleAll} className="text-indigo-600 hover:text-indigo-700 hover:underline">
                    {form.permissions.length === PERMISSION_GROUPS.flatMap((g) => g.items).length ? '全不选' : '全选'}
                  </button>
                  <span className="text-muted-foreground">
                    已选 <span className="font-medium text-foreground">{form.permissions.length}</span> 项
                  </span>
                </div>
              </div>
              <div className="border border-border/60 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                {PERMISSION_GROUPS.map((group) => {
                  const allKeys = group.items.map((i) => i.key);
                  const groupAllSelected = allKeys.every((k) => form.permissions.includes(k));
                  const groupSomeSelected = allKeys.some((k) => form.permissions.includes(k));
                  return (
                    <div key={group.group} className="border-b border-border/40 last:border-b-0">
                      <div
                        className="flex items-center justify-between px-3 py-2 bg-muted/20 cursor-pointer hover:bg-muted/40"
                        onClick={() => toggleGroup(group.group)}
                      >
                        <span className="text-sm font-medium">{group.group}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {form.permissions.filter((p) => allKeys.includes(p)).length}/{allKeys.length}
                          </span>
                          <input
                            type="checkbox"
                            checked={groupAllSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = groupSomeSelected && !groupAllSelected;
                            }}
                            className="size-4 rounded border-border"
                            readOnly
                          />
                        </div>
                      </div>
                      <div className="p-3 space-y-2">
                        {group.items.map((item) => (
                          <label
                            key={item.key}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/20 px-2 py-1 rounded"
                          >
                            <input
                              type="checkbox"
                              checked={form.permissions.includes(item.key)}
                              onChange={() => togglePermission(item.key)}
                              className="size-3.5 rounded border-border"
                            />
                            <span>{item.label}</span>
                            <code className="ml-auto text-xs text-muted-foreground font-mono">{item.key}</code>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>有效期</Label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { value: 'forever', label: '永久' },
                  { value: '30d', label: '30天' },
                  { value: '90d', label: '90天' },
                  { value: 'custom', label: '自定义' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setForm({ ...form, validPeriod: opt.value as any })}
                    className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                      form.validPeriod === opt.value
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                        : 'border-border/60 hover:border-border'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {form.validPeriod === 'custom' && (
                <Input
                  type="date"
                  value={form.customDate}
                  onChange={(e) => setForm({ ...form, customDate: e.target.value })}
                  className="mt-2"
                />
              )}
            </div>

            <div className="space-y-2">
              <Label>调用限额（0表示不限制）</Label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">每分钟</Label>
                  <Input
                    type="number"
                    value={form.perMinute || ''}
                    onChange={(e) => setForm({ ...form, perMinute: Number(e.target.value) })}
                    min={0}
                    placeholder="0"
                    className="h-9 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">每天</Label>
                  <Input
                    type="number"
                    value={form.perDay || ''}
                    onChange={(e) => setForm({ ...form, perDay: Number(e.target.value) })}
                    min={0}
                    placeholder="0"
                    className="h-9 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">每月</Label>
                  <Input
                    type="number"
                    value={form.perMonth || ''}
                    onChange={(e) => setForm({ ...form, perMonth: Number(e.target.value) })}
                    min={0}
                    placeholder="0"
                    className="h-9 mt-1"
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              创建密钥
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新密钥显示弹窗 */}
      <Dialog open={showKeyModal} onOpenChange={setShowKeyModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5 text-amber-500" />
              密钥创建成功
            </DialogTitle>
            <DialogDescription>
              请立即复制保存，关闭后不再显示完整密钥
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2 text-amber-800">
                <AlertTriangle className="size-5 shrink-0 mt-0.5" />
                <div className="text-sm space-y-1">
                  <p className="font-medium">重要提示</p>
                  <p className="text-amber-700">
                    这是唯一一次显示完整密钥的机会。请将密钥安全保存，不要分享给他人，也不要提交到代码仓库。
                  </p>
                </div>
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border border-border/40">
              <div className="flex items-center justify-between gap-2">
                <code className="text-sm font-mono break-all flex-1">{newKeyDisplay}</code>
                <Button variant="outline" size="sm" className="shrink-0 h-7" onClick={() => copyKey(newKeyDisplay)}>
                  <Copy className="size-3.5 mr-1" />
                  复制
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowKeyModal(false)}>我已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情抽屉 */}
      <Drawer open={detailDrawer} onOpenChange={setDetailDrawer}>
        <DrawerContent className="h-[90vh] max-w-xl mx-auto">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Key className="size-5 text-indigo-500" />
              密钥详情 - {selectedKey?.name}
            </DrawerTitle>
            <DrawerDescription>查看密钥信息和调用统计</DrawerDescription>
          </DrawerHeader>
          {selectedKey && (
            <div className="px-4 pb-6 space-y-5 overflow-y-auto">
              {/* 基本信息 */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="size-4 text-indigo-500" />
                  基本信息
                </h3>
                <div className="grid grid-cols-2 gap-3 p-3 bg-muted/20 rounded-lg">
                  <div>
                    <Label className="text-xs text-muted-foreground">密钥名称</Label>
                    <div className="text-sm font-medium mt-1">{selectedKey.name}</div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">状态</Label>
                    <div className="text-sm font-medium mt-1">
                      <Badge
                        variant="outline"
                        className={selectedKey.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                        }
                      >
                        {selectedKey.status === 'active' ? '启用' : '禁用'}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">密钥前缀</Label>
                    <div className="text-sm font-mono mt-1">
                      {selectedKey.keyPrefix}****{selectedKey.keySuffix}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">关联用户</Label>
                    <div className="text-sm font-medium mt-1">
                      {selectedKey.isSystem ? '系统级' : selectedKey.userName}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">创建时间</Label>
                    <div className="text-sm mt-1 tabular-nums">
                      {format(new Date(selectedKey.createdAt), 'yyyy-MM-dd HH:mm')}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">最后使用</Label>
                    <div className="text-sm mt-1 tabular-nums">
                      {selectedKey.lastUsedAt ? format(new Date(selectedKey.lastUsedAt), 'MM-dd HH:mm') : '从未使用'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 调用统计 */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="size-4 text-amber-500" />
                  调用统计
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-indigo-50 rounded-lg text-center">
                    <div className="text-xl font-bold text-indigo-700 tabular-nums">
                      {Math.floor(selectedKey.callCount * 0.05).toLocaleString()}
                    </div>
                    <div className="text-xs text-indigo-600">今日调用</div>
                  </div>
                  <div className="p-3 bg-violet-50 rounded-lg text-center">
                    <div className="text-xl font-bold text-violet-700 tabular-nums">
                      {Math.floor(selectedKey.callCount * 0.3).toLocaleString()}
                    </div>
                    <div className="text-xs text-violet-600">本周调用</div>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg text-center">
                    <div className="text-xl font-bold text-emerald-700 tabular-nums">
                      {selectedKey.callCount.toLocaleString()}
                    </div>
                    <div className="text-xs text-emerald-600">总调用</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-muted/30 rounded-lg text-center">
                    <div className="text-lg font-bold tabular-nums">99.2%</div>
                    <div className="text-xs text-muted-foreground">成功率</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg text-center">
                    <div className="text-lg font-bold tabular-nums">128ms</div>
                    <div className="text-xs text-muted-foreground">平均响应</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg text-center">
                    <div className="text-lg font-bold tabular-nums">456ms</div>
                    <div className="text-xs text-muted-foreground">P99响应</div>
                  </div>
                </div>
              </div>

              {/* 最近调用记录 */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="size-4 text-blue-500" />
                  最近调用记录
                </h3>
                <div className="border border-border/40 rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">时间</TableHead>
                        <TableHead className="text-xs">接口</TableHead>
                        <TableHead className="text-xs">状态码</TableHead>
                        <TableHead className="text-xs">响应时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentLogs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="h-20 text-center text-xs text-muted-foreground">
                            暂无调用记录
                          </TableCell>
                        </TableRow>
                      ) : (
                        recentLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs tabular-nums">
                              {format(new Date(log.timestamp), 'MM-dd HH:mm:ss')}
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[120px]">{log.endpoint}</TableCell>
                            <TableCell className="text-xs tabular-nums">
                              <span className={log.statusCode >= 400 ? 'text-rose-600' : 'text-emerald-600'}>
                                {log.statusCode}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs tabular-nums">{log.responseTime}ms</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => resetKey(selectedKey)}>
                  <RefreshCw className="size-4 mr-1.5" />
                  重置密钥
                </Button>
                <Button
                  variant="outline"
                  className={selectedKey.status === 'active' ? 'text-amber-600 border-amber-200' : 'text-emerald-600 border-emerald-200'}
                  onClick={() => { toggleKeyStatus(selectedKey); setDetailDrawer(false); }}
                >
                  {selectedKey.status === 'active' ? '禁用' : '启用'}
                </Button>
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
