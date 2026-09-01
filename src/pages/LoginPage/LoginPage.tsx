import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Sparkles, Wand2, Palette, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

export default function LoginPage() {
  const [email, setEmail] = useState('demo@tujiang.ai');
  const [password, setPassword] = useState('Demo123456');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string } | null)?.from || '/';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.warning('请输入邮箱和密码');
      return;
    }

    setIsSubmitting(true);
    try {
      const ok = await login({ email, password, remember });
      if (ok) {
        navigate(from, { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const fillDemo = () => {
    setEmail('demo@tujiang.ai');
    setPassword('Demo123456');
  };

  return (
    <div className="min-h-screen w-full flex bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-300/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-purple-300/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

      <div className="relative z-10 w-full flex">
        {/* 左侧品牌展示区 */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12">
          <div>
            <Link to="/login" className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-base font-bold shadow-lg">
                图匠
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">图匠AI</div>
                <div className="text-xs text-muted-foreground">电商生图专家</div>
              </div>
            </Link>
          </div>

          <div className="space-y-8">
            <div>
              <h1 className="text-4xl font-bold text-foreground leading-tight mb-4">
                AI驱动的
                <br />
                <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  电商创意生产平台
                </span>
              </h1>
              <p className="text-muted-foreground text-lg">
                一键生成高质量商品主图和详情页，让上新效率提升 10 倍
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Wand2, title: 'AI主图详情全案', desc: '5步快速生成全套视觉素材' },
                { icon: Image, title: 'AI克隆大师', desc: '竞品参考一键复刻自家产品' },
                { icon: Palette, title: '12+ 风格模板', desc: '覆盖全品类专业摄影风格' },
                { icon: Sparkles, title: 'AI创图工坊', desc: '文生图 / 图生图自由创作' },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.1 }}
                    className="bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-white/80 shadow-sm"
                  >
                    <div className="size-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 text-white flex items-center justify-center mb-3">
                      <Icon className="size-5" />
                    </div>
                    <div className="font-semibold text-sm text-foreground">{item.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            © 2024 图匠AI · 电商创意生产平台
          </div>
        </div>

        {/* 右侧表单区 */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-md"
          >
            {/* 移动端 Logo */}
            <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
              <div className="size-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-base font-bold shadow-lg">
                图匠
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">图匠AI</div>
                <div className="text-xs text-muted-foreground">电商生图专家</div>
              </div>
            </div>

            <Card className="border-border/60 shadow-xl bg-white/90 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-2xl font-bold">欢迎回来</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">登录你的图匠AI账号</p>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium">
                      邮箱
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="请输入邮箱地址"
                        className="pl-10 h-11"
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-sm font-medium">
                        密码
                      </Label>
                      <Link
                        to="/forgot-password"
                        className="text-xs text-primary hover:underline"
                      >
                        忘记密码？
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="请输入密码"
                        className="pl-10 pr-10 h-11"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="remember"
                        checked={remember}
                        onCheckedChange={(v) => setRemember(v === true)}
                      />
                      <Label
                        htmlFor="remember"
                        className="text-xs text-muted-foreground cursor-pointer"
                      >
                        记住我
                      </Label>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-md"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    ) : null}
                    {isSubmitting ? '登录中...' : '登录'}
                  </Button>

                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white/90 px-3 text-xs text-muted-foreground">
                        演示账号
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full h-10 text-sm"
                    onClick={fillDemo}
                  >
                    一键填充演示账号
                  </Button>

                  <div className="text-center text-sm text-muted-foreground pt-2">
                    还没有账号？{' '}
                    <Link to="/register" className="text-primary hover:underline font-medium">
                      立即注册
                    </Link>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
