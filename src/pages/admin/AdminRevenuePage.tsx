import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  DollarSign,
  TrendingUp,
  Users,
  ShoppingBag,
  ArrowDownUp,
  Wallet,
  BarChart3,
  PieChart as PieChartIcon,
  Download,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import StatCard from '@/components/admin/StatCard';
import { storage, delay, success, type ApiResponse } from '@/lib/storage';
import { ORDERS_KEY, type IOrder } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';
import AdminDataTable from '@/components/admin/AdminDataTable';
import { toast } from 'sonner';

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f472b6'];

interface RevenueData {
  totalRevenue: number;
  monthRevenue: number;
  todayRevenue: number;
  avgOrderValue: number;
  payingUsers: number;
  totalOrders: number;
  refundAmount: number;
  netRevenue: number;
  dailyData: { date: string; orders: number; users: number; revenue: number; refunds: number; net: number }[];
  packageData: { name: string; amount: number; orders: number }[];
  payMethodData: { name: string; value: number }[];
}

async function getRevenueData(period: 'day' | 'week' | 'month'): Promise<ApiResponse<RevenueData | null>> {
  await delay(300);
  mockDataService.initMockData();
  const orders = storage.get<IOrder[]>(ORDERS_KEY, []);
  const paidOrders = orders.filter((o) => o.status === 'paid');

  const totalRevenue = paidOrders.reduce((s, o) => s + o.amount, 0);
  const totalOrders = paidOrders.length;
  const payingUsers = new Set(paidOrders.map((o) => o.userId)).size;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // 模拟每日数据（近30天）
  const dailyData: RevenueData['dailyData'] = [];
  const now = new Date();
  let cumulativeRevenue = 0;
  let cumulativeRefunds = 0;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    const revenue = period === 'day'
      ? Math.floor(800 + Math.sin(i / 3) * 300 + Math.random() * 400)
      : Math.floor(1500 + Math.sin(i / 5) * 600 + Math.random() * 800);
    const refunds = Math.floor(Math.random() * 50);
    cumulativeRevenue += revenue;
    cumulativeRefunds += refunds;
    dailyData.push({
      date: dateStr,
      orders: Math.floor(revenue / 50),
      users: Math.floor(revenue / 80),
      revenue,
      refunds,
      net: revenue - refunds,
    });
  }

  // 套餐数据
  const packageData = [
    { name: '入门套餐(49元)', amount: Math.floor(totalRevenue * 0.15), orders: Math.floor(totalOrders * 0.35) },
    { name: '标准套餐(99元)', amount: Math.floor(totalRevenue * 0.3), orders: Math.floor(totalOrders * 0.3) },
    { name: '专业套餐(199元)', amount: Math.floor(totalRevenue * 0.35), orders: Math.floor(totalOrders * 0.25) },
    { name: '企业套餐(499元)', amount: Math.floor(totalRevenue * 0.2), orders: Math.floor(totalOrders * 0.1) },
  ];

  // 支付方式
  const payMethodData = [
    { name: '微信支付', value: 55 },
    { name: '支付宝', value: 38 },
    { name: '其他', value: 7 },
  ];

  const todayRevenue = dailyData[dailyData.length - 1]?.revenue || 0;
  const monthRevenue = dailyData.slice(-30).reduce((s, d) => s + d.revenue, 0);
  const refundAmount = dailyData.reduce((s, d) => s + d.refunds, 0);
  const netRevenue = totalRevenue - refundAmount;

  return success({
    totalRevenue,
    monthRevenue,
    todayRevenue,
    avgOrderValue: Math.round(avgOrderValue * 100) / 100,
    payingUsers,
    totalOrders,
    refundAmount,
    netRevenue,
    dailyData,
    packageData,
    payMethodData,
  });
}

