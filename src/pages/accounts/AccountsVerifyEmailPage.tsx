import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { sendShopEmailVerificationOtp, verifyShopEmail } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

// Standalone route (outside AccountsLayout, no nav chrome) — mandatory after the temp-password change
export default function AccountsVerifyEmailPage() {
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
    if ((user as any).role !== 'Accounts Office') { navigate('/', { replace: true }); return; }
    if (user.mustChangePassword) { navigate('/accounts/change-password', { replace: true }); return; }
    if (user.emailVerified) { navigate('/accounts', { replace: true }); return; }
  }, [user, isLoading, navigate]);

  const handleSendOtp = async () => {
    setSending(true);
    try {
      const res = await sendShopEmailVerificationOtp();
      if (res.alreadyVerified) {
        updateUser({ emailVerified: true });
        navigate('/accounts', { replace: true });
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
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleDigitChange = (index: number, val: string) => {
    if (!/^\d*$/.test(val)) return;
    const digit = val.slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim();
    if (/^\d{6}$/.test(pasted)) {
      setCode(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const fullCode = code.join('');
    if (fullCode.length !== 6) {
      toast.error('Enter the complete 6-digit verification code');
      return;
    }
    if (!otpId) {
      toast.error('Session expired. Please request a new code.');
      return;
    }
    setVerifying(true);
    try {
      await verifyShopEmail({ otpId, code: fullCode });
      updateUser({ emailVerified: true });
      toast.success('Email verified successfully!');
      navigate('/accounts', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
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
        <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 mb-4">
          <Mail className="w-7 h-7" />
        </div>
        <h2 className="text-center text-2xl font-bold text-foreground">Verify Your Email Address</h2>
        <p className="mt-2 text-center text-xs text-muted-foreground max-w-sm mx-auto">
          We sent a 6-digit verification code to <span className="font-semibold text-foreground">{user.email}</span>. Please enter it below to complete setup.
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card border border-border/60 py-8 px-4 shadow-xl rounded-2xl sm:px-10">
          <form onSubmit={handleVerify} className="space-y-6">
            <div className="grid grid-cols-6 gap-2 sm:gap-3" onPaste={handlePaste}>
              {code.map((digit, idx) => (
                <input
                  key={idx}
                  ref={el => { inputRefs.current[idx] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleDigitChange(idx, e.target.value)}
                  onKeyDown={e => handleKeyDown(idx, e)}
                  className="w-full h-12 text-center text-lg font-bold bg-accent/50 border border-border/60 rounded-xl focus:border-primary focus:outline-none text-foreground"
                />
              ))}
            </div>

            <button
              type="submit"
              disabled={verifying || code.join('').length !== 6}
              className="w-full gradient-primary text-primary-foreground py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-primary/20 hover:opacity-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Verify Email & Enter Dashboard
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-border/60 text-center space-y-3">
            <p className="text-xs text-muted-foreground">
              Didn't receive the code?{' '}
              {countdown > 0 ? (
                <span className="text-muted-foreground font-mono">Resend in {countdown}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={sending}
                  className="text-primary font-semibold hover:underline disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Resend Code'}
                </button>
              )}
            </p>

            <div>
              <button onClick={() => logout()} className="text-xs text-muted-foreground hover:text-foreground">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
