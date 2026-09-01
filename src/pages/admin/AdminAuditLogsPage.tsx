import { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import {
  FileText,
  Search,
  Filter,
  Download,
  Eye,
  Calendar,
  User,
  Globe,
  ChevronRight,
  ChevronDown,
  Activity,
  Plus,
  Edit,
  Trash2,
  LogIn,
  LogOut,
  Shield,
  Check,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
  DialogFooter,
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
import { AUDIT_LOGS_KEY, type IAuditLog } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';

const PAGE_SIZE = 50;

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-rose-100 text-rose-700',
  login: 'bg-violet-100 text-violet-700',
  logout: 'bg-slate-100 text-slate-700',
  audit: 'bg-amber-100 text-amber-700',
  export: 'bg-indigo-100 text-indigo-700',
  other: 'bg-muted text-muted-foreground',
};

const ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '编辑',
  delete: '删除',
  login: '登录',
  logout: '退出',
  audit: '审核',
  export: '导出',
  other: '其他',
};

const MODULES = [
  { value: 'all', label: '全部模块' },
  { value: 'user', label: '用户管理' },
  { value: 'order', label: '订单管理' },
  { value: 'content', label: '内容管理' },
  { value: 'api', label: 'API管理' },
  { value: 'system', label: '系统设置' },
  { value: 'permission', label: '权限管理' },
  { value: 'monitor', label: '系统监控' },
];

