import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, ShieldCheck, Fingerprint, Delete } from 'lucide-react';
import { toast } from 'sonner';
import { setPin as setPinEndpoint, verifyPin as verifyPinEndpoint } from '@/lib/api';

interface PinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'set' | 'verify' | 'change';
  onSuccess: () => void;
  /** When true, the dialog cannot be dismissed without completing the PIN flow (used for the mandatory post-signup wallet PIN setup). */
  mandatory?: boolean;
  title?: string;
  description?: string;
  /** The account's existing PIN length (from `user.pinLength`) — 4 for legacy accounts that haven't reset their PIN since the 6-digit policy, 6 for everyone else. Required to enter/verify an EXISTING pin correctly; new PINs always target NEW_PIN_LENGTH regardless of this value. Defaults to 6 if omitted. */
  verifyLength?: number;
}

const NEW_PIN_LENGTH = 6;

function PinDots({ value, length, error = false }: { value: string; length: number; error?: boolean }) {
  return (
    <div className="flex gap-3.5 justify-center my-6">
      {Array.from({ length }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            scale: value.length === i ? [1, 1.2, 1] : 1,
          }}
          transition={{ duration: 0.2 }}
          className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
            error
              ? 'bg-destructive border-2 border-destructive shadow-sm shadow-destructive/30'
              : value.length > i
                ? 'bg-primary border-2 border-primary shadow-sm shadow-primary/30'
                : 'bg-transparent border-2 border-border/80'
          }`}
        />
      ))}
    </div>
  );
}

function Numpad({ onDigit, onDelete, disabled }: { onDigit: (d: string) => void; onDelete: () => void; disabled?: boolean }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
      {keys.map((key, i) => {
        if (key === '') return <div key={i} />;
        if (key === 'del') {
          return (
            <button key={i} onClick={onDelete} disabled={disabled}
              className="h-16 w-16 mx-auto rounded-2xl flex items-center justify-center text-muted-foreground hover:bg-accent/80 hover:text-foreground transition-all active:scale-90 disabled:opacity-40">
              <Delete className="w-5 h-5" />
            </button>
          );
        }
        return (
          <button key={i} onClick={() => onDigit(key)} disabled={disabled}
            className="h-16 w-16 mx-auto rounded-2xl text-xl font-semibold text-foreground bg-accent/30 hover:bg-accent/70 border border-border/40 transition-all active:scale-90 active:bg-primary/15 disabled:opacity-40">
            {key}
          </button>
        );
      })}
    </div>
  );
}

export default function PinDialog({ open, onOpenChange, mode, onSuccess, mandatory, title, description, verifyLength }: PinDialogProps) {
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'current' | 'new' | 'confirm' | 'verify'>(
    mode === 'verify' ? 'verify' : mode === 'change' ? 'current' : 'new'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open) {
      setPin(''); setCurrentPin(''); setConfirmPin(''); setError(false);
      setStep(mode === 'verify' ? 'verify' : mode === 'change' ? 'current' : 'new');
    }
  }, [open, mode]);

  const activePin = step === 'current' ? currentPin : step === 'confirm' ? confirmPin : pin;
  const setActivePin = step === 'current' ? setCurrentPin : step === 'confirm' ? setConfirmPin : setPin;
  // "verify"/"current" steps enter an EXISTING pin (whatever length the account actually has —
  // legacy accounts may still be 4 digits). "new"/"confirm" always target the current policy.
  const activeLength = (step === 'verify' || step === 'current') ? (verifyLength || NEW_PIN_LENGTH) : NEW_PIN_LENGTH;

  const handleDigit = useCallback((d: string) => {
    if (activePin.length >= activeLength) return;
    const newVal = activePin + d;
    setActivePin(newVal);
    setError(false);

    if (newVal.length === activeLength) {
      setTimeout(() => {
        if (step === 'verify') handleVerifyPin(newVal);
        else if (step === 'current') { setStep('new'); }
        else if (step === 'new') { setStep('confirm'); }
        else handleSetPin(newVal);
      }, 200);
    }
  }, [activePin, step, activeLength]);

  const handleDelete = useCallback(() => {
    setActivePin(activePin.slice(0, -1));
    setError(false);
  }, [activePin]);

  const handleSetPin = async (confirm: string) => {
    if (pin !== confirm) {
      setError(true);
      toast.error('PINs do not match');
      setTimeout(() => { setConfirmPin(''); setError(false); }, 500);
      return;
    }
    setLoading(true);
    try {
      const cur = mode === 'change' ? currentPin : undefined;
      await setPinEndpoint({ pin, currentPin: cur });
      toast.success(mode === 'change' ? 'PIN changed successfully' : 'PIN set successfully');
      onSuccess(); onOpenChange(false);
    } catch (e: any) { toast.error(e.message || 'Failed'); setError(true); }
    finally { setLoading(false); }
  };

  const handleVerifyPin = async (p: string) => {
    setLoading(true);
    try {
      const res = await verifyPinEndpoint({ pin: p });
      if (res.valid) { onSuccess(); onOpenChange(false); }
      else { toast.error(res.message); setError(true); setTimeout(() => { setPin(''); setError(false); }, 500); }
    } catch (e: any) { toast.error(e.message || 'Failed'); setError(true); setTimeout(() => { setPin(''); setError(false); }, 500); }
    finally { setLoading(false); }
  };

  // Keyboard support
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) handleDigit(e.key);
      else if (e.key === 'Backspace') handleDelete();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleDigit, handleDelete]);

  const titles: Record<string, string> = { current: 'Current PIN', new: mode === 'change' ? 'New PIN' : 'Create PIN', confirm: 'Confirm PIN', verify: 'Enter PIN' };
  const descs: Record<string, string> = {
    verify: `Enter your ${activeLength}-digit PIN to authorize this transaction`,
    current: `Enter your current ${activeLength}-digit PIN to continue`,
    confirm: 'Re-enter your PIN to confirm',
    new: `Choose a secure ${NEW_PIN_LENGTH}-digit PIN for your wallet`,
  };

  return (
    <Dialog open={open} onOpenChange={mandatory ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-sm rounded-3xl p-0 overflow-hidden border-border/60"
        hideClose={mandatory}
        onEscapeKeyDown={mandatory ? (e) => e.preventDefault() : undefined}
        onPointerDownOutside={mandatory ? (e) => e.preventDefault() : undefined}
      >
        {/* Top section with gradient background */}
        <div className="bg-gradient-to-b from-primary/8 to-transparent px-6 pt-7 pb-2">
          <DialogHeader className="text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
              {mode === 'verify' ? <Fingerprint className="w-7 h-7 text-primary" /> : <ShieldCheck className="w-7 h-7 text-primary" />}
            </div>
            <DialogTitle className="text-lg font-bold">{title || titles[step]}</DialogTitle>
            <DialogDescription className="text-sm">{description || descs[step]}</DialogDescription>
          </DialogHeader>

          <PinDots value={activePin} length={activeLength} error={error} />
        </div>

        {/* Keypad section */}
        <div className="px-6 pb-6 pt-2">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <Numpad onDigit={handleDigit} onDelete={handleDelete} disabled={loading} />
          )}

          {!mandatory && (
            <button onClick={() => onOpenChange(false)} className="mt-5 text-sm text-muted-foreground hover:text-foreground text-center w-full transition-colors">
              Cancel
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
