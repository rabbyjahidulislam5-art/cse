import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Eye, EyeOff, Lock, Mail, User, Phone, CheckCircle2, AlertCircle, ShieldCheck, ArrowLeft, RefreshCw, KeyRound, Sparkles, ShieldAlert } from 'lucide-react';
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { toast } from 'sonner';
import { getGoogleClientId, isValidGoogleClientId } from '@/lib/google-auth-config';
import { getAuthToken, setAuthToken, decodeTokenUserId } from '@/lib/auth-token';
import { getStoredToken, setStoredToken as saveToken, getStoredUser, setStoredUser as saveUser, clearStoredAuth, isPerTabAuthMode, setPerTabAuthMode } from '@/lib/auth-storage';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Module-scoped, not React state — api.ts (a plain fetch client, outside the component tree)
// calls this on any 401 so the tab that actually hit the expired/invalid token logs itself out
// and drops back to the login card. Each tab has its own JS module instance, so this never
// reaches across tabs — a session expiring in one tab has zero effect on any other open tab.
import { sessionEvents } from './session-events';
export { sessionEvents };

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
  mustChangePassword?: boolean;
  emailVerified?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  loginWithRedirect: (opts?: { initialView?: string; redirectUrl?: string }) => void;
  logout: (opts?: { returnTo?: string }) => void;
  token: string | null;
  // Patches the locally-cached user (e.g. clearing mustChangePassword/emailVerified after those
  // onboarding steps complete) without a full re-login — mirrors saveUser/setUser below.
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  loginWithRedirect: () => {},
  logout: () => {},
  token: null,
  updateUser: () => {},
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

function GoogleAuthDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border/60" />
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">or</span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.6 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 6.1 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.2-5.1l-6.6-5.4c-2 1.5-4.6 2.5-7.6 2.5-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.4C41.4 35.7 44 30.4 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// The client ID is baked in at Vite build time — checking on mount catches a build that never
// embedded it (missing env var in the hosting dashboard, or the browser serving a stale bundle
// from before the var was added) instead of silently rendering a broken button.
function useGoogleAuthConfig() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const clientId = getGoogleClientId();
    if (!clientId) {
      setReason('VITE_GOOGLE_CLIENT_ID is missing from this build. It was not set in the hosting provider\'s environment variables when the frontend was last built and deployed.');
      setStatus('error');
      return;
    }
    if (!isValidGoogleClientId(clientId)) {
      setReason('VITE_GOOGLE_CLIENT_ID is set but does not look like a valid Google OAuth client ID.');
      setStatus('error');
      return;
    }
    setStatus('ready');
  }, []);

  return { status, reason };
}

// Google's button takes a fixed pixel width (no %/auto) — measuring the actual card width here
// (capped at 400px, matching the max-w-lg auth card's content column) is what makes it match the
// Sign In button's width and stay responsive on mobile, instead of a hardcoded "320" clipping or
// leaving gutters on different screen sizes.
function useMeasuredWidth(max: number = 300) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(max);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(200, Math.min(max, Math.floor(el.getBoundingClientRect().width))));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [max]);

  return { ref, width };
}

function GoogleAuthButtonSkeleton() {
  return (
    <div className="h-10 w-full max-w-[300px] mx-auto rounded-full bg-accent/40 border border-border/50 animate-pulse flex items-center justify-center gap-2">
      <GoogleIcon className="w-4 h-4 opacity-40" />
      <div className="h-3 w-28 rounded bg-border/60" />
    </div>
  );
}

