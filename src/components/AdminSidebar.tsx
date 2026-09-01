import { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  ShoppingCart,
  BarChart3,
  Undo2,
  Key,
  ScrollText,
  Plug,
  Palette,
  Image,
  Megaphone,
  Settings,
  CreditCard,
  Coins,
  Mail,
  Smartphone,
  Shield,
  UserCheck,
  ClipboardList,
  AlertTriangle,
  LogIn,
  Activity,
  LogOut,
  ChevronUp,
} from 'lucide-react';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { Image as UIImage } from '@/components/ui/image';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface MenuItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  group?: string;
}

const MENU_ITEMS: MenuItem[] = [
  // 数据概览
  { path: '/admin/dashboard', label: '仪表盘', icon: LayoutDashboard, group: '数据概览' },
  // 用户管理
  { path: '/admin/users', label: '用户列表', icon: Users, group: '用户管理' },
  { path: '/admin/feedback', label: '用户反馈', icon: MessageSquare, group: '用户管理' },
  // 订单营收
  { path: '/admin/orders', label: '订单管理', icon: ShoppingCart, group: '订单营收' },
  { path: '/admin/revenue', label: '营收统计', icon: BarChart3, group: '订单营收' },
  { path: '/admin/refunds', label: '退款管理', icon: Undo2, group: '订单营收' },
  // API管理
  { path: '/admin/api-keys', label: 'API密钥', icon: Key, group: 'API管理' },
  { path: '/admin/api-logs', label: '调用日志', icon: ScrollText, group: 'API管理' },
  { path: '/admin/services', label: '第三方服务', icon: Plug, group: 'API管理' },
  // 内容管理
  { path: '/admin/styles', label: '风格模板', icon: Palette, group: '内容管理' },
  { path: '/admin/cases', label: '案例展示', icon: Image, group: '内容管理' },
  { path: '/admin/announcements', label: '系统公告', icon: Megaphone, group: '内容管理' },
  // 系统设置
  { path: '/admin/settings/basic', label: '基础设置', icon: Settings, group: '系统设置' },
  { path: '/admin/settings/packages', label: '充值套餐', icon: CreditCard, group: '系统设置' },
  { path: '/admin/settings/points', label: '积分规则', icon: Coins, group: '系统设置' },
  { path: '/admin/settings/email-templates', label: '邮件模板', icon: Mail, group: '系统设置' },
  { path: '/admin/settings/sms-templates', label: '短信模板', icon: Smartphone, group: '系统设置' },
  // 权限管理
  { path: '/admin/admins', label: '管理员列表', icon: UserCheck, group: '权限管理' },
  { path: '/admin/roles', label: '角色管理', icon: Shield, group: '权限管理' },
  { path: '/admin/audit-logs', label: '操作日志', icon: ClipboardList, group: '权限管理' },
  // 系统监控
  { path: '/admin/error-logs', label: '错误日志', icon: AlertTriangle, group: '系统监控' },
  { path: '/admin/login-logs', label: '登录日志', icon: LogIn, group: '系统监控' },
  { path: '/admin/system-status', label: '系统状态', icon: Activity, group: '系统监控' },
];

const GROUPS = [
  '数据概览',
  '用户管理',
  '订单营收',
  'API管理',
  '内容管理',
  '系统设置',
  '权限管理',
  '系统监控',
];

export default function AdminSidebar() {
  const { pathname } = useLocation();
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();

  const groupedItems = useMemo(() => {
    const groups: Record<string, MenuItem[]> = {};
    for (const g of GROUPS) groups[g] = [];
    for (const item of MENU_ITEMS) {
      if (item.group && groups[item.group]) {
        groups[item.group].push(item);
      }
    }
    return groups;
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <Sidebar collapsible="icon" className="bg-slate-900 text-slate-200 border-r border-slate-800">
      <SidebarHeader className="px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3 group-data-[state=collapsed]:justify-center">
          <div className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center text-sm font-bold shadow-md">
            管
          </div>
          <div className="flex-1 min-w-0 group-data-[state=collapsed]:hidden">
            <div className="text-base font-bold text-white tracking-tight">图匠AI</div>
            <div className="text-xs text-slate-400">管理后台</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        {GROUPS.map((group) => (
          <SidebarGroup key={group} className="py-1">
            <SidebarGroupLabel className="px-4 text-[11px] uppercase tracking-wider text-slate-500 font-semibold group-data-[state=collapsed]:hidden">
              {group}
            </SidebarGroupLabel>
            <SidebarMenu>
              {groupedItems[group]?.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.path ||
                  (item.path !== '/admin/dashboard' && pathname.startsWith(item.path));
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.label}
                      isActive={isActive}
                      className="data-[active=true]:bg-indigo-600/20 data-[active=true]:text-indigo-300 hover:bg-slate-800/70 hover:text-white"
                    >
                      <NavLink
                        to={item.path}
                        end={item.path === '/admin/dashboard'}
                        className="flex items-center gap-3 text-slate-300"
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="group-data-[state=collapsed]:hidden text-sm">
                          {item.label}
                        </span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-slate-800">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full">
              <div className="flex items-center gap-3 group-data-[state=collapsed]:justify-center cursor-pointer hover:bg-slate-800/70 rounded-md p-1.5 -m-1.5 transition-colors">
                <UIImage
                  src={admin?.avatar || ''}
                  alt="管理员头像"
                  className="size-8 shrink-0 rounded-full object-cover ring-2 ring-indigo-500/30"
                />
                <div className="flex-1 min-w-0 group-data-[state=collapsed]:hidden text-left">
                  <div className="text-sm font-medium text-white truncate">
                    {admin?.nickname || '管理员'}
                  </div>
                  <div className="text-xs text-slate-400">
                    {admin?.isSuperAdmin ? '超级管理员' : '管理员'}
                  </div>
                </div>
                <ChevronUp className="size-3.5 text-slate-500 group-data-[state=collapsed]:hidden" />
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <div className="flex items-center gap-2 p-2 border-b border-border/40">
              <UIImage
                src={admin?.avatar || ''}
                alt={admin?.nickname || ''}
                className="size-8 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{admin?.nickname}</div>
                <div className="text-xs text-muted-foreground truncate">{admin?.email}</div>
              </div>
            </div>
            <DropdownMenuItem onClick={() => navigate('/')}>
              <LayoutDashboard className="size-4 mr-2" />
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
      </SidebarFooter>
    </Sidebar>
  );
}
