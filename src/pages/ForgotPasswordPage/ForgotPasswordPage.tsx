import { useState, type FormEvent, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { authService } from '@/services/authService';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (countdown > 0) {
      timerRef.current = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [countdown]);

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    if (!email) {
      toast.warning('请输入邮箱');
      return;
    }
    if (!authService.validateEmail(email)) {
      toast.error('邮箱格式不正确');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await authService.sendVerificationCode(email);
      if (res.code === 0) {
        toast.success(res.message || '验证码已发送');
        setCountdown(60);
      } else {
        toast.error(res.message || '发送失败');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyAndReset(e: FormEvent) {
    e.preventDefault();

    if (!code || code.length !== 6) {
      toast.error('请输入6位验证码');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('密码至少8位');
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
      toast.error('密码必须包含字母和数字');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await authService.resetPassword({
        email,
        code,
        newPassword,
      });
      if (res.code === 0) {
        toast.success('密码重置成功，请重新登录');
        setTimeout(() => navigate('/login'), 1000);
      } else {
        toast.error(res.message || '重置失败');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 relative overflow-hidden p-6">
      <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-300/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-purple-300/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Logo */}
        <Link to="/login" className="flex items-center gap-3 mb-8 justify-center">
          <div className="size-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-base font-bold shadow-lg">
            图匠
          </div>
          <div>
            <div className="text-xl font-bold text-foreground">图匠AI</div>
            <div className="text-xs text-muted-foreground">电商生图专家</div>
          </div>
        </Link>

        <Card className="border-border/60 shadow-xl bg-white/90 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft className="size-3" />
              返回登录
            </Link>
            <CardTitle className="text-2xl font-bold">重置密码</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {step === 1 ? '输入注册邮箱，获取验证码' : '设置你的新密码'}
            </p>
          </CardHeader>
          <CardContent>
            {/* 步骤指示器 */}
            <div className="flex items-center gap-2 mb-6">
              {[1, 2].map((s) => (
                <div key={s} className="flex-1 flex items-center gap-2">
                  <div
                    className={`size-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      step >= s
                        ? 'bg-gradient-to-br from-indigo-500 to-purple-500 text-white'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step > s ? '✓' : s}
                  </div>
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all ${
                        step > s ? 'w-full' : 'w-0'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>

            {step === 1 && (
              <form onSubmit={handleSendCode} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    注册邮箱
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="请输入注册邮箱"
                      className="pl-10 h-11"
                      autoComplete="email"
                    />
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
                  {isSubmitting ? '发送中...' : '发送验证码'}
                </Button>

                {countdown > 0 && (
                  <div className="text-center text-xs text-muted-foreground">
                    验证码已发送，{countdown}s 后可重新发送
                  </div>
                )}

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type="text"
                      value={code}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setCode(v);
                        if (v.length === 6) setStep(2);
                      }}
                      placeholder="输入6位验证码"
                      className="h-11 text-center tracking-[0.5em] font-mono"
                      maxLength={6}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleSendCode as unknown as () => void}
                    disabled={countdown > 0 || isSubmitting}
                    className="h-11 px-4 shrink-0"
                  >
                    {countdown > 0 ? `${countdown}s` : '重新发送'}
                  </Button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={handleVerifyAndReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code2" className="text-sm font-medium">
                    验证码
                  </Label>
                  <Input
                    id="code2"
                    type="text"
                    value={code}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setCode(v);
                    }}
                    placeholder="6位验证码"
                    className="h-11 text-center tracking-[0.5em] font-mono"
                    maxLength={6}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-sm font-medium">
                    新密码
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="newPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="至少8位，含字母和数字"
                      className="pl-10 pr-10 h-11"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword2" className="text-sm font-medium">
                    确认新密码
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword2"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="请再次输入新密码"
                      className="pl-10 h-11"
                      autoComplete="new-password"
                    />
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
                  {isSubmitting ? '重置中...' : '确认重置'}
                </Button>

                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  ← 重新输入邮箱
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
