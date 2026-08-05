import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, LogOut, Save, User, Lock, ShieldCheck, Mail, Phone, Hash, Camera, MapPin, Droplets, Calendar, FileText, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getAdminProfile, updateProfile, uploadFile, type GetAdminProfileOutputType } from '@/lib/api';
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

// Mirrors student/ProfilePage.tsx's design exactly, adapted to Admin Office's identity fields
// (no studentId/department/batch — Full Name/Email/Role/Employee ID instead).
export default function AdminProfilePage() {
  const { logout } = useAuth();
  const [data, setData] = useState<GetAdminProfileOutputType['user'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    phone: '', emergencyContact: '', address: '', bloodGroup: '',
    gender: '', dateOfBirth: '', bio: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    getAdminProfile({})
      .then(({ user }) => {
        setData(user);
        setForm({
          phone: user.phone || '',
          emergencyContact: user.emergencyContact || '',
          address: user.address || '',
          bloodGroup: user.bloodGroup || '',
          gender: user.gender || '',
          dateOfBirth: user.dateOfBirth || '',
          bio: user.bio || '',
        });
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success('Profile updated successfully');
      load();
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
      load();
    } catch (e: any) { toast.error(e.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  if (loading || !data) {
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
        <BackButton fallback="/admin" />
        <h1 className="text-xl font-bold text-foreground mb-6">Profile</h1>

        {/* Avatar & Identity */}
        <div className="flex items-center gap-5 mb-8">
          <div className="relative group">
            {data.profilePicture ? (
              <img src={data.profilePicture} alt="Profile" className="w-24 h-24 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-destructive/80 to-destructive flex items-center justify-center shadow-lg shadow-destructive/20">
                <span className="text-3xl font-bold text-destructive-foreground">{data.fullName?.charAt(0) || 'A'}</span>
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-destructive flex items-center justify-center shadow-md hover:bg-destructive/90 transition-colors"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-destructive-foreground" /> : <Camera className="w-3.5 h-3.5 text-destructive-foreground" />}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-foreground">{data.fullName || 'Admin'}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{data.role || 'Admin Office'} · {data.employeeId}</p>
          </div>
        </div>
      </FadeIn>

      {/* Read-only identity fields */}
      <FadeIn delay={0.1}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Identity (Read-only)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
          <ReadOnlyField icon={User} label="Full Name" value={data.fullName} />
          <ReadOnlyField icon={Hash} label="Employee ID" value={data.employeeId} />
          <ReadOnlyField icon={ShieldCheck} label="Role" value={data.role} />
          <ReadOnlyField icon={Mail} label="Email" value={data.email} />
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
    </div>
  );
}
