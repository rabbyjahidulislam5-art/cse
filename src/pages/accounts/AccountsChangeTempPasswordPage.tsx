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

// Standalone route (outside AccountsLayout, no nav chrome) — mandatory on first login with a temp password
export default function AccountsChangeTempPasswordPage() {
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
    if ((user as any).role !== 'Accounts Office') { navigate('/', { replace: true }); return; }
    if (!user.mustChangePassword) { navigate('/accounts', { replace: true }); return; }
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
      toast.success('Password updated successfully.');
      navigate('/accounts/verify-email', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Failed to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-4">
          <KeyRound className="w-7 h-7" />
        </div>
        <h2 className="text-center text-2xl font-bold text-foreground">Set Your Account Password</h2>
        <p className="mt-2 text-center text-xs text-muted-foreground max-w-sm mx-auto">
          Welcome to Smart Campus Accounts Office. For security, please replace your temporary password before accessing the dashboard.
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card border border-border/60 py-8 px-4 shadow-xl rounded-2xl sm:px-10">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter at least 8 characters"
                  className="w-full bg-accent/50 border border-border/60 rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPassword && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                    <span>Strength: {strength.label}</span>
                  </div>
                  <div className="h-1.5 w-full bg-accent rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${strength.color}`} style={{ width: `${(strength.score / 4) * 100}%` }} />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">Confirm New Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                className="w-full bg-accent/50 border border-border/60 rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full gradient-primary text-primary-foreground py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary/20 hover:opacity-95 transition-all flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Update Password & Continue
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-border/60 text-center">
            <button onClick={() => logout()} className="text-xs text-muted-foreground hover:text-foreground">
              Sign out and return to login
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
