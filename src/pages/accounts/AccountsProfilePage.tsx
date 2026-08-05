import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import PinDialog from '@/components/PinDialog';
import { toast } from 'sonner';
import { Loader2, LogOut, Save, User, Lock, ShieldCheck, Mail, Phone, Landmark, Camera, Calendar, Briefcase, BadgeCheck, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getAccountsProfile, updateAccountsProfile, uploadFile, type GetAccountsProfileOutputType } from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';

function ReadOnlyField({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-accent/30 border border-border/40">
      <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">{label}</p>
        <p className="text-sm font-medium text-foreground truncate mt-0.5">{value || '—'}</p>
      </div>
      <Lock className="w-3.5 h-3.5 text-muted-foreground/40" />
    </div>
  );
}

export default function AccountsProfilePage() {
  const { logout } = useAuth();
  const [data, setData] = useState<GetAccountsProfileOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fullName: '', phone: '', bio: '', designation: '', employeeId: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<'set' | 'change'>('set');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    getAccountsProfile({})
      .then(d => {
        setData(d);
        setForm({
          fullName: d.user.fullName || '',
          phone: d.user.phone || '',
          bio: d.user.bio || '',
          designation: d.user.designation || '',
          employeeId: d.user.employeeId || '',
        });
      })
      .catch(() => toast.error('Failed to load accounts profile'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAccountsProfile(form);
      toast.success('Accounts profile updated');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      await updateAccountsProfile({ profilePicture: url });
      toast.success('Profile picture updated');
      load();
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl space-y-6">
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const u = data?.user;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl space-y-6">
      <BackButton fallback="/accounts" />
      {/* Header Banner */}
      <FadeIn>
        <div className="relative rounded-2xl border border-border/60 bg-card p-6 overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
          <div className="flex flex-col sm:flex-row items-center gap-5 relative">
            <div className="relative group shrink-0">
              <div className="w-20 h-20 rounded-2xl bg-accent flex items-center justify-center overflow-hidden border-2 border-primary/20 shadow-lg">
                {u?.profilePicture ? (
                  <img src={u.profilePicture} alt={u.fullName} className="w-full h-full object-cover" />
                ) : (
                  <Landmark className="w-9 h-9 text-muted-foreground" />
                )}
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
            </div>

            <div className="text-center sm:text-left flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground truncate">{u?.fullName || 'Accounts Officer'}</h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  <BadgeCheck className="w-3.5 h-3.5" /> Official Staff
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{u?.designation} · {u?.department}</p>
              <p className="text-xs text-muted-foreground font-mono">{u?.email}</p>
            </div>

          </div>
        </div>
      </FadeIn>

      {/* System Assignment & Read-Only Fields */}
      <FadeIn delay={0.05}>
        <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Official System Assignment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">(Read-Only)</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReadOnlyField icon={Mail} label="Official Email" value={u?.email || ''} />
            <ReadOnlyField icon={Briefcase} label="Department" value={u?.department || 'Accounts Office'} />
            <ReadOnlyField icon={ShieldCheck} label="System Role" value={u?.role || 'Accounts Office'} />
            <ReadOnlyField icon={Calendar} label="Joining Date" value={u?.joiningDate || ''} />
          </div>
        </div>
      </FadeIn>

      {/* Profile Form & Security */}
      <FadeIn delay={0.1}>
        <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Personal Information</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} placeholder="Your full name" className="bg-accent/50 border-border/60" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Phone Number</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+880 1XXXXXXXXX" className="bg-accent/50 border-border/60" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Official Designation</Label>
              <Input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Senior Accounts Officer" className="bg-accent/50 border-border/60" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Employee ID</Label>
              <Input value={form.employeeId} onChange={e => setForm({ ...form, employeeId: e.target.value })} placeholder="e.g. ACC-00124" className="bg-accent/50 border-border/60" />
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs">Short Bio / Note</Label>
              <Textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} placeholder="Department notes or professional bio..." className="bg-accent/50 border-border/60 resize-none h-20" />
            </div>

            <div className="sm:col-span-2 pt-2 flex flex-col sm:flex-row justify-end gap-3">
              <Button onClick={() => logout()} variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 w-full sm:w-auto">
                <LogOut className="w-4 h-4 mr-1.5" /> Sign Out
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm" className="shadow-lg shadow-primary/20 w-full sm:w-auto">
                {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </FadeIn>

    </div>
  );
}
