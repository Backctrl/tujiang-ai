import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Wallet,
  Coins,
  ArrowUpRight,
  ArrowDownLeft,
  History,
  Sparkles,
  Gift,
  CreditCard,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { walletService } from '@/services/walletService';
import { useAuth } from '@/context/AuthContext';
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
import { Image } from '@/components/ui/image';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const RECHARGE_PACKAGES = [
  { id: 'p1', price: 49, credits: 3300, bonus: 0, label: '入门套餐', popular: false },
  { id: 'p2', price: 99, credits: 8300, bonus: 300, label: '热销套餐', popular: true },
  { id: 'p3', price: 199, credits: 20000, bonus: 1000, label: '专业套餐', popular: false },
  { id: 'p4', price: 499, credits: 68000, bonus: 5000, label: '企业套餐', popular: false },
];

const TYPE_LABELS: Record<string, { label: string; icon: typeof Coins; color: string }> = {
  recharge: { label: '充值', icon: CreditCard, color: 'text-success' },
  consume: { label: '消耗', icon: Sparkles, color: 'text-destructive' },
  gift: { label: '赠送', icon: Gift, color: 'text-amber-500' },
  refund: { label: '退款', icon: RefreshCw, color: 'text-info' },
};

const PAGE_SIZE = 10;

