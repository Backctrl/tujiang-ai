import { useEffect, useState } from 'react';
import {
  Server,
  Database,
  HardDrive,
  Cpu,
  MemoryStick,
  Wifi,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Clock,
  Zap,
  Boxes,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { delay } from '@/lib/storage';

interface ServiceStatus {
  name: string;
  status: 'normal' | 'warning' | 'error' | 'maintenance';
  latency: number;
}

function StatusIndicator({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; icon: any }> = {
    normal: { color: 'text-emerald-500', bg: 'bg-emerald-500', icon: CheckCircle2 },
    warning: { color: 'text-amber-500', bg: 'bg-amber-500', icon: AlertTriangle },
    error: { color: 'text-rose-500', bg: 'bg-rose-500', icon: XCircle },
    maintenance: { color: 'text-blue-500', bg: 'bg-blue-500', icon: Clock },
  };
  const s = map[status] || map.normal;
  const Icon = s.icon;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`relative flex size-2.5 ${s.color}`}>
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${s.bg} opacity-40`} />
        <span className={`relative inline-flex rounded-full size-2.5 ${s.bg}`} />
      </span>
      <Icon className={`size-4 ${s.color}`} />
    </div>
  );
}

function MetricBar({
  label,
  value,
  max = 100,
  unit = '%',
  icon: Icon,
  colorClass,
}: {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  icon: any;
  colorClass: string;
}) {
  const percent = Math.min(100, (value / max) * 100);
  const isHigh = percent > 80;
  const isMid = percent > 60 && percent <= 80;
  const barColor = isHigh ? 'bg-rose-500' : isMid ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Icon className={`size-4 ${colorClass}`} />
          <span className="text-foreground/80">{label}</span>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${isHigh ? 'text-rose-600' : ''}`}>
          {value.toFixed(1)}{unit}
        </span>
      </div>
      <Progress value={percent} className={`h-2 bg-muted/50 [&>div]:${barColor}`} />
    </div>
  );
}