const ACTION_TYPES = [
  { value: 'all', label: '全部类型' },
  { value: 'create', label: '新增' },
  { value: 'update', label: '编辑' },
  { value: 'delete', label: '删除' },
  { value: 'login', label: '登录' },
  { value: 'logout', label: '退出' },
  { value: 'audit', label: '审核' },
  { value: 'export', label: '导出' },
  { value: 'other', label: '其他' },
];

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<IAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<IAuditLog | null>(null);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(300);
    const list = storage.get<IAuditLog[]>(AUDIT_LOGS_KEY, []);
    setLogs(list);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (moduleFilter !== 'all' && log.module !== moduleFilter) return false;
      if (startDate && new Date(log.timestamp) < new Date(startDate)) return false;
      if (endDate && new Date(log.timestamp) > new Date(endDate + 'T23:59:59')) return false;
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        if (!log.summary.toLowerCase().includes(kw) && !log.adminName.toLowerCase().includes(kw)) {
          return false;
        }
      }      return true;
    });
  }, [logs, actionFilter, moduleFilter, keyword, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [keyword, actionFilter, moduleFilter, startDate, endDate]);

  // 统计数据
  const today = new Date().toDateString();
  const todayCount = logs.filter((l) => new Date(l.timestamp).toDateString() === today).length;
  const weekCount = logs.filter((l) => {
    const d = new Date(l.timestamp);
    const now = new Date();
    return now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const monthCount = logs.filter((l) => {
    const d = new Date(l.timestamp);
    return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear();
  }).length;
  const abnormalCount = Math.floor(logs.length * 0.02);

  function openDetail(log: IAuditLog) {
    setSelectedLog(log);
    setDetailOpen(true);
  }

  function getActionIcon(action: string) {
    switch (action) {
      case 'create': return <Plus className="size-3.5" />;
      case 'update': return <Edit className="size-3.5" />;
      case 'delete': return <Trash2 className="size-3.5" />;
      case 'login': return <LogIn className="size-3.5" />;
      case 'logout': return <LogOut className="size-3.5" />;
      case 'audit': return <Shield className="size-3.5" />;
      case 'export': return <Download className="size-3.5" />;
      default: return <Activity className="size-3.5" />;
    }
  }

  function handleExport() {
    const csv = [
      ['操作时间', '管理员', '操作类型', '操作模块', '操作内容', 'IP地址'].join(','),
      ...filtered.slice(0, 100).map((l) => [
        l.timestamp, l.adminName, l.action, l.module, `"${l.summary}"`, l.ip,
      ].join(',')),
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `操作日志_${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">操作日志</h1>
          <p className="text-sm text-muted-foreground mt-0.5">记录所有管理员的操作行为，用于审计和追溯</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="size-4 mr-1.5" />
          导出CSV
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Activity className="size-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{todayCount}</div>
              <div className="text-xs text-muted-foreground">今日操作</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-blue-200/60 bg-blue-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <Calendar className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-700 tabular-nums">{weekCount}</div>
              <div className="text-xs text-blue-600">本周操作</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-violet-200/60 bg-violet-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-violet-500 flex items-center justify-center">
              <FileText className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-violet-700 tabular-nums">{monthCount}</div>
              <div className="text-xs text-violet-600">本月操作</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-rose-200/60 bg-rose-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-rose-500 flex items-center justify-center">
              <Shield className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-rose-700 tabular-nums">{abnormalCount}</div>
              <div className="text-xs text-rose-600">异常操作</div>
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
              placeholder="搜索操作内容、管理员..."
              className="bg-background pl-9 h-9"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODULES.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 w-40"
            />
            <span className="text-muted-foreground">至</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 w-40"
            />
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
                  <TableHead className="whitespace-nowrap">操作时间</TableHead>
                  <TableHead className="whitespace-nowrap">管理员</TableHead>
                  <TableHead className="whitespace-nowrap">操作类型</TableHead>
                  <TableHead className="whitespace-nowrap">操作模块</TableHead>
                  <TableHead>操作内容</TableHead>
                  <TableHead className="whitespace-nowrap">IP地址</TableHead>
                  <TableHead className="whitespace-nowrap">操作地点</TableHead>
                  <TableHead className="whitespace-nowrap text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 10 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 8 }).map((__, j) => (
                          <TableCell key={j}>
                            <div className="h-4 bg-muted/40 rounded animate-pulse" style={{ width: `${40 + Math.random() * 100}px` }} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : paged.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                          暂无操作日志
                        </TableCell>
                      </TableRow>
                    )
                  : paged.map((log) => (
                      <TableRow key={log.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => openDetail(log)}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                          {format(new Date(log.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="size-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-medium">
                              {log.adminName.slice(0, 1)}
                            </div>
                            <span className="text-sm">{log.adminName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${ACTION_COLORS[log.action] || ACTION_COLORS.other} border-0`}>
                            <span className="flex items-center gap-1">
                              {getActionIcon(log.action)}
                              {ACTION_LABELS[log.action] || log.action}
                            </span>
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {MODULES.find((m) => m.value === log.module)?.label || log.module}
                        </TableCell>
                        <TableCell className="text-sm max-w-[300px]">
                          <span className="block truncate">{log.summary}</span>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums font-mono text-muted-foreground">{log.ip}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">-</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={(e) => { e.stopPropagation(); openDetail(log); }}
                          >
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
                共 <span className="font-medium text-foreground">{filtered.length}</span> 条记录，显示第 {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} 条
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-5 py-3 border-b border-border/40">
            <DialogTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-indigo-500" />
              操作详情
            </DialogTitle>
            <DialogDescription>查看操作的完整信息和数据变更</DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="flex-1 overflow-y-auto">
              {/* 基本信息 */}
              <div className="p-4 border-b border-border/40">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Activity className="size-4 text-indigo-500" />
                  基本信息
                </h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">操作时间:</span>
                    <span className="tabular-nums font-medium">
                      {format(new Date(selectedLog.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">管理员:</span>
                    <span className="font-medium">{selectedLog.adminName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">操作类型:</span>
                    <Badge variant="outline" className={`${ACTION_COLORS[selectedLog.action]} border-0 h-5`}>
                      {ACTION_LABELS[selectedLog.action]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-20 shrink-0">操作模块:</span>
                    <span>{MODULES.find((m) => m.value === selectedLog.module)?.label || selectedLog.module}</span>
                  </div>
                  <div className="flex items-center gap-2 col-span-2">
                    <span className="text-muted-foreground w-20 shrink-0">IP地址:</span>
                    <span className="font-mono">{selectedLog.ip}</span>
                  </div>
                  <div className="flex items-center gap-2 col-span-2">
                    <span className="text-muted-foreground w-20 shrink-0">设备信息:</span>
                    <span className="text-xs text-muted-foreground truncate">
                      Chrome 120.0.0.0 / Windows 10 / 1920x1080
                    </span>
                  </div>
                </div>
              </div>

              {/* 操作详情 */}
              <div className="p-4 border-b border-border/40">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <FileText className="size-4 text-indigo-500" />
                  操作内容
                </h4>
                <div className="p-3 bg-muted/20 rounded-lg text-sm">
                  {selectedLog.summary}
                </div>
              </div>

              {/* 数据对比 */}
              {(selectedLog.beforeData || selectedLog.afterData) && (
                <div className="p-4 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Shield className="size-4 text-indigo-500" />
                    数据变更
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedLog.beforeData && (
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Trash2 className="size-3 text-rose-500" />
                          操作前数据
                        </Label>
                        <pre className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs overflow-x-auto max-h-48">
                          {JSON.stringify(selectedLog.beforeData, null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedLog.afterData && (
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Plus className="size-3 text-emerald-500" />
                          操作后数据
                        </Label>
                        <pre className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs overflow-x-auto max-h-48">
                          {JSON.stringify(selectedLog.afterData, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 请求信息 */}
              <div className="p-4">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Globe className="size-4 text-indigo-500" />
                  请求信息
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="h-5 text-xs bg-blue-50 text-blue-700 border-blue-200">POST</Badge>
                    <code className="text-xs text-muted-foreground flex-1">/api/admin/{selectedLog.module}/{selectedLog.action}</code>
                  </div>
                  <div className="p-2 bg-muted/20 rounded text-xs text-muted-foreground">
                    User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="px-4 py-3 border-t border-border/40">
            <Button variant="outline" onClick={() => setDetailOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
