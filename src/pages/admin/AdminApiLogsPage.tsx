import { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import {
  Search,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Zap,
  Gauge,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { storage, delay } from '@/lib/storage';
import { API_LOGS_KEY, type IApiLog } from '@/data/admin-models';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

export default function AdminApiLogsPage() {
  const [logs, setLogs] = useState<IApiLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [apiFilter, setApiFilter] = useState('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<IApiLog | null>(null);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    setLogs(storage.get<IApiLog[]>(API_LOGS_KEY, []));
    setLoading(false);
  }

  const stats = useMemo(() => {
    const total = logs.length;
    const success = logs.filter((l) => l.statusCode < 400).length;
    const failed = total - success;
    const avgDuration = total > 0
      ? Math.round(logs.reduce((s, l) => s + l.responseTime, 0) / total)
      : 0;
    const p99 = total > 0
      ? [...logs].sort((a, b) => b.responseTime - a.responseTime)[Math.floor(total * 0.01)]?.responseTime || 0
      : 0;
    return { total, success, failed, successRate: total > 0 ? ((success / total) * 100).toFixed(2) : '0', avgDuration, p99 };
  }, [logs]);

  const filtered = useMemo(() => {
    let result = [...logs];
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (l) => l.requestId.toLowerCase().includes(kw) || l.url.toLowerCase().includes(kw),
      );
    }
    if (statusFilter === 'success') {
      result = result.filter((l) => l.statusCode < 400);
    } else if (statusFilter === 'failed') {
      result = result.filter((l) => l.statusCode >= 400);
    }
    if (apiFilter !== 'all') {
      result = result.filter((l) => l.endpoint === apiFilter);
    }
    return result;
  }, [logs, keyword, statusFilter, apiFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page]);

  const apiNames = useMemo(() => {
    const set = new Set(logs.map((l) => l.endpoint));
    return Array.from(set);
  }, [logs]);

  function openDetail(log: IApiLog) {
    setSelected(log);
    setDetailOpen(true);
  }

  const columns = [
    {
      key: 'requestId',
      title: '请求ID',
      width: '180px',
      render: (row: IApiLog) => (
        <span className="font-mono text-xs text-foreground/80 truncate block max-w-[170px]">
          {row.requestId}
        </span>
      ),
    },
    {
      key: 'endpoint',
      title: '接口名称',
      width: '140px',
      render: (row: IApiLog) => (
        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-100 text-xs">
          {row.endpoint}
        </Badge>
      ),
    },
    {
      key: 'user',
      title: '用户/密钥',
      width: '120px',
      render: (row: IApiLog) => (
        <span className="text-xs truncate block max-w-[110px]">{row.userId || row.apiKeyName || 'system'}</span>
      ),
    },
    {
      key: 'method',
      title: '方法',
      width: '60px',
      align: 'center' as const,
      render: (row: IApiLog) => {
        const color = row.method === 'GET' ? 'text-emerald-600'
          : row.method === 'POST' ? 'text-blue-600'
          : row.method === 'PUT' ? 'text-amber-600'
          : 'text-rose-600';
        return <span className={`text-xs font-bold ${color}`}>{row.method}</span>;
      },
    },
    {
      key: 'status',
      title: '状态码',
      width: '80px',
      align: 'center' as const,
      render: (row: IApiLog) => {
        const isSuccess = row.statusCode < 400;
        return (
          <Badge
            variant="outline"
            className={isSuccess
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'
            }
          >
            {row.statusCode}
          </Badge>
        );
      },
    },
    {
      key: 'duration',
      title: '响应时间',
      width: '90px',
      align: 'right' as const,
      render: (row: IApiLog) => {
        const slow = row.responseTime > 1000;
        return (
          <span className={`tabular-nums text-xs ${slow ? 'text-amber-600 font-medium' : ''}`}>
            {row.responseTime}ms
          </span>
        );
      },
    },
    {
      key: 'ip',
      title: 'IP地址',
      width: '120px',
      render: (row: IApiLog) => (
        <span className="text-xs text-muted-foreground font-mono">{row.ip}</span>
      ),
    },
    {
      key: 'time',
      title: '时间',
      width: '140px',
      render: (row: IApiLog) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(row.timestamp), 'MM-dd HH:mm:ss')}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: '70px',
      render: (row: IApiLog) => (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openDetail(row)}>
          <Eye className="size-3.5 mr-1" />
          详情
        </Button>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">API调用日志</h1>
        <p className="text-sm text-muted-foreground mt-0.5">查看和分析API调用记录</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card className="border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Activity className="size-4 text-indigo-600" />
              </div>
              <span className="text-xs text-muted-foreground">总请求数</span>
            </div>
            <div className="text-2xl font-bold tabular-nums">{stats.total.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="size-4 text-emerald-600" />
              </div>
              <span className="text-xs text-muted-foreground">成功</span>
            </div>
            <div className="text-2xl font-bold text-emerald-600 tabular-nums">{stats.success.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-8 rounded-lg bg-rose-100 flex items-center justify-center">
                <XCircle className="size-4 text-rose-600" />
              </div>
              <span className="text-xs text-muted-foreground">失败</span>
            </div>
            <div className="text-2xl font-bold text-rose-600 tabular-nums">{stats.failed.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-8 rounded-lg bg-violet-100 flex items-center justify-center">
                <Zap className="size-4 text-violet-600" />
              </div>
              <span className="text-xs text-muted-foreground">成功率</span>
            </div>
            <div className="text-2xl font-bold text-violet-600 tabular-nums">{stats.successRate}%</div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-8 rounded-lg bg-cyan-100 flex items-center justify-center">
                <Clock className="size-4 text-cyan-600" />
              </div>
              <span className="text-xs text-muted-foreground">平均响应</span>
            </div>
            <div className="text-2xl font-bold text-cyan-600 tabular-nums">{stats.avgDuration}ms</div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="size-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <Gauge className="size-4 text-amber-600" />
              </div>
              <span className="text-xs text-muted-foreground">P99响应</span>
            </div>
            <div className="text-2xl font-bold text-amber-600 tabular-nums">{stats.p99}ms</div>
          </CardContent>
        </Card>
      </div>

      <AdminDataTable
        columns={columns}
        data={paginated}
        loading={loading}
        total={filtered.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        rowKey={(row) => row.requestId}
        search={{
          value: keyword,
          onChange: (v) => {
            setKeyword(v);
            setPage(1);
          },
          placeholder: '搜索请求ID、URL...',
        }}
        toolbar={
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-28 h-9 text-sm">
                <SelectValue placeholder="响应状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectContent>
            </Select>
            <Select value={apiFilter} onValueChange={(v) => { setApiFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="全部接口" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部接口</SelectItem>
                {apiNames.slice(0, 10).map((n) => (
                  <SelectItem key={n} value={n}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {/* 详情弹窗 */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              API调用详情
              <Badge variant="outline" className="font-mono">
                {selected?.requestId}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selected && `${selected.method} ${selected.url}`}
            </DialogDescription>
          </DialogHeader>

          {selected && (
            <Tabs defaultValue="request" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="request" className="flex-1">请求信息</TabsTrigger>
                <TabsTrigger value="response" className="flex-1">响应信息</TabsTrigger>
                <TabsTrigger value="headers" className="flex-1">请求头</TabsTrigger>
              </TabsList>

              <TabsContent value="request" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-2.5 bg-muted/20 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">接口名称</div>
                    <div className="font-medium">{selected.endpoint}</div>
                  </div>
                  <div className="p-2.5 bg-muted/20 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">请求方法</div>
                    <div className="font-medium">{selected.method}</div>
                  </div>
                  <div className="p-2.5 bg-muted/20 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">用户</div>
                    <div className="font-medium">{selected.userId || '系统'}</div>
                  </div>
                  <div className="p-2.5 bg-muted/20 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">API密钥</div>
                    <div className="font-mono text-xs">{selected.apiKeyName || '无'}</div>
                  </div>
                  <div className="p-2.5 bg-muted/20 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">IP地址</div>
                    <div className="font-mono text-xs">{selected.ip}</div>
                  </div>
                  <div className="p-2.5 bg-muted/20 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">响应时间</div>
                    <div className="font-medium">{selected.responseTime}ms</div>
                  </div>
                </div>
                <div className="p-3 bg-muted/20 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2">请求参数</div>
                  <pre className="text-xs font-mono overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                    {JSON.stringify(selected.requestBody || { message: '模拟请求体数据' }, null, 2)}
                  </pre>
                </div>
              </TabsContent>

              <TabsContent value="response" className="space-y-3 mt-4">
                <div className="p-2.5 bg-muted/20 rounded-lg flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">HTTP状态码</span>
                  <Badge
                    variant="outline"
                    className={selected.statusCode < 400
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                    }
                  >
                    {selected.statusCode}
                  </Badge>
                </div>
                <div className="p-3 bg-muted/20 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2">响应体</div>
                  <pre className="text-xs font-mono overflow-x-auto max-h-60 whitespace-pre-wrap break-all">
                    {JSON.stringify(selected.responseBody || {
                      code: 0,
                      message: 'success',
                      data: { result: '模拟响应数据' }
                    }, null, 2)}
                  </pre>
                </div>
              </TabsContent>

              <TabsContent value="headers" className="space-y-3 mt-4">
                <div className="p-3 bg-muted/20 rounded-lg">
                  <div className="text-xs text-muted-foreground mb-2">请求头</div>
                  <pre className="text-xs font-mono overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                    {JSON.stringify({
                      'content-type': 'application/json',
                      'user-agent': 'Mozilla/5.0',
                      'authorization': 'Bearer ***',
                      'x-request-id': selected.requestId,
                      'referer': 'https://tujiang.ai/',
                    }, null, 2)}
                  </pre>
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
