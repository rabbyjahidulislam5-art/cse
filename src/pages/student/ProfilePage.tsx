import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PinDialog from '@/components/PinDialog';
import { toast } from 'sonner';
import { Loader2, LogOut, Save, User, Lock, ShieldCheck, Mail, Phone, GraduationCap, Building, Hash, ChevronRight, Camera, Heart, MapPin, Droplets, Calendar, FileText, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useUser } from '@/lib/user-context';
import { updateProfile } from '@/lib/api';
import { uploadFile } from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';

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

export default function ProfilePage() {
  const { user, loading, refreshDashboard } = useUser();
  const { logout } = useAuth();
  const [form, setForm] = useState({
    phone: '', emergencyContact: '', address: '', bloodGroup: '',
    gender: '', dateOfBirth: '', bio: '',
  });
  const [formInit, setFormInit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<'set' | 'change'>('set');
  const fileRef = useRef<HTMLInputElement>(null);

  if (user && !formInit) {
    setForm({
      phone: user.phone || '',
      emergencyContact: user.emergencyContact || '',
      address: user.address || '',
      bloodGroup: user.bloodGroup || '',
      gender: user.gender || '',
      dateOfBirth: user.dateOfBirth || '',
      bio: user.bio || '',
    });
    setFormInit(true);
  }

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success('Profile updated successfully');
      refreshDashboard();
    } catch (e: any) { toast.error(e.message || 'Failed to update'); }
    finally { setSaving(false); }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setUploading(true);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      await updateProfile({ profilePicture: fileUrl });
      toast.success('Profile picture updated');
      refreshDashboard();
    } catch (e: any) { toast.error(e.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  if (loading || !user) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="flex items-center gap-4"><Skeleton className="w-24 h-24 rounded-2xl" /><div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-56" /></div></div>
        {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <FadeIn>
        <h1 className="text-xl font-bold text-foreground mb-6">Profile</h1>

        {/* Avatar & Identity */}
        <div className="flex items-center gap-5 mb-8">
          <div className="relative group">
            {user.profilePicture ? (
              <img src={user.profilePicture} alt="Profile" className="w-24 h-24 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div className="w-24 h-24 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-3xl font-bold text-primary-foreground">{user.fullName?.charAt(0) || '?'}</span>
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-foreground" /> : <Camera className="w-3.5 h-3.5 text-primary-foreground" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{user.fullName || 'Student'}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{user.studentId || '—'} · {user.department || '—'}</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Batch {user.batch || '—'}</p>
          </div>
        </div>
      </FadeIn>

      {/* Read-only identity fields */}
      <FadeIn delay={0.1}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Identity (Read-only)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
          <ReadOnlyField icon={User} label="Full Name" value={user.fullName || ''} />
          <ReadOnlyField icon={Hash} label="Student ID" value={user.studentId || ''} />
          <ReadOnlyField icon={Building} label="Department" value={user.department || ''} />
          <ReadOnlyField icon={GraduationCap} label="Batch" value={user.batch || ''} />
          <ReadOnlyField icon={Mail} label="Email" value={user.email} />
        </div>
      </FadeIn>

      {/* Editable fields */}
      <FadeIn delay={0.15}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Personal Details</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</Label>
              <Input value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="+880 1XXX XXXXXX" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Emergency Contact</Label>
              <Input value={form.emergencyContact} onChange={e => update('emergencyContact', e.target.value)} placeholder="+880 1XXX XXXXXX" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Droplets className="w-3.5 h-3.5" /> Blood Group</Label>
              <Select value={form.bloodGroup} onValueChange={v => update('bloodGroup', v)}>
                <SelectTrigger className="mt-1.5 bg-accent/50 border-border/60">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Gender</Label>
              <Select value={form.gender} onValueChange={v => update('gender', v)}>
                <SelectTrigger className="mt-1.5 bg-accent/50 border-border/60">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Date of Birth</Label>
              <Input type="date" value={form.dateOfBirth} onChange={e => update('dateOfBirth', e.target.value)} className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Address</Label>
            <Input value={form.address} onChange={e => update('address', e.target.value)} placeholder="Your address" className="mt-1.5 bg-accent/50 border-border/60" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Bio</Label>
            <Textarea value={form.bio} onChange={e => update('bio', e.target.value)} placeholder="Tell us about yourself..." rows={3} className="mt-1.5 bg-accent/50 border-border/60 resize-none" />
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full h-11 font-semibold">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </FadeIn>

      {/* Security */}
      <FadeIn delay={0.2}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Security</h3>
        <button
          onClick={() => { setPinMode(user.pinSet ? 'change' : 'set'); setPinOpen(true); }}
          className="w-full rounded-xl border border-border/60 bg-card p-4 flex items-center gap-4 hover:border-primary/20 transition-colors mb-6"
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${user.pinSet ? 'bg-[hsl(var(--chart-3))]/10' : 'bg-[hsl(var(--chart-4))]/10'}`}>
            {user.pinSet ? <ShieldCheck className="w-6 h-6 text-[hsl(var(--chart-3))]" /> : <Lock className="w-6 h-6 text-[hsl(var(--chart-4))]" />}
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-foreground">Wallet PIN</p>
            <p className="text-xs text-muted-foreground">{user.pinSet ? 'PIN is active. Tap to change.' : 'Set a PIN to secure your wallet.'}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </FadeIn>

      {/* Logout */}
      <FadeIn delay={0.25}>
        <Button
          variant="outline"
          className="w-full h-12 text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/30 font-semibold"
          onClick={() => logout({ returnTo: window.location.origin })}
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </FadeIn>

      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode={pinMode} verifyLength={user.pinLength || 4} onSuccess={() => refreshDashboard()} />
    </div>
  );
}
