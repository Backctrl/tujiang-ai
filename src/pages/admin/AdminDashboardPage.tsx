import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  Users,
  Activity,
  ImageIcon,
  DollarSign,
  Server,
  Clock,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import StatCard from '@/components/admin/StatCard';
import { dashboardService, type DashboardStats, type DashboardCharts } from '@/services/dashboardService';
import { Image as UIImage } from '@/components/ui/image';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [charts, setCharts] = useState<DashboardCharts | null>(null);
  const [activity, setActivity] = useState<{
    recentUsers: any[];
    recentOrders: any[];
    recentAudits: any[];
  }>({ recentUsers: [], recentOrders: [], recentAudits: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      dashboardService.getStats(),
      dashboardService.getCharts(),
      dashboardService.getRecentActivity(),
    ]).then(([statsRes, chartsRes, activityRes]) => {
      if (statsRes.data) setStats(statsRes.data);
      if (chartsRes.data) setCharts(chartsRes.data);
      if (activityRes.data) setActivity(activityRes.data);
      setLoading(false);
    });
  }, []);

  const userGrowthOption: EChartsOption = charts
    ? {
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, data: ['新增用户'] },
        grid: { left: '3%', right: '4%', bottom: '20%', top: '10%', containLabel: true },
        xAxis: {
          type: 'category',
          data: charts.userGrowth.dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          axisLabel: { color: '#64748b', fontSize: 11, interval: 4 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#f1f5f9' } },
          axisLabel: { color: '#64748b', fontSize: 11 },
        },
        series: [
          {
            name: '新增用户',
            type: 'line',
            smooth: true,
            data: charts.userGrowth.values,
            lineStyle: { color: CHART_COLORS[0], width: 2 },
            itemStyle: { color: CHART_COLORS[0] },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(99, 102, 241, 0.25)' },
                  { offset: 1, color: 'rgba(99, 102, 241, 0.02)' },
                ],
              },
            },
          },
        ],
      }
    : {};

  const revenueOption: EChartsOption = charts
    ? {
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, data: ['营收金额'] },
        grid: { left: '3%', right: '4%', bottom: '20%', top: '10%', containLabel: true },
        xAxis: {
          type: 'category',
          data: charts.revenueTrend.dates,
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          axisLabel: { color: '#64748b', fontSize: 11, interval: 4 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#f1f5f9' } },
          axisLabel: { color: '#64748b', fontSize: 11 },
        },
        series: [
          {
            name: '营收金额',
            type: 'bar',
            data: charts.revenueTrend.values,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: CHART_COLORS[1] },
                  { offset: 1, color: '#c4b5fd' },
                ],
              },
              borderRadius: [4, 4, 0, 0],
            },
            barWidth: '50%',
          },
        ],
      }
    : {};

  const imageOption: EChartsOption = charts
    ? {
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, data: ['图片生成量'] },
        grid: { left: '3%', right: '4%', bottom: '25%', top: '10%', containLabel: true },
        xAxis: {
          type: 'category',
          data: charts.imageTrend.dates,
          boundaryGap: false,
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          axisLabel: { color: '#64748b', fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#f1f5f9' } },
          axisLabel: { color: '#64748b', fontSize: 11 },
        },
        series: [
          {
            name: '图片生成量',
            type: 'line',
            smooth: true,
            data: charts.imageTrend.values,
            lineStyle: { color: CHART_COLORS[2], width: 2 },
            itemStyle: { color: CHART_COLORS[2] },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(168, 85, 247, 0.2)' },
                  { offset: 1, color: 'rgba(168, 85, 247, 0.02)' },
                ],
              },
            },
          },
        ],
      }
    : {};

  const packageOption: EChartsOption = charts
    ? {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, type: 'scroll' },
        series: [
          {
            type: 'pie',
            radius: ['45%', '70%'],
            center: ['50%', '45%'],
            avoidLabelOverlap: false,
            label: { show: false },
            emphasis: { label: { show: false } },
            data: charts.packageDistribution.names.map((name, i) => ({
              value: charts.packageDistribution.values[i],
              name,
              itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
            })),
          },
        ],
      }
    : {};

  const apiOption: EChartsOption = charts
    ? {
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, data: ['调用量'] },
        grid: { left: '3%', right: '4%', bottom: '25%', top: '10%', containLabel: true },
        xAxis: {
          type: 'category',
          data: charts.apiDistribution.names,
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          axisLabel: { color: '#64748b', fontSize: 11, rotate: 0 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          splitLine: { lineStyle: { color: '#f1f5f9' } },
          axisLabel: { color: '#64748b', fontSize: 11 },
        },
        series: [
          {
            name: '调用量',
            type: 'line',
            smooth: true,
            data: charts.apiDistribution.values,
            lineStyle: { color: CHART_COLORS[3], width: 2 },
            itemStyle: { color: CHART_COLORS[3] },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(217, 70, 239, 0.15)' },
                  { offset: 1, color: 'rgba(217, 70, 239, 0.02)' },
                ],
              },
            },
          },
        ],
      }
    : {};

  const activityOption: EChartsOption = charts
    ? {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, type: 'scroll' },
        series: [
          {
            type: 'pie',
            radius: ['50%', '75%'],
            center: ['50%', '45%'],
            label: { show: false },
            emphasis: { label: { show: false } },
            data: charts.userActivity.names.map((name, i) => ({
              value: charts.userActivity.values[i],
              name,
              itemStyle: { color: ['#10b981', '#94a3b8', '#6366f1'][i] },
            })),
          },
        ],
      }
    : {};

  if (loading || !stats || !charts) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted/50 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[300px] bg-muted/50 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">数据概览</h1>
          <p className="text-sm text-muted-foreground mt-0.5">平台核心数据指标一览</p>
        </div>
        <Badge variant="outline" className="text-xs">
          实时数据 · 更新于 {new Date().toLocaleTimeString('zh-CN')}
        </Badge>
      </div>

      {/* 核心指标卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          title="总用户数"
          value={stats.totalUsers.toLocaleString()}
          trend={{ value: `+${stats.todayNewUsers}`, up: true }}
          subtitle="今日新增"
          icon={<Users />}
          iconBg="bg-indigo-100"
          iconColor="text-indigo-600"
        />
        <StatCard
          title="活跃用户"
          value={stats.activeUsersToday}
          subtitle={`7日活跃 ${stats.activeUsers7d}`}
          icon={<Activity />}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />
        <StatCard
          title="总生成图片"
          value={stats.totalImages.toLocaleString()}
          trend={{ value: `+${stats.todayImages}`, up: true }}
          subtitle="今日生成"
          icon={<ImageIcon />}
          iconBg="bg-violet-100"
          iconColor="text-violet-600"
        />
        <StatCard
          title="总营收"
          value={`¥${stats.totalRevenue.toLocaleString()}`}
          trend={{ value: `+¥${stats.todayRevenue}`, up: true }}
          subtitle="今日营收"
          icon={<DollarSign />}
          iconBg="bg-amber-100"
          iconColor="text-amber-600"
        />
        <StatCard
          title="API总调用"
          value={stats.totalApiCalls.toLocaleString()}
          subtitle={`成功率 ${stats.apiSuccessRate.toFixed(1)}%`}
          icon={<Server />}
          iconBg="bg-cyan-100"
          iconColor="text-cyan-600"
        />
        <StatCard
          title="平均响应时间"
          value={`${stats.avgResponseTime}ms`}
          trend={{ value: `${stats.responseTimeTrend}ms`, down: stats.responseTimeTrend < 0 }}
          subtitle={stats.responseTimeTrend < 0 ? '较昨日' : '较昨日'}
          icon={<Clock />}
          iconBg="bg-rose-100"
          iconColor="text-rose-600"
        />
      </div>

      {/* 图表区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">用户增长趋势</CardTitle>
            <p className="text-xs text-muted-foreground">近30天新增用户</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={userGrowthOption} className="h-[280px]" />
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">营收趋势</CardTitle>
            <p className="text-xs text-muted-foreground">近30天每日营收</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={revenueOption} className="h-[280px]" />
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">图片生成量趋势</CardTitle>
            <p className="text-xs text-muted-foreground">近7天生成量</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={imageOption} className="h-[280px]" />
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">充值套餐分布</CardTitle>
            <p className="text-xs text-muted-foreground">各套餐销售占比</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={packageOption} className="h-[280px]" />
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">API接口调用分布</CardTitle>
            <p className="text-xs text-muted-foreground">各接口调用量统计</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={apiOption} className="h-[280px]" />
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">用户活跃度分布</CardTitle>
            <p className="text-xs text-muted-foreground">活跃/沉默/新用户占比</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={activityOption} className="h-[280px]" />
          </CardContent>
        </Card>
      </div>

      {/* 最近活动 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">最近注册用户</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {activity.recentUsers.map((user) => (
              <div key={user.id} className="flex items-center gap-3">
                <UIImage
                  src={user.avatar}
                  alt={user.nickname}
                  className="size-9 rounded-full object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{user.nickname}</div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(user.createdAt), {
                    addSuffix: true,
                    locale: zhCN,
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">最近订单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {activity.recentOrders.map((order) => (
              <div key={order.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{order.packageName}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {order.orderNo.slice(-12)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold">¥{order.amount}</div>
                  <Badge
                    variant={order.status === 'paid' ? 'default' : 'outline'}
                    className={
                      order.status === 'paid'
                        ? 'bg-emerald-500 text-white'
                        : order.status === 'pending'
                        ? 'text-amber-600 border-amber-200 bg-amber-50'
                        : 'text-slate-500'
                    }
                  >
                    {order.status === 'paid'
                      ? '已支付'
                      : order.status === 'pending'
                      ? '待支付'
                      : order.status === 'refunded'
                      ? '已退款'
                      : '已取消'}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">最近操作</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {activity.recentAudits.map((log) => (
              <div key={log.id} className="flex items-start gap-3">
                <UIImage
                  src={log.adminAvatar}
                  alt={log.adminName}
                  className="size-7 rounded-full object-cover mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className="font-medium">{log.adminName}</span>
                    <span className="text-muted-foreground mx-1">·</span>
                    <span>{log.module}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{log.summary}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
