import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, User, CheckCircle, Sparkles, Wand2, Palette, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { authService } from '@/services/authService';
import { UniversalLink } from '@lark-apaas/client-toolkit-lite';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  // 密码强度计算
  const passwordStrength = (() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[a-zA-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    return score;
  })();

  const strengthLabel = ['太弱', '较弱', '一般', '较强', '很强'][passwordStrength];
  const strengthColor = [
    'bg-destructive',
    'bg-warning',
    'bg-warning',
    'bg-success/70',
    'bg-success',
  ][passwordStrength];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!email || !nickname || !password || !confirmPassword) {
      toast.warning('请填写所有字段');
      return;
    }

    if (!authService.validateEmail(email)) {
      toast.error('邮箱格式不正确');
      return;
    }

    if (nickname.length < 2 || nickname.length > 20) {
      toast.error('昵称长度需在2-20字符之间');
      return;
    }

    if (password.length < 8) {
      toast.error('密码至少8位');
      return;
    }
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      toast.error('密码必须包含字母和数字');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }

    if (!agreed) {
      toast.warning('请阅读并同意用户协议和隐私政策');
      return;
    }

    setIsSubmitting(true);
    try {
      const ok = await register({ email, nickname, password });
      if (ok) {
        navigate('/', { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-300/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-purple-300/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

      <div className="relative z-10 w-full flex">
        {/* 左侧品牌展示区 */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12">
          <div>
            <Link to="/register" className="flex items-center gap-3">
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
                立即开启
                <br />
                <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  AI 电商创意之旅
                </span>
              </h1>
              <p className="text-muted-foreground text-lg">
                注册即送 500 积分，免费体验全部 AI 生图功能
              </p>
            </div>

            <div className="space-y-3">
              {[
                '5 步生成全套电商主图 + 详情页',
                '一键克隆竞品爆款风格',
                '12+ 专业风格模板覆盖全品类',
                '支持批量生成，效率提升 10 倍',
              ].map((item, i) => (
                <motion.div
                  key={item}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.08 }}
                  className="flex items-center gap-3"
                >
                  <div className="size-6 rounded-full bg-white/80 flex items-center justify-center text-primary">
                    <CheckCircle className="size-4" />
                  </div>
                  <span className="text-sm text-foreground">{item}</span>
                </motion.div>
              ))}
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
                <CardTitle className="text-2xl font-bold">创建账号</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  注册即送 <span className="text-primary font-semibold">500</span> 积分
                </p>
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
                    <Label htmlFor="nickname" className="text-sm font-medium">
                      昵称
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="nickname"
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="请输入昵称（2-20字符）"
                        className="pl-10 h-11"
                        autoComplete="nickname"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-medium">
                      密码
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="至少8位，含字母和数字"
                        className="pl-10 pr-10 h-11"
                        autoComplete="new-password"
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
                    {password && (
                      <div className="space-y-1">
                        <div className="flex gap-1">
                          {[0, 1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className={`h-1 flex-1 rounded-full transition-colors ${
                                i < passwordStrength ? strengthColor : 'bg-muted'
                              }`}
                            />
                          ))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          密码强度：{strengthLabel}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-sm font-medium">
                      确认密码
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="请再次输入密码"
                        className="pl-10 pr-10 h-11"
                        autoComplete="new-password"
                      />
                    </div>
                    {confirmPassword && password !== confirmPassword && (
                      <div className="text-xs text-destructive">两次输入的密码不一致</div>
                    )}
                  </div>

                  <div className="flex items-start gap-2 pt-1">
                    <Checkbox
                      id="agree"
                      checked={agreed}
                      onCheckedChange={(v) => setAgreed(v === true)}
                    />
                    <Label
                      htmlFor="agree"
                      className="text-xs text-muted-foreground cursor-pointer leading-5"
                    >
                      我已阅读并同意{' '}
                      <UniversalLink to="#" className="text-primary hover:underline">
                        《用户协议》
                      </UniversalLink>{' '}
                      和{' '}
                      <UniversalLink to="#" className="text-primary hover:underline">
                        《隐私政策》
                      </UniversalLink>
                    </Label>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-11 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-md"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    ) : null}
                    {isSubmitting ? '注册中...' : '注册账号'}
                  </Button>

                  <div className="text-center text-sm text-muted-foreground pt-2">
                    已有账号？{' '}
                    <Link to="/login" className="text-primary hover:underline font-medium">
                      立即登录
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
