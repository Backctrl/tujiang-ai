import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Search,
  Download,
  Eye,
  Calendar,
  CheckCircle,
  Trash2,
  Bug,
  AlertCircle,
  Info,
  BarChart3,
  FilterX,
  ChevronDown,
  ChevronRight,
  Settings,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { storage, delay } from '@/lib/storage';
import { ERROR_LOGS_KEY, type IErrorLog } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';

const PAGE_SIZE = 50;

const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'bg-rose-100 text-rose-700',
  WARN: 'bg-amber-100 text-amber-700',
  INFO: 'bg-blue-100 text-blue-700',
};

const LEVEL_BG: Record<string, string> = {
  ERROR: '#f43f5e',
  WARN: '#f59e0b',
  INFO: '#3b82f6',
};

const TYPES = [
  { value: 'all', label: '全部类型' },
  { value: 'system', label: '系统错误' },
  { value: 'api', label: 'API错误' },
  { value: 'database', label: '数据库错误' },
  { value: 'third-party', label: '第三方服务错误' },
  { value: 'frontend', label: '前端错误' },
  { value: 'other', label: '其他错误' },
];

export default function AdminErrorLogsPage() {
  const [logs, setLogs] = useState<IErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [readFilter, setReadFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<IErrorLog | null>(null);
  const [stackExpanded, setStackExpanded] = useState(false);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreList, setIgnoreList] = useState<string[]>(['favicon.ico 404', 'NetworkError when attempting to fetch resource']);
  const [newIgnoreRule, setNewIgnoreRule] = useState('');

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(300);
    const list = storage.get<IErrorLog[]>(ERROR_LOGS_KEY, []);
    setLogs(list);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (levelFilter !== 'all' && log.level !== levelFilter) return false;
      if (typeFilter !== 'all' && log.type !== typeFilter) return false;
      if (readFilter === 'unread' && log.isRead) return false;
      if (readFilter === 'read' && !log.isRead) return false;
      if (startDate && new Date(log.timestamp) < new Date(startDate)) return false;
      if (endDate && new Date(log.timestamp) > new Date(endDate + 'T23:59:59')) return false;
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        if (!log.message.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [logs, levelFilter, typeFilter, readFilter, keyword, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [keyword, levelFilter, typeFilter, readFilter, startDate, endDate]);

  // 统计数据
  const today = new Date().toDateString();
  const todayErrors = logs.filter((l) => new Date(l.timestamp).toDateString() === today).length;
  const weekErrors = logs.filter((l) => {
    const d = new Date(l.timestamp);
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;
  const monthErrors = logs.filter((l) => {
    const d = new Date(l.timestamp);
    return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear();
  }).length;
  const errorRate = logs.length > 0 ? ((logs.filter((l) => l.level === 'ERROR').length / logs.length) * 100).toFixed(1) : '0';

  // 趋势图数据 - 最近7天
  const trendData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toDateString());
    }
    const errorCounts = days.map((d) => logs.filter((l) => new Date(l.timestamp).toDateString() === d && l.level === 'ERROR').length);
    const warnCounts = days.map((d) => logs.filter((l) => new Date(l.timestamp).toDateString() === d && l.level === 'WARN').length);
    const infoCounts = days.map((d) => logs.filter((l) => new Date(l.timestamp).toDateString() === d && l.level === 'INFO').length);
    return {
      xAxis: days.map((d) => {
        const date = new Date(d);
        return `${date.getMonth() + 1}/${date.getDate()}`;
      }),
      error: errorCounts,
      warn: warnCounts,
      info: infoCounts,
    };
  }, [logs]);

  const chartOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['ERROR', 'WARN', 'INFO'], right: 10, top: 0, textStyle: { fontSize: 12 } },
    grid: { left: 40, right: 20, top: 35, bottom: 25 },
    xAxis: { type: 'category', data: trendData.xAxis, axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    series: [
      {
        name: 'ERROR',
        type: 'line',
        smooth: true,
        data: trendData.error,
        itemStyle: { color: LEVEL_BG.ERROR },
        areaStyle: { opacity: 0.1 },
      },
      {
        name: 'WARN',
        type: 'line',
        smooth: true,
        data: trendData.warn,
        itemStyle: { color: LEVEL_BG.WARN },
        areaStyle: { opacity: 0.1 },
      },
      {
        name: 'INFO',
        type: 'line',
        smooth: true,
        data: trendData.info,
        itemStyle: { color: LEVEL_BG.INFO },
        areaStyle: { opacity: 0.1 },
      },
    ],
  };

  function getLevelIcon(level: string) {
    switch (level) {
      case 'ERROR': return <AlertCircle className="size-4" />;
      case 'WARN': return <AlertTriangle className="size-4" />;
      default: return <Info className="size-4" />;
    }
  }

  function openDetail(log: IErrorLog) {
    setSelectedLog(log);
    setStackExpanded(false);
    setDetailOpen(true);
    // 标记为已读
    if (!log.isRead) {
      const all = storage.get<IErrorLog[]>(ERROR_LOGS_KEY, []);
      const idx = all.findIndex((l) => l.id === log.id);
      if (idx !== -1) {
        all[idx].isRead = true;
        storage.set(ERROR_LOGS_KEY, all);
        setLogs([...all]);
      }
    }
  }

  function toggleRead(log: IErrorLog) {
    const all = storage.get<IErrorLog[]>(ERROR_LOGS_KEY, []);
    const idx = all.findIndex((l) => l.id === log.id);
    if (idx !== -1) {
      all[idx].isRead = !all[idx].isRead;
      storage.set(ERROR_LOGS_KEY, all);
      setLogs([...all]);
      toast.success(all[idx].isRead ? '已标记为已读' : '已标记为未读');
    }
  }

  function handleDelete(log: IErrorLog) {
    if (!confirm('确认删除此错误日志？')) return;
    const all = storage.get<IErrorLog[]>(ERROR_LOGS_KEY, []).filter((l) => l.id !== log.id);
    storage.set(ERROR_LOGS_KEY, all);
    setLogs(all);
    toast.success('已删除');
  }

  function markAllRead() {
    if (!confirm('确认将所有错误标记为已读？')) return;
    const all = storage.get<IErrorLog[]>(ERROR_LOGS_KEY, []).map((l) => ({ ...l, isRead: true }));
    storage.set(ERROR_LOGS_KEY, all);
    setLogs(all);
    toast.success('已全部标记为已读');
  }

  function clearRead() {
    if (!confirm('确认清空所有已读的错误日志？此操作不可恢复。')) return;
    const all = storage.get<IErrorLog[]>(ERROR_LOGS_KEY, []).filter((l) => !l.isRead);
    storage.set(ERROR_LOGS_KEY, all);
    setLogs(all);
    toast.success('已清空已读日志');
  }

  function addIgnoreRule() {
    if (!newIgnoreRule.trim()) return;
    setIgnoreList((prev) => [...prev, newIgnoreRule.trim()]);
    setNewIgnoreRule('');
    toast.success('已添加忽略规则');
  }

  function removeIgnoreRule(rule: string) {
    setIgnoreList((prev) => prev.filter((r) => r !== rule));
    toast.success('已移除忽略规则');
  }

  function ignoreCurrent() {
    if (!selectedLog) return;
    const rule = selectedLog.message.slice(0, 50);
    setIgnoreList((prev) => [...prev, rule]);
    toast.success('已添加到忽略列表');
  }

  const unreadCount = logs.filter((l) => !l.isRead).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            错误日志
            {unreadCount > 0 && (
              <Badge className="bg-rose-500 text-white border-0">{unreadCount} 未读</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">系统错误监控和追踪，快速定位和排查问题</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setIgnoreOpen(true)}>
            <FilterX className="size-4 mr-1.5" />
            忽略列表
          </Button>
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCircle className="size-4 mr-1.5" />
            全部已读
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="border border-rose-200/60 bg-rose-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-rose-500 flex items-center justify-center">
              <AlertCircle className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-rose-700 tabular-nums">{todayErrors}</div>
              <div className="text-xs text-rose-600">今日错误</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-amber-200/60 bg-amber-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-amber-500 flex items-center justify-center">
              <AlertTriangle className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700 tabular-nums">{weekErrors}</div>
              <div className="text-xs text-amber-600">本周错误</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-violet-200/60 bg-violet-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-violet-500 flex items-center justify-center">
              <Bug className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-violet-700 tabular-nums">{monthErrors}</div>
              <div className="text-xs text-violet-600">本月错误</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <BarChart3 className="size-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{errorRate}%</div>
              <div className="text-xs text-muted-foreground">错误率</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 趋势图 */}
      <Card className="border border-border/50 mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="size-4 text-indigo-500" />
            近7天错误趋势
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ReactECharts option={chartOption} style={{ height: 200 }} notMerge lazyUpdate />
        </CardContent>
      </Card>

      {/* 筛选 */}
      <Card className="border border-border/50 mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索错误信息..."
              className="bg-background pl-9 h-9"
            />
          </div>
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部级别</SelectItem>
              <SelectItem value="ERROR">ERROR</SelectItem>
              <SelectItem value="WARN">WARN</SelectItem>
              <SelectItem value="INFO">INFO</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={readFilter} onValueChange={setReadFilter}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="unread">未读</SelectItem>
              <SelectItem value="read">已读</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-36" />
            <span className="text-muted-foreground">至</span>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-36" />
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
                  <TableHead className="whitespace-nowrap">发生时间</TableHead>
                  <TableHead className="whitespace-nowrap">级别</TableHead>
                  <TableHead className="whitespace-nowrap">类型</TableHead>
                  <TableHead>错误信息</TableHead>
                  <TableHead className="whitespace-nowrap">请求URL</TableHead>
                  <TableHead className="whitespace-nowrap">关联用户</TableHead>
                  <TableHead className="whitespace-nowrap">状态</TableHead>
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
                          暂无错误日志
                        </TableCell>
                      </TableRow>
                    )
                  : paged.map((log) => (
                      <TableRow
                        key={log.id}
                        className={`hover:bg-muted/30 cursor-pointer ${!log.isRead ? 'bg-indigo-50/30' : ''}`}
                        onClick={() => openDetail(log)}
                      >
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground tabular-nums">
                          {format(new Date(log.timestamp), 'MM-dd HH:mm:ss')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${LEVEL_COLORS[log.level]} border-0`}>
                            <span className="flex items-center gap-1">
                              {getLevelIcon(log.level)}
                              {log.level}
                            </span>
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{TYPES.find((t) => t.value === log.type)?.label || log.type}</span>
                        </TableCell>
                        <TableCell className="text-sm max-w-[300px]">
                          <span className="block truncate font-mono text-xs">{log.message}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[180px]">
                          <span className="block truncate font-mono">{log.url || '-'}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.userId || '-'}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={log.isRead
                              ? 'h-5 text-[10px] bg-slate-50 text-slate-600 border-slate-200'
                              : 'h-5 text-[10px] bg-rose-50 text-rose-700 border-rose-200'
                            }
                          >
                            {log.isRead ? '已读' : '未读'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={(e) => { e.stopPropagation(); openDetail(log); }}
                            >
                              <Eye className="size-3.5 mr-1" />
                              详情
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-amber-600"
                              onClick={(e) => { e.stopPropagation(); toggleRead(log); }}
                            >
                              <CheckCircle className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-rose-500"
                              onClick={(e) => { e.stopPropagation(); handleDelete(log); }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
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
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-5 py-3 border-b border-border/40">
            <DialogTitle className="text-base flex items-center gap-2">
              {selectedLog && (
                <Badge variant="outline" className={`${LEVEL_COLORS[selectedLog.level]} border-0`}>
                  <span className="flex items-center gap-1">
                    {getLevelIcon(selectedLog.level)}
                    {selectedLog.level}
                  </span>
                </Badge>
              )}
              错误详情
            </DialogTitle>
            <DialogDescription>
              {selectedLog?.message.slice(0, 80)}
              {selectedLog && selectedLog.message.length > 80 ? '...' : ''}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="flex-1 overflow-y-auto">
              {/* 基本信息 */}
              <div className="p-4 border-b border-border/40">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Info className="size-4 text-indigo-500" />
                  基本信息
                </h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">发生时间:</span>
                    <span className="tabular-nums font-medium">
                      {format(new Date(selectedLog.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">错误类型:</span>
                    <span>{TYPES.find((t) => t.value === selectedLog.type)?.label || selectedLog.type}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">状态:</span>
                    <span>{selectedLog.isRead ? '已读' : '未读'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">发生次数:</span>
                    <span className="tabular-nums">{Math.floor(Math.random() * 10) + 1} 次</span>
                  </div>
                </div>
              </div>

              {/* 错误信息 */}
              <div className="p-4 border-b border-border/40">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <AlertCircle className="size-4 text-rose-500" />
                  错误信息
                </h4>
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 font-mono text-sm whitespace-pre-wrap">
                  {selectedLog.message}
                </div>
              </div>

              {/* 堆栈跟踪 */}
              {selectedLog.stack && (
                <div className="p-4 border-b border-border/40">
                  <button
                    onClick={() => setStackExpanded(!stackExpanded)}
                    className="text-sm font-semibold flex items-center gap-2 w-full text-left"
                  >
                    {stackExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    <Bug className="size-4 text-indigo-500" />
                    堆栈跟踪
                  </button>
                  {stackExpanded && (
                    <pre className="mt-3 p-3 bg-slate-900 text-slate-100 rounded-lg text-xs overflow-x-auto max-h-64 leading-relaxed">
                      {selectedLog.stack}
                    </pre>
                  )}
                </div>
              )}

              {/* 请求信息 */}
              <div className="p-4 border-b border-border/40">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Settings className="size-4 text-indigo-500" />
                  请求信息
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">请求URL:</span>
                    <code className="text-xs flex-1 truncate">{selectedLog.url || '-'}</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">请求方法:</span>
                    <span>POST</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-sm">请求头:</span>
                    <pre className="mt-1 p-2 bg-muted/30 rounded text-xs overflow-x-auto">
{`{
  "Content-Type": "application/json",
  "Authorization": "Bearer ***",
  "User-Agent": "Mozilla/5.0..."
}`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* 系统环境 */}
              <div className="p-4">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <BarChart3 className="size-4 text-indigo-500" />
                  系统环境
                </h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">操作系统:</span>
                    <span>Linux (Ubuntu 22.04)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">Node版本:</span>
                    <span className="font-mono">v20.10.0</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">浏览器:</span>
                    <span>Chrome 120</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24 shrink-0">应用版本:</span>
                    <span className="font-mono">v1.2.0</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="px-4 py-3 border-t border-border/40 flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={ignoreCurrent}>
                <FilterX className="size-3.5 mr-1" />
                忽略此类错误
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-rose-600 border-rose-200 hover:bg-rose-50"
                onClick={() => {
                  if (selectedLog) {
                    handleDelete(selectedLog);
                    setDetailOpen(false);
                  }
                }}
              >
                <Trash2 className="size-3.5 mr-1" />
                删除
              </Button>
            </div>
            <Button onClick={() => setDetailOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 忽略列表弹窗 */}
      <Dialog open={ignoreOpen} onOpenChange={setIgnoreOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <FilterX className="size-4 text-indigo-500" />
              忽略规则管理
            </DialogTitle>
            <DialogDescription>匹配以下规则的错误将被自动忽略，不显示在列表中</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Input
                value={newIgnoreRule}
                onChange={(e) => setNewIgnoreRule(e.target.value)}
                placeholder="输入错误关键词或正则..."
                onKeyDown={(e) => e.key === 'Enter' && addIgnoreRule()}
              />
              <Button onClick={addIgnoreRule}>添加</Button>
            </div>
            <div className="border border-border/40 rounded-lg divide-y divide-border/40 max-h-64 overflow-y-auto">
              {ignoreList.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  暂无忽略规则
                </div>
              ) : (
                ignoreList.map((rule, i) => (
                  <div key={i} className="p-3 flex items-center justify-between gap-2 hover:bg-muted/20">
                    <code className="text-xs flex-1 truncate">{rule}</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-rose-500"
                      onClick={() => removeIgnoreRule(rule)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIgnoreOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
