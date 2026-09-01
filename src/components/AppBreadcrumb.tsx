import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Home, Bell, Coins, Plus, User } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useAuth } from '@/context/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Image as UIImage } from '@/components/ui/image';
import { Wallet, Settings, LogOut } from 'lucide-react';

const PATH_MAP: Record<string, string> = {
  '': '工作台',
  masterplan: 'AI主图详情全案',
  clone: 'AI克隆大师',
  create: 'AI创图工坊',
  tools: 'AI工具箱',
  'style-library': '风格库',
  history: '历史记录',
  wallet: '钱包',
  profile: '个人中心',
};

export default function AppBreadcrumb() {
  const location = useLocation();
  const { user, isLoggedIn, logout } = useAuth();
  const navigate = useNavigate();
  const segments = location.pathname.split('/').filter(Boolean);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex items-center justify-between h-14 px-6 border-b border-border/40 bg-background/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="size-8 hover:bg-accent rounded-md" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                href="/"
                className="text-xs flex items-center gap-1 hover:text-foreground"
              >
                <Home className="size-3" />
                工作台
              </BreadcrumbLink>
            </BreadcrumbItem>
            {segments.map((seg, i) => {
              const isLast = i === segments.length - 1;
              const label = PATH_MAP[seg] || seg;
              const path = '/' + segments.slice(0, i + 1).join('/');
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
        {isLoggedIn && user && (
          <>
            {/* 积分余额 */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/wallet')}
              className="h-8 gap-1.5 text-xs"
            >
              <Coins className="size-3.5 text-amber-500" />
              <span className="font-semibold tabular-nums text-amber-600">
                {user.credits.toLocaleString()}
              </span>
              <Plus className="size-3 text-muted-foreground" />
            </Button>

            {/* 通知 */}
            <Button variant="ghost" size="icon" className="size-8">
              <Bell className="size-4" />
            </Button>

            {/* 用户头像下拉 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="size-8 rounded-full overflow-hidden ring-2 ring-primary/10 hover:ring-primary/30 transition-all">
                  <UIImage src={user.avatar} alt={user.nickname} className="w-full h-full object-cover" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="flex items-center gap-2 p-2 border-b border-border/40">
                  <UIImage
                    src={user.avatar}
                    alt={user.nickname}
                    className="size-9 rounded-full object-cover"
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
          </>
        )}
      </div>
    </div>
  );
}
