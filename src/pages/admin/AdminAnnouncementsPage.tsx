import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Send,
  AlertCircle,
  Info,
  Rocket,
  ArrowDownCircle,
  CalendarDays,
  Megaphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { storage, delay } from '@/lib/storage';
import { ANNOUNCEMENTS_KEY, type IAnnouncement } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';
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
import {
  Switch,
} from '@/components/ui/switch';

const TYPE_MAP: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  system: { label: '系统公告', icon: Info, color: 'text-blue-700', bg: 'bg-blue-100' },
  activity: { label: '活动公告', icon: Megaphone, color: 'text-amber-700', bg: 'bg-amber-100' },
  update: { label: '更新公告', icon: Rocket, color: 'text-violet-700', bg: 'bg-violet-100' },
};

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  draft: { label: '草稿', variant: 'bg-slate-100 text-slate-600 border-slate-200' },
  published: { label: '已发布', variant: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  offline: { label: '已下线', variant: 'bg-rose-100 text-rose-700 border-rose-200' },
};

export default function AdminAnnouncementsPage() {
  const [items, setItems] = useState<IAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<IAnnouncement | null>(null);
  const [form, setForm] = useState({
    title: '',
    type: 'system' as 'system' | 'activity' | 'update',
    content: '',
    status: 'draft' as 'draft' | 'published' | 'offline',
    immediate: true,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    setItems(storage.get<IAnnouncement[]>(ANNOUNCEMENTS_KEY, []));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = [...items];
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (i) => i.title.toLowerCase().includes(kw) || i.content.toLowerCase().includes(kw),
      );
    }
    if (typeFilter !== 'all') {
      result = result.filter((i) => i.type === typeFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((i) => i.status === statusFilter);
    }
    return result;
  }, [items, keyword, typeFilter, statusFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openCreate() {
    setEditing(null);
    setForm({
      title: '',
      type: 'system',
      content: '',
      status: 'draft',
      immediate: true,
    });
    setEditOpen(true);
  }

  function openEdit(item: IAnnouncement) {
    setEditing(item);
    setForm({
      title: item.title,
      type: item.type,
      content: item.content,
      status: item.status,
      immediate: true,
    });
    setEditOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.content.trim()) {
      toast.warning('请填写标题和内容');
      return;
    }
    setSubmitting(true);
    await delay(300);
    const all = storage.get<IAnnouncement[]>(ANNOUNCEMENTS_KEY, []);

    if (editing) {
      const idx = all.findIndex((i) => i.id === editing.id);
      if (idx !== -1) {
        all[idx] = {
          ...all[idx],
          title: form.title,
          type: form.type,
          content: form.content,
          status: form.status,
        };
      }
      toast.success('公告已更新');
    } else {
      const newItem: IAnnouncement = {
        id: `ann_${Date.now()}`,
        title: form.title,
        type: form.type,
        content: form.content,
        status: form.status,
        publishedAt: form.status === 'published' ? new Date().toISOString() : undefined,
        createdAt: new Date().toISOString(),
      };
      all.unshift(newItem);
      toast.success('公告已创建');
    }
    storage.set(ANNOUNCEMENTS_KEY, all);
    setItems(all);
    setSubmitting(false);
    setEditOpen(false);
  }

  function togglePublish(item: IAnnouncement) {
    const all = storage.get<IAnnouncement[]>(ANNOUNCEMENTS_KEY, []);
    const idx = all.findIndex((i) => i.id === item.id);
    if (idx !== -1) {
      if (all[idx].status === 'published') {
        all[idx].status = 'offline';
        toast.success('已下线');
      } else {
        all[idx].status = 'published';
        all[idx].publishedAt = new Date().toISOString();
        toast.success('已发布');
      }
      storage.set(ANNOUNCEMENTS_KEY, all);
      setItems(all);
    }
  }

  function handleDelete(item: IAnnouncement) {
    if (!confirm(`确认删除公告「${item.title}」？`)) return;
    const all = storage.get<IAnnouncement[]>(ANNOUNCEMENTS_KEY, []).filter((i) => i.id !== item.id);
    storage.set(ANNOUNCEMENTS_KEY, all);
    setItems(all);
    toast.success('已删除');
  }

  const columns = [
    {
      key: 'title',
      title: '标题',
      width: '280px',
      render: (row: IAnnouncement) => {
        const t = TYPE_MAP[row.type];
        const Icon = t.icon;
        return (
          <div className="flex items-start gap-2 min-w-0">
            <div className={`size-7 rounded-md ${t.bg} flex items-center justify-center shrink-0 mt-0.5`}>
              <Icon className={`size-3.5 ${t.color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm truncate">{row.title}</div>
              <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {row.content.substring(0, 60)}...
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'type',
      title: '类型',
      width: '100px',
      align: 'center' as const,
      render: (row: IAnnouncement) => {
        const t = TYPE_MAP[row.type];
        return <Badge variant="outline" className={`${t.bg} ${t.color} border-transparent`}>{t.label}</Badge>;
      },
    },
    {
      key: 'status',
      title: '状态',
      width: '90px',
      align: 'center' as const,
      render: (row: IAnnouncement) => {
        const s = STATUS_MAP[row.status];
        return <Badge variant="outline" className={s.variant}>{s.label}</Badge>;
      },
    },
    {
      key: 'time',
      title: '发布时间',
      width: '150px',
      render: (row: IAnnouncement) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {row.publishedAt
            ? format(new Date(row.publishedAt), 'yyyy-MM-dd HH:mm')
            : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: '200px',
      render: (row: IAnnouncement) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openEdit(row)}>
            <Edit className="size-3.5 mr-1" />
            编辑
          </Button>
          {row.status !== 'published' ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50"
              onClick={() => togglePublish(row)}
            >
              <Send className="size-3.5 mr-1" />
              发布
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-amber-600 hover:bg-amber-50"
              onClick={() => togglePublish(row)}
            >
              <ArrowDownCircle className="size-3.5 mr-1" />
              下线
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-rose-500 hover:bg-rose-50"
            onClick={() => handleDelete(row)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">系统公告</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理前台展示的公告通知</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4 mr-1.5" />
          新增公告
        </Button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Object.entries(STATUS_MAP).map(([key, val]) => (
          <Card key={key} className="border border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`size-10 rounded-lg ${val.variant.replace('border-', '').split(' ')[0]} flex items-center justify-center`}>
                {key === 'published' && <Send className="size-5" />}
                {key === 'draft' && <Edit className="size-5" />}
                {key === 'offline' && <ArrowDownCircle className="size-5" />}
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">
                  {items.filter((i) => i.status === key).length}
                </div>
                <div className="text-xs text-muted-foreground">{val.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
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
          placeholder: '搜索公告标题或内容...',
        }}
        toolbar={
          <div className="flex gap-2">
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-28 h-9 text-sm">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="system">系统公告</SelectItem>
                <SelectItem value="activity">活动公告</SelectItem>
                <SelectItem value="update">更新公告</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-28 h-9 text-sm">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
                <SelectItem value="offline">已下线</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑公告' : '新增公告'}</DialogTitle>
            <DialogDescription>编辑公告内容和发布状态</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>公告标题 *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="请输入公告标题"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>公告类型</Label>
                <Select value={form.type} onValueChange={(v: any) => setForm({ ...form, type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">系统公告</SelectItem>
                    <SelectItem value="activity">活动公告</SelectItem>
                    <SelectItem value="update">更新公告</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>发布状态</Label>
                <Select value={form.status} onValueChange={(v: any) => setForm({ ...form, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿</SelectItem>
                    <SelectItem value="published">已发布</SelectItem>
                    <SelectItem value="offline">已下线</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>公告内容 *</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="请输入公告内容，支持多行文本..."
                rows={8}
              />
              <p className="text-xs text-muted-foreground">
                当前字数：{form.content.length} 字
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-border/40">
              <Switch
                checked={form.immediate}
                onCheckedChange={(c) => setForm({ ...form, immediate: c })}
                id="publish-now"
              />
              <div>
                <Label htmlFor="publish-now" className="cursor-pointer">立即生效</Label>
                <p className="text-xs text-muted-foreground">
                  关闭后可设置定时发布（需后端任务支持）
                </p>
              </div>
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
    </div>
  );
}
