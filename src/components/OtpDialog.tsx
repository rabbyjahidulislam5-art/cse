import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { sendOtp, verifyOtp } from '@/lib/api';

interface OtpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purpose: 'Payment' | 'Transfer' | 'PIN Reset' | 'Large Payment';
  onSuccess: () => void;
}

export default function OtpDialog({ open, onOpenChange, purpose, onSuccess }: OtpDialogProps) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [otpId, setOtpId] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (open) { setCode(['', '', '', '', '', '']); setSent(false); setOtpId(''); handleSendOtp(); }
  }, [open]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleSendOtp = async () => {
    setSending(true);
    try {
      const res = await sendOtp({ purpose });
      setOtpId(res.otpId); setSent(true); setCountdown(60);
      toast.success(res.message);
      setTimeout(() => inputRefs.current[0]?.focus(), 300);
    } catch (e: any) { toast.error(e.message || 'Failed to send OTP'); }
    finally { setSending(false); }
  };

  const handleDigit = (idx: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...code]; next[idx] = val; setCode(next);
    if (val && idx < 5) inputRefs.current[idx + 1]?.focus();
    // Auto-submit on complete
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
      const next = text.split('');
      setCode(next);
      inputRefs.current[5]?.focus();
      setTimeout(() => handleVerify(text), 100);
    }
  };

  const handleVerify = async (otp?: string) => {
    const otpCode = otp || code.join('');
    if (otpCode.length !== 6) { toast.error('Enter the 6-digit OTP'); return; }
    setVerifying(true);
    try {
      const res = await verifyOtp({ otpId, code: otpCode });
      if (res.valid) { toast.success('OTP verified'); onSuccess(); onOpenChange(false); }
      else { toast.error(res.message); setCode(['', '', '', '', '', '']); inputRefs.current[0]?.focus(); }
    } catch (e: any) { toast.error(e.message || 'Verification failed'); }
    finally { setVerifying(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm glass-strong rounded-2xl p-6">
        <DialogHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
            <Mail className="w-8 h-8 text-primary" />
          </div>
          <DialogTitle className="text-lg font-bold">Email Verification</DialogTitle>
          <DialogDescription className="text-sm">
            {sent ? 'Enter the 6-digit code sent to your email' : 'Sending verification code...'}
          </DialogDescription>
        </DialogHeader>

        {sending && !sent && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        {sent && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 mt-2">
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
                  className={`w-12 h-14 rounded-xl border-2 text-center text-xl font-bold bg-accent/50 text-foreground transition-all outline-none ${
                    d ? 'border-primary' : 'border-border/60 focus:border-primary/50'
                  }`}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            <div className="text-center">
              {countdown > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Resend code in <span className="text-primary font-semibold tabular">{countdown}s</span>
                </p>
              ) : (
                <button onClick={handleSendOtp} disabled={sending} className="text-xs text-primary font-semibold hover:underline">
                  Resend Code
                </button>
              )}
            </div>

            <Button onClick={() => handleVerify()} disabled={verifying || code.join('').length !== 6} className="w-full h-12 font-semibold">
              {verifying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {verifying ? 'Verifying...' : 'Verify OTP'}
            </Button>
          </motion.div>
        )}

        <button onClick={() => onOpenChange(false)} className="mt-2 text-sm text-muted-foreground hover:text-foreground text-center w-full transition-colors">
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  );
}