function ServerCard({
  title,
  subtitle,
  icon: Icon,
  colorClass,
  metrics,
}: {
  title: string;
  subtitle: string;
  icon: any;
  colorClass: string;
  metrics: { label: string; value: number; unit?: string; max?: number; icon: any }[];
}) {
  return (
    <Card className="border border-border/50 overflow-hidden">
      <CardHeader className="pb-3 flex flex-row items-center gap-3">
        <div className={`size-10 rounded-lg ${colorClass} flex items-center justify-center`}>
          <Icon className="size-5 text-white" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pb-5">
        {metrics.map((m, i) => (
          <MetricBar
            key={i}
            label={m.label}
            value={m.value}
            unit={m.unit || '%'}
            max={m.max || 100}
            icon={m.icon}
            colorClass="text-muted-foreground"
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default function AdminSystemStatusPage() {
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [serverStats, setServerStats] = useState({
    cpu: 35,
    memory: 62,
    disk: 45,
    networkIn: 12.5,
    networkOut: 8.3,
  });
  const [dbStats, setDbStats] = useState({
    connections: 85,
    maxConnections: 200,
    qps: 234,
    slowQueries: 3,
    size: 2.4,
  });
  const [cacheStats, setCacheStats] = useState({
    hitRate: 94.5,
    memory: 384,
    maxMemory: 512,
    keyCount: 12456,
  });
  const [queueStats, setQueueStats] = useState({
    pending: 12,
    processing: 5,
    failed: 2,
    processedToday: 1245,
  });
  const [storageStats, setStorageStats] = useState({
    used: 128,
    total: 1024,
    files: 45678,
    traffic: 320,
  });
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'Web 服务', status: 'normal', latency: 12 },
    { name: 'API 网关', status: 'normal', latency: 18 },
    { name: '数据库', status: 'normal', latency: 3 },
    { name: 'Redis 缓存', status: 'normal', latency: 1 },
    { name: '消息队列', status: 'normal', latency: 5 },
    { name: 'AI 生图服务', status: 'warning', latency: 850 },
    { name: '短信服务', status: 'normal', latency: 45 },
    { name: '邮件服务', status: 'normal', latency: 120 },
    { name: '对象存储', status: 'normal', latency: 35 },
    { name: '内容审核', status: 'error', latency: 0 },
  ]);

  async function handleRefresh() {
    setRefreshing(true);
    await delay(800);
    setServerStats({
      cpu: 25 + Math.random() * 40,
      memory: 50 + Math.random() * 30,
      disk: 40 + Math.random() * 15,
      networkIn: 8 + Math.random() * 15,
      networkOut: 5 + Math.random() * 10,
    });
    setDbStats({
      connections: 60 + Math.floor(Math.random() * 80),
      maxConnections: 200,
      qps: 150 + Math.floor(Math.random() * 200),
      slowQueries: Math.floor(Math.random() * 5),
      size: 2.3 + Math.random() * 0.3,
    });
    setCacheStats({
      hitRate: 90 + Math.random() * 9,
      memory: 300 + Math.random() * 150,
      maxMemory: 512,
      keyCount: 12000 + Math.floor(Math.random() * 1000),
    });
    setQueueStats({
      pending: Math.floor(Math.random() * 20),
      processing: Math.floor(Math.random() * 8),
      failed: Math.floor(Math.random() * 3),
      processedToday: 1200 + Math.floor(Math.random() * 200),
    });
    setStorageStats({
      used: 120 + Math.random() * 20,
      total: 1024,
      files: 45000 + Math.floor(Math.random() * 2000),
      traffic: 300 + Math.random() * 50,
    });
    setLastRefresh(new Date());
    setRefreshing(false);
    toast.success('状态已刷新');
  }

  const normalCount = services.filter((s) => s.status === 'normal').length;
  const warningCount = services.filter((s) => s.status === 'warning').length;
  const errorCount = services.filter((s) => s.status === 'error').length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">系统状态</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            实时监控服务器与服务运行状态
            <span className="ml-3 text-xs">
              最后更新：{lastRefresh.toLocaleTimeString()}
            </span>
          </p>
        </div>
        <Button size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`size-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '刷新中...' : '刷新状态'}
        </Button>
      </div>

      {/* 概览指标 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="border border-emerald-200/50 bg-emerald-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              <CheckCircle2 className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700">{normalCount}</div>
              <div className="text-xs text-emerald-600">正常服务</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-amber-200/50 bg-amber-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-amber-500 flex items-center justify-center">
              <AlertTriangle className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-700">{warningCount}</div>
              <div className="text-xs text-amber-600">警告</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-rose-200/50 bg-rose-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-rose-500 flex items-center justify-center">
              <XCircle className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-rose-700">{errorCount}</div>
              <div className="text-xs text-rose-600">异常</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-indigo-200/50 bg-indigo-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-500 flex items-center justify-center">
              <Activity className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-indigo-700">{services.length}</div>
              <div className="text-xs text-indigo-600">监控总数</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 服务器状态 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <ServerCard
          title="服务器状态"
          subtitle="CPU / 内存 / 磁盘 / 网络"
          icon={Server}
          colorClass="bg-gradient-to-br from-indigo-500 to-violet-500"
          metrics={[
            { label: 'CPU 使用率', value: serverStats.cpu, icon: Cpu },
            { label: '内存使用率', value: serverStats.memory, icon: MemoryStick },
            { label: '磁盘使用率', value: serverStats.disk, icon: HardDrive },
          ]}
        />
        <ServerCard
          title="数据库状态"
          subtitle="MySQL / 连接数 / QPS"
          icon={Database}
          colorClass="bg-gradient-to-br from-cyan-500 to-blue-500"
          metrics={[
            { label: '连接数', value: dbStats.connections, max: dbStats.maxConnections, unit: `/${dbStats.maxConnections}`, icon: Database },
            { label: '查询QPS', value: dbStats.qps, max: 500, unit: '/s', icon: Zap },
            { label: '慢查询', value: dbStats.slowQueries, max: 20, unit: ' 条', icon: Clock },
          ]}
        />
        <ServerCard
          title="缓存状态"
          subtitle="Redis / 命中率 / 内存"
          icon={Boxes}
          colorClass="bg-gradient-to-br from-rose-500 to-pink-500"
          metrics={[
            { label: '命中率', value: cacheStats.hitRate, icon: CheckCircle2 },
            { label: '内存使用', value: cacheStats.memory, max: cacheStats.maxMemory, unit: 'MB', icon: MemoryStick },
            { label: 'Key数量', value: cacheStats.keyCount, max: 20000, unit: '', icon: Database },
          ]}
        />
      </div>

      {/* 队列和存储 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card className="border border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center gap-3">
            <div className="size-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <Clock className="size-5 text-white" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base font-semibold">消息队列</CardTitle>
              <p className="text-xs text-muted-foreground">任务处理状态</p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3">
              <div className="text-center p-3 bg-amber-50 rounded-lg">
                <div className="text-2xl font-bold text-amber-600">{queueStats.pending}</div>
                <div className="text-xs text-amber-700/80">待处理</div>
              </div>
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{queueStats.processing}</div>
                <div className="text-xs text-blue-700/80">处理中</div>
              </div>
              <div className="text-center p-3 bg-rose-50 rounded-lg">
                <div className="text-2xl font-bold text-rose-600">{queueStats.failed}</div>
                <div className="text-xs text-rose-700/80">失败</div>
              </div>
              <div className="text-center p-3 bg-emerald-50 rounded-lg">
                <div className="text-2xl font-bold text-emerald-600 tabular-nums">{queueStats.processedToday}</div>
                <div className="text-xs text-emerald-700/80">今日完成</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center gap-3">
            <div className="size-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <HardDrive className="size-5 text-white" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base font-semibold">存储服务</CardTitle>
              <p className="text-xs text-muted-foreground">对象存储使用情况</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground/80">已用空间</span>
                <span className="font-semibold tabular-nums">{storageStats.used.toFixed(0)} / {storageStats.total} GB</span>
              </div>
              <Progress
                value={(storageStats.used / storageStats.total) * 100}
                className="h-2 bg-muted/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center p-2.5 bg-muted/30 rounded-lg">
                <div className="text-xl font-bold tabular-nums">{storageStats.files.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">文件总数</div>
              </div>
              <div className="text-center p-2.5 bg-muted/30 rounded-lg">
                <div className="text-xl font-bold tabular-nums">{storageStats.traffic.toFixed(0)} GB</div>
                <div className="text-xs text-muted-foreground">本月流量</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 服务列表 */}
      <Card className="border border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Wifi className="size-4 text-indigo-500" />
            服务状态列表
          </CardTitle>
          <p className="text-xs text-muted-foreground">所有依赖服务的运行状态和延迟</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {services.map((svc) => (
              <div
                key={svc.name}
                className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
                  svc.status === 'normal'
                    ? 'border-emerald-200 bg-emerald-50/30'
                    : svc.status === 'warning'
                    ? 'border-amber-200 bg-amber-50/30'
                    : svc.status === 'error'
                    ? 'border-rose-200 bg-rose-50/30'
                    : 'border-blue-200 bg-blue-50/30'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusIndicator status={svc.status} />
                  <span className="text-sm font-medium truncate">{svc.name}</span>
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs tabular-nums shrink-0 ${
                    svc.status === 'error'
                      ? 'bg-rose-100 text-rose-700 border-rose-200'
                      : 'bg-white/60 border-border/40'
                  }`}
                >
                  {svc.status === 'error' ? '不可用' : `${svc.latency}ms`}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
