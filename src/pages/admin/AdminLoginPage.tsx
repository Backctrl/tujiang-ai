import { useState, type FormEvent, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminAuthProvider, useAdminAuth } from '@/context/AdminAuthContext';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

function AdminLoginForm() {
  const [email, setEmail] = useState('admin@tujiang.ai');
  const [password, setPassword] = useState('Admin123456');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isLoggedIn } = useAdminAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.warning('请输入邮箱和密码');
      return;
    }

    setIsSubmitting(true);
    try {
      const ok = await login({ email, password });
      if (ok) {
        navigate('/admin/dashboard', { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 relative overflow-hidden">
      {/* 背景装饰 */}
      <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-500/5 rounded-full blur-3xl" />

      {/* 网格纹理 */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md px-6"
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="size-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center text-lg font-bold shadow-xl shadow-indigo-500/20">
            <Shield className="size-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">图匠AI · 管理后台</div>
            <div className="text-xs text-slate-400">Admin Console</div>
          </div>
        </div>

        <Card className="border-slate-700/50 bg-slate-900/80 backdrop-blur-sm shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-bold text-white">管理员登录</CardTitle>
            <p className="text-sm text-slate-400 mt-1">
              请使用管理员账号登录管理后台
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-300">
                  管理员邮箱 / 用户名
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                  <Input
                    id="email"
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@tujiang.ai"
                    className="pl-10 h-11 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-slate-300">
                  密码
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className="pl-10 pr-10 h-11 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:border-indigo-500"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white shadow-lg shadow-indigo-500/20"
                disabled={isSubmitting}
              >
                {isSubmitting && (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                )}
                {isSubmitting ? '登录中...' : '登 录'}
              </Button>

              <div className="text-center text-xs text-slate-500 pt-2">
                <div className="mb-1">演示账号：admin@tujiang.ai / Admin123456</div>
                <Link
                  to="/login"
                  className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1"
                >
                  返回前台登录 →
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <AdminAuthProvider>
      <AdminLoginForm />
    </AdminAuthProvider>
  );
}
