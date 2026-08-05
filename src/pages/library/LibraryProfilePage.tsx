import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import PinDialog from '@/components/PinDialog';
import { toast } from 'sonner';
import { Loader2, LogOut, Save, User, Lock, ShieldCheck, Mail, Phone, BookOpen, ChevronRight, Camera, FileText, Clock, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getLibraryDetails, updateProfile, updateLibraryDetails, changePassword, uploadFile, type GetLibraryDetailsOutputType } from '@/lib/api';
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

// Mirrors ShopProfilePage.tsx's structure, plus a self-service password-change card (profile
// management "similar to other authenticated users" per the Library onboarding requirement).
export default function LibraryProfilePage() {
  const { logout } = useAuth();
  const [data, setData] = useState<GetLibraryDetailsOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [staffForm, setStaffForm] = useState({ phone: '', bio: '' });
  const [libraryForm, setLibraryForm] = useState({ description: '', operatingHours: '', contactNumber: '', location: '' });
  const [savingStaff, setSavingStaff] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<'set' | 'change'>('set');
  const fileRef = useRef<HTMLInputElement>(null);

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  const load = () => {
    getLibraryDetails({}).then(d => {
      setData(d);
      setStaffForm({ phone: d.staff?.phone || '', bio: d.staff?.bio || '' });
      setLibraryForm({
        description: d.library.description || '', operatingHours: d.library.operatingHours || '',
        contactNumber: d.library.contactNumber || '', location: d.library.location || '',
      });
    }).catch(() => toast.error('Failed to load profile')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSaveStaff = async () => {
    setSavingStaff(true);
    try {
      await updateProfile(staffForm);
      toast.success('Profile updated');
      load();
    } catch (e: any) { toast.error(e.message || 'Failed to update'); }
    finally { setSavingStaff(false); }
  };

  const handleSaveLibrary = async () => {
    setSavingLibrary(true);
    try {
      await updateLibraryDetails(libraryForm);
      toast.success('Library details updated');
      load();
    } catch (e: any) { toast.error(e.message || 'Failed to update'); }
    finally { setSavingLibrary(false); }
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

  const handleChangePassword = async () => {
    if (pwForm.newPassword.length < 8) { toast.error('New password must be at least 8 characters long.'); return; }
    if (pwForm.newPassword !== pwForm.confirmPassword) { toast.error('New passwords do not match.'); return; }
    setSavingPw(true);
    try {
      await changePassword({ currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      toast.success('Password updated');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e: any) { toast.error(e.message || 'Failed to update password'); }
    finally { setSavingPw(false); }
  };

  if (loading || !data) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="flex items-center gap-4"><Skeleton className="w-24 h-24 rounded-2xl" /><div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-56" /></div></div>
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }

  const { staff, library } = data;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <FadeIn>
        <BackButton fallback="/library" />
        <h1 className="text-xl font-bold text-foreground mb-6">Library Staff Profile</h1>

        <div className="flex items-center gap-5 mb-8">
          <div className="relative group">
            {staff?.profilePicture ? (
              <img src={staff.profilePicture} alt="Profile" className="w-24 h-24 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div className="w-24 h-24 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-3xl font-bold text-primary-foreground">{staff?.fullName?.charAt(0) || 'L'}</span>
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
            <h2 className="text-xl font-bold text-foreground">{staff?.fullName || 'Library Staff'}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{library.name}</p>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Identity (Read-only)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
          <ReadOnlyField icon={BookOpen} label="Library Name" value={library.name} />
          <ReadOnlyField icon={Mail} label="Login Email" value={staff?.email || ''} />
        </div>

      </FadeIn>

      <FadeIn delay={0.1}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Personal Details</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-8">
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</Label>
            <Input value={staffForm.phone} onChange={e => setStaffForm(f => ({ ...f, phone: e.target.value }))} placeholder="+880 1XXX XXXXXX" className="mt-1.5 bg-accent/50 border-border/60" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Bio</Label>
            <Textarea value={staffForm.bio} onChange={e => setStaffForm(f => ({ ...f, bio: e.target.value }))} placeholder="A short note about you..." rows={2} className="mt-1.5 bg-accent/50 border-border/60 resize-none" />
          </div>
          <Button onClick={handleSaveStaff} disabled={savingStaff} className="w-full h-11 font-semibold">
            {savingStaff ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {savingStaff ? 'Saving...' : 'Save Personal Details'}
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.15}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Library Details</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Library Contact Number</Label>
              <Input value={libraryForm.contactNumber} onChange={e => setLibraryForm(f => ({ ...f, contactNumber: e.target.value }))} placeholder="+880 1XXX XXXXXX" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Operating Hours</Label>
              <Input value={libraryForm.operatingHours} onChange={e => setLibraryForm(f => ({ ...f, operatingHours: e.target.value }))} placeholder="e.g. 9:00 AM – 8:00 PM" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Location</Label>
            <Input value={libraryForm.location} onChange={e => setLibraryForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Building A, Ground Floor" className="mt-1.5 bg-accent/50 border-border/60" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Description</Label>
            <Textarea value={libraryForm.description} onChange={e => setLibraryForm(f => ({ ...f, description: e.target.value }))} placeholder="What does the library offer?" rows={3} className="mt-1.5 bg-accent/50 border-border/60 resize-none" />
          </div>
          <Button onClick={handleSaveLibrary} disabled={savingLibrary} className="w-full h-11 font-semibold">
            {savingLibrary ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {savingLibrary ? 'Saving...' : 'Save Library Details'}
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.2}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Security</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><KeyRound className="w-4 h-4" /> Change Password</div>
          <div>
            <Label className="text-xs text-muted-foreground">Current Password</Label>
            <div className="relative mt-1.5">
              <Input type={showPw ? 'text' : 'password'} value={pwForm.currentPassword} onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))} placeholder="Current password" className="bg-accent/50 border-border/60 pr-10" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">New Password</Label>
              <Input type={showPw ? 'text' : 'password'} value={pwForm.newPassword} onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="Min 8 chars, upper/lower/number" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Confirm New Password</Label>
              <Input type={showPw ? 'text' : 'password'} value={pwForm.confirmPassword} onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="Repeat new password" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
          </div>
          <Button onClick={handleChangePassword} disabled={savingPw} className="w-full h-11 font-semibold">
            {savingPw ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
            {savingPw ? 'Updating...' : 'Update Password'}
          </Button>
        </div>


      </FadeIn>

      <FadeIn delay={0.25}>
        <Button
          variant="outline"
          className="w-full h-12 text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/30 font-semibold"
          onClick={() => logout({ returnTo: window.location.origin })}
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </FadeIn>

      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode={pinMode} verifyLength={staff?.pinLength || 4} onSuccess={() => load()} />
    </div>
  );
}
