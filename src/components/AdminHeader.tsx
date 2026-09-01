import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Home, Search, Bell, LogOut, User, ExternalLink } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAdminAuth } from '@/context/AdminAuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Image as UIImage } from '@/components/ui/image';

const PATH_MAP: Record<string, string> = {
  '': '仪表盘',
  dashboard: '仪表盘',
  users: '用户列表',
  feedback: '用户反馈',
  orders: '订单管理',
  revenue: '营收统计',
  refunds: '退款管理',
  'api-keys': 'API密钥',
  'api-logs': '调用日志',
  services: '第三方服务',
  styles: '风格模板',
  cases: '案例展示',
  announcements: '系统公告',
  settings: '系统设置',
  basic: '基础设置',
  packages: '充值套餐',
  points: '积分规则',
  'email-templates': '邮件模板',
  'sms-templates': '短信模板',
  admins: '管理员列表',
  roles: '角色管理',
  'audit-logs': '操作日志',
  'error-logs': '错误日志',
  'login-logs': '登录日志',
  'system-status': '系统状态',
};

export default function AdminHeader() {
  const location = useLocation();
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();
  const segments = location.pathname.split('/').filter(Boolean).slice(1); // 去掉 'admin'

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="flex items-center justify-between h-14 px-6 border-b border-border/40 bg-background/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="size-8 hover:bg-accent rounded-md" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                href="/admin/dashboard"
                className="text-xs flex items-center gap-1 hover:text-foreground"
              >
                <Home className="size-3" />
                管理后台
              </BreadcrumbLink>
            </BreadcrumbItem>
            {segments.map((seg, i) => {
              const isLast = i === segments.length - 1;
              const label = PATH_MAP[seg] || seg;
              const path = '/admin/' + segments.slice(0, i + 1).join('/');
              return (
                <BreadcrumbItem key={path}>
                  <BreadcrumbSeparator>
                    <ChevronRight className="size-3" />
                  </BreadcrumbSeparator>
                  {isLast ? (
                    <BreadcrumbPage className="text-xs font-medium">{label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={path} className="text-xs hover:text-foreground">
                      {label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-64 hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="全局搜索..." className="pl-9 h-9 text-sm" />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/')}
          className="h-9 gap-1.5 text-xs"
        >
          <ExternalLink className="size-3.5" />
          进入前台
        </Button>

        <Button variant="ghost" size="icon" className="size-8">
          <Bell className="size-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="size-8 rounded-full overflow-hidden ring-2 ring-indigo-500/20 hover:ring-indigo-500/40 transition-all">
              <UIImage src={admin?.avatar || ''} alt={admin?.nickname || ''} className="w-full h-full object-cover" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="flex items-center gap-2 p-2 border-b border-border/40">
              <UIImage
                src={admin?.avatar || ''}
                alt={admin?.nickname || ''}
                className="size-9 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{admin?.nickname}</div>
                <div className="text-xs text-muted-foreground truncate">{admin?.email}</div>
              </div>
            </div>
            <DropdownMenuItem onClick={() => navigate('/')}>
              <ExternalLink className="size-4 mr-2" />
              进入前台
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="size-4 mr-2" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
