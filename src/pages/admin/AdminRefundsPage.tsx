import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  Check,
  X,
  AlertCircle,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Image as UIImage } from '@/components/ui/image';
import AdminDataTable from '@/components/admin/AdminDataTable';
import { storage, delay } from '@/lib/storage';
import { REFUNDS_KEY, ORDERS_KEY, type IOrder } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const STATUS_MAP: Record<string, { label: string; variant: string; icon: any }> = {
  pending: { label: '待审核', variant: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock },
  approved: { label: '已通过', variant: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  rejected: { label: '已拒绝', variant: 'bg-rose-100 text-rose-700 border-rose-200', icon: XCircle },
};

const REASON_MAP: Record<string, string> = {
  user: '用户申请',
  duplicate: '重复支付',
  other: '其他原因',
};

interface IRefund {
  id: string;
  orderId: string;
  orderNo: string;
  userId: string;
  userName: string;
  userAvatar: string;
  amount: number;
  reason: string;
  remark: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  processedAt?: string;
}

export default function AdminRefundsPage() {
  const [refunds, setRefunds] = useState<IRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<IRefund | null>(null);
  const [rejectRemark, setRejectRemark] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    setRefunds(storage.get<IRefund[]>(REFUNDS_KEY, []));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = [...refunds];
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (r) => r.orderNo.toLowerCase().includes(kw) || r.userName.toLowerCase().includes(kw),
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }
    return result;
  }, [refunds, keyword, statusFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openDetail(item: IRefund) {
    setSelected(item);
    setDetailOpen(true);
  }

  async function handleApprove(item: IRefund) {
    setSubmitting(true);
    await delay(500);
    const all = storage.get<IRefund[]>(REFUNDS_KEY, []);
    const idx = all.findIndex((r) => r.id === item.id);
    if (idx !== -1) {
      all[idx].status = 'approved';
      all[idx].processedAt = new Date().toISOString();
      storage.set(REFUNDS_KEY, all);

      // 更新订单状态
      const orders = storage.get<IOrder[]>(ORDERS_KEY, []);
      const oidx = orders.findIndex((o) => o.id === item.orderId);
      if (oidx !== -1) {
        orders[oidx].status = 'refunded';
        storage.set(ORDERS_KEY, orders);
      }

      setRefunds(all);
    }
    setSubmitting(false);
    setDetailOpen(false);
    toast.success('退款已通过');
  }

  function openReject(item: IRefund) {
    setSelected(item);
    setRejectRemark('');
    setRejectOpen(true);
  }

  async function handleReject() {
    if (!selected || !rejectRemark.trim()) {
      toast.warning('请填写拒绝原因');
      return;
    }
    setSubmitting(true);
    await delay(300);
    const all = storage.get<IRefund[]>(REFUNDS_KEY, []);
    const idx = all.findIndex((r) => r.id === selected.id);
    if (idx !== -1) {
      all[idx].status = 'rejected';
      all[idx].processedAt = new Date().toISOString();
      all[idx].remark = rejectRemark;
      storage.set(REFUNDS_KEY, all);
      setRefunds(all);
    }
    setSubmitting(false);
    setRejectOpen(false);
    setDetailOpen(false);
    toast.success('已拒绝退款申请');
  }

  const pendingCount = refunds.filter((r) => r.status === 'pending').length;

  const columns = [
    {
      key: 'orderNo',
      title: '订单号',
      width: '160px',
      render: (row: IRefund) => (
        <span className="font-mono text-xs text-foreground/80">{row.orderNo}</span>
      ),
    },
    {
      key: 'user',
      title: '用户',
      width: '140px',
      render: (row: IRefund) => (
        <div className="flex items-center gap-2 min-w-0">
          <UIImage
            src={row.userAvatar}
            alt={row.userName}
            className="size-7 rounded-full object-cover shrink-0"
          />
          <span className="text-sm truncate">{row.userName}</span>
        </div>
      ),
    },
    {
      key: 'amount',
      title: '退款金额',
      width: '110px',
      align: 'right' as const,
      render: (row: IRefund) => (
        <span className="font-semibold text-rose-600 tabular-nums">¥{row.amount}</span>
      ),
    },
    {
      key: 'reason',
      title: '退款原因',
      width: '100px',
      render: (row: IRefund) => REASON_MAP[row.reason] || row.reason,
    },
    {
      key: 'status',
      title: '状态',
      width: '100px',
      align: 'center' as const,
      render: (row: IRefund) => {
        const s = STATUS_MAP[row.status];
        const Icon = s.icon;
        return (
          <Badge variant="outline" className={s.variant}>
            <Icon className="size-3 mr-1" />
            {s.label}
          </Badge>
        );
      },
    },
    {
      key: 'createdAt',
      title: '申请时间',
      width: '150px',
      render: (row: IRefund) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(row.createdAt), 'yyyy-MM-dd HH:mm')}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: '140px',
      render: (row: IRefund) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openDetail(row)}>
            <Eye className="size-3.5 mr-1" />
            详情
          </Button>
          {row.status === 'pending' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-emerald-600 hover:bg-emerald-50"
                onClick={() => handleApprove(row)}
              >
                <Check className="size-3.5 mr-1" />
                通过
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50"
                onClick={() => openReject(row)}
              >
                <X className="size-3.5 mr-1" />
                拒绝
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">退款管理</h1>
        <p className="text-sm text-muted-foreground mt-0.5">审核和处理用户退款申请</p>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 border border-amber-200/50 rounded-xl bg-amber-50/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Clock className="size-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700">{pendingCount}</div>
              <div className="text-xs text-amber-600">待审核</div>
            </div>
          </div>
        </div>
        <div className="p-4 border border-emerald-200/50 rounded-xl bg-emerald-50/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="size-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700">
                {refunds.filter((r) => r.status === 'approved').length}
              </div>
              <div className="text-xs text-emerald-600">已通过</div>
            </div>
          </div>
        </div>
        <div className="p-4 border border-rose-200/50 rounded-xl bg-rose-50/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-rose-100 flex items-center justify-center">
              <XCircle className="size-5 text-rose-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-rose-700">
                {refunds.filter((r) => r.status === 'rejected').length}
              </div>
              <div className="text-xs text-rose-600">已拒绝</div>
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
        search={{
          value: keyword,
          onChange: (v) => {
            setKeyword(v);
            setPage(1);
          },
          placeholder: '搜索订单号、用户昵称...',
        }}
        toolbar={
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-32 h-9 text-sm">
              <SelectValue placeholder="审核状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">待审核</SelectItem>
              <SelectItem value="approved">已通过</SelectItem>
              <SelectItem value="rejected">已拒绝</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>退款详情</DialogTitle>
            <DialogDescription>
              {selected && STATUS_MAP[selected.status].label}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              {/* 用户信息 */}
              <div className="flex items-center gap-3 pb-3 border-b border-border/50">
                <UIImage
                  src={selected.userAvatar}
                  alt={selected.userName}
                  className="size-10 rounded-full object-cover"
                />
                <div className="flex-1">
                  <div className="font-medium">{selected.userName}</div>
                  <div className="text-xs text-muted-foreground">用户ID: {selected.userId}</div>
                </div>
                <Badge variant="outline" className={STATUS_MAP[selected.status].variant}>
                  {STATUS_MAP[selected.status].label}
                </Badge>
              </div>

              {/* 退款信息 */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">订单号</span>
                  <span className="font-mono">{selected.orderNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">退款金额</span>
                  <span className="font-bold text-rose-600 text-lg">¥{selected.amount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">退款原因</span>
                  <span>{REASON_MAP[selected.reason] || selected.reason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">申请时间</span>
                  <span>{format(new Date(selected.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                </div>
                {selected.processedAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">处理时间</span>
                    <span>{format(new Date(selected.processedAt), 'yyyy-MM-dd HH:mm')}</span>
                  </div>
                )}
              </div>

              {selected.remark && (
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">备注说明</div>
                  <p className="text-sm">{selected.remark}</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              关闭
            </Button>
            {selected?.status === 'pending' && (
              <>
                <Button variant="destructive" onClick={() => openReject(selected)}>
                  <X className="size-4 mr-1.5" />
                  拒绝
                </Button>
                <Button onClick={() => handleApprove(selected)} disabled={submitting}>
                  {submitting && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  )}
                  <Check className="size-4 mr-1.5" />
                  通过
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝弹窗 */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-5 text-rose-500" />
              拒绝退款
            </DialogTitle>
            <DialogDescription>请填写拒绝原因，将通知用户</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="p-3 bg-muted/30 rounded-lg text-sm">
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">退款金额</span>
                <span className="font-bold text-rose-600">¥{selected?.amount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">订单号</span>
                <span className="font-mono text-xs">{selected?.orderNo}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>拒绝原因 *</Label>
              <Textarea
                value={rejectRemark}
                onChange={(e) => setRejectRemark(e.target.value)}
                placeholder="请输入拒绝原因"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={submitting}>
              {submitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
