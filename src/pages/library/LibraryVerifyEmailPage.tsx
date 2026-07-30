import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { sendShopEmailVerificationOtp, verifyShopEmail } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

// Standalone route (outside LibraryLayout, no nav chrome) — mandatory after the temp-password
// change. Mirrors ShopVerifyEmailPage.tsx exactly; reuses the same backend OTP endpoints (widened
// to accept the Library role server-side — see server/src/index.ts) rather than duplicating them.
export default function LibraryVerifyEmailPage() {
  const navigate = useNavigate();
  const { user, isLoading, updateUser, logout } = useAuth();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [otpId, setOtpId] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate('/', { replace: true }); return; }
    if ((user as any).role !== 'Library') { navigate('/', { replace: true }); return; }
    if (user.mustChangePassword) { navigate('/library/change-password', { replace: true }); return; }
    if (user.emailVerified) { navigate('/library', { replace: true }); return; }
  }, [user, isLoading, navigate]);

  const handleSendOtp = async () => {
    setSending(true);
    try {
      const res = await sendShopEmailVerificationOtp();
      if (res.alreadyVerified) {
        updateUser({ emailVerified: true });
        navigate('/library', { replace: true });
        return;
      }
      setOtpId(res.otpId || '');
      setSent(true);
      setCountdown(60);
      toast.success(res.message);
      setTimeout(() => inputRefs.current[0]?.focus(), 300);
    } catch (e: any) {
      toast.error(e.message || 'Failed to send OTP');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!isLoading && user && !requestedRef.current && !user.mustChangePassword && !user.emailVerified) {
      requestedRef.current = true;
      handleSendOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleDigit = (idx: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...code]; next[idx] = val; setCode(next);
    if (val && idx < 5) inputRefs.current[idx + 1]?.focus();
    if (val && idx === 5) {
      const otp = next.join('');
      if (otp.length === 6) setTimeout(() => handleVerify(otp), 100);
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) {
      const next = [...code]; next[idx - 1] = ''; setCode(next);
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) {
      setCode(text.split(''));
      inputRefs.current[5]?.focus();
      setTimeout(() => handleVerify(text), 100);
    }
  };

  const handleVerify = async (otp?: string) => {
    const otpCode = otp || code.join('');
    if (otpCode.length !== 6) { toast.error('Enter the 6-digit OTP'); return; }
    setVerifying(true);
    try {
      await verifyShopEmail({ otpId, code: otpCode });
      updateUser({ emailVerified: true });
      toast.success('Email verified.');
      navigate('/library', { replace: true });
    } catch (e: any) {
      toast.error(e.message || 'Verification failed');
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setVerifying(false);
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
              <Mail className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-foreground">Verify Your Email</h1>
              <p className="text-xs text-muted-foreground mt-1">
                {sent ? `Enter the 6-digit code sent to ${user.email}` : 'Sending verification code...'}
              </p>
            </div>
          </div>

          {sending && !sent && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}

          {sent && (
            <div className="space-y-5">
              <div className="flex gap-2.5 justify-center" onPaste={handlePaste}>
                {code.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className={`w-12 h-14 rounded-xl border-2 text-center text-xl font-bold bg-accent/50 text-foreground transition-all outline-none ${d ? 'border-primary' : 'border-border/60 focus:border-primary/50'}`}
                    autoFocus={i === 0}
                  />
                ))}
              </div>

              <div className="text-center">
                {countdown > 0 ? (
                  <p className="text-xs text-muted-foreground">Resend code in <span className="text-primary font-semibold tabular">{countdown}s</span></p>
                ) : (
                  <button onClick={handleSendOtp} disabled={sending} className="text-xs text-primary font-semibold hover:underline">Resend Code</button>
                )}
              </div>

              <button
                onClick={() => handleVerify()}
                disabled={verifying || code.join('').length !== 6}
                className="w-full h-12 rounded-xl gradient-primary text-primary-foreground font-bold text-sm shadow-xl shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {verifying ? 'Verifying...' : 'Verify OTP'}
              </button>
            </div>
          )}

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
