import { useState, useEffect, useMemo } from 'react';
import {
  Image as ImageIcon,
  Copy,
  Sparkles,
  Wrench,
  Coins,
  TrendingUp,
  TrendingDown,
  Clock,
  Wallet,
  ArrowRight,
  Palette,
  ImageIcon as PhotoIcon,
  Zap,
  DollarSign,
  BarChart3,
  History,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useCredits } from '@/hooks/use-credits';
import { MOCK_STYLES } from '@/data/styles';
import { PRODUCT_IMAGES } from '@/data/history';
import { cn } from '@/lib/utils';
import { Image } from '@/components/ui/image';

const QUICK_ACTIONS = [
  {
    path: '/masterplan',
    title: 'AI主图详情全案',
    description: '5步向导，一键生成完整商品详情',
    icon: ImageIcon,
    gradient: 'from-blue-500 to-indigo-600',
    badge: '热门',
  },
  {
    path: '/clone',
    title: 'AI克隆大师',
    description: '参考竞品图，快速生成自家产品图',
    icon: Copy,
    gradient: 'from-purple-500 to-pink-600',
    badge: 'NEW',
  },
  {
    path: '/create',
    title: 'AI创图工坊',
    description: '文生图 / 图生图，自由创作',
    icon: Sparkles,
    gradient: 'from-orange-500 to-red-500',
    badge: '',
  },
  {
    path: '/tools',
    title: 'AI工具箱',
    description: '抠图 / 放大 / 换背景 / 修复',
    icon: Wrench,
    gradient: 'from-emerald-500 to-teal-600',
    badge: '',
  },
];

