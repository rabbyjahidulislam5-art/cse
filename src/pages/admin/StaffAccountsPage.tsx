import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserCog, Plus, Search, Pencil, Ban, CheckCircle, Loader2, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import { getStaff, manageStaff, type GetStaffOutputType } from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';

type Staff = GetStaffOutputType['staff'][0];

const roleBadgeColor: Record<string, string> = {
  'Admin Office': '--chart-5',
  'Library': '--chart-2',
  'Accounts Office': '--chart-4',
  'Shop Staff': '--chart-3',
};

export default function StaffAccountsPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editStaff, setEditStaff] = useState<Staff | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ staff: Staff; action: 'suspend' | 'activate' } | null>(null);
  const [saving, setSaving] = useState(false);

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('Admin Office');
  const [formPhone, setFormPhone] = useState('');
  const [formDept, setFormDept] = useState('');

  const loadStaff = () => {
    setLoading(true);
    getStaff({ search: '' })
      .then(d => setStaff(d.staff))
      .catch(() => toast.error('Failed to load staff'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStaff(); }, []);

  const filtered = useMemo(() => {
    if (!search) return staff;
    const q = search.toLowerCase();
    return staff.filter(s => s.fullName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.role.toLowerCase().includes(q));
  }, [staff, search]);

  const openCreate = () => {
    setEditStaff(null);
    setFormName(''); setFormEmail(''); setFormRole('Admin Office'); setFormPhone(''); setFormDept('');
    setFormOpen(true);
  };

  const openEdit = (s: Staff) => {
    setEditStaff(s);
    setFormName(s.fullName); setFormEmail(s.email); setFormRole(s.role); setFormPhone(s.phone); setFormDept(s.department);
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !formEmail.trim()) { toast.error('Name and email are required'); return; }
    setSaving(true);
    try {
      await manageStaff({
        action: editStaff ? 'update' : 'create',
        staffId: editStaff?.id,
        fullName: formName,
        email: formEmail,
        role: formRole,
        phone: formPhone,
        department: formDept,
      });
      toast.success(editStaff ? 'Staff updated' : 'Staff account created');
      setFormOpen(false);
      loadStaff();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async () => {
    if (!confirmAction) return;
    setSaving(true);
    try {
      await manageStaff({ action: confirmAction.action, staffId: confirmAction.staff.id });
      toast.success(`Staff ${confirmAction.action === 'suspend' ? 'suspended' : 'activated'}`);
      setConfirmAction(null);
      loadStaff();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      <FadeIn>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Staff Accounts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{staff.length} staff members</p>
          </div>
          <Button onClick={openCreate} size="sm" className="shadow-lg shadow-primary/20 shrink-0 self-start sm:self-auto">
            <Plus className="w-4 h-4 mr-1.5" /> Add Staff
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input aria-label="Search staff" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff..." className="pl-9 bg-accent/50 border-border/60" />
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
            <UserCog className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No staff accounts found</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <AnimatePresence>
              {filtered.map(s => (
                <motion.div key={s.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="rounded-xl border border-border/60 bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 hover:border-primary/10 transition-colors">
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0" style={{ background: `hsl(var(${roleBadgeColor[s.role] || '--chart-1'}) / 0.1)` }}>
                      <span className="text-sm font-bold" style={{ color: `hsl(var(${roleBadgeColor[s.role] || '--chart-1'}))` }}>{s.fullName.charAt(0)}</span>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground truncate">{s.fullName}</p>
                        <StatusBadge status={s.status} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: `hsl(var(${roleBadgeColor[s.role] || '--chart-1'}) / 0.1)`, color: `hsl(var(${roleBadgeColor[s.role] || '--chart-1'}))` }}>
                          {s.role}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">{s.email}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 justify-end pt-2 sm:pt-0 border-t border-border/40 sm:border-t-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit Staff" onClick={() => openEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                    {s.status === 'Active' ? (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--chart-4))]" title="Suspend Staff" onClick={() => setConfirmAction({ staff: s, action: 'suspend' })}><Ban className="w-3.5 h-3.5" /></Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--chart-3))]" title="Activate Staff" onClick={() => setConfirmAction({ staff: s, action: 'activate' })}><CheckCircle className="w-3.5 h-3.5" /></Button>
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
        <DialogContent className="glass-strong rounded-2xl w-[calc(100vw-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>{editStaff ? 'Edit Staff' : 'Add Staff Account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-xs text-muted-foreground">Full Name *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Enter full name" className="mt-1.5 bg-accent/50" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email *</Label>
              <Input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="name@gmail.com" className="mt-1.5 bg-accent/50" disabled={!!editStaff} />
              <p className="text-[10px] text-muted-foreground mt-1">Use a real inbox — login credentials are emailed here automatically.</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Role *</Label>
              <Select value={formRole} onValueChange={setFormRole}>
                <SelectTrigger className="mt-1.5 bg-accent/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Admin Office">Admin Office</SelectItem>
                  <SelectItem value="Library">Library</SelectItem>
                  <SelectItem value="Accounts Office">Accounts Office</SelectItem>
                  <SelectItem value="Shop Staff">Shop Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="+880 1XXX XXXXXX" className="mt-1.5 bg-accent/50" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Department</Label>
              <Input value={formDept} onChange={e => setFormDept(e.target.value)} placeholder="e.g. Administration" className="mt-1.5 bg-accent/50" />
            </div>
            <Button onClick={handleSubmit} disabled={saving} className="w-full">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editStaff ? 'Update Staff' : 'Create Account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Action */}
      <AlertDialog open={!!confirmAction} onOpenChange={o => !o && setConfirmAction(null)}>
        <AlertDialogContent className="glass-strong rounded-2xl w-[calc(100vw-2rem)] sm:max-w-md p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction?.action === 'suspend' ? 'Suspend Staff' : 'Activate Staff'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === 'suspend'
                ? `${confirmAction.staff.fullName} will be unable to access the system.`
                : `${confirmAction?.staff.fullName} will regain access.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} disabled={saving} className={confirmAction?.action === 'suspend' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {confirmAction?.action === 'suspend' ? 'Suspend' : 'Activate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