export default function WalletPage() {
  const { user, updateUser, isLoggedIn } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const [loading, setLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState<(typeof RECHARGE_PACKAGES)[0] | null>(null);
  const [showPayDialog, setShowPayDialog] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
    setLoading(true);
    walletService
      .getTransactions({
        page,
        pageSize: PAGE_SIZE,
        type: type === 'all' ? 'all' : (type as any),
      })
      .then((res) => {
        if (res.code === 0 && res.data) {
          setTransactions(res.data.list);
          setTotal(res.data.total);
        }
      })
      .finally(() => setLoading(false));
  }, [page, type, isLoggedIn]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleRecharge = (pkg: typeof RECHARGE_PACKAGES[0]) => {
    setSelectedPkg(pkg);
    setShowPayDialog(true);
  };

  const handlePay = async () => {
    if (!selectedPkg) return;
    setPaying(true);
    try {
      const res = await walletService.recharge({
        packageId: selectedPkg.id,
        amount: selectedPkg.price,
        credits: selectedPkg.credits + selectedPkg.bonus,
        paymentMethod: 'wechat',
      });
      if (res.code === 0 && res.data) {
        updateUser({ credits: res.data.balance });
        toast.success(`充值成功！${selectedPkg.credits + selectedPkg.bonus} 积分已到账`);
        setShowPayDialog(false);
        setPaying(false);
        // 刷新流水
        setLoading(true);
        walletService
          .getTransactions({ page: 1, pageSize: PAGE_SIZE, type: 'all' })
          .then((res) => {
            if (res.code === 0 && res.data) {
              setTransactions(res.data.list);
              setTotal(res.data.total);
              setPage(1);
              setType('all');
            }
          })
          .finally(() => setLoading(false));
      } else {
        toast.error(res.message || '支付失败');
      }
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="size-6 text-primary" />
          我的钱包
        </h1>
        <p className="text-muted-foreground mt-1">管理你的积分余额和充值套餐</p>
      </div>

      <div className="space-y-6">
        {/* 余额卡片 */}
        <Card className="border-0 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/3" />
          <CardContent className="pt-8 pb-8 relative">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white/70 text-sm mb-1 flex items-center gap-1.5">
                  <Coins className="size-4" />
                  当前积分余额
                </div>
                <div className="text-5xl font-black tracking-tight tabular-nums">
                  {user?.credits.toLocaleString() || '0'}
                </div>
                <div className="text-white/60 text-xs mt-2">
                  约可生成 {Math.floor((user?.credits || 0) / 10)} 张 AI 图片
                </div>
              </div>
              <div className="text-right">
                <Badge className="bg-white/20 hover:bg-white/30 text-white border-0 mb-2">
                  {user?.nickname || '用户'}
                </Badge>
                <div className="text-white/60 text-xs">
                  注册赠送 500 积分已领
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 充值套餐 */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-lg">充值套餐</CardTitle>
            <CardDescription>选择适合你的积分套餐，多充多送</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {RECHARGE_PACKAGES.map((pkg) => (
                <div
                  key={pkg.id}
                  className="relative group rounded-xl border-2 border-border/60 p-5 hover:border-primary/50 hover:shadow-lg transition-all cursor-pointer bg-card"
                  onClick={() => handleRecharge(pkg)}
                >
                  {pkg.popular && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white text-[10px] font-bold">
                      🔥 最受欢迎
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mb-1">{pkg.label}</div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-3xl font-black text-foreground">
                      {pkg.credits.toLocaleString()}
                    </span>
                    <span className="text-xs text-muted-foreground">积分</span>
                  </div>
                  {pkg.bonus > 0 && (
                    <div className="text-xs text-amber-600 font-medium mb-3">
                      + 赠送 {pkg.bonus.toLocaleString()} 积分
                    </div>
                  )}
                  <div className="text-lg font-bold text-primary mb-3">
                    ¥{pkg.price}
                    <span className="text-xs text-muted-foreground font-normal ml-1">
                      约 {Math.round((pkg.price / (pkg.credits + pkg.bonus)) * 1000)} 元/千分
                    </span>
                  </div>
                  <Button
                    className="w-full h-9 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRecharge(pkg);
                    }}
                  >
                    立即充值
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 积分明细 */}
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <History className="size-5 text-primary" />
                  积分明细
                </CardTitle>
                <CardDescription>查看你的积分变动记录，共 {total} 条</CardDescription>
              </div>
              <div className="w-32">
                <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="全部类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部类型</SelectItem>
                    <SelectItem value="recharge">充值</SelectItem>
                    <SelectItem value="consume">消耗</SelectItem>
                    <SelectItem value="gift">赠送</SelectItem>
                    <SelectItem value="refund">退款</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading && transactions.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                暂无积分流水记录
              </div>
            ) : (
              <>
                <div className="divide-y divide-border/40">
                  {transactions.map((tx) => {
                    const info = TYPE_LABELS[tx.type] || TYPE_LABELS.consume;
                    const Icon = info.icon;
                    const isPositive = tx.type === 'recharge' || tx.type === 'gift' || tx.type === 'refund';
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div
                          className={`size-9 rounded-lg bg-muted flex items-center justify-center shrink-0 ${info.color}`}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{tx.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(tx.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`text-sm font-semibold tabular-nums ${
                              isPositive ? 'text-success' : 'text-destructive'
                            }`}
                          >
                            {isPositive ? '+' : '-'}
                            {Math.abs(tx.amount).toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            余额 {tx.balanceAfter.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-4 mt-4 border-t border-border/40">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                    <div className="text-sm text-muted-foreground px-2">
                      第 {page} / {totalPages} 页
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 支付弹窗 */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>充值确认</DialogTitle>
            <DialogDescription>
              {selectedPkg && (
                <>
                  购买 <span className="font-semibold text-foreground">{selectedPkg.label}</span>
                  ，共 <span className="font-semibold text-primary">{selectedPkg.credits + selectedPkg.bonus}</span> 积分
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="text-center space-y-4">
              <div className="text-4xl font-black bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">
                ¥{selectedPkg?.price}
              </div>
              <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CreditCard className="size-4" />
                  微信支付
                </span>
                <span className="flex items-center gap-1">
                  <CreditCard className="size-4" />
                  支付宝
                </span>
              </div>
              <div className="bg-muted/50 rounded-xl p-6 mx-auto w-48 h-48 flex items-center justify-center">
                {/* 模拟二维码 */}
                <div className="grid grid-cols-10 gap-0.5 w-32 h-32">
                  {Array.from({ length: 100 }).map((_, i) => (
                    <div
                      key={i}
                      className={`${Math.random() > 0.5 ? 'bg-foreground' : 'bg-background'} rounded-sm`}
                    />
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                请使用微信或支付宝扫码支付（演示环境，点击下方按钮模拟支付成功）
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)}>
              取消
            </Button>
            <Button
              onClick={handlePay}
              disabled={paying}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
            >
              {paying && <Loader2 className="size-4 mr-2 animate-spin" />}
              {paying ? '支付中...' : '模拟支付成功'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
