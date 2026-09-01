import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Search,
  Download,
  Eye,
  Undo2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Image as UIImage } from '@/components/ui/image';
import AdminDataTable from '@/components/admin/AdminDataTable';
import { storage, delay } from '@/lib/storage';
import { ORDERS_KEY, REFUNDS_KEY, type IOrder } from '@/data/admin-models';
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
  pending: { label: '待支付', variant: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock },
  paid: { label: '已支付', variant: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  refunded: { label: '已退款', variant: 'bg-slate-100 text-slate-600 border-slate-200', icon: Undo2 },
  cancelled: { label: '已取消', variant: 'bg-rose-100 text-rose-700 border-rose-200', icon: XCircle },
};

const PAY_METHOD_MAP: Record<string, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
  other: '其他',
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<IOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [payFilter, setPayFilter] = useState('all');

  const [detailOpen, setDetailOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [selected, setSelected] = useState<IOrder | null>(null);
  const [refundReason, setRefundReason] = useState('user');
  const [refundRemark, setRefundRemark] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mockDataService.initMockData();
    loadOrders();
  }, []);

  async function loadOrders() {
    setLoading(true);
    await delay(200);
    setOrders(storage.get<IOrder[]>(ORDERS_KEY, []));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = [...orders];
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (o) =>
          o.orderNo.toLowerCase().includes(kw) ||
          o.userName.toLowerCase().includes(kw),
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }
    if (payFilter !== 'all') {
      result = result.filter((o) => o.payMethod === payFilter);
    }
    return result;
  }, [orders, keyword, statusFilter, payFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openDetail(order: IOrder) {
    setSelected(order);
    setDetailOpen(true);
  }

  function openRefund(order: IOrder) {
    setSelected(order);
    setRefundAmount(String(order.amount));
    setRefundReason('user');
    setRefundRemark('');
    setRefundOpen(true);
  }

  async function handleRefund() {
    if (!selected) return;
    const amount = parseFloat(refundAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.warning('请输入正确的退款金额');
      return;
    }
    if (amount > selected.amount) {
      toast.warning('退款金额不能大于订单金额');
      return;
    }

    setSubmitting(true);
    await delay(500);

    // 更新订单状态
    const all = storage.get<IOrder[]>(ORDERS_KEY, []);
    const idx = all.findIndex((o) => o.id === selected.id);
    if (idx !== -1) {
      all[idx].status = 'refunded';
      storage.set(ORDERS_KEY, all);
      setOrders(all);
    }

    // 添加退款记录
    const refunds = storage.get<any[]>(REFUNDS_KEY, []);
    refunds.unshift({
      id: `refund_${Date.now()}`,
      orderId: selected.id,
      orderNo: selected.orderNo,
      userId: selected.userId,
      userName: selected.userName,
      userAvatar: selected.userAvatar,
      amount,
      reason: refundReason,
      remark: refundRemark,
      status: 'approved',
      createdAt: new Date().toISOString(),
      processedAt: new Date().toISOString(),
    });
    storage.set(REFUNDS_KEY, refunds);

    setSubmitting(false);
    setRefundOpen(false);
    setDetailOpen(false);
    toast.success('退款处理成功，已扣减对应积分');
  }

  const columns = [
    {
      key: 'orderNo',
      title: '订单号',
      width: '180px',
      render: (row: IOrder) => (
        <span className="font-mono text-xs text-foreground/80">{row.orderNo}</span>
      ),
    },
    {
      key: 'user',
      title: '用户',
      width: '160px',
      render: (row: IOrder) => (
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
      key: 'package',
      title: '充值套餐',
      render: (row: IOrder) => (
        <div className="text-sm">
          <div className="font-medium">{row.packageName}</div>
          <div className="text-xs text-muted-foreground">{row.credits.toLocaleString()} 积分</div>
        </div>
      ),
    },
    {
      key: 'amount',
      title: '金额',
      align: 'right' as const,
      render: (row: IOrder) => (
        <span className="font-semibold text-foreground tabular-nums">¥{row.amount}</span>
      ),
    },
    {
      key: 'payMethod',
      title: '支付方式',
      width: '100px',
      render: (row: IOrder) => (
        <span className="text-sm text-muted-foreground">{PAY_METHOD_MAP[row.payMethod] || row.payMethod}</span>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: '100px',
      align: 'center' as const,
      render: (row: IOrder) => {
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
      title: '创建时间',
      width: '150px',
      render: (row: IOrder) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(row.createdAt), 'yyyy-MM-dd HH:mm')}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: '160px',
      render: (row: IOrder) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openDetail(row)}>
            <Eye className="size-3.5 mr-1" />
            详情
          </Button>
          {row.status === 'paid' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50"
              onClick={() => openRefund(row)}
            >
              <Undo2 className="size-3.5 mr-1" />
              退款
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">订单管理</h1>
        <p className="text-sm text-muted-foreground mt-0.5">查看和管理所有充值订单</p>
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
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32 h-9 text-sm">
                <SelectValue placeholder="订单状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="pending">待支付</SelectItem>
                <SelectItem value="paid">已支付</SelectItem>
                <SelectItem value="refunded">已退款</SelectItem>
                <SelectItem value="cancelled">已取消</SelectItem>
              </SelectContent>
            </Select>
            <Select value={payFilter} onValueChange={(v) => { setPayFilter(v); setPage(1); }}>
              <SelectTrigger className="w-32 h-9 text-sm">
                <SelectValue placeholder="支付方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部方式</SelectItem>
                <SelectItem value="wechat">微信支付</SelectItem>
                <SelectItem value="alipay">支付宝</SelectItem>
                <SelectItem value="other">其他</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        actions={[
          {
            label: '导出',
            icon: <Download />,
            variant: 'outline' as const,
            onClick: () => toast.success('已导出订单列表（模拟）'),
          },
        ]}
      />

      {/* 订单详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>订单详情</DialogTitle>
            <DialogDescription>
              {selected && (
                <span className="font-mono text-xs">{selected.orderNo}</span>
              )}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              {/* 状态头部 */}
              <div className="text-center p-4 bg-muted/30 rounded-lg">
                {(() => {
                  const s = STATUS_MAP[selected.status];
                  const Icon = s.icon;
                  return (
                    <>
                      <div className={`size-12 mx-auto rounded-full flex items-center justify-center ${s.variant.replace('text-', 'bg-').split(' ')[0]} bg-opacity-20`}>
                        <Icon className={`size-6 ${s.variant.split(' ')[1]}`} />
                      </div>
                      <div className="font-semibold mt-2">{s.label}</div>
                    </>
                  );
                })()}
              </div>

              {/* 基本信息 */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">充值套餐</span>
                  <span className="font-medium">{selected.packageName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">订单金额</span>
                  <span className="font-semibold text-lg text-foreground">
                    ¥{selected.amount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">到账积分</span>
                  <span className="font-medium text-indigo-600">
                    {selected.credits.toLocaleString()} 积分
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">支付方式</span>
                  <span>{PAY_METHOD_MAP[selected.payMethod]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">创建时间</span>
                  <span>{format(new Date(selected.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                </div>
                {selected.paidAt && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">支付时间</span>
                    <span>{format(new Date(selected.paidAt), 'yyyy-MM-dd HH:mm')}</span>
                  </div>
                )}
                {selected.transactionId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">交易号</span>
                    <span className="font-mono text-xs">{selected.transactionId}</span>
                  </div>
                )}
              </div>

              {/* 用户信息 */}
              <div className="pt-3 border-t border-border/50">
                <div className="text-xs text-muted-foreground mb-2">用户信息</div>
                <div className="flex items-center gap-3">
                  <UIImage
                    src={selected.userAvatar}
                    alt={selected.userName}
                    className="size-10 rounded-full object-cover"
                  />
                  <div>
                    <div className="font-medium">{selected.userName}</div>
                    <div className="text-xs text-muted-foreground">用户ID: {selected.userId}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              关闭
            </Button>
            {selected?.status === 'paid' && (
              <Button variant="destructive" onClick={() => openRefund(selected)}>
                <Undo2 className="size-4 mr-1.5" />
                申请退款
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 退款弹窗 */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-rose-500" />
              确认退款
            </DialogTitle>
            <DialogDescription>
              退款后将扣减用户对应积分，此操作不可撤销
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-rose-700">订单号</span>
                  <span className="font-mono text-rose-700">{selected.orderNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-rose-700">订单金额</span>
                  <span className="font-bold text-rose-700">¥{selected.amount}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>退款原因</Label>
                <Select value={refundReason} onValueChange={setRefundReason}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">用户申请</SelectItem>
                    <SelectItem value="duplicate">重复支付</SelectItem>
                    <SelectItem value="other">其他原因</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="refund-amount">退款金额（元）</Label>
                <input
                  id="refund-amount"
                  type="number"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  最多可退款 ¥{selected.amount}，支持部分退款
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="refund-remark">备注说明</Label>
                <Textarea
                  id="refund-remark"
                  value={refundRemark}
                  onChange={(e) => setRefundRemark(e.target.value)}
                  placeholder="请输入退款备注（可选）"
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleRefund} disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 mr-2 animate-spin" />
              )}
              确认退款
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
