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
} from '@/components/ui/sidebar';
import {
  LayoutDashboard,
  Image,
  Copy,
  Sparkles,
  Palette,
  Wrench,
  History,
  Wallet,
  Coins,
  User,
  LogOut,
  Settings,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Image as UIImage } from '@/components/ui/image';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { path: '/', label: '工作台', icon: LayoutDashboard, badge: false },
  { path: '/masterplan', label: 'AI主图详情全案', icon: Image, badge: true },
  { path: '/clone', label: 'AI克隆大师', icon: Copy, badge: false },
  { path: '/create', label: 'AI创图工坊', icon: Sparkles, badge: false },
  { path: '/style-library', label: '风格库', icon: Palette, badge: false },
  { path: '/tools', label: 'AI工具箱', icon: Wrench, badge: false },
  { path: '/history', label: '历史记录', icon: History, badge: false },
  { path: '/wallet', label: '钱包', icon: Wallet, badge: false },
];

export default function AppSidebar() {
  const { pathname } = useLocation();
  const { user, isLoggedIn, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50">
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-3 group-data-[state=collapsed]:justify-center">
          <div className="size-9 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-primary-foreground flex items-center justify-center text-sm font-bold shadow-md">
            图匠
          </div>
          <div className="flex-1 min-w-0 group-data-[state=collapsed]:hidden">
            <div className="text-base font-bold tracking-tight">图匠AI</div>
            <div className="text-xs text-muted-foreground">电商生图专家</div>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="p-2">
          <SidebarMenu>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.path === '/'
                  ? pathname === '/'
                  : pathname === item.path || pathname.startsWith(`${item.path}/`);
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild tooltip={item.label} isActive={isActive}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className="flex items-center gap-3"
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="group-data-[state=collapsed]:hidden text-sm flex items-center gap-1.5">
                        {item.label}
                        {item.badge && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white text-[9px] font-bold leading-none">
                            <span className="size-1 rounded-full bg-white animate-pulse" />
                            NEW
                          </span>
                        )}
                      </span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border">
        {isLoggedIn && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full">
                <div className="flex items-center gap-3 group-data-[state=collapsed]:justify-center group-data-[state=collapsed]:px-0 cursor-pointer hover:bg-sidebar-accent/50 rounded-md p-1.5 -m-1.5">
                  <UIImage
                    src={user.avatar}
                    alt="用户头像"
                    className="size-8 shrink-0 rounded-full object-cover ring-2 ring-sidebar-primary/20"
                  />
                  <div className="flex-1 min-w-0 group-data-[state=collapsed]:hidden text-left">
                    <div className="text-sm font-medium truncate">{user.nickname}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Coins className="size-3 text-amber-500" />
                      <span className="tabular-nums font-medium text-amber-600">
                        {user.credits.toLocaleString()}
                      </span>
                      <span>积分</span>
                    </div>
                  </div>
                  <ChevronUp className="size-3.5 text-muted-foreground group-data-[state=collapsed]:hidden" />
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <div className="flex items-center gap-2 p-2 border-b border-border/40">
                <UIImage
                  src={user.avatar}
                  alt={user.nickname}
                  className="size-8 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{user.nickname}</div>
                  <div className="text-xs text-muted-foreground truncate">{user.email}</div>
                </div>
              </div>
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="size-4 mr-2" />
                个人中心
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/wallet')}>
                <Wallet className="size-4 mr-2" />
                我的钱包
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <Settings className="size-4 mr-2" />
                设置
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
        ) : (
          <div className="group-data-[state=collapsed]:hidden">
            <Button
              onClick={() => navigate('/login')}
              className="w-full h-9 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-sm"
            >
              登录 / 注册
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
