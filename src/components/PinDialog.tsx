import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Lock, ShieldCheck, Fingerprint } from 'lucide-react';
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
}

const PIN_LENGTH = 4;

function PinDots({ value, length = PIN_LENGTH, error = false }: { value: string; length?: number; error?: boolean }) {
  return (
    <div className="flex gap-4 justify-center my-8">
      {Array.from({ length }).map((_, i) => (
        <motion.div
          key={i}
          animate={{
            scale: value.length === i ? [1, 1.15, 1] : 1,
            backgroundColor: error ? 'hsl(0, 78%, 58%)' : value.length > i ? 'hsl(42, 82%, 52%)' : 'hsl(225, 18%, 12%)',
          }}
          transition={{ duration: 0.15 }}
          className="w-4 h-4 rounded-full border-2 transition-colors"
          style={{
            borderColor: error ? 'hsl(0, 78%, 58%)' : value.length > i ? 'hsl(42, 82%, 52%)' : 'hsl(225, 15%, 20%)',
          }}
        />
      ))}
    </div>
  );
}

function Numpad({ onDigit, onDelete, disabled }: { onDigit: (d: string) => void; onDelete: () => void; disabled?: boolean }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
  return (
    <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
      {keys.map((key, i) => {
        if (key === '') return <div key={i} />;
        if (key === 'del') {
          return (
            <button key={i} onClick={onDelete} disabled={disabled}
              className="h-14 rounded-xl text-muted-foreground hover:bg-accent/80 transition-all active:scale-95 text-sm font-medium">
              ←
            </button>
          );
        }
        return (
          <button key={i} onClick={() => onDigit(key)} disabled={disabled}
            className="h-14 rounded-xl text-lg font-semibold text-foreground hover:bg-accent/80 transition-all active:scale-95 active:bg-primary/10">
            {key}
          </button>
        );
      })}
    </div>
  );
}

export default function PinDialog({ open, onOpenChange, mode, onSuccess, mandatory, title, description }: PinDialogProps) {
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

  const handleDigit = useCallback((d: string) => {
    if (activePin.length >= PIN_LENGTH) return;
    const newVal = activePin + d;
    setActivePin(newVal);
    setError(false);

    if (newVal.length === PIN_LENGTH) {
      setTimeout(() => {
        if (step === 'verify') handleVerifyPin(newVal);
        else if (step === 'current') { setStep('new'); }
        else if (step === 'new') { setStep('confirm'); }
        else handleSetPin(newVal);
      }, 200);
    }
  }, [activePin, step]);

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
    verify: 'Enter your 4-digit PIN to authorize this transaction',
    current: 'Enter your current PIN to continue',
    confirm: 'Re-enter your PIN to confirm',
    new: 'Choose a secure 4-digit PIN for your wallet',
  };

  return (
    <Dialog open={open} onOpenChange={mandatory ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-sm glass-strong rounded-2xl p-6"
        hideClose={mandatory}
        onEscapeKeyDown={mandatory ? (e) => e.preventDefault() : undefined}
        onPointerDownOutside={mandatory ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
            {mode === 'verify' ? <Fingerprint className="w-8 h-8 text-primary" /> : <ShieldCheck className="w-8 h-8 text-primary" />}
          </div>
          <DialogTitle className="text-lg font-bold">{title || titles[step]}</DialogTitle>
          <DialogDescription className="text-sm">{description || descs[step]}</DialogDescription>
        </DialogHeader>

        <PinDots value={activePin} error={error} />

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <Numpad onDigit={handleDigit} onDelete={handleDelete} disabled={loading} />
        )}

        {!mandatory && (
          <button onClick={() => onOpenChange(false)} className="mt-4 text-sm text-muted-foreground hover:text-foreground text-center w-full transition-colors">
            Cancel
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
