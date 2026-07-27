import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Store, Plus, Search, Pencil, Ban, Trash2, CheckCircle, X, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import { getAdminShops, manageShop, type GetAdminShopsOutputType } from '@/lib/api';
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
    setFormOpen(true);
  };

  const openEdit = (shop: Shop) => {
    setEditShop(shop);
    setFormName(shop.name); setFormCategory(shop.category); setFormLocation(shop.location || '');
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) { toast.error('Shop name is required'); return; }
    setSaving(true);
    try {
      await manageShop({
        action: editShop ? 'update' : 'create',
        shopId: editShop?.id,
        name: formName,
        category: formCategory,
        location: formLocation,
      });
      toast.success(editShop ? 'Shop updated' : 'Shop created');
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
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shops..." className="pl-9 bg-accent/50 border-border/60" />
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
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(shop)}><Pencil className="w-3.5 h-3.5" /></Button>
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
    </div>
  );
}
