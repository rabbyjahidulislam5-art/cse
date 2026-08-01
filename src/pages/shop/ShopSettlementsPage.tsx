import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUpRight, Plus, Search, Building2, Clock, CheckCircle2, XCircle, AlertCircle,
  Loader2, Banknote, RefreshCw, FileText, ChevronRight, Check, X, ShieldCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import {
  createShopSettlementRequest,
  getShopSettlements,
  getShopSettlementDetail,
  updateShopBankInfo,
  type SettlementRequestItem,
  type SettlementTimelineItem,
} from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';

export default function ShopSettlementsPage() {
  const [requests, setRequests] = useState<SettlementRequestItem[]>([]);
  const [pendingBalance, setPendingBalance] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  // Request Modal State
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestAmount, setRequestAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [bankRoutingNumber, setBankRoutingNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Bank Info Update Modal State
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [updatingBank, setUpdatingBank] = useState(false);

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<SettlementRequestItem | null>(null);
  const [timeline, setTimeline] = useState<SettlementTimelineItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = () => {
    setLoading(true);
    getShopSettlements({ status: statusFilter })
      .then(d => {
        setRequests(d.requests);
        setPendingBalance(d.pendingBalance);
        setStatusCounts(d.statusCounts || {});
      })
      .catch(() => toast.error('Failed to load settlement requests'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const openRequestModal = () => {
    setRequestAmount(pendingBalance > 0 ? String(pendingBalance) : '');
    setNotes('');
    setRequestModalOpen(true);
  };

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(requestAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid settlement amount');
      return;
    }
    if (amount > pendingBalance) {
      toast.error(`Requested amount ৳${amount.toLocaleString()} exceeds pending balance ৳${pendingBalance.toLocaleString()}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await createShopSettlementRequest({
        requestedAmount: amount,
        bankAccountName,
        bankAccountNumber,
        bankName,
        bankBranch,
        bankRoutingNumber,
        notes,
      });
      toast.success(res.message);
      setRequestModalOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit settlement request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateBankInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingBank(true);
    try {
      await updateShopBankInfo({
        bankAccountName,
        bankAccountNumber,
        bankName,
        bankBranch,
        bankRoutingNumber,
      });
      toast.success('Bank details saved');
      setBankModalOpen(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update bank details');
    } finally {
      setUpdatingBank(false);
    }
  };

  const openDetail = async (reqItem: SettlementRequestItem) => {
    setSelectedRequest(reqItem);
    setDetailModalOpen(true);
    setLoadingDetail(true);
    try {
      const d = await getShopSettlementDetail({ requestId: reqItem.id });
      setTimeline(d.timeline);
    } catch (e: any) {
      toast.error('Failed to load settlement timeline');
    } finally {
      setLoadingDetail(false);
    }
  };

  if (loading && !requests.length) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl space-y-6">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl space-y-6">
      {/* Top Banner */}
      <FadeIn>
        <div className="relative rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 p-6 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative">
            <div>
              <h1 className="text-xl font-bold text-foreground">Shop Pending Settlement</h1>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-muted-foreground">Pending Balance:</span>
                <span className="text-xl font-bold text-primary tabular">৳{pendingBalance.toLocaleString()}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Button onClick={() => setBankModalOpen(true)} variant="outline" size="sm">
                <Building2 className="w-4 h-4 mr-1.5" /> Bank Account
              </Button>
              <Button onClick={openRequestModal} disabled={pendingBalance <= 0} size="sm" className="shadow-lg shadow-primary/20">
                <Plus className="w-4 h-4 mr-1.5" /> Request Settlement
              </Button>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Filter Tabs */}
      <FadeIn delay={0.05}>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {[
            { id: 'all', label: 'All Requests' },
            { id: 'PendingReview', label: 'Pending Review', count: statusCounts.PendingReview },
            { id: 'Approved', label: 'Approved', count: statusCounts.Approved },
            { id: 'Paid', label: 'Paid', count: statusCounts.Paid },
            { id: 'Rejected', label: 'Rejected', count: statusCounts.Rejected },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 border ${
                statusFilter === tab.id
                  ? 'gradient-primary text-primary-foreground border-transparent shadow-md'
                  : 'bg-card text-muted-foreground border-border/60 hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/20 text-current font-mono">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </FadeIn>

      {/* Request List */}
      <FadeIn delay={0.1}>
        {requests.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
            <ArrowUpRight className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">No settlement requests found</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {pendingBalance > 0 ? `You have ৳${pendingBalance.toLocaleString()} available for settlement.` : 'Your revenue is currently fully settled.'}
            </p>
            {pendingBalance > 0 && (
              <Button onClick={openRequestModal} size="sm">Request Settlement</Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(r => (
              <div
                key={r.id}
                onClick={() => openDetail(r)}
                className="rounded-xl border border-border/60 bg-card p-4 hover:border-primary/30 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <ArrowUpRight className="w-5 h-5" />
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-foreground font-mono">{r.reference}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Requested: {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {r.bankName ? ` · ${r.bankName} (${r.bankAccountNumber})` : ''}
                    </p>
                    {r.adminRemarks && (
                      <p className="text-xs text-amber-500/90 italic">Admin note: {r.adminRemarks}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                  <div className="text-left sm:text-right">
                    <p className="text-base font-bold text-foreground tabular">৳{r.requestedAmount.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{r.paidAt ? `Paid ${new Date(r.paidAt).toLocaleDateString()}` : 'In progress'}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        )}
      </FadeIn>

      {/* Request Modal */}
      <Dialog open={requestModalOpen} onOpenChange={setRequestModalOpen}>
        <DialogContent className="max-w-md bg-card border-border/60">
          <DialogHeader>
            <DialogTitle>Request Shop Settlement</DialogTitle>
            <DialogDescription>
              Submit a formal settlement payout request for review by Admin Office.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRequest} className="space-y-4 py-2">
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">Available Pending Balance:</span>
              <span className="text-sm font-bold text-primary tabular">৳{pendingBalance.toLocaleString()}</span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Settlement Amount (৳)</Label>
              <Input
                type="number"
                step="0.01"
                required
                max={pendingBalance}
                value={requestAmount}
                onChange={e => setRequestAmount(e.target.value)}
                placeholder="Enter amount"
                className="bg-accent/50 border-border/60"
              />
            </div>

            <div className="space-y-2 pt-2 border-t border-border/60">
              <Label className="text-xs font-semibold">Disbursement Bank Account</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Bank Name (e.g. Dutch Bangla)" className="bg-accent/50 text-xs border-border/60" />
                <Input value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} placeholder="Account Number" className="bg-accent/50 text-xs border-border/60" />
                <Input value={bankAccountName} onChange={e => setBankAccountName(e.target.value)} placeholder="Account Holder Name" className="bg-accent/50 text-xs border-border/60" />
                <Input value={bankBranch} onChange={e => setBankBranch(e.target.value)} placeholder="Branch Name" className="bg-accent/50 text-xs border-border/60" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notes / Remarks for Admin (Optional)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional instructions..." className="bg-accent/50 border-border/60 resize-none h-16 text-xs" />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setRequestModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plus className="w-4 h-4 mr-1.5" />}
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bank Account Modal */}
      <Dialog open={bankModalOpen} onOpenChange={setBankModalOpen}>
        <DialogContent className="max-w-md bg-card border-border/60">
          <DialogHeader>
            <DialogTitle>Update Shop Bank Information</DialogTitle>
            <DialogDescription>
              Bank account details where settlement payouts will be disbursed.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateBankInfo} className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Account Holder Name</Label>
              <Input value={bankAccountName} onChange={e => setBankAccountName(e.target.value)} placeholder="Full Name as on Bank Account" className="bg-accent/50 text-xs border-border/60" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bank Name</Label>
              <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. Dutch-Bangla Bank PLC" className="bg-accent/50 text-xs border-border/60" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Account Number</Label>
              <Input value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} placeholder="Account Number" className="bg-accent/50 text-xs border-border/60" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Branch Name</Label>
                <Input value={bankBranch} onChange={e => setBankBranch(e.target.value)} placeholder="Branch" className="bg-accent/50 text-xs border-border/60" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Routing Number</Label>
                <Input value={bankRoutingNumber} onChange={e => setBankRoutingNumber(e.target.value)} placeholder="9-digit routing" className="bg-accent/50 text-xs border-border/60" />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setBankModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updatingBank}>
                {updatingBank ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Check className="w-4 h-4 mr-1.5" />}
                Save Bank Details
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Timeline Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-xl bg-card border-border/60 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono">
              {selectedRequest?.reference}
              {selectedRequest && <StatusBadge status={selectedRequest.status} />}
            </DialogTitle>
            <DialogDescription>
              Settlement Request Lifecycle & Audit Log
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-accent/30 border border-border/40 text-xs">
                <div>
                  <span className="text-muted-foreground block">Requested Amount:</span>
                  <span className="text-base font-bold text-foreground">৳{selectedRequest.requestedAmount.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Bank Account:</span>
                  <span className="font-semibold text-foreground">{selectedRequest.bankName || 'Not specified'}</span>
                  <span className="text-muted-foreground block text-[10px] font-mono">{selectedRequest.bankAccountNumber}</span>
                </div>
              </div>

              {selectedRequest.adminRemarks && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
                  <strong>Admin Remarks:</strong> {selectedRequest.adminRemarks}
                </div>
              )}

              {/* Status Timeline */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Status History Timeline</h4>

                {loadingDetail ? (
                  <Skeleton className="h-20 rounded-xl" />
                ) : !timeline.length ? (
                  <p className="text-xs text-muted-foreground">No history logged yet.</p>
                ) : (
                  <div className="space-y-3 relative before:absolute before:left-3.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    {timeline.map(t => (
                      <div key={t.id} className="flex items-start gap-3 relative">
                        <div className="w-7 h-7 rounded-full bg-card border-2 border-primary text-primary flex items-center justify-center shrink-0 text-xs z-10">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 bg-accent/30 p-2.5 rounded-xl border border-border/40 text-xs space-y-0.5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <span className="font-semibold text-foreground">{t.fromStatus} → {t.toStatus}</span>
                            <span className="text-[10px] text-muted-foreground sm:text-right">{new Date(t.createdAt).toLocaleString()}</span>
                          </div>
                          <p className="text-muted-foreground text-[11px]">Changed by: {t.changedBy.fullName} ({t.changedBy.role})</p>
                          {t.reason && <p className="text-foreground italic">{t.reason}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
