import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Plus, Search, Pencil, Ban, Trash2, CheckCircle, Landmark, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import { getAdminShops, manageShop, type GetAdminShopsOutputType } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';

type Shop = GetAdminShopsOutputType['shops'][0];

export default function ShopManagementPage() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editShop, setEditShop] = useState<Shop | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ shop: Shop; action: 'suspend' | 'activate' | 'remove' } | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Food & Beverage');
  const [formLocation, setFormLocation] = useState('');
  const [formOwnerEmail, setFormOwnerEmail] = useState('');
  const [formOwnerName, setFormOwnerName] = useState('');
  const [formContactNumber, setFormContactNumber] = useState('');

  // Settlement state
  const [settleShop, setSettleShop] = useState<Shop | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleNotes, setSettleNotes] = useState('');
  const [settling, setSettling] = useState(false);

  const loadShops = () => {
    setLoading(true);
    getAdminShops({ search: '' })
      .then(d => setShops(d.shops))
      .catch(() => toast.error('Failed to load shops'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadShops(); }, []);

  const filtered = useMemo(() => {
    let list = shops;
    if (filterStatus !== 'all') list = list.filter(s => s.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [shops, filterStatus, search]);

  const openCreate = () => {
    setEditShop(null);
    setFormName(''); setFormCategory('Food & Beverage'); setFormLocation('');
    setFormOwnerEmail(''); setFormOwnerName(''); setFormContactNumber('');
    setFormOpen(true);
  };

  const openEdit = (shop: Shop) => {
    setEditShop(shop);
    setFormName(shop.name); setFormCategory(shop.category); setFormLocation(shop.location || '');
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) { toast.error('Shop name is required'); return; }
    if (!editShop && !formOwnerEmail.trim()) { toast.error('Owner email is required to create the merchant login'); return; }
    setSaving(true);
    try {
      const result = await manageShop({
        action: editShop ? 'update' : 'create',
        shopId: editShop?.id,
        name: formName,
        category: formCategory,
        location: formLocation,
        ...(editShop ? {} : {
          ownerEmail: formOwnerEmail.trim(),
          ownerName: formOwnerName.trim() || undefined,
          contactNumber: formContactNumber.trim() || undefined,
        }),
      });
      if (!editShop && result.emailDelivered === false && result.tempPassword) {
        toast.warning(
          `Shop created, but the credential email failed to send. Relay this temporary password to the owner manually: ${result.tempPassword}`,
          { duration: 20000 },
        );
      } else {
        toast.success(editShop ? 'Shop updated' : 'Shop created — login credentials emailed to the owner');
      }
      setFormOpen(false);
      loadShops();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async () => {
    if (!confirmAction) return;
    setSaving(true);
    try {
      await manageShop({ action: confirmAction.action, shopId: confirmAction.shop.id });
      toast.success(`Shop ${confirmAction.action === 'remove' ? 'removed' : confirmAction.action === 'suspend' ? 'suspended' : 'activated'}`);
      setConfirmAction(null);
      loadShops();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const openSettle = (shop: Shop) => {
    setSettleShop(shop);
    setSettleAmount(shop.pendingSettlement > 0 ? String(shop.pendingSettlement) : '');
    setSettleNotes('');
  };

  const handleSettle = async () => {
    if (!settleShop) return;
    const amount = parseFloat(settleAmount);
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return; }
    setSettling(true);
    try {
      await manageShop({ action: 'settle', shopId: settleShop.id, amount, notes: settleNotes });
      toast.success('Settlement recorded');
      setSettleShop(null);
      loadShops();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSettling(false); }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Shop Management</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{shops.length} shops registered</p>
          </div>
          <Button onClick={openCreate} size="sm" className="shadow-lg shadow-primary/20">
            <Plus className="w-4 h-4 mr-1.5" /> Add Shop
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input aria-label="Search shops" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shops..." className="pl-9 bg-accent/50 border-border/60" />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-full sm:w-40 bg-accent/50 border-border/60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Suspended">Suspended</SelectItem>
              <SelectItem value="Removed">Removed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
            <Store className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No shops found</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <AnimatePresence>
              {filtered.map((shop) => (
                <motion.div key={shop.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-xl border border-border/60 bg-card p-4 flex items-center gap-4 hover:border-primary/10 transition-colors">
                  <div className="w-11 h-11 rounded-xl bg-accent flex items-center justify-center shrink-0">
                    <Store className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{shop.name}</p>
                      <StatusBadge status={shop.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-muted-foreground">{shop.category}</span>
                      {shop.location && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{shop.location}</span>}
                    </div>
                    {(shop.ownerEmail || shop.contactNumber) && (
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {shop.ownerEmail && <span className="text-[11px] text-muted-foreground font-mono">{shop.ownerEmail}</span>}
                        {shop.contactNumber && <span className="text-[11px] text-muted-foreground">{shop.contactNumber}</span>}
                        {shop.mustChangePassword && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-semibold">Pending first login</span>}
                        {!shop.mustChangePassword && !shop.emailVerified && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-semibold">Email unverified</span>}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs text-muted-foreground">Pending Settlement</p>
                    <p className={`text-sm font-bold tabular ${shop.pendingSettlement > 0 ? 'text-[hsl(var(--chart-4))]' : 'text-muted-foreground'}`}>{formatCurrency(shop.pendingSettlement)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(shop)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" title="Record Settlement" onClick={() => openSettle(shop)}><Landmark className="w-3.5 h-3.5" /></Button>
                    {shop.status === 'Active' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--chart-4))]" onClick={() => setConfirmAction({ shop, action: 'suspend' })}><Ban className="w-3.5 h-3.5" /></Button>
                    )}
                    {shop.status === 'Suspended' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--chart-3))]" onClick={() => setConfirmAction({ shop, action: 'activate' })}><CheckCircle className="w-3.5 h-3.5" /></Button>
                    )}
                    {shop.status !== 'Removed' && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmAction({ shop, action: 'remove' })}><Trash2 className="w-3.5 h-3.5" /></Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </FadeIn>

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="glass-strong rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>{editShop ? 'Edit Shop' : 'Add New Shop'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-xs text-muted-foreground">Shop Name *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Enter shop name" className="mt-1.5 bg-accent/50" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Category *</Label>
              <Select value={formCategory} onValueChange={setFormCategory}>
                <SelectTrigger className="mt-1.5 bg-accent/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Food & Beverage">Food & Beverage</SelectItem>
                  <SelectItem value="Stationery">Stationery</SelectItem>
                  <SelectItem value="Printing">Printing</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Location</Label>
              <Input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="e.g. Building A, Floor 2" className="mt-1.5 bg-accent/50" />
            </div>
            {!editShop && (
              <>
                <div className="pt-2 border-t border-border/50">
                  <p className="text-xs font-semibold text-foreground">Merchant Login</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">A merchant account is created automatically and login credentials are emailed to the owner.</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Owner Email *</Label>
                  <Input type="email" value={formOwnerEmail} onChange={e => setFormOwnerEmail(e.target.value)} placeholder="owner@example.com" className="mt-1.5 bg-accent/50" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Owner Name</Label>
                  <Input value={formOwnerName} onChange={e => setFormOwnerName(e.target.value)} placeholder="Optional" className="mt-1.5 bg-accent/50" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Contact Number</Label>
                  <Input value={formContactNumber} onChange={e => setFormContactNumber(e.target.value)} placeholder="Optional" className="mt-1.5 bg-accent/50" />
                </div>
              </>
            )}
            <Button onClick={handleSubmit} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editShop ? 'Update Shop' : 'Create Shop'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Action */}
      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.action === 'remove' ? 'Remove Shop' : confirmAction?.action === 'suspend' ? 'Suspend Shop' : 'Activate Shop'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === 'remove'
                ? `"${confirmAction?.shop.name}" will be permanently removed from the directory.`
                : confirmAction?.action === 'suspend'
                ? `"${confirmAction?.shop.name}" will be temporarily suspended.`
                : `"${confirmAction?.shop.name}" will be reactivated.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} disabled={saving} className={confirmAction?.action === 'activate' ? '' : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {confirmAction?.action === 'remove' ? 'Remove' : confirmAction?.action === 'suspend' ? 'Suspend' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Record Settlement */}
      <Dialog open={!!settleShop} onOpenChange={(o) => !o && setSettleShop(null)}>
        <DialogContent className="glass-strong rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Record Settlement — {settleShop?.name}</DialogTitle>
            <DialogDescription>Confirm this shop has been paid the collected amount outside the app.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-xl border border-border/60 bg-accent/30 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Received</span><span className="font-semibold text-foreground tabular">{formatCurrency(settleShop?.totalReceived || 0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Already Settled</span><span className="font-semibold text-foreground tabular">{formatCurrency(settleShop?.totalSettled || 0)}</span></div>
              <div className="flex justify-between pt-1.5 border-t border-border/40"><span className="text-muted-foreground">Pending Settlement</span><span className="font-bold text-[hsl(var(--chart-4))] tabular">{formatCurrency(settleShop?.pendingSettlement || 0)}</span></div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Settlement Amount (৳) *</Label>
              <Input type="number" value={settleAmount} onChange={e => setSettleAmount(e.target.value)} placeholder="0.00" className="mt-1.5 bg-accent/50" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <Textarea value={settleNotes} onChange={e => setSettleNotes(e.target.value)} placeholder="e.g. Bank transfer ref, date paid..." rows={2} className="mt-1.5 bg-accent/50" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleShop(null)} disabled={settling}>Cancel</Button>
            <Button onClick={handleSettle} disabled={settling} className="font-semibold">
              {settling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Landmark className="w-4 h-4 mr-2" />}
              Record Settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
