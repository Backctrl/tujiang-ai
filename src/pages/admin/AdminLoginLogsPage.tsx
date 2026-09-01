import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  User,
  Shield,
  LogIn,
  LogOut,
  Search,
  MapPin,
  Monitor,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Eye,
  Filter,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { storage, delay } from '@/lib/storage';
import { LOGIN_LOGS_KEY, type ILoginLog } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';
import { avatarImages } from '@lark-apaas/client-toolkit-lite';

const PAGE_SIZE = 20;

export default function AdminLoginLogsPage() {
  const [logs, setLogs] = useState<ILoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [userType, setUserType] = useState('all');
  const [status, setStatus] = useState('all');

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ILoginLog | null>(null);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(300);
    const list = storage.get<ILoginLog[]>(LOGIN_LOGS_KEY, []);
    setLogs(list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (userType !== 'all' && log.userType !== userType) return false;
      if (status !== 'all' && log.status !== status) return false;
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        if (
          !log.username?.toLowerCase().includes(kw) &&
          !log.email?.toLowerCase().includes(kw) &&
          !log.ip?.includes(kw)
        )
          return false;
      }
      return true;
    });
  }, [logs, userType, status, keyword]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [keyword, userType, status]);

  const total = logs.length;
  const successCount = logs.filter((l) => l.status === 'success').length;
  const failCount = logs.filter((l) => l.status === 'failed').length;
  const adminCount = logs.filter((l) => l.userType === 'admin').length;

  function openDetail(log: ILoginLog) {
    setDetail(log);
    setDetailOpen(true);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">登录日志</h1>
          <p className="text-sm text-muted-foreground mt-0.5">记录所有用户和管理员的登录行为</p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="size-4 mr-1.5" />
          导出
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <LogIn className="size-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{total.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">总登录次数</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-emerald-200/60 bg-emerald-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700 tabular-nums">{successCount.toLocaleString()}</div>
              <div className="text-xs text-emerald-600">成功</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-rose-200/60 bg-rose-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-rose-500 flex items-center justify-center">
              <XCircle className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-rose-700 tabular-nums">{failCount.toLocaleString()}</div>
              <div className="text-xs text-rose-600">失败</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-amber-200/60 bg-amber-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-amber-500 flex items-center justify-center">
              <Shield className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700 tabular-nums">{adminCount.toLocaleString()}</div>
              <div className="text-xs text-amber-600">管理员登录</div>
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
              placeholder="搜索用户名、邮箱、IP..."
              className="bg-background pl-9 h-9"
            />
          </div>
          <div className="w-40">
            <Select value={userType} onValueChange={setUserType}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="用户类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部用户</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
                <SelectItem value="user">普通用户</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="登录状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
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
                  <TableHead className="whitespace-nowrap">登录时间</TableHead>
                  <TableHead className="whitespace-nowrap">类型</TableHead>
                  <TableHead className="whitespace-nowrap">用户</TableHead>
                  <TableHead className="whitespace-nowrap">邮箱</TableHead>
                  <TableHead className="whitespace-nowrap">登录IP</TableHead>
                  <TableHead className="whitespace-nowrap">登录地点</TableHead>
                  <TableHead className="whitespace-nowrap">设备</TableHead>
                  <TableHead className="whitespace-nowrap">状态</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 9 }).map((__, j) => (
                          <TableCell key={j}>
                            <div className="h-4 bg-muted/40 rounded animate-pulse" style={{ width: `${60 + Math.random() * 60}px` }} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : paged.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-32 text-center text-muted-foreground">
                          暂无登录日志
                        </TableCell>
                      </TableRow>
                    )
                  : paged.map((log) => (
                      <TableRow key={log.id} className="hover:bg-muted/30">
                        <TableCell className="whitespace-nowrap tabular-nums text-sm">
                          {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={log.userType === 'admin'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                            }
                          >
                            {log.userType === 'admin' ? '管理员' : '用户'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="size-7 rounded-full bg-muted overflow-hidden shrink-0">
                              {log.userType === 'admin' ? (
                                <Shield className="size-4 m-1.5 text-indigo-500" />
                              ) : (
                                <User className="size-4 m-1.5 text-muted-foreground" />
                              )}
                            </div>
                            <span className="font-medium text-sm truncate max-w-[120px]">{log.username}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[180px]">
                          <span className="block truncate">{log.email}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm font-mono">{log.ip}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-1">
                            <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-[100px]">{log.location}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[160px]">
                          <span className="block truncate">{log.device}</span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={log.status === 'success'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                            }
                          >
                            {log.status === 'success' ? '成功' : '失败'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openDetail(log)}>
                            <Eye className="size-3.5 mr-1" />
                            详情
                          </Button>
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

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {detail?.status === 'success' ? (
                <CheckCircle2 className="size-5 text-emerald-500" />
              ) : (
                <XCircle className="size-5 text-rose-500" />
              )}
              登录详情
            </DialogTitle>
            <DialogDescription>
              {detail?.status === 'success' ? '登录成功' : detail?.failReason || '登录失败'}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">登录时间</Label>
                  <div className="text-sm font-medium mt-1 tabular-nums">
                    {format(new Date(detail.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">用户类型</Label>
                  <div className="text-sm font-medium mt-1">
                    {detail.userType === 'admin' ? '管理员' : '普通用户'}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">用户名</Label>
                  <div className="text-sm font-medium mt-1">{detail.username}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">邮箱</Label>
                  <div className="text-sm font-medium mt-1">{detail.email}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">登录IP</Label>
                  <div className="text-sm font-mono mt-1">{detail.ip}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">登录地点</Label>
                  <div className="text-sm font-medium mt-1 flex items-center gap-1">
                    <MapPin className="size-3.5 text-muted-foreground" />
                    {detail.location}
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">设备信息</Label>
                <div className="text-sm font-medium mt-1 flex items-center gap-1.5">
                  <Monitor className="size-4 text-muted-foreground" />
                  {detail.device}
                </div>
              </div>
              {detail.status === 'failed' && detail.failReason && (
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
                  <Label className="text-xs text-rose-600">失败原因</Label>
                  <div className="text-sm font-medium text-rose-700 mt-1">{detail.failReason}</div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
