import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Eye, EyeOff, Lock, Mail, User, Phone, CheckCircle2, AlertCircle, ShieldCheck, ArrowLeft, RefreshCw, KeyRound, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
  firstName?: string;
  role?: string;
  studentId?: string;
  department?: string;
  batch?: string;
  phone?: string;
  status?: string;
  pinSet?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  loginWithRedirect: (opts?: { initialView?: string; redirectUrl?: string }) => void;
  logout: (opts?: { returnTo?: string }) => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  loginWithRedirect: () => {},
  logout: () => {},
  token: null,
});

function evaluatePasswordStrength(pass: string) {
  let score = 0;
  if (!pass) return { score: 0, label: 'None', color: 'bg-border' };
  if (pass.length >= 8) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[a-z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;

  if (score <= 2) return { score: 1, label: 'Weak', color: 'bg-destructive' };
  if (score === 3) return { score: 2, label: 'Medium', color: 'bg-amber-500' };
  if (score === 4) return { score: 3, label: 'Strong', color: 'bg-emerald-500' };
  return { score: 4, label: 'Very Strong', color: 'bg-primary' };
}

const DEPARTMENTS = ['CSE', 'EEE', 'BBA', 'Pharmacy', 'English', 'Law', 'Economics', 'Sociology'];
const BATCHES = ['2022', '2023', '2024', '2025', '2026'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [authView, setAuthView] = useState<'login' | 'signup' | 'forgot' | 'verify-register' | 'verify-forgot'>('login');

  // Form inputs
  const [emailOrStudentId, setEmailOrStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('CSE');
  const [batch, setBatch] = useState('2023');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptTerms, setAcceptTerms] = useState(true);

  // OTP state
  const [otpCode, setOtpCode] = useState('');
  const [otpId, setOtpId] = useState('');
  const [timerSeconds, setTimerSeconds] = useState(300);

  const [error, setError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('auth_user');
    if (saved && savedUser) {
      setToken(saved);
      setUser(JSON.parse(savedUser));
    }
    setIsLoading(false);
  }, []);

  // OTP countdown timer
  useEffect(() => {
    if ((authView === 'verify-register' || authView === 'verify-forgot') && timerSeconds > 0) {
      const interval = setInterval(() => setTimerSeconds(prev => prev - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [authView, timerSeconds]);

  const loginWithRedirect = useCallback((opts?: { initialView?: string; redirectUrl?: string }) => {
    setAuthView(opts?.initialView === 'signup' ? 'signup' : 'login');
    setShowAuth(true);
    setError('');
  }, []);

  const logout = useCallback((opts?: { returnTo?: string }) => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    setToken(null);
    if (opts?.returnTo) window.location.href = opts.returnTo;
  }, []);

  // Auto studentId calculation
  const computedStudentId = emailOrStudentId.includes('@')
    ? (emailOrStudentId.split('@')[0].match(/^\d{4}-\d-\d{2}-\d{3}$/) ? emailOrStudentId.split('@')[0] : emailOrStudentId.split('@')[0])
    : emailOrStudentId;

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrStudentId, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Login failed');

      if (rememberMe) {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
      }
      setToken(data.token);
      setUser(data.user);
      setShowAuth(false);
      toast.success(`Welcome back, ${data.user.fullName || 'Student'}!`);
    } catch (err: any) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setFormLoading(false);
    }
  };

  // Step 1: Send Registration OTP
  const handleRegisterOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const lower = emailOrStudentId.toLowerCase().trim();
    if (!lower.endsWith('@std.ewubd.edu')) {
      setError('Registration is restricted to @std.ewubd.edu email addresses only.');
      return;
    }

    const strength = evaluatePasswordStrength(password);
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!acceptTerms) {
      setError('Please accept the Terms & Conditions.');
      return;
    }

    setFormLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/register-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lower }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to send OTP');

      setOtpId(data.otpId);
      setTimerSeconds(300);
      setAuthView('verify-register');
      toast.success(`OTP sent to ${lower}`);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setFormLoading(false);
    }
  };

  // Step 2: Complete Registration with OTP
  const handleCompleteRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6) {
      setError('Please enter the 6-digit OTP code sent to your email.');
      return;
    }
    setFormLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailOrStudentId.toLowerCase().trim(),
          password,
          fullName,
          phone,
          department,
          batch,
          studentId: computedStudentId,
          otpCode,
          otpId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verification failed');

      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setShowAuth(false);
      toast.success('Account created successfully! Welcome to Smart Campus.');
    } catch (err: any) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setFormLoading(false);
    }
  };

  // Forgot Password: Request OTP
  const handleForgotOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOrStudentId) {
      setError('Please enter your EWU Email or Student ID.');
      return;
    }
    setFormLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: emailOrStudentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'User not found');

      setOtpId(data.otpId);
      setTimerSeconds(300);
      setAuthView('verify-forgot');
      toast.success(`OTP sent to ${data.email}`);
    } catch (err: any) {
      setError(err.message || 'Request failed');
    } finally {
      setFormLoading(false);
    }
  };

  // Forgot Password: Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.length !== 6) {
      setError('Please enter the 6-digit OTP code.');
      return;
    }
    if (password.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setFormLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/auth/forgot-password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otpId, code: otpCode, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Reset failed');

      toast.success(data.message || 'Password reset successful!');
      setAuthView('login');
      setPassword('');
      setConfirmPassword('');
      setOtpCode('');
    } catch (err: any) {
      setError(err.message || 'Password reset failed');
    } finally {
      setFormLoading(false);
    }
  };

  const passwordStrength = evaluatePasswordStrength(password);

  if (showAuth && !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
        {/* Glow ambient background */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[500px] bg-primary/10 rounded-full blur-[140px]" />
          <div className="absolute bottom-10 right-10 w-[400px] h-[300px] bg-secondary/5 rounded-full blur-[100px]" />
        </div>

        <div className="w-full max-w-lg relative z-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-strong rounded-3xl p-6 sm:p-8 border border-border/80 shadow-2xl space-y-6"
          >
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center shadow-xl shadow-primary/20 mx-auto">
                <GraduationCap className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-foreground">Smart Campus</h1>
                <p className="text-xs font-medium text-primary tracking-wide uppercase mt-0.5">East West University Wallet</p>
              </div>
            </div>

            {/* View Switcher Tabs */}
            {(authView === 'login' || authView === 'signup') && (
              <div className="flex bg-accent/60 p-1 rounded-xl border border-border/60">
                <button
                  type="button"
                  onClick={() => { setAuthView('login'); setError(''); }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${
                    authView === 'login' ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthView('signup'); setError(''); }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${
                    authView === 'signup' ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Register Student
                </button>
              </div>
            )}

            {/* Error banner */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl bg-destructive/10 border border-destructive/20 p-3.5 flex items-start gap-2.5 text-xs font-medium text-destructive"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* LOGIN FORM */}
            {authView === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                    EWU Email OR Student ID
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      required
                      value={emailOrStudentId}
                      onChange={e => setEmailOrStudentId(e.target.value)}
                      placeholder="e.g. 2023-2-60-053@std.ewubd.edu"
                      className="w-full h-11 rounded-xl bg-accent/40 border border-border/60 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setAuthView('forgot'); setError(''); }}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-11 rounded-xl bg-accent/40 border border-border/60 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-3.5 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={e => setRememberMe(e.target.checked)}
                      className="rounded border-border bg-accent text-primary focus:ring-primary/20"
                    />
                    Remember Me
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={formLoading}
                  className="w-full h-12 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {formLoading ? 'Signing In...' : 'Sign In to Wallet'}
                </button>
              </form>
            )}

            {/* REGISTRATION FORM */}
            {authView === 'signup' && (
              <form onSubmit={handleRegisterOtpRequest} className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3.5" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      placeholder="e.g. Tanvir Ahmed"
                      className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                    EWU Student Email <span className="text-primary font-normal text-[11px]">(Must end with @std.ewubd.edu)</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3.5" />
                    <input
                      type="email"
                      required
                      value={emailOrStudentId}
                      onChange={e => setEmailOrStudentId(e.target.value)}
                      placeholder="2023-2-60-053@std.ewubd.edu"
                      className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-mono"
                    />
                  </div>
                  {computedStudentId && (
                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-primary" /> Auto Student ID: <span className="font-mono text-primary font-bold">{computedStudentId}</span>
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Department</label>
                    <select
                      value={department}
                      onChange={e => setDepartment(e.target.value)}
                      className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                      {DEPARTMENTS.map(d => <option key={d} value={d} className="bg-popover text-foreground">{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Batch</label>
                    <select
                      value={batch}
                      onChange={e => setBatch(e.target.value)}
                      className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                      {BATCHES.map(b => <option key={b} value={b} className="bg-popover text-foreground">{b}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Phone Number</label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3.5" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      placeholder="01700000000"
                      className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min 8 chars, 1 Upper, 1 Special"
                      className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-3.5 text-muted-foreground">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Strength bar */}
                  {password && (
                    <div className="mt-1.5 space-y-1">
                      <div className="flex gap-1 h-1.5 w-full bg-accent rounded-full overflow-hidden">
                        {[1, 2, 3, 4].map(idx => (
                          <div
                            key={idx}
                            className={`flex-1 transition-all ${idx <= passwordStrength.score ? passwordStrength.color : 'bg-transparent'}`}
                          />
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground flex justify-between">
                        <span>Strength: <strong className="text-foreground">{passwordStrength.label}</strong></span>
                        <span>8+ chars, A-z, 0-9, #!</span>
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Confirm Password</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={e => setAcceptTerms(e.target.checked)}
                    className="rounded border-border bg-accent text-primary focus:ring-primary/20"
                  />
                  I agree to the Terms of Service & Campus Privacy Policy
                </label>

                <button
                  type="submit"
                  disabled={formLoading}
                  className="w-full h-11 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {formLoading ? 'Sending OTP...' : 'Continue — Send Email OTP'}
                </button>
              </form>
            )}

            {/* OTP VERIFICATION STEP (REGISTRATION) */}
            {authView === 'verify-register' && (
              <form onSubmit={handleCompleteRegister} className="space-y-5">
                <div className="text-center space-y-1 bg-accent/30 p-4 rounded-2xl border border-border/60">
                  <Mail className="w-8 h-8 text-primary mx-auto mb-2" />
                  <h3 className="text-sm font-bold text-foreground">Verify Your EWU Email</h3>
                  <p className="text-xs text-muted-foreground">
                    We sent a 6-digit OTP code to <span className="font-mono font-bold text-primary">{emailOrStudentId}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Expires in: <strong className="font-mono text-amber-500">{Math.floor(timerSeconds / 60)}:{String(timerSeconds % 60).padStart(2, '0')}</strong>
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block text-center mb-2">
                    Enter 6-Digit OTP Code
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full h-14 text-center font-mono text-3xl tracking-[12px] font-black rounded-2xl bg-accent/50 border border-border/80 focus:border-primary text-foreground"
                  />
                </div>

                <button
                  type="submit"
                  disabled={formLoading || otpCode.length !== 6}
                  className="w-full h-12 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {formLoading ? 'Verifying...' : 'Verify OTP & Create Account'}
                </button>

                <div className="flex justify-between items-center text-xs">
                  <button
                    type="button"
                    onClick={() => { setAuthView('signup'); setError(''); }}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to Form
                  </button>
                  <button
                    type="button"
                    onClick={handleRegisterOtpRequest}
                    disabled={timerSeconds > 240}
                    className="text-primary font-semibold hover:underline disabled:opacity-50"
                  >
                    Resend Code
                  </button>
                </div>
              </form>
            )}

            {/* FORGOT PASSWORD FORM */}
            {authView === 'forgot' && (
              <form onSubmit={handleForgotOtpRequest} className="space-y-4">
                <div className="text-center space-y-1">
                  <KeyRound className="w-8 h-8 text-primary mx-auto mb-2" />
                  <h3 className="text-sm font-bold text-foreground">Reset Password</h3>
                  <p className="text-xs text-muted-foreground">Enter your registered EWU Email or Student ID</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                    Email OR Student ID
                  </label>
                  <input
                    type="text"
                    required
                    value={emailOrStudentId}
                    onChange={e => setEmailOrStudentId(e.target.value)}
                    placeholder="2023-2-60-053@std.ewubd.edu"
                    className="w-full h-11 rounded-xl bg-accent/40 border border-border/60 px-4 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:border-primary"
                  />
                </div>

                <button
                  type="submit"
                  disabled={formLoading}
                  className="w-full h-11 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {formLoading ? 'Sending...' : 'Send Password Reset OTP'}
                </button>

                <button
                  type="button"
                  onClick={() => { setAuthView('login'); setError(''); }}
                  className="w-full text-center text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center justify-center gap-1 pt-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
                </button>
              </form>
            )}

            {/* FORGOT PASSWORD — VERIFY & NEW PASSWORD */}
            {authView === 'verify-forgot' && (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="text-center space-y-1 bg-accent/30 p-3.5 rounded-2xl border border-border/60">
                  <KeyRound className="w-6 h-6 text-primary mx-auto mb-1" />
                  <h3 className="text-sm font-bold text-foreground">Enter OTP & New Password</h3>
                  <p className="text-xs text-muted-foreground">Code sent to your email</p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block text-center mb-1">
                    6-Digit OTP Code
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full h-12 text-center font-mono text-2xl tracking-[8px] font-black rounded-xl bg-accent/50 border border-border/80 focus:border-primary text-foreground"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">New Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 px-4 text-sm text-foreground focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full h-10 rounded-xl bg-accent/40 border border-border/60 px-4 text-sm text-foreground focus:border-primary"
                  />
                </div>

                <button
                  type="submit"
                  disabled={formLoading || otpCode.length !== 6}
                  className="w-full h-11 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {formLoading ? 'Resetting...' : 'Update Password & Sign In'}
                </button>
              </form>
            )}

            {/* Footer info */}
            <div className="pt-2 border-t border-border/40 text-center">
              <p className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                Bank-Grade 256-bit SSL Encryption · EWU Campus Network
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, loginWithRedirect, logout, token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
