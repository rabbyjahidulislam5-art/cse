import { useState, useEffect } from 'react';
import { Search, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { getAuditLogs, generateAuditLogReport, type GetAuditLogsOutputType } from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';
import ExportButton from '@/components/ExportButton';

type Log = GetAuditLogsOutputType['logs'][0];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const limit = 30;

  const load = (off: number, q?: string) => {
    setLoading(true);
    getAuditLogs({ search: q || '', limit, offset: off })
      .then(d => { setLogs(d.logs); setHasMore(d.hasMore); setOffset(off); })
      .catch(() => toast.error('Failed to load logs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(0); }, []);

  const handleSearch = () => load(0, search);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      <FadeIn>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">System Audit Logs</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Read-only activity history across the entire system</p>
          </div>
          <ExportButton
            supportRoute="/admin/disputes"
            onExport={(format) => generateAuditLogReport({ format })}
          />
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="flex gap-2 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input aria-label="Search logs" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="Search logs..." className="pl-9 bg-accent/50 border-border/60" />
          </div>
          <Button onClick={handleSearch} variant="outline" size="sm" className="h-10">Search</Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : logs.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card p-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No matching log entries</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block rounded-xl border border-border/60 bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Actor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Entity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {logs.map(log => (
                    <tr key={log.id} className="hover:bg-accent/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{log.action}</td>
                      <td className="px-4 py-3 text-muted-foreground">{log.actorName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{log.entityType}</td>
                      <td className="px-4 py-3 text-muted-foreground truncate max-w-[300px]">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {logs.map(log => (
                <div key={log.id} className="rounded-xl border border-border/60 bg-card p-4">
                  <p className="text-sm font-semibold text-foreground">{log.action}</p>
                  <p className="text-xs text-muted-foreground mt-1">by {log.actorName} · {log.entityType}</p>
                  <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">{log.details}</p>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <Button variant="outline" size="sm" onClick={() => load(Math.max(0, offset - limit), search)} disabled={offset === 0}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {Math.floor(offset / limit) + 1}</span>
              <Button variant="outline" size="sm" onClick={() => load(offset + limit, search)} disabled={!hasMore}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </FadeIn>
    </div>
  );
}
