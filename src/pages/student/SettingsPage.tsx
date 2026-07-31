import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import PinDialog from '@/components/PinDialog';
import { ShieldCheck, Lock, ChevronRight, LogOut, Bell, Shield, Smartphone, Key } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useUser } from '@/lib/user-context';
import { FadeIn } from '@/components/PageTransition';

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out shrink-0 ${checked ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}
    >
      <div className="w-4 h-4 rounded-full bg-white shadow-md" />
    </button>
  );
}

export default function SettingsPage() {
  const { user, loading, refreshDashboard } = useUser();
  const { logout } = useAuth();
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<'set' | 'change'>('set');
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [securityAlerts, setSecurityAlerts] = useState(true);

  if (loading || !user) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <FadeIn>
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your wallet PIN, security settings, and account preferences</p>
        </div>
      </FadeIn>

      {/* Wallet PIN Security */}
      <FadeIn delay={0.1}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Wallet Security</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-6">
          <button
            onClick={() => { setPinMode(user.pinSet ? 'change' : 'set'); setPinOpen(true); }}
            className="w-full rounded-xl border border-border/40 bg-accent/30 p-4 flex items-center gap-4 hover:border-primary/30 transition-all text-left group"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${user.pinSet ? 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]' : 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))]'}`}>
              {user.pinSet ? <ShieldCheck className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Wallet PIN</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${user.pinSet ? 'bg-[hsl(var(--chart-3))]/15 text-[hsl(var(--chart-3))]' : 'bg-[hsl(var(--chart-4))]/15 text-[hsl(var(--chart-4))]'}`}>
                  {user.pinSet ? 'Active' : 'Not Set'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {user.pinSet ? 'PIN is active. Tap to change your PIN.' : 'Set a Wallet PIN to authorize payments and transfers.'}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </div>
      </FadeIn>

      {/* Account Preferences & Notifications */}
      <FadeIn delay={0.15}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Preferences & Alerts</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-6">
          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" /> Transaction Notifications
              </Label>
              <p className="text-xs text-muted-foreground">Receive real-time notifications for deposits, payments, and transfers</p>
            </div>
            <ToggleSwitch checked={emailAlerts} onChange={setEmailAlerts} />
          </div>

          <div className="h-px bg-border/40" />

          <div className="flex items-center justify-between py-1">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-secondary" /> Security & OTP Alerts
              </Label>
              <p className="text-xs text-muted-foreground">Receive email alerts for login attempts and sensitive PIN/OTP actions</p>
            </div>
            <ToggleSwitch checked={securityAlerts} onChange={setSecurityAlerts} />
          </div>
        </div>
      </FadeIn>

      {/* Active Session Info */}
      <FadeIn delay={0.2}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Account Identity</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">Signed in as {user.email}</p>
              <p className="text-[11px] text-muted-foreground">Role: Student · Student ID: {user.studentId || 'N/A'}</p>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Sign Out Button */}
      <FadeIn delay={0.25}>
        <Button
          variant="outline"
          className="w-full h-12 text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/30 font-semibold rounded-xl"
          onClick={() => logout({ returnTo: window.location.origin })}
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </FadeIn>

      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode={pinMode} verifyLength={user.pinLength || 4} onSuccess={() => refreshDashboard()} />
    </div>
  );
}