const STATS = [
  {
    label: '累计生成图片',
    value: 128,
    suffix: '张',
    change: '+12%',
    changeType: 'up',
    icon: PhotoIcon,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    label: '本月生成',
    value: 32,
    suffix: '张',
    change: '+8%',
    changeType: 'up',
    icon: Zap,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
  },
  {
    label: '节省设计费',
    value: 3840,
    prefix: '¥',
    change: '+15%',
    changeType: 'up',
    icon: DollarSign,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
  {
    label: '平均生成耗时',
    value: 8.6,
    suffix: '秒/张',
    change: '-0.8s',
    changeType: 'up',
    icon: Clock,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
];

const RECENT_ITEMS = [
  { id: '1', name: '北欧风沙发详情页', time: '10分钟前', count: 8, status: 'success', thumb: PRODUCT_IMAGES[0] },
  { id: '2', name: '蓝牙耳机主图6张', time: '30分钟前', count: 6, status: 'success', thumb: PRODUCT_IMAGES[1] },
  { id: '3', name: '护肤品详情页', time: '2小时前', count: 10, status: 'success', thumb: PRODUCT_IMAGES[2] },
  { id: '4', name: '连衣裙主图', time: '昨天', count: 4, status: 'success', thumb: PRODUCT_IMAGES[3] },
  { id: '5', name: '智能扫地机器人', time: '昨天', count: 6, status: 'success', thumb: PRODUCT_IMAGES[4] },
  { id: '6', name: '餐桌详情页克隆', time: '2天前', count: 5, status: 'success', thumb: PRODUCT_IMAGES[5] },
];

function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const duration = 1200;
    const startTime = Date.now();
    const startVal = 0;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(startVal + (value - startVal) * eased);
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [value]);

  const isInt = Number.isInteger(value);
  return (
    <span className="tabular-nums">
      {prefix}
      {isInt ? Math.round(display).toLocaleString() : display.toFixed(1)}
      {suffix}
    </span>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { credits } = useCredits();

  const [greeting, setGreeting] = useState('下午好');
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 6) setGreeting('凌晨好');
    else if (hour < 12) setGreeting('上午好');
    else if (hour < 14) setGreeting('中午好');
    else if (hour < 18) setGreeting('下午好');
    else setGreeting('晚上好');
  }, []);

  const todayGenerated = 5;
  const remainingCredits = Math.floor(credits / 20);

  const hotStyles = useMemo(() => MOCK_STYLES.slice(0, 6), []);

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* 顶部欢迎区 */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-6 md:p-8 text-white"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255_255_255_0.2),transparent_50%)]" />
          <div className="absolute -bottom-20 -right-20 size-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -top-16 -left-10 size-48 rounded-full bg-white/10 blur-3xl" />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">
                {greeting}，图匠用户 👋
              </h1>
              <p className="text-white/70 mt-2">今天也要高效出图哦</p>
            </div>

            <div className="flex items-center gap-4 bg-white/15 backdrop-blur-md rounded-2xl p-4 border border-white/20 min-w-[280px]">
              <div className="flex-1">
                <div className="text-xs text-white/70">积分余额</div>
                <div className="text-2xl font-bold flex items-center gap-1 mt-1">
                  <Coins className="size-5 text-amber-300" />
                  <AnimatedNumber value={credits} />
                </div>
                <div className="text-xs text-white/60 mt-1">
                  今日已生成 {todayGenerated} 张 · 还能生成约 {remainingCredits} 张
                </div>
              </div>
              <Button
                size="sm"
                className="bg-white text-purple-600 hover:bg-white/90 h-9"
                onClick={() => navigate('/wallet')}
              >
                <Wallet className="size-4 mr-1.5" />
                立即充值
              </Button>
            </div>
          </div>
        </motion.div>

        {/* 快捷功能区 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="size-5 text-primary" />
              快捷功能
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {QUICK_ACTIONS.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.path}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.4 }}
                >
                  <Card
                    className="overflow-hidden border-border/60 hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer group"
                    onClick={() => navigate(item.path)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div
                          className={cn(
                            'size-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-md',
                            item.gradient,
                          )}
                        >
                          <Icon className="size-6" />
                        </div>
                        {item.badge && (
                          <Badge
                            className={cn(
                              'text-[10px] font-bold',
                              item.badge === 'NEW'
                                ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white border-0'
                                : 'bg-blue-100 text-blue-700 border-0',
                            )}
                          >
                            {item.badge}
                          </Badge>
                        )}
                      </div>
                      <div className="font-semibold mt-4 text-base">{item.title}</div>
                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {item.description}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full mt-4 h-8 text-xs group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                      >
                        立即使用
                        <ArrowRight className="size-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* 数据统计区 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="size-5 text-primary" />
              使用统计
            </h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {STATS.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + i * 0.08, duration: 0.4 }}
                >
                  <Card className="border-border/60 hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className={`size-10 rounded-lg ${stat.bg} flex items-center justify-center`}>
                          <Icon className={cn('size-5', stat.color)} />
                        </div>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'text-[10px] font-medium h-5',
                            stat.changeType === 'up'
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                              : 'bg-rose-50 text-rose-600 border-rose-100',
                          )}
                        >
                          {stat.changeType === 'up' ? (
                            <TrendingUp className="size-3 mr-0.5" />
                          ) : (
                            <TrendingDown className="size-3 mr-0.5" />
                          )}
                          {stat.change}
                        </Badge>
                      </div>
                      <div className="mt-3">
                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                        <div className="text-2xl font-bold mt-1 text-foreground">
                          <AnimatedNumber
                            value={stat.value}
                            prefix={stat.prefix}
                            suffix={stat.suffix}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* 最近生成区 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <History className="size-5 text-primary" />
              最近生成
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/history')}
            >
              查看全部
              <ChevronRight className="size-4 ml-0.5" />
            </Button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 snap-x snap-mandatory">
            {RECENT_ITEMS.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.06, duration: 0.4 }}
                className="shrink-0 w-48 snap-start group cursor-pointer"
                onClick={() => navigate('/history')}
              >
                <Card className="overflow-hidden border-border/60 hover:border-primary/40 hover:shadow-md transition-all">
                  <div className="aspect-square relative overflow-hidden bg-muted">
                    <Image
                      src={item.thumb}
                      alt={item.name}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <Badge
                      variant="default"
                      className="absolute top-2 right-2 text-[10px] font-normal bg-emerald-500/90"
                    >
                      {item.status === 'success' ? '已完成' : '生成中'}
                    </Badge>
                  </div>
                  <CardContent className="p-3">
                    <div className="text-sm font-medium truncate">{item.name}</div>
                    <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                      <span>{item.time}</span>
                      <span className="flex items-center gap-1">
                        <PhotoIcon className="size-3" />
                        {item.count}张
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* 风格推荐区 */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Palette className="size-5 text-primary" />
              热门风格推荐
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/style-library')}
            >
              查看全部风格
              <ChevronRight className="size-4 ml-0.5" />
            </Button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 snap-x snap-mandatory">
            {hotStyles.map((style, i) => (
              <motion.div
                key={style.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + i * 0.06, duration: 0.4 }}
                className="shrink-0 w-40 snap-start group cursor-pointer"
                onClick={() => navigate('/style-library')}
              >
                <Card className="overflow-hidden border-border/60 hover:border-primary/40 hover:shadow-md transition-all">
                  <div className="aspect-square relative overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">
                    <Image
                      src={style.previewUrl}
                      alt={style.name}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <Button
                      size="sm"
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity h-7 text-xs shadow-md"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate('/');
                      }}
                    >
                      使用
                    </Button>
                  </div>
                  <CardContent className="p-3">
                    <div className="text-sm font-medium truncate">{style.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <BarChart3 className="size-3" />
                      {Math.floor(Math.random() * 20000 + 5000).toLocaleString()} 次使用
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
