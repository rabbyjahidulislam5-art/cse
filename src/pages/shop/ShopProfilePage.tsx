import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import PinDialog from '@/components/PinDialog';
import { toast } from 'sonner';
import { Loader2, LogOut, Save, User, Lock, ShieldCheck, Mail, Phone, Store, ChevronRight, Camera, FileText, Clock, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getShopDashboard, updateProfile, updateShopProfile, uploadFile, type GetShopDashboardOutputType } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
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

export default function ShopProfilePage() {
  const { logout } = useAuth();
  const [data, setData] = useState<GetShopDashboardOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownerForm, setOwnerForm] = useState({ phone: '', bio: '' });
  const [shopForm, setShopForm] = useState({ description: '', operatingHours: '', contactNumber: '', location: '' });
  const [savingOwner, setSavingOwner] = useState(false);
  const [savingShop, setSavingShop] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<'set' | 'change'>('set');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    getShopDashboard({}).then(d => {
      setData(d);
      setOwnerForm({ phone: d.owner.phone || '', bio: d.owner.bio || '' });
      setShopForm({
        description: d.shop.description || '', operatingHours: d.shop.operatingHours || '',
        contactNumber: d.shop.contactNumber || '', location: d.shop.location || '',
      });
    }).catch(() => toast.error('Failed to load profile')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSaveOwner = async () => {
    setSavingOwner(true);
    try {
      await updateProfile(ownerForm);
      toast.success('Profile updated');
      load();
    } catch (e: any) { toast.error(e.message || 'Failed to update'); }
    finally { setSavingOwner(false); }
  };

  const handleSaveShop = async () => {
    setSavingShop(true);
    try {
      await updateShopProfile(shopForm);
      toast.success('Shop details updated');
      load();
    } catch (e: any) { toast.error(e.message || 'Failed to update'); }
    finally { setSavingShop(false); }
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
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }

  const { owner, shop, wallet } = data;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <FadeIn>
        <h1 className="text-xl font-bold text-foreground mb-6">Merchant Profile</h1>

        <div className="flex items-center gap-5 mb-6">
          <div className="relative group">
            {owner.profilePicture ? (
              <img src={owner.profilePicture} alt="Profile" className="w-24 h-24 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div className="w-24 h-24 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/20">
                <span className="text-3xl font-bold text-primary-foreground">{owner.fullName?.charAt(0) || 'S'}</span>
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
            <h2 className="text-xl font-bold text-foreground">{owner.fullName || 'Merchant'}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{shop.name} · {shop.category}</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Merchant ID: {shop.merchantId}</p>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="rounded-2xl border border-border/60 bg-card p-4 flex items-center gap-4 mb-8">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Wallet Balance</p>
            <p className="text-lg font-bold text-foreground tabular">{formatCurrency(wallet.balance)}</p>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Identity (Read-only)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-8">
          <ReadOnlyField icon={Store} label="Shop Name" value={shop.name} />
          <ReadOnlyField icon={Mail} label="Login Email" value={owner.email} />
        </div>
        <p className="text-[11px] text-muted-foreground -mt-6 mb-8">Shop name and login email are admin-managed — contact the Admin Office to change them.</p>
      </FadeIn>

      <FadeIn delay={0.15}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Personal Details</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-8">
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Phone</Label>
            <Input value={ownerForm.phone} onChange={e => setOwnerForm(f => ({ ...f, phone: e.target.value }))} placeholder="+880 1XXX XXXXXX" className="mt-1.5 bg-accent/50 border-border/60" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Bio</Label>
            <Textarea value={ownerForm.bio} onChange={e => setOwnerForm(f => ({ ...f, bio: e.target.value }))} placeholder="Tell students about yourself..." rows={2} className="mt-1.5 bg-accent/50 border-border/60 resize-none" />
          </div>
          <Button onClick={handleSaveOwner} disabled={savingOwner} className="w-full h-11 font-semibold">
            {savingOwner ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {savingOwner ? 'Saving...' : 'Save Personal Details'}
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.2}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Shop Details</h3>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4 mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Shop Contact Number</Label>
              <Input value={shopForm.contactNumber} onChange={e => setShopForm(f => ({ ...f, contactNumber: e.target.value }))} placeholder="+880 1XXX XXXXXX" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Operating Hours</Label>
              <Input value={shopForm.operatingHours} onChange={e => setShopForm(f => ({ ...f, operatingHours: e.target.value }))} placeholder="e.g. 9:00 AM – 8:00 PM" className="mt-1.5 bg-accent/50 border-border/60" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Location</Label>
            <Input value={shopForm.location} onChange={e => setShopForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Building A, Floor 2" className="mt-1.5 bg-accent/50 border-border/60" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Business Description</Label>
            <Textarea value={shopForm.description} onChange={e => setShopForm(f => ({ ...f, description: e.target.value }))} placeholder="What does your shop offer?" rows={3} className="mt-1.5 bg-accent/50 border-border/60 resize-none" />
          </div>
          <Button onClick={handleSaveShop} disabled={savingShop} className="w-full h-11 font-semibold">
            {savingShop ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {savingShop ? 'Saving...' : 'Save Shop Details'}
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.25}>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Security</h3>
        <button
          onClick={() => { setPinMode(owner.pinSet ? 'change' : 'set'); setPinOpen(true); }}
          className="w-full rounded-xl border border-border/60 bg-card p-4 flex items-center gap-4 hover:border-primary/20 transition-colors mb-6"
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${owner.pinSet ? 'bg-[hsl(var(--chart-3))]/10' : 'bg-[hsl(var(--chart-4))]/10'}`}>
            {owner.pinSet ? <ShieldCheck className="w-6 h-6 text-[hsl(var(--chart-3))]" /> : <Lock className="w-6 h-6 text-[hsl(var(--chart-4))]" />}
          </div>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-foreground">Wallet PIN</p>
            <p className="text-xs text-muted-foreground">{owner.pinSet ? 'PIN is active. Tap to change.' : 'Set a PIN to secure your wallet.'}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </FadeIn>

      <FadeIn delay={0.3}>
        <Button
          variant="outline"
          className="w-full h-12 text-destructive border-destructive/20 hover:bg-destructive/5 hover:border-destructive/30 font-semibold"
          onClick={() => logout({ returnTo: window.location.origin })}
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </FadeIn>

      <PinDialog open={pinOpen} onOpenChange={setPinOpen} mode={pinMode} verifyLength={owner.pinLength || 4} onSuccess={() => load()} />
    </div>
  );
}
