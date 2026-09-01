import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Shield,
  Users,
  Plus,
  Search,
  Save,
  Check,
  ChevronRight,
  ChevronDown,
  Copy,
  Trash2,
  Edit,
  Lock,
  Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { storage, delay } from '@/lib/storage';
import { mockDataService } from '@/services/mockDataService';

const ROLES_KEY = '__app_tujiang_admin_roles';

interface IRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  dataScope?: string;
  isSystem: boolean;
  createdAt: string;
  status: 'active' | 'disabled';
}

const PERMISSION_MODULES = [
  {
    module: 'data-overview',
    name: '数据概览',
    items: [
      { key: 'dashboard:view', label: '查看仪表盘' },
      { key: 'dashboard:export', label: '导出报表' },
    ],
  },
  {
    module: 'user-management',
    name: '用户管理',
    items: [
      { key: 'user:view', label: '查看用户' },
      { key: 'user:create', label: '新增用户' },
      { key: 'user:edit', label: '编辑用户' },
      { key: 'user:delete', label: '删除用户' },
      { key: 'user:export', label: '导出用户' },
    ],
  },
  {
    module: 'order-revenue',
    name: '订单营收',
    items: [
      { key: 'order:view', label: '查看订单' },
      { key: 'order:edit', label: '编辑订单' },
      { key: 'order:refund', label: '退款处理' },
      { key: 'order:export', label: '导出订单' },
      { key: 'revenue:view', label: '营收统计' },
    ],
  },
  {
    module: 'api-management',
    name: 'API管理',
    items: [
      { key: 'apikey:view', label: '查看密钥' },
      { key: 'apikey:create', label: '创建密钥' },
      { key: 'apikey:edit', label: '编辑密钥' },
      { key: 'apikey:delete', label: '删除密钥' },
      { key: 'apilog:view', label: '查看调用日志' },
    ],
  },
  {
    module: 'content-management',
    name: '内容管理',
    items: [
      { key: 'style:view', label: '查看风格' },
      { key: 'style:edit', label: '编辑风格' },
      { key: 'case:view', label: '查看案例' },
      { key: 'case:edit', label: '编辑案例' },
      { key: 'announcement:edit', label: '公告管理' },
      { key: 'feedback:view', label: '查看反馈' },
      { key: 'feedback:reply', label: '回复反馈' },
    ],
  },
  {
    module: 'system-settings',
    name: '系统设置',
    items: [
      { key: 'settings:basic', label: '基础设置' },
      { key: 'settings:points', label: '积分规则' },
      { key: 'settings:email', label: '邮件模板' },
      { key: 'settings:sms', label: '短信模板' },
      { key: 'settings:services', label: '服务配置' },
    ],
  },
  {
    module: 'permission-management',
    name: '权限管理',
    items: [
      { key: 'admin:view', label: '查看管理员' },
      { key: 'admin:create', label: '新增管理员' },
      { key: 'admin:edit', label: '编辑管理员' },
      { key: 'role:view', label: '查看角色' },
      { key: 'role:edit', label: '编辑角色' },
    ],
  },
  {
    module: 'system-monitor',
    name: '系统监控',
    items: [
      { key: 'monitor:status', label: '系统状态' },
      { key: 'monitor:audit', label: '操作日志' },
      { key: 'monitor:error', label: '错误日志' },
      { key: 'monitor:loginlog', label: '登录日志' },
    ],
  },
];

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<IRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [dataScope, setDataScope] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', description: '', enabled: true });
  const [saving, setSaving] = useState(false);

  const selected = roles.find((r) => r.id === selectedId) || null;

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    const list = storage.get<IRole[]>(ROLES_KEY, []);
    setRoles(list);
    if (list.length > 0 && !selectedId) {
      setSelectedId(list[0].id);
      setDataScope(list[0].dataScope || 'all');
      // 展开第一个模块
      setExpandedModules({ [PERMISSION_MODULES[0].module]: true });
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return roles;
    const kw = search.trim().toLowerCase();
    return roles.filter((r) => r.name.toLowerCase().includes(kw) || r.description.toLowerCase().includes(kw));
  }, [roles, search]);

  const allPermKeys = PERMISSION_MODULES.flatMap((m) => m.items.map((i) => i.key));
  const selectedPerms = selected?.permissions || [];

  function toggleModule(moduleKey: string) {
    setExpandedModules((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
  }

  function togglePermission(key: string) {
    if (!selected || selected.isSystem) return;
    const newPerms = selectedPerms.includes(key)
      ? selectedPerms.filter((p) => p !== key)
      : [...selectedPerms, key];
    updateSelectedRole({ permissions: newPerms });
  }

  function toggleModulePermissions(moduleKey: string) {
    if (!selected || selected.isSystem) return;
    const module = PERMISSION_MODULES.find((m) => m.module === moduleKey);
    if (!module) return;
    const allKeys = module.items.map((i) => i.key);
    const allSelected = allKeys.every((k) => selectedPerms.includes(k));
    const newPerms = allSelected
      ? selectedPerms.filter((p) => !allKeys.includes(p))
      : [...new Set([...selectedPerms, ...allKeys])];
    updateSelectedRole({ permissions: newPerms });
  }

  function toggleAllPermissions() {
    if (!selected || selected.isSystem) return;
    const allSelected = allPermKeys.every((k) => selectedPerms.includes(k));
    updateSelectedRole({ permissions: allSelected ? [] : allPermKeys });
  }

  function updateSelectedRole(updates: Partial<IRole>) {
    if (!selected) return;
    const updated = { ...selected, ...updates };
    setRoles((prev) => prev.map((r) => (r.id === selected.id ? updated : r)));
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    await delay(400);
    const all = storage.get<IRole[]>(ROLES_KEY, []);
    const idx = all.findIndex((r) => r.id === selected.id);
    if (idx !== -1) {
      all[idx] = { ...selected, dataScope };
      storage.set(ROLES_KEY, all);
    }
    setSaving(false);
    toast.success('权限配置已保存');
  }

  function handleCopy() {
    if (!selected) return;
    const newR: IRole = {
      id: `role_${Date.now()}`,
      name: `${selected.name} (副本)`,
      description: selected.description,
      permissions: [...selected.permissions],
      dataScope: selected.dataScope || 'all',
      isSystem: false,
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    const all = storage.get<IRole[]>(ROLES_KEY, []);
    all.push(newR);
    storage.set(ROLES_KEY, all);
    setRoles(all);
    setSelectedId(newR.id);
    toast.success('已复制为新角色');
  }

  function handleReset() {
    if (!confirm('确认重置为默认权限配置？当前修改将丢失。')) return;
    const defaults = storage.get<IRole[]>(ROLES_KEY, []).find((r) => r.id === selectedId);
    if (defaults) {
      updateSelectedRole({ permissions: defaults.permissions });
      setDataScope(defaults.dataScope || 'all');
      toast.success('已重置为默认配置');
    }
  }

  function handleDelete(role: IRole) {
    if (role.isSystem) {
      toast.warning('系统角色不可删除');
      return;
    }
    if (!confirm(`确认删除角色「${role.name}」？`)) return;
    const all = storage.get<IRole[]>(ROLES_KEY, []).filter((r) => r.id !== role.id);
    storage.set(ROLES_KEY, all);
    setRoles(all);
    if (selectedId === role.id && all.length > 0) {
      setSelectedId(all[0].id);
    }
    toast.success('角色已删除');
  }

  async function handleCreate() {
    if (!newRole.name.trim()) {
      toast.warning('请输入角色名称');
      return;
    }
    setSaving(true);
    await delay(400);
    const role: IRole = {
      id: `role_${Date.now()}`,
      name: newRole.name,
      description: newRole.description,
      permissions: [],
      dataScope: 'all',
      isSystem: false,
      createdAt: new Date().toISOString(),
      status: newRole.enabled ? 'active' : 'disabled',
    };
    const all = storage.get<IRole[]>(ROLES_KEY, []);
    all.push(role);
    storage.set(ROLES_KEY, all);
    setRoles(all);
    setSelectedId(role.id);
    setCreateOpen(false);
    setNewRole({ name: '', description: '', enabled: true });
    setSaving(false);
    toast.success('角色创建成功');
  }

  const totalRoles = roles.length;
  const activeRoles = roles.filter((r) => r.status === 'active').length;
  const totalPerms = allPermKeys.length;
  const totalAdmins = 12; // 模拟

  return (
    <div className="p-6 h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">角色与权限管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">配置角色权限和数据访问范围</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          新增角色
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Shield className="size-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{totalRoles}</div>
              <div className="text-xs text-muted-foreground">总角色数</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-emerald-200/60 bg-emerald-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              <Check className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700 tabular-nums">{activeRoles}</div>
              <div className="text-xs text-emerald-600">启用角色</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-blue-200/60 bg-blue-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <Users className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-700 tabular-nums">{totalAdmins}</div>
              <div className="text-xs text-blue-600">管理员总数</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-violet-200/60 bg-violet-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-violet-500 flex items-center justify-center">
              <Lock className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-violet-700 tabular-nums">{totalPerms}</div>
              <div className="text-xs text-violet-600">权限项总数</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4 h-[calc(100%-160px)]">
        {/* 左侧角色列表 */}
        <div className="w-80 shrink-0 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card">
          <div className="p-3 border-b border-border/40">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索角色..."
                className="h-9 pl-8"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-3 border border-border/40 rounded-lg animate-pulse">
                    <div className="h-4 bg-muted/40 rounded w-2/3 mb-2" />
                    <div className="h-3 bg-muted/30 rounded w-1/2" />
                  </div>
                ))
              : filtered.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => { setSelectedId(role.id); setDataScope(role.dataScope || 'all'); }}
                    className={`w-full p-3 text-left rounded-lg border transition-all ${
                      selectedId === role.id
                        ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-200'
                        : 'border-border/40 hover:border-border/80 hover:bg-muted/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`size-8 rounded-md flex items-center justify-center shrink-0 ${
                          role.isSystem ? 'bg-amber-100' : 'bg-indigo-100'
                        }`}>
                          {role.isSystem ? (
                            <Shield className="size-4 text-amber-600" />
                          ) : (
                            <Users className="size-4 text-indigo-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{role.name}</span>
                            {role.isSystem && (
                              <Badge variant="outline" className="h-4 text-[10px] px-1 bg-amber-50 text-amber-700 border-amber-200">
                                系统
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">{role.description}</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Lock className="size-3" />
                          {role.permissions.length} 权限
                        </span>
                      </div>
                      {!role.isSystem && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(role); }}
                          className="text-rose-400 hover:text-rose-600"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </button>
                ))}
          </div>
        </div>

        {/* 右侧权限配置 */}
        <div className="flex-1 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card">
          {selected ? (
            <>
              <div className="p-4 border-b border-border/40 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{selected.name}</h3>
                      {selected.isSystem && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          系统角色，不可删除
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{selected.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                      <Copy className="size-3.5 mr-1" />
                      复制为新角色
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleReset} disabled={selected.isSystem}>
                      重置为默认
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={saving || selected.isSystem}>
                      {saving && (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
                      )}
                      <Save className="size-3.5 mr-1" />
                      保存权限
                    </Button>
                  </div>
                </div>

                {/* 角色基本信息编辑 */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">角色名称</Label>
                    <Input
                      value={selected.name}
                      onChange={(e) => updateSelectedRole({ name: e.target.value })}
                      disabled={selected.isSystem}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">角色描述</Label>
                    <Input
                      value={selected.description}
                      onChange={(e) => updateSelectedRole({ description: e.target.value })}
                      disabled={selected.isSystem}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 权限树 */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Lock className="size-4 text-indigo-500" />
                      功能权限
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        (已选 {selectedPerms.length}/{totalPerms})
                      </span>
                    </h4>
                    <button
                      onClick={toggleAllPermissions}
                      disabled={selected.isSystem}
                      className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {allPermKeys.every((k) => selectedPerms.includes(k)) ? '全不选' : '全选'}
                    </button>
                  </div>

                  <div className="border border-border/40 rounded-lg overflow-hidden">
                    {PERMISSION_MODULES.map((module) => {
                      const allKeys = module.items.map((i) => i.key);
                      const allSelected = allKeys.every((k) => selectedPerms.includes(k));
                      const someSelected = allKeys.some((k) => selectedPerms.includes(k));
                      const expanded = expandedModules[module.module];
                      return (
                        <div key={module.module} className="border-b border-border/30 last:border-b-0">
                          <div
                            className="flex items-center justify-between px-3 py-2.5 bg-muted/20 cursor-pointer hover:bg-muted/30"
                            onClick={() => toggleModule(module.module)}
                          >
                            <div className="flex items-center gap-2">
                              {expanded ? (
                                <ChevronDown className="size-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="size-4 text-muted-foreground" />
                              )}
                              <span className="text-sm font-medium">{module.name}</span>
                              <span className="text-xs text-muted-foreground">
                                ({selectedPerms.filter((p) => allKeys.includes(p)).length}/{allKeys.length})
                              </span>
                            </div>
                            <input
                              type="checkbox"
                              checked={allSelected}
                              ref={(el) => {
                                if (el) el.indeterminate = someSelected && !allSelected;
                              }}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleModulePermissions(module.module);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              disabled={selected.isSystem}
                              className="size-4 rounded border-border"
                            />
                          </div>
                          {expanded && (
                            <div className="p-3 grid grid-cols-2 gap-1.5">
                              {module.items.map((item) => (
                                <label
                                  key={item.key}
                                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/20 px-2 py-1.5 rounded"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedPerms.includes(item.key)}
                                    onChange={() => togglePermission(item.key)}
                                    disabled={selected.isSystem}
                                    className="size-3.5 rounded border-border"
                                  />
                                  <span className="flex-1">{item.label}</span>
                                  <code className="text-[10px] text-muted-foreground font-mono">{item.key}</code>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 数据权限 */}
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Database className="size-4 text-indigo-500" />
                    数据权限
                  </h4>
                  <div className="border border-border/40 rounded-lg p-3 space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { value: 'all', label: '全部数据', desc: '可查看所有数据' },
                        { value: 'dept', label: '本部门数据', desc: '仅查看本部门' },
                        { value: 'self', label: '本人数据', desc: '仅查看本人数据' },
                        { value: 'custom', label: '自定义', desc: '自定义数据范围' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => !selected.isSystem && setDataScope(opt.value)}
                          disabled={selected.isSystem}
                          className={`p-3 text-left rounded-lg border transition-all ${
                            dataScope === opt.value
                              ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-200'
                              : 'border-border/40 hover:border-border/80'
                          } ${selected.isSystem ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    {dataScope === 'custom' && (
                      <div className="p-3 bg-muted/20 rounded-lg">
                        <Label className="text-xs text-muted-foreground mb-2 block">选择可访问的部门</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {['产品部', '技术部', '运营部', '市场部', '客服部', '财务部'].map((dept) => (
                            <Badge key={dept} variant="outline" className="cursor-pointer hover:bg-indigo-50">
                              {dept}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              请选择一个角色
            </div>
          )}
        </div>
      </div>

      {/* 新增角色弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">新增角色</DialogTitle>
            <DialogDescription>创建新的角色，后续可配置详细权限</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>角色名称 *</Label>
              <Input
                value={newRole.name}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                placeholder="例：运营主管"
              />
            </div>
            <div className="space-y-1.5">
              <Label>角色描述</Label>
              <Textarea
                value={newRole.description}
                onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                placeholder="描述该角色的职责范围..."
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>启用状态</Label>
                <p className="text-xs text-muted-foreground mt-0.5">禁用后该角色下的管理员无法登录</p>
              </div>
              <Switch checked={newRole.enabled} onCheckedChange={(c) => setNewRole({ ...newRole, enabled: c })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              创建角色
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
