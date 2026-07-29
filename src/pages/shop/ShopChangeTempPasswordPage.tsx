import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { KeyRound, Lock, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { changePassword } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

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

// Standalone route (outside ShopLayout, no nav chrome) — this step is mandatory on first login
// with a temp password and must not be skippable via back/forward navigation or deep links.
export default function ShopChangeTempPasswordPage() {
  const navigate = useNavigate();
  const { user, isLoading, updateUser, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/', { replace: true }); return; }
    if ((user as any).role !== 'Shop Staff') { navigate('/', { replace: true }); return; }
    if (!user.mustChangePassword) { navigate('/shop', { replace: true }); return; }
  }, [user, isLoading, navigate]);

  const strength = evaluatePasswordStrength(newPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('Password must be at least 8 characters long.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      await changePassword({ newPassword });
      updateUser({ mustChangePassword: false });
      toast.success('Password updated.');
      navigate('/shop/verify-email', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !user) return null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-strong rounded-3xl p-6 sm:p-8 border border-border/80 shadow-2xl space-y-6"
        >
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center shadow-xl shadow-primary/20 mx-auto">
              <KeyRound className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-foreground">Set a New Password</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Your account was created with a temporary password. Set a new one to continue.
              </p>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3.5 text-xs font-medium text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">New Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3.5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 8 chars, upper/lower/number"
                  className="w-full h-11 rounded-xl bg-accent/40 border border-border/60 pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-3.5 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPassword && (
                <div className="mt-1.5 space-y-1">
                  <div className="flex gap-1 h-1.5 w-full bg-accent rounded-full overflow-hidden">
                    {[1, 2, 3, 4].map(idx => (
                      <div key={idx} className={`flex-1 transition-all ${idx <= strength.score ? strength.color : 'bg-transparent'}`} />
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Strength: <strong className="text-foreground">{strength.label}</strong></p>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Confirm New Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="w-full h-11 rounded-xl bg-accent/40 border border-border/60 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {submitting ? 'Updating...' : 'Set Password & Continue'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => logout({ returnTo: window.location.origin })}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </motion.div>
      </div>
    </div>
  );
}
