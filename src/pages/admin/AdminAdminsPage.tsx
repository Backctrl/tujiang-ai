import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Crown,
  KeyRound,
  UserCog,
  UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Image as UIImage } from '@/components/ui/image';
import { storage, delay } from '@/lib/storage';
import { ADMINS_KEY, ROLES_KEY, type IAdmin, type IRole } from '@/data/admin';
import { adminService } from '@/services/adminService';
import AdminDataTable from '@/components/admin/AdminDataTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { avatarImages } from '@lark-apaas/client-toolkit-lite';

const ROLE_ICONS: Record<string, any> = {
  super_admin: Crown,
  ops_admin: UserCog,
  finance_admin: Shield,
  tech_admin: ShieldAlert,
};

export default function AdminAdminsPage() {
  const [admins, setAdmins] = useState<IAdmin[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [currentAdminId, setCurrentAdminId] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<IAdmin | null>(null);
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    roleId: '',
    status: 'active' as 'active' | 'disabled',
  });
  const [submitting, setSubmitting] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<IAdmin | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const statusActive = 'active' as const;

  useEffect(() => {
    loadData();
    const stored = storage.get<{ id: string } | null>(ADMINS_KEY + '_current', null);
    if (stored) setCurrentAdminId(stored.id);
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    const [adminList, roleList] = await Promise.all([
      adminService.listAdmins({ page: 1, pageSize: 100 }),
      adminService.getRoles(),
    ]);
    setAdmins(adminList.data?.list || []);
    setRoles(roleList);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = [...admins];
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (a) => a.username.toLowerCase().includes(kw) || a.email.toLowerCase().includes(kw),
      );
    }
    if (roleFilter !== 'all') {
      result = result.filter((a) => a.roleId === roleFilter);
    }
    return result;
  }, [admins, keyword, roleFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  function getRoleName(roleId: string) {
    return roles.find((r) => r.id === roleId)?.name || '未知角色';
  }

  function openCreate() {
    setEditing(null);
    setForm({
      username: '',
      email: '',
      password: '',
      roleId: roles.find((r) => r.id !== 'super_admin')?.id || '',
      status: 'active',
    });
    setEditOpen(true);
  }

  function openEdit(admin: IAdmin) {
    setEditing(admin);
    setForm({
      username: admin.username,
      email: admin.email,
      password: '',
      roleId: admin.roleId,
      status: admin.status,
    });
    setEditOpen(true);
  }

  async function handleSave() {
    if (!form.username.trim() || !form.email.trim()) {
      toast.warning('请填写用户名和邮箱');
      return;
    }
    if (!editing && !form.password.trim()) {
      toast.warning('请设置初始密码');
      return;
    }
    setSubmitting(true);
    await delay(300);

    const all = storage.get<IAdmin[]>(ADMINS_KEY, []);

    if (editing) {
      const idx = all.findIndex((a) => a.id === editing.id);
      if (idx !== -1) {
        all[idx].username = form.username;
        all[idx].email = form.email;
        all[idx].roleId = form.roleId;
        all[idx].status = form.status;
        all[idx].password = form.password;
      }
      toast.success('管理员已更新');
    } else {
      const newAdmin: IAdmin = {
        id: `admin_${Date.now()}`,
        username: form.username,
        email: form.email,
        nickname: form.username,
        password: btoa(form.password),
        roleId: form.roleId,
        status: form.status,
        avatar: avatarImages.avatarImg3,
        lastLoginAt: '',
        lastLoginIp: '',
        createdAt: new Date().toISOString(),
      };
      all.push(newAdmin);
      toast.success('管理员已创建');
    }
    storage.set(ADMINS_KEY, all);
    setAdmins(all);
    setSubmitting(false);
    setEditOpen(false);
  }

  function toggleStatus(admin: IAdmin) {
    if (admin.roleId === 'super_admin') {
      toast.warning('超级管理员不可禁用');
      return;
    }
    const all = storage.get<IAdmin[]>(ADMINS_KEY, []);
    const idx = all.findIndex((a) => a.id === admin.id);
    if (idx !== -1) {
      all[idx].status = all[idx].status === 'active' ? 'disabled' : 'active';
      storage.set(ADMINS_KEY, all);
      setAdmins(all);
      toast.success(all[idx].status === 'active' ? '已启用' : '已禁用');
    }
  }

  function handleDelete(admin: IAdmin) {
    if (admin.roleId === 'super_admin') {
      toast.warning('超级管理员不可删除');
      return;
    }
    if (!confirm(`确认删除管理员「${admin.username}」？`)) return;
    const all = storage.get<IAdmin[]>(ADMINS_KEY, []).filter((a) => a.id !== admin.id);
    storage.set(ADMINS_KEY, all);
    setAdmins(all);
    toast.success('已删除');
  }

  function openReset(admin: IAdmin) {
    setResetTarget(admin);
    setNewPassword('');
    setResetOpen(true);
  }

  async function handleReset() {
    if (!resetTarget || !newPassword.trim() || newPassword.length < 6) {
      toast.warning('密码至少6位');
      return;
    }
    setSubmitting(true);
    await delay(200);
    const all = storage.get<IAdmin[]>(ADMINS_KEY, []);
    const idx = all.findIndex((a) => a.id === resetTarget.id);
    if (idx !== -1) {
      all[idx].password = btoa(newPassword);
      storage.set(ADMINS_KEY, all);
      setAdmins(all);
    }
    setSubmitting(false);
    setResetOpen(false);
    toast.success('密码已重置');
  }

  const columns = [
    {
      key: 'admin',
      title: '管理员',
      width: '180px',
      render: (row: IAdmin) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <UIImage
              src={row.avatar}
              alt={row.username}
              className="size-8 rounded-full object-cover"
            />
            {row.roleId === 'super_admin' && (
              <Crown className="size-3.5 text-amber-500 absolute -top-0.5 -right-0.5 bg-background rounded-full p-px" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm truncate">{row.username}</div>
            <div className="text-xs text-muted-foreground truncate">{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      title: '角色',
      width: '110px',
      render: (row: IAdmin) => {
        const role = roles.find((r) => r.id === row.roleId);
        const Icon = ROLE_ICONS[row.roleId] || ShieldCheck;
        const colorClass = row.roleId === 'super_admin'
          ? 'bg-amber-100 text-amber-700 border-amber-200'
          : row.roleId === 'tech_admin'
          ? 'bg-cyan-100 text-cyan-700 border-cyan-200'
          : row.roleId === 'finance_admin'
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
          : 'bg-indigo-100 text-indigo-700 border-indigo-200';
        return (
          <Badge variant="outline" className={colorClass}>
            <Icon className="size-3 mr-1" />
            {role?.name || '未知'}
          </Badge>
        );
      },
    },
    {
      key: 'status',
      title: '状态',
      width: '80px',
      align: 'center' as const,
      render: (row: IAdmin) => (
        <Badge
          variant="outline"
          className={row.status === 'active'
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-rose-50 text-rose-700 border-rose-200'
          }
        >
          {row.status === 'active' ? '启用' : '禁用'}
        </Badge>
      ),
    },
    {
      key: 'lastLogin',
      title: '最后登录',
      width: '150px',
      render: (row: IAdmin) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {row.lastLoginAt ? format(new Date(row.lastLoginAt), 'yyyy-MM-dd HH:mm') : '从未登录'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: '140px',
      render: (row: IAdmin) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(row.createdAt), 'yyyy-MM-dd HH:mm')}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: '220px',
      render: (row: IAdmin) => {
        const isSuper = row.roleId === 'super_admin';
        const isSelf = row.id === currentAdminId;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => openEdit(row)}
              disabled={isSuper && !isSelf}
            >
              <Edit className="size-3.5 mr-1" />
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-indigo-600 hover:bg-indigo-50"
              onClick={() => openReset(row)}
            >
              <KeyRound className="size-3.5 mr-1" />
              重置密码
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs ${
                row.status === 'active'
                  ? 'text-amber-600 hover:bg-amber-50'
                  : 'text-emerald-600 hover:bg-emerald-50'
              }`}
              onClick={() => toggleStatus(row)}
              disabled={isSuper}
            >
              {row.status === 'active' ? (
                <><UserX className="size-3.5 mr-1" />禁用</>
              ) : (
                <><ShieldCheck className="size-3.5 mr-1" />启用</>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-rose-500 hover:bg-rose-50"
              onClick={() => handleDelete(row)}
              disabled={isSuper}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">管理员列表</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理后台系统管理员账号</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4 mr-1.5" />
          新增管理员
        </Button>
      </div>

      {/* 角色统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {roles.map((role) => {
          const Icon = ROLE_ICONS[role.id] || Shield;
          const count = admins.filter((a) => a.roleId === role.id).length;
          const colorClass = role.id === 'super_admin'
            ? 'from-amber-100 to-amber-50 border-amber-200 text-amber-700'
            : role.id === 'tech_admin'
            ? 'from-cyan-100 to-cyan-50 border-cyan-200 text-cyan-700'
            : role.id === 'finance_admin'
            ? 'from-emerald-100 to-emerald-50 border-emerald-200 text-emerald-700'
            : 'from-indigo-100 to-indigo-50 border-indigo-200 text-indigo-700';
          return (
            <Card key={role.id} className={`border bg-gradient-to-br ${colorClass}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="size-10 rounded-lg bg-white/80 flex items-center justify-center">
                  <Icon className="size-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs opacity-80">{role.name}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AdminDataTable
        columns={columns}
        data={paginated}
        loading={loading}
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        rowKey={(row) => row.id}
        search={{
          value: keyword,
          onChange: (v) => {
            setKeyword(v);
            setPage(1);
          },
          placeholder: '搜索用户名、邮箱...',
        }}
        toolbar={
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
            <SelectTrigger className="w-32 h-9 text-sm">
              <SelectValue placeholder="全部角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部角色</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑管理员' : '新增管理员'}</DialogTitle>
            <DialogDescription>设置管理员账号信息和权限角色</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>用户名 *</Label>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="admin"
                />
              </div>
              <div className="space-y-1.5">
                <Label>邮箱 *</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="admin@example.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{editing ? '新密码（留空则不修改）' : '初始密码 *'}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="至少6位"
              />
            </div>

            <div className="space-y-1.5">
              <Label>角色 *</Label>
              <Select
                value={form.roleId}
                onValueChange={(v) => setForm({ ...form, roleId: v })}
                disabled={editing?.roleId === 'super_admin'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择角色" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-border/40">
              <Input
                type="checkbox"
                id="admin-status"
                checked={form.status === 'active'}
                onChange={(e) => setForm({ ...form, status: e.target.checked ? 'active' : 'disabled' })}
                className="size-4"
              />
              <Label htmlFor="admin-status" className="cursor-pointer">启用账号</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={submitting}>
              {submitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重置密码弹窗 */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-indigo-500" />
              重置密码
            </DialogTitle>
            <DialogDescription>
              为管理员「{resetTarget?.username}」设置新密码
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>新密码 *</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少6位"
                onKeyDown={(e) => e.key === 'Enter' && handleReset()}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>取消</Button>
            <Button onClick={handleReset} disabled={submitting}>
              {submitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
