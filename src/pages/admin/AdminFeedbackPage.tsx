import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  MessageSquare,
  Bug,
  Lightbulb,
  MoreHorizontal,
  Send,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Image as UIImage } from '@/components/ui/image';
import AdminDataTable from '@/components/admin/AdminDataTable';
import { storage, delay } from '@/lib/storage';
import { FEEDBACK_KEY, type IFeedback } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TYPE_MAP: Record<string, { label: string; icon: any; color: string }> = {
  suggestion: { label: '功能建议', icon: Lightbulb, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  bug: { label: 'Bug报告', icon: Bug, color: 'text-rose-600 bg-rose-50 border-rose-200' },
  other: { label: '其他', icon: MessageSquare, color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '待处理', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  processing: { label: '处理中', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  resolved: { label: '已解决', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
};

export default function AdminFeedbackPage() {
  const [list, setList] = useState<IFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<IFeedback | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    setList(storage.get<IFeedback[]>(FEEDBACK_KEY, []));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = [...list];
    if (typeFilter !== 'all') {
      result = result.filter((item) => item.type === typeFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((item) => item.status === statusFilter);
    }
    return result;
  }, [list, typeFilter, statusFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openDetail(item: IFeedback) {
    setSelected(item);
    setReplyContent(item.reply || '');
    setDetailOpen(true);
  }

  function updateStatus(item: IFeedback, status: IFeedback['status']) {
    const all = storage.get<IFeedback[]>(FEEDBACK_KEY, []);
    const idx = all.findIndex((f) => f.id === item.id);
    if (idx !== -1) {
      all[idx].status = status;
      storage.set(FEEDBACK_KEY, all);
      setList(all);
      toast.success(`已标记为${STATUS_MAP[status].label}`);
    }
  }

  async function handleReply() {
    if (!selected || !replyContent.trim()) {
      toast.warning('请输入回复内容');
      return;
    }
    setReplying(true);
    await delay(300);
    const all = storage.get<IFeedback[]>(FEEDBACK_KEY, []);
    const idx = all.findIndex((f) => f.id === selected.id);
    if (idx !== -1) {
      all[idx].reply = replyContent;
      all[idx].status = 'resolved';
      all[idx].repliedAt = new Date().toISOString();
      storage.set(FEEDBACK_KEY, all);
      setList(all);
      setSelected(all[idx]);
    }
    setReplying(false);
    toast.success('回复已发送');
  }

  const columns = [
    {
      key: 'user',
      title: '用户',
      width: '160px',
      render: (row: IFeedback) => (
        <div className="flex items-center gap-2 min-w-0">
          <UIImage
            src={row.userAvatar}
            alt={row.userName}
            className="size-8 rounded-full object-cover shrink-0"
          />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{row.userName}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      title: '类型',
      width: '110px',
      render: (row: IFeedback) => {
        const t = TYPE_MAP[row.type] || TYPE_MAP.other;
        const Icon = t.icon;
        return (
          <Badge variant="outline" className={t.color}>
            <Icon className="size-3 mr-1" />
            {t.label}
          </Badge>
        );
      },
    },
    {
      key: 'content',
      title: '反馈内容',
      render: (row: IFeedback) => (
        <div className="line-clamp-2 text-sm text-foreground/80">{row.content}</div>
      ),
    },
    {
      key: 'status',
      title: '处理状态',
      width: '100px',
      align: 'center' as const,
      render: (row: IFeedback) => {
        const s = STATUS_MAP[row.status];
        return <Badge variant="outline" className={s.color}>{s.label}</Badge>;
      },
    },
    {
      key: 'createdAt',
      title: '提交时间',
      width: '160px',
      render: (row: IFeedback) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true, locale: zhCN })}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: '180px',
      render: (row: IFeedback) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openDetail(row)}>
            查看详情
          </Button>
          {row.status !== 'resolved' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50"
              onClick={() => updateStatus(row, 'resolved')}
            >
              标记已解决
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">用户反馈</h1>
        <p className="text-sm text-muted-foreground mt-0.5">处理用户提交的反馈和建议</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 border border-border/50 rounded-xl bg-card/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Clock className="size-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {list.filter((f) => f.status === 'pending').length}
              </div>
              <div className="text-xs text-muted-foreground">待处理</div>
            </div>
          </div>
        </div>
        <div className="p-4 border border-border/50 rounded-xl bg-card/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <AlertCircle className="size-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {list.filter((f) => f.status === 'processing').length}
              </div>
              <div className="text-xs text-muted-foreground">处理中</div>
            </div>
          </div>
        </div>
        <div className="p-4 border border-border/50 rounded-xl bg-card/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="size-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">
                {list.filter((f) => f.status === 'resolved').length}
              </div>
              <div className="text-xs text-muted-foreground">已解决</div>
            </div>
          </div>
        </div>
      </div>

      <AdminDataTable
        columns={columns}
        data={paginated}
        loading={loading}
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowKey={(row) => row.id}
        toolbar={
          <div className="flex items-center gap-2">
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32 h-9 text-sm">
                <SelectValue placeholder="反馈类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="suggestion">功能建议</SelectItem>
                <SelectItem value="bug">Bug报告</SelectItem>
                <SelectItem value="other">其他</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32 h-9 text-sm">
                <SelectValue placeholder="处理状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="pending">待处理</SelectItem>
                <SelectItem value="processing">处理中</SelectItem>
                <SelectItem value="resolved">已解决</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>反馈详情</DialogTitle>
            <DialogDescription>
              {selected && (
                <span className="inline-flex items-center gap-1">
                  {TYPE_MAP[selected.type]?.label} · {selected.userName}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <UIImage
                  src={selected.userAvatar}
                  alt={selected.userName}
                  className="size-10 rounded-full object-cover"
                />
                <div>
                  <div className="font-medium">{selected.userName}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(selected.createdAt), 'yyyy-MM-dd HH:mm')}
                  </div>
                </div>
                <Badge variant="outline" className={`ml-auto ${STATUS_MAP[selected.status].color}`}>
                  {STATUS_MAP[selected.status].label}
                </Badge>
              </div>

              <div className="p-4 bg-muted/30 rounded-lg">
                <p className="text-sm leading-relaxed">{selected.content}</p>
              </div>

              {selected.reply && (
                <div className="p-4 bg-indigo-50/50 border border-indigo-100 rounded-lg">
                  <div className="text-xs text-indigo-600 font-medium mb-1.5">
                    官方回复 · {selected.repliedAt && format(new Date(selected.repliedAt), 'yyyy-MM-dd HH:mm')}
                  </div>
                  <p className="text-sm leading-relaxed">{selected.reply}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>回复反馈</Label>
                <Textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  placeholder="输入回复内容..."
                  rows={4}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              关闭
            </Button>
            <Button onClick={handleReply} disabled={replying}>
              {replying && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              <Send className="size-4 mr-1.5" />
              {selected?.reply ? '更新回复' : '发送回复'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
