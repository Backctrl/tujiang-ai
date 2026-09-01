import { useEffect, useState, useMemo } from 'react';
import { Plus, Search, Download, Edit, Eye, CreditCard, Ban, Key, Trash2, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import AdminDataTable from '@/components/admin/AdminDataTable';
import { Image as UIImage } from '@/components/ui/image';
import { storage, delay } from '@/lib/storage';
import { USERS_KEY, type IUser } from '@/data/user';
import { mockDataService } from '@/services/mockDataService';
import { formatDistanceToNow, format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<IUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);

  // 积分调整弹窗
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<IUser | null>(null);
  const [creditType, setCreditType] = useState<'add' | 'deduct'>('add');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditSubmitting, setCreditSubmitting] = useState(false);

  // 详情弹窗
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailUser, setDetailUser] = useState<IUser | null>(null);

  useEffect(() => {
    mockDataService.initMockData();
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    await delay(200);
    const all = storage.get<IUser[]>(USERS_KEY, []);
    setUsers(all);
    setLoading(false);
  }

  const filteredUsers = useMemo(() => {
    let list = [...users];

    if (keyword) {
      const kw = keyword.toLowerCase();
      list = list.filter(
        (u) =>
          u.email.toLowerCase().includes(kw) ||
          u.nickname.toLowerCase().includes(kw) ||
          u.phone.includes(kw),
      );
    }

    // 状态筛选（简化：全部用户视为正常，可扩展禁用状态）
    if (statusFilter === 'disabled') {
      list = list.filter((u) => false); // 暂无禁用用户
    }

    // 排序
    if (sortField && sortOrder) {
      list.sort((a, b) => {
        let valA: any;
        let valB: any;
        switch (sortField) {
          case 'createdAt':
            valA = new Date(a.createdAt).getTime();
            valB = new Date(b.createdAt).getTime();
            break;
          case 'credits':
            valA = a.credits;
            valB = b.credits;
            break;
          default:
            valA = a.createdAt;
            valB = b.createdAt;
        }
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      });
    }

    return list;
  }, [users, keyword, statusFilter, sortField, sortOrder]);

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredUsers.slice(start, start + pageSize);
  }, [filteredUsers, page, pageSize]);

  function handleSort(field: string, order: 'asc' | 'desc' | null) {
    setSortField(order ? field : '');
    setSortOrder(order);
  }

  function openCreditDialog(user: IUser) {
    setSelectedUser(user);
    setCreditType('add');
    setCreditAmount('');
    setCreditReason('');
    setCreditDialogOpen(true);
  }

  async function handleCreditSubmit() {
    if (!selectedUser || !creditAmount || !creditReason) {
      toast.warning('请填写完整信息');
      return;
    }
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.warning('积分数量必须大于0');
      return;
    }

    setCreditSubmitting(true);
    await delay(300);

    const all = storage.get<IUser[]>(USERS_KEY, []);
    const idx = all.findIndex((u) => u.id === selectedUser.id);
    if (idx !== -1) {
      const newCredits =
        creditType === 'add' ? all[idx].credits + amount : all[idx].credits - amount;
      if (newCredits < 0) {
        toast.error('积分余额不足');
        setCreditSubmitting(false);
        return;
      }
      all[idx].credits = newCredits;
      storage.set(USERS_KEY, all);
      setUsers(all);
      setDetailUser(all[idx]);
    }

    setCreditSubmitting(false);
    setCreditDialogOpen(false);
    toast.success(
      creditType === 'add'
        ? `已成功为 ${selectedUser.nickname} 增加 ${amount} 积分`
        : `已成功从 ${selectedUser.nickname} 扣减 ${amount} 积分`,
    );
  }

  function openDetail(user: IUser) {
    setDetailUser(user);
    setDetailDialogOpen(true);
  }

  function handleDisable(user: IUser) {
    toast.info(`已禁用用户 ${user.nickname}（模拟）`);
  }

  function handleResetPassword(user: IUser) {
    toast.success(`已为 ${user.nickname} 重置密码为 123456（模拟）`);
  }

  function handleDelete(user: IUser) {
    const all = storage.get<IUser[]>(USERS_KEY, []);
    const filtered = all.filter((u) => u.id !== user.id);
    storage.set(USERS_KEY, filtered);
    setUsers(filtered);
    toast.success(`已删除用户 ${user.nickname}`);
  }

  const columns = [
    {
      key: 'user',
      title: '用户',
      render: (row: IUser) => (
        <div className="flex items-center gap-3 min-w-0">
          <UIImage
            src={row.avatar}
            alt={row.nickname}
            className="size-8 rounded-full object-cover shrink-0"
          />
          <div className="min-w-0">
            <div className="font-medium truncate">{row.nickname}</div>
            <div className="text-xs text-muted-foreground truncate">{row.email}</div>
          </div>
        </div>
      ),
      width: '200px',
    },
    {
      key: 'phone',
      title: '手机号',
      dataIndex: 'phone' as const,
    },
    {
      key: 'createdAt',
      title: '注册时间',
      sortable: true,
      render: (row: IUser) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(row.createdAt), 'yyyy-MM-dd HH:mm')}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      title: '最后登录',
      render: (row: IUser) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {row.lastLoginAt
            ? formatDistanceToNow(new Date(row.lastLoginAt), {
                addSuffix: true,
                locale: zhCN,
              })
            : '未登录'}
        </span>
      ),
    },
    {
      key: 'credits',
      title: '积分余额',
      sortable: true,
      render: (row: IUser) => (
        <span className="font-semibold text-indigo-600 tabular-nums">
          {row.credits.toLocaleString()}
        </span>
      ),
      align: 'right' as const,
    },
    {
      key: 'images',
      title: '生成图片数',
      sortable: true,
      render: () => <span className="tabular-nums">{Math.floor(Math.random() * 500)}</span>,
      align: 'right' as const,
    },
    {
      key: 'status',
      title: '状态',
      render: () => (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200">
          正常
        </Badge>
      ),
      align: 'center' as const,
    },
    {
      key: 'actions',
      title: '操作',
      width: '280px',
      render: (row: IUser) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openDetail(row)}
            className="h-7 px-2 text-xs"
          >
            <Eye className="size-3.5 mr-1" />
            详情
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openCreditDialog(row)}
            className="h-7 px-2 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
          >
            <CreditCard className="size-3.5 mr-1" />
            积分
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDisable(row)}
            className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          >
            <Ban className="size-3.5 mr-1" />
            禁用
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleResetPassword(row)}
            className="h-7 px-2 text-xs"
          >
            <Key className="size-3.5 mr-1" />
            重置
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDelete(row)}
            className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="size-3.5 mr-1" />
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">用户列表</h1>
        <p className="text-sm text-muted-foreground mt-0.5">管理平台所有注册用户</p>
      </div>

      <AdminDataTable
        columns={columns}
        data={paginatedUsers}
        loading={loading}
        total={filteredUsers.length}
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
          placeholder: '搜索邮箱、昵称、手机号...',
        }}
        toolbar={
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-32 h-9 text-sm">
              <SelectValue placeholder="状态筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="active">正常</SelectItem>
              <SelectItem value="disabled">已禁用</SelectItem>
            </SelectContent>
          </Select>
        }
        actions={[
          {
            label: '导出',
            icon: <Download />,
            variant: 'outline' as const,
            onClick: () => toast.success('已导出用户列表（模拟）'),
          },
          {
            label: '新增用户',
            icon: <Plus />,
            variant: 'default' as const,
            onClick: () => toast.info('新增用户功能开发中'),
          },
        ]}
        sortField={sortField}
        sortOrder={sortOrder}
        onSortChange={handleSort}
      />

      {/* 用户详情弹窗 */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>用户详情</DialogTitle>
            <DialogDescription>查看和管理用户的详细信息</DialogDescription>
          </DialogHeader>

          {detailUser && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 pb-4 border-b border-border/50">
                <UIImage
                  src={detailUser.avatar}
                  alt={detailUser.nickname}
                  className="size-16 rounded-full object-cover ring-4 ring-indigo-100"
                />
                <div>
                  <h3 className="text-lg font-semibold">{detailUser.nickname}</h3>
                  <p className="text-sm text-muted-foreground">{detailUser.email}</p>
                  <Badge variant="outline" className="mt-1 bg-emerald-50 text-emerald-600 border-emerald-200">
                    正常
                  </Badge>
                </div>
              </div>

              <Tabs defaultValue="basic">
                <TabsList className="w-full grid grid-cols-3">
                  <TabsTrigger value="basic">基本信息</TabsTrigger>
                  <TabsTrigger value="account">账户信息</TabsTrigger>
                  <TabsTrigger value="records">操作记录</TabsTrigger>
                </TabsList>
                <TabsContent value="basic" className="space-y-3 pt-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">昵称：</span>
                      <span>{detailUser.nickname}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">邮箱：</span>
                      <span>{detailUser.email}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">手机号：</span>
                      <span>{detailUser.phone || '未绑定'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">注册时间：</span>
                      <span>{format(new Date(detailUser.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">最后登录：</span>
                      <span>
                        {detailUser.lastLoginAt
                          ? format(new Date(detailUser.lastLoginAt), 'yyyy-MM-dd HH:mm')
                          : '未登录'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">注册IP：</span>
                      <span>127.0.0.1</span>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="account" className="space-y-3 pt-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">积分余额：</span>
                      <span className="font-semibold text-indigo-600">
                        {detailUser.credits.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">累计消耗：</span>
                      <span>1,250</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">生成图片总数：</span>
                      <span>328</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">充值次数：</span>
                      <span>3</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">总充值金额：</span>
                      <span>¥198</span>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="records" className="pt-4">
                  <div className="text-sm text-muted-foreground text-center py-8">
                    操作记录列表（模拟数据）
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
              关闭
            </Button>
            <Button variant="outline" onClick={() => detailUser && openCreditDialog(detailUser)}>
              <CreditCard className="size-4 mr-1.5" />
              调整积分
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                detailUser && handleDisable(detailUser);
                setDetailDialogOpen(false);
              }}
            >
              <Ban className="size-4 mr-1.5" />
              禁用账号
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 调整积分弹窗 */}
      <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>调整积分</DialogTitle>
            <DialogDescription>
              为 <span className="font-medium text-foreground">{selectedUser?.nickname}</span>{' '}
              调整积分余额
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <span className="text-sm text-muted-foreground">当前积分余额</span>
              <span className="font-bold text-indigo-600 text-lg">
                {selectedUser?.credits.toLocaleString()}
              </span>
            </div>

            <div className="space-y-2">
              <Label>调整类型</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={creditType === 'add' ? 'default' : 'outline'}
                  className="flex-1"
                  onClick={() => setCreditType('add')}
                >
                  增加积分
                </Button>
                <Button
                  type="button"
                  variant={creditType === 'deduct' ? 'destructive' : 'outline'}
                  className="flex-1"
                  onClick={() => setCreditType('deduct')}
                >
                  扣减积分
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="credit-amount">积分数量 *</Label>
              <Input
                id="credit-amount"
                type="number"
                min="1"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="请输入积分数量"
              />
              {creditAmount && selectedUser && creditType === 'deduct' && (
                <p className="text-xs text-amber-600">
                  调整后余额：{Math.max(0, selectedUser.credits - parseInt(creditAmount) || 0)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="credit-reason">调整原因 *</Label>
              <Textarea
                id="credit-reason"
                value={creditReason}
                onChange={(e) => setCreditReason(e.target.value)}
                placeholder="请输入调整原因，将记录到积分流水"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreditSubmit} disabled={creditSubmitting}>
              {creditSubmitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              确认{creditType === 'add' ? '增加' : '扣减'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