function GoogleAuthErrorButton({ reason }: { reason: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="h-10 w-full max-w-[300px] mx-auto rounded-full bg-[#131314] border border-[#8e918f] text-white text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-[#1b1b1b] transition-colors"
      >
        <GoogleIcon className="w-[18px] h-[18px]" />
        Continue with Google
      </button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-4.5 h-4.5 text-destructive" /> Google Sign-In Unavailable
            </DialogTitle>
            <DialogDescription>{reason}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Please use your Password or Wallet PIN instead, or contact support if this persists.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GoogleAuthButton({ onSuccess, loading }: { onSuccess: (r: CredentialResponse) => void; loading?: boolean }) {
  const { status, reason } = useGoogleAuthConfig();
  const { ref, width } = useMeasuredWidth(300);

  if (status === 'checking') return <GoogleAuthButtonSkeleton />;
  if (status === 'error') return <GoogleAuthErrorButton reason={reason} />;

  return (
    <div ref={ref} className={`flex justify-center w-full ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
      <GoogleLogin
        onSuccess={onSuccess}
        onError={() => toast.error('Google Sign-In failed. Please try again.')}
        theme="filled_black"
        shape="pill"
        size="large"
        text="continue_with"
        logo_alignment="center"
        width={width}
      />
    </div>
  );
}

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

  const [googleLoading, setGoogleLoading] = useState(false);

  const [error, setError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const [perTabMode, setPerTabMode] = useState(() => isPerTabAuthMode());

  useEffect(() => {
    const saved = getStoredToken();
    const savedUser = getStoredUser();
    if (saved && savedUser) {
      setAuthToken(saved);
      setToken(saved);
      setUser(savedUser);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (isPerTabAuthMode()) return; // Per-Tab Dev/Test Mode ignores cross-tab storage events
      if (e.key !== 'auth_token') return;
      const currentId = decodeTokenUserId(getAuthToken());

      if (!e.newValue) {
        const removedId = decodeTokenUserId(e.oldValue);
        if (!currentId || removedId === currentId) {
          setAuthToken(null);
          setUser(null);
          setToken(null);
        }
        return;
      }

      const incomingId = decodeTokenUserId(e.newValue);
      if (currentId && incomingId && currentId !== incomingId) return;

      setAuthToken(e.newValue);
      setToken(e.newValue);
      const newUser = getStoredUser();
      if (newUser) {
        setUser(newUser);
        setShowAuth(false);
        setError('');
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
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

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveUser(next);
      return next;
    });
  }, []);

  const logout = useCallback((opts?: { returnTo?: string }) => {
    clearStoredAuth();
    setAuthToken(null);
    setUser(null);
    setToken(null);
    if (opts?.returnTo) window.location.href = opts.returnTo;
  }, []);

  // Register this tab's session-expiry handler. See sessionEvents' comment above.
  useEffect(() => {
    sessionEvents.onExpire = () => {
      logout();
      toast.error('Your session has expired. Please sign in again.');
    };
    return () => { sessionEvents.onExpire = () => {}; };
  }, [logout]);

  // Auto studentId calculation
  const computedStudentId = emailOrStudentId.includes('@')
    ? (emailOrStudentId.split('@')[0].match(/^\d{4}-\d-\d{2}-\d{3}$/) ? emailOrStudentId.split('@')[0] : emailOrStudentId.split('@')[0])
    : emailOrStudentId;

  // Safe fetch helper to handle HTML/JSON responses gracefully
  const safeAuthCall = async (endpoint: string, body: Record<string, unknown>) => {
    try {
      const targetUrl = `${API_URL}${endpoint}`;
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          throw new Error('Backend URL is not connected to Vercel. Please go to Vercel Settings -> Environment Variables and add VITE_API_URL = (Your Render API URL).');
        } else {
          throw new Error('Backend server is not running on localhost. Please start the backend with "cd server && npm run dev".');
        }
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Request failed');
      return data;
    } catch (err: any) {
      if (err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
        if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          throw new Error('Cannot reach Render Backend server. Please verify your Render Backend URL in Vercel Environment Variables.');
        } else {
          throw new Error('Cannot connect to local backend (port 4000). Make sure to run "npm run dev" inside the server directory.');
        }
      }
      throw err;
    }
  };

  // Handle Login — Email/Student ID + (Password OR Wallet PIN, whichever matches)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setError('');
    try {
      const data = await safeAuthCall('/auth/login', { emailOrStudentId, password });
      // This tab's own session works either way — "Remember Me" only controls whether it's
      // *persisted* (so a later new tab/restart also picks it up), not whether this tab can use it.
      setAuthToken(data.token);
      saveToken(data.token);
      saveUser(data.user);
      setToken(data.token);
      setUser(data.user);
      setShowAuth(false);
      toast.success(`Welcome back, ${data.user.fullName || 'Student'}!`);
    } catch (err: any) {
      setError(err.message || 'Invalid Password or Wallet PIN.');
    } finally {
      setFormLoading(false);
    }
  };

  // Handle Google Sign-In / Sign-Up — restricted server-side to verified @std.ewubd.edu accounts.
  // Existing accounts (however they were created) are matched by verified email and signed in; new accounts are created automatically.
  const handleGoogleAuth = async (response: CredentialResponse) => {
    if (!response.credential) return;
    setGoogleLoading(true);
    setError('');
    try {
      const data = await safeAuthCall('/auth/google', { credential: response.credential });
      setAuthToken(data.token);
      saveToken(data.token);
      saveUser(data.user);
      setToken(data.token);
      setUser(data.user);
      setShowAuth(false);
      toast.success(`Welcome, ${data.user.fullName || 'Student'}!`);
    } catch (err: any) {
      setError(err.message || 'Google Sign-In failed');
    } finally {
      setGoogleLoading(false);
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
      const data = await safeAuthCall('/auth/register-otp', { email: lower });
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
      const data = await safeAuthCall('/auth/signup', {
        email: emailOrStudentId.toLowerCase().trim(),
        password,
        fullName,
        phone,
        department,
        batch,
        studentId: computedStudentId,
        otpCode,
        otpId,
      });

      setAuthToken(data.token);
      saveToken(data.token);
      saveUser(data.user);
      setToken(data.token);
      setUser(data.user);
      setShowAuth(false);
      toast.success('Account created successfully! You can set a Wallet PIN anytime from Wallet Settings.');
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
      const data = await safeAuthCall('/auth/forgot-password/otp', { identifier: emailOrStudentId });
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
      await safeAuthCall('/auth/forgot-password/reset', { otpId, code: otpCode, newPassword: password });
      setPassword('');
      setConfirmPassword('');
      setOtpCode('');
      // The button promises "& Sign In" — actually do it instead of dropping the user back at an
      // empty login form after they just typed their new password once already. The reset itself
      // already succeeded at this point, so a failure here is a sign-in issue, not a reset failure.
      try {
        const loginData = await safeAuthCall('/auth/login', { emailOrStudentId, password });
        setAuthToken(loginData.token);
        saveToken(loginData.token);
        saveUser(loginData.user);
        setToken(loginData.token);
        setUser(loginData.user);
        setShowAuth(false);
        toast.success(`Password updated. Welcome back, ${loginData.user.fullName || 'Student'}!`);
      } catch {
        setAuthView('login');
        toast.success('Password updated successfully. Please sign in with your new password.');
      }
    } catch (err: any) {
      setError(err.message || 'Password reset failed');
    } finally {
      setFormLoading(false);
    }
  };

  const passwordStrength = evaluatePasswordStrength(password);

  // Back button — local to this auth card only. Steps back through the auth flow; never touches app/router navigation.
  const canGoBack = authView !== 'login';
  const handleBack = () => {
    setError('');
    if (authView === 'verify-register') { setAuthView('signup'); return; }
    if (authView === 'verify-forgot') { setAuthView('forgot'); return; }
    if (authView === 'forgot') { setAuthView('login'); return; }
    if (authView === 'signup') { setAuthView('login'); return; }
  };

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
            <div className="relative text-center space-y-2">
              {canGoBack && (
                <button
                  type="button"
                  onClick={handleBack}
                  aria-label="Back"
                  className="absolute left-0 top-0 w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/60 active:scale-95 transition-all"
                >
                  <ArrowLeft className="w-4.5 h-4.5" />
                </button>
              )}
              <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center shadow-xl shadow-primary/20 mx-auto">
                <GraduationCap className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-foreground">EWU Campus Wallet</h1>
              </div>
            </div>

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
                      Password or Wallet PIN
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
                      placeholder="Enter your Password or 6-digit Wallet PIN"
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

                <GoogleAuthDivider />
                <GoogleAuthButton onSuccess={r => handleGoogleAuth(r)} loading={googleLoading} />

                <p className="text-center text-xs text-muted-foreground pt-1">
                  New to Smart Campus?{' '}
                  <button type="button" onClick={() => { setAuthView('signup'); setError(''); }} className="text-primary font-semibold hover:underline">
                    Create an account
                  </button>
                </p>
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
                  <span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">Terms of Service</a> & <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">Campus Privacy Policy</a></span>
                </label>

                <button
                  type="submit"
                  disabled={formLoading}
                  className="w-full h-11 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {formLoading ? 'Sending OTP...' : 'Continue'}
                </button>

                <GoogleAuthDivider />
                <GoogleAuthButton onSuccess={r => handleGoogleAuth(r)} loading={googleLoading} />
                <p className="text-center text-[11px] text-muted-foreground -mt-1">Google Sign-Up is restricted to @std.ewubd.edu accounts</p>

                <p className="text-center text-xs text-muted-foreground pt-1">
                  Already have an account?{' '}
                  <button type="button" onClick={() => { setAuthView('login'); setError(''); }} className="text-primary font-semibold hover:underline">
                    Sign in
                  </button>
                </p>
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

                <div className="flex justify-end items-center text-xs">
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

            {/* Footer info & Dev Mode Toggle */}
            <div className="pt-2.5 border-t border-border/40 text-center space-y-2">
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = !perTabMode;
                    setPerTabAuthMode(next);
                    setPerTabMode(next);
                    toast.info(next ? 'Per-Tab Sessions enabled (Dev/Test Mode)' : 'Standard Shared Sessions enabled');
                  }}
                  className={`text-[10px] px-3 py-1 rounded-full border transition-all flex items-center gap-1.5 ${
                    perTabMode ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-sm' : 'bg-accent/40 border-border/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${perTabMode ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40'}`} />
                  {perTabMode ? 'Per-Tab Auth Mode: ACTIVE (Dev Mode)' : 'Per-Tab Auth Mode: OFF (Click to Enable)'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, loginWithRedirect, logout, token, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
