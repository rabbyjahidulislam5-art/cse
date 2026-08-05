import { useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { motion } from 'framer-motion';
import { Search, UserRound, Wallet, ShieldAlert, Receipt, History, GraduationCap, Loader2, ChevronRight, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import {
  searchAccountsStudents, getAccountsStudentProfile,
  type AccountsStudentSearchResult, type StudentFinancialProfileOutputType,
} from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';

const SOURCE_LABELS: Record<string, string> = { semester: 'Semester Fee', library: 'Library Fine', admin: 'Admin Fine', payLater: 'Shop Due' };

function StatTile({ icon: Icon, label, value, tone }: { icon: typeof Wallet; label: string; value: string; tone?: 'default' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className={`w-4 h-4 ${tone === 'warn' ? 'text-destructive' : 'text-muted-foreground'}`} />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={`text-lg font-bold tabular ${tone === 'warn' ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function HistoryRows({ rows }: { rows: Array<{ id: string; label: string; amount: number; status: string; reference: string; updatedAt: string }> }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground px-1 py-4 text-center">No records.</p>;
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.id} className="flex items-center justify-between text-sm rounded-xl bg-accent/30 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-foreground font-medium truncate">{r.label}</p>
            <p className="text-xs text-muted-foreground">{r.reference || '—'} · {new Date(r.updatedAt).toLocaleDateString()}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="font-semibold tabular text-foreground">{formatCurrency(r.amount)}</span>
            <StatusBadge status={r.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StudentFinancialProfilePage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AccountsStudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [profile, setProfile] = useState<StudentFinancialProfileOutputType | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const runSearch = useDebouncedCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await searchAccountsStudents({ query: q.trim() });
      setResults(res.students);
    } catch (e: any) {
      toast.error(e.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }, 350);

  const openProfile = async (studentDbId: string) => {
    setLoadingProfile(true);
    try {
      const p = await getAccountsStudentProfile({ studentDbId });
      setProfile(p);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load student profile');
    } finally {
      setLoadingProfile(false);
    }
  };

  const closeProfile = () => setProfile(null);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <FadeIn>
        <BackButton fallback="/accounts" />
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground">Student Financial Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">Search any student to view a complete financial overview.</p>
        </div>
      </FadeIn>

      {!profile ? (
        <>
          <FadeIn delay={0.05}>
            <div className="relative mb-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => { setQuery(e.target.value); runSearch(e.target.value); }}
                placeholder="Search by Student ID, Name, or Email..."
                aria-label="Search students"
                className="pl-9 bg-accent/50 border-border/60"
                autoFocus
              />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
          </FadeIn>

          {results.length === 0 && query.trim() && !searching ? (
            <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
              <UserRound className="w-9 h-9 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No students matched "{query}".</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((s, i) => (
                <motion.button
                  key={s.id} type="button" onClick={() => openProfile(s.id)}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  className="w-full text-left flex items-center justify-between gap-3 p-4 rounded-xl border border-border/60 bg-card hover:border-primary/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <UserRound className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{s.fullName || s.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.studentId} · {s.department}{s.batch ? ` · ${s.batch}` : ''}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </motion.button>
              ))}
            </div>
          )}
        </>
      ) : loadingProfile ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
          <Skeleton className="h-60 rounded-2xl" />
        </div>
      ) : (
        <FadeIn>
          <button type="button" onClick={closeProfile} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
            <X className="w-4 h-4" /> Back to search
          </button>

          <div className="rounded-2xl border border-border/60 bg-card p-4 mb-5 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center">
                <UserRound className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-base font-bold text-foreground">{profile.student.fullName}</p>
                <p className="text-xs text-muted-foreground">{profile.student.studentId} · {profile.student.email}</p>
              </div>
            </div>
            <StatusBadge status={profile.student.status} />
          </div>

          {profile.restriction.restricted && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 mb-5 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{profile.restriction.reason}</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatTile icon={Wallet} label="Wallet Balance" value={formatCurrency(profile.walletBalance)} />
            <StatTile icon={Receipt} label="Total Outstanding" value={formatCurrency(profile.outstanding.total)} tone={profile.outstanding.total > 0 ? 'warn' : 'default'} />
            <StatTile icon={GraduationCap} label="Scholarship Credits" value={formatCurrency(profile.scholarshipCredits.reduce((s, c) => s + c.amount, 0))} />
            <StatTile icon={History} label="Transactions" value={String(profile.transactions.total)} />
          </div>

          {profile.outstanding.total > 0 && (
            <div className="rounded-2xl border border-border/60 bg-card p-4 mb-6">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Outstanding Breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(Object.entries(profile.outstanding.breakdown) as [keyof typeof SOURCE_LABELS, number][]).map(([key, amount]) => (
                  <div key={key}>
                    <p className="text-xs text-muted-foreground">{SOURCE_LABELS[key] || key}</p>
                    <p className="text-sm font-bold text-foreground tabular mt-0.5">{formatCurrency(amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Tabs defaultValue="transactions">
            <TabsList className="w-full grid grid-cols-3">
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="dues">Dues History</TabsTrigger>
              <TabsTrigger value="scholarships">Scholarships</TabsTrigger>
            </TabsList>

            <TabsContent value="transactions" className="mt-4">
              {profile.transactions.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-1 py-4 text-center">No transactions yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.transactions.rows.map(t => (
                    <div key={t.id} className="flex items-center justify-between text-sm rounded-xl bg-accent/30 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-foreground font-medium truncate">{t.description || t.purpose || t.type}</p>
                        <p className="text-xs text-muted-foreground">{t.reference} · {new Date(t.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className={`font-semibold tabular ${t.direction === 'Credit' ? 'text-[hsl(var(--chart-3))]' : 'text-foreground'}`}>
                          {t.direction === 'Credit' ? '+' : '−'}{formatCurrency(t.amount)}
                        </span>
                        <StatusBadge status={t.status} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="dues" className="mt-4 space-y-5">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Semester Fees</p>
                <HistoryRows rows={profile.history.semesterFee} />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Library Fines</p>
                <HistoryRows rows={profile.history.libraryFine} />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Administrative Fines</p>
                <HistoryRows rows={profile.history.adminFine} />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Shop Dues</p>
                <HistoryRows rows={profile.history.payLaterDue} />
              </div>
            </TabsContent>

            <TabsContent value="scholarships" className="mt-4">
              {profile.scholarshipCredits.length === 0 ? (
                <p className="text-sm text-muted-foreground px-1 py-4 text-center">No scholarship credits yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {profile.scholarshipCredits.map(c => (
                    <div key={c.id} className="flex items-center justify-between text-sm rounded-xl bg-accent/30 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-foreground font-medium truncate">{c.description || 'Scholarship Credit'}</p>
                        <p className="text-xs text-muted-foreground">{c.reference} · {new Date(c.createdAt).toLocaleString()}</p>
                      </div>
                      <span className="font-semibold tabular text-[hsl(var(--chart-3))] shrink-0 ml-2">+{formatCurrency(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </FadeIn>
      )}
    </div>
  );
}