export default function AdminRevenuePage() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getRevenueData(period).then((res) => {
      if (res.data) setData(res.data);
      setLoading(false);
    });
  }, [period]);

  const revenueOption: EChartsOption = data
    ? {
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, data: ['营收金额', '净营收', '订单数'] },
        grid: { left: '3%', right: '4%', bottom: '20%', top: '10%', containLabel: true },
        xAxis: {
          type: 'category',
          data: data.dailyData.map((d) => d.date),
          axisLine: { lineStyle: { color: '#e2e8f0' } },
          axisLabel: { color: '#64748b', fontSize: 11, interval: 3 },
        },
        yAxis: [
          {
            type: 'value',
            name: '金额(元)',
            axisLine: { show: false },
            splitLine: { lineStyle: { color: '#f1f5f9' } },
            axisLabel: { color: '#64748b', fontSize: 11 },
          },
          {
            type: 'value',
            name: '订单数',
            axisLine: { show: false },
            splitLine: { show: false },
            axisLabel: { color: '#64748b', fontSize: 11 },
          },
        ],
        series: [
          {
            name: '营收金额',
            type: 'bar',
            data: data.dailyData.map((d) => d.revenue),
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: CHART_COLORS[0] },
                  { offset: 1, color: '#c7d2fe' },
                ],
              },
              borderRadius: [4, 4, 0, 0],
            },
            barWidth: '40%',
          },
          {
            name: '净营收',
            type: 'line',
            smooth: true,
            data: data.dailyData.map((d) => d.net),
            lineStyle: { color: CHART_COLORS[2], width: 2 },
            itemStyle: { color: CHART_COLORS[2] },
          },
          {
            name: '订单数',
            type: 'line',
            yAxisIndex: 1,
            smooth: true,
            data: data.dailyData.map((d) => d.orders),
            lineStyle: { color: CHART_COLORS[4], width: 2, type: 'dashed' as const },
            itemStyle: { color: CHART_COLORS[4] },
          },
        ],
      }
    : {};

  const packageOption: EChartsOption = data
    ? {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, type: 'scroll' },
        series: [
          {
            type: 'pie',
            radius: ['45%', '70%'],
            center: ['50%', '45%'],
            label: { show: false },
            emphasis: { label: { show: false } },
            data: data.packageData.map((d, i) => ({
              value: d.amount,
              name: d.name,
              itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
            })),
          },
        ],
      }
    : {};

  const payOption: EChartsOption = data
    ? {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, type: 'scroll' },
        series: [
          {
            type: 'pie',
            radius: ['55%', '75%'],
            center: ['50%', '45%'],
            label: { show: false },
            emphasis: { label: { show: false } },
            data: data.payMethodData.map((d, i) => ({
              value: d.value,
              name: d.name,
              itemStyle: { color: ['#22c55e', '#3b82f6', '#94a3b8'][i] },
            })),
          },
        ],
      }
    : {};

  const columns = [
    { key: 'date', title: '日期', dataIndex: 'date' as const, width: '100px' },
    {
      key: 'orders',
      title: '订单数',
      align: 'right' as const,
      render: (row: any) => <span className="tabular-nums">{row.orders}</span>,
    },
    {
      key: 'users',
      title: '充值用户数',
      align: 'right' as const,
      render: (row: any) => <span className="tabular-nums">{row.users}</span>,
    },
    {
      key: 'revenue',
      title: '营收金额',
      align: 'right' as const,
      render: (row: any) => (
        <span className="font-medium text-emerald-600 tabular-nums">¥{row.revenue.toLocaleString()}</span>
      ),
    },
    {
      key: 'refunds',
      title: '退款金额',
      align: 'right' as const,
      render: (row: any) => (
        <span className="text-rose-500 tabular-nums">¥{row.refunds}</span>
      ),
    },
    {
      key: 'net',
      title: '净营收',
      align: 'right' as const,
      render: (row: any) => (
        <span className="font-semibold tabular-nums">¥{row.net.toLocaleString()}</span>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">营收统计</h1>
          <p className="text-sm text-muted-foreground mt-0.5">平台营收数据分析</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => toast.success('已导出（模拟）')}>
          <Download className="size-4 mr-1.5" />
          导出报表
        </Button>
      </div>

      {/* 核心指标 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="总营收"
          value={`¥${data?.totalRevenue.toLocaleString() || 0}`}
          trend={{ value: '+12.5%', up: true }}
          subtitle="较上月"
          icon={<DollarSign />}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />
        <StatCard
          title="本月营收"
          value={`¥${data?.monthRevenue.toLocaleString() || 0}`}
          trend={{ value: '+8.3%', up: true }}
          subtitle="较上月"
          icon={<TrendingUp />}
          iconBg="bg-indigo-100"
          iconColor="text-indigo-600"
        />
        <StatCard
          title="今日营收"
          value={`¥${data?.todayRevenue.toLocaleString() || 0}`}
          icon={<BarChart3 />}
          iconBg="bg-violet-100"
          iconColor="text-violet-600"
        />
        <StatCard
          title="平均客单价"
          value={`¥${data?.avgOrderValue || 0}`}
          trend={{ value: '+5.2%', up: true }}
          subtitle="较上月"
          icon={<Wallet />}
          iconBg="bg-amber-100"
          iconColor="text-amber-600"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="充值用户数"
          value={data?.payingUsers || 0}
          icon={<Users />}
          iconBg="bg-cyan-100"
          iconColor="text-cyan-600"
        />
        <StatCard
          title="充值订单数"
          value={data?.totalOrders || 0}
          icon={<ShoppingBag />}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />
        <StatCard
          title="退款金额"
          value={`¥${data?.refundAmount.toLocaleString() || 0}`}
          icon={<ArrowDownUp />}
          iconBg="bg-rose-100"
          iconColor="text-rose-600"
        />
        <StatCard
          title="净营收"
          value={`¥${data?.netRevenue.toLocaleString() || 0}`}
          icon={<DollarSign />}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />
      </div>

      {/* 营收趋势图 */}
      <Card className="border border-border/50">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">营收趋势</CardTitle>
            <p className="text-xs text-muted-foreground">营收金额与订单数趋势</p>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="day" className="text-xs h-7 px-3">按日</TabsTrigger>
              <TabsTrigger value="week" className="text-xs h-7 px-3">按周</TabsTrigger>
              <TabsTrigger value="month" className="text-xs h-7 px-3">按月</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-[320px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ReactECharts option={revenueOption} className="h-[320px]" />
          )}
        </CardContent>
      </Card>

      {/* 分布图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PieChartIcon className="size-4 text-indigo-500" />
              套餐销售分布
            </CardTitle>
            <p className="text-xs text-muted-foreground">各套餐销售金额占比</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={packageOption} className="h-[280px]" />
          </CardContent>
        </Card>

        <Card className="border border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PieChartIcon className="size-4 text-violet-500" />
              支付方式分布
            </CardTitle>
            <p className="text-xs text-muted-foreground">各支付方式使用占比</p>
          </CardHeader>
          <CardContent>
            <ReactECharts option={payOption} className="h-[280px]" />
          </CardContent>
        </Card>
      </div>

      {/* 每日明细 */}
      <Card className="border border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">每日营收明细</CardTitle>
          <p className="text-xs text-muted-foreground">最近30天每日营收详情</p>
        </CardHeader>
        <CardContent className="p-0 pt-4">
          <div className="px-1">
            {data && (
              <AdminDataTable
                columns={columns}
                data={[...data.dailyData].reverse()}
                total={data.dailyData.length}
                page={1}
                pageSize={10}
                onPageChange={() => {}}
                rowKey={(row: any) => row.date}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
