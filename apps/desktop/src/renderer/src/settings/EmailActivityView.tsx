import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Search,
} from 'lucide-react';
import type { EmailContentSnapshot, OwnerEmailActivityEntry } from '@selfos/core/schemas';
import {
  AdminOnlyBadge,
  Button,
  Inline,
  Select,
  Stack,
  Text,
  TextInput,
} from '../design-system/components';
import styles from './EmailActivityView.module.css';

const PAGE_SIZE = 20;

const FAMILY_LABEL: Record<string, string> = {
  welcome: 'Welcome',
  'questionnaire-delivery': 'Questionnaire',
  transactional: 'Transactional',
  digest: 'Digest',
  're-engagement': 'Re-engagement',
  'ai-suggestion': 'Suggestion',
  'ai-suggestion-intimacy': 'Intimacy',
  milestone: 'Milestone',
};

type SortField = 'sentAt' | 'subject' | 'status' | 'personName';

const GOOD = new Set(['delivered', 'opened', 'clicked']);
const BAD = new Set(['bounced', 'complained', 'failed']);
const pillClass = (status: string): string =>
  (GOOD.has(status) ? styles.pillGood : BAD.has(status) ? styles.pillBad : styles.pillNeutral) ??
  '';

const when = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * The owner Email-activity view (67 §3.7 / Phase 6, redesigned) — an admin-only surface: summary stats, a
 * search + member/family/status toolbar, a sortable + paginated table, delivery health, CSV export, and a
 * click-to-view detail drawer showing the exact email that was sent (rendered in a sandboxed iframe). The
 * read is `people.manage`-gated at the bridge; never member-facing.
 */
export function EmailActivityView(): JSX.Element {
  const [rows, setRows] = useState<OwnerEmailActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [member, setMember] = useState('all');
  const [family, setFamily] = useState('all');
  const [status, setStatus] = useState('all');
  const [sortField, setSortField] = useState<SortField>('sentAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<OwnerEmailActivityEntry | null>(null);
  const [content, setContent] = useState<EmailContentSnapshot | null | 'loading'>(null);

  useEffect(() => {
    void (async () => {
      setRows((await window.selfos?.emailAllActivity()) ?? []);
      setLoaded(true);
    })();
  }, []);

  const members = useMemo(() => Array.from(new Set(rows.map((r) => r.personName))).sort(), [rows]);
  const families = useMemo(() => Array.from(new Set(rows.map((r) => r.family))).sort(), [rows]);
  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (member === 'all' || r.personName === member) &&
        (family === 'all' || r.family === family) &&
        (status === 'all' || r.status === status) &&
        (q === '' ||
          r.subject.toLowerCase().includes(q) ||
          r.toAddress.toLowerCase().includes(q) ||
          r.personName.toLowerCase().includes(q)),
    );
    const dir = sortDir === 'asc' ? 1 : -1;
    return out.sort((a, b) => {
      const av = String(a[sortField] ?? '');
      const bv = String(b[sortField] ?? '');
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [rows, search, member, family, status, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const stats = useMemo(() => {
    const opened = rows.filter((r) => r.status === 'opened' || r.status === 'clicked').length;
    return {
      sent: rows.length,
      delivered: rows.filter((r) => GOOD.has(r.status)).length,
      opened,
      bounced: rows.filter((r) => BAD.has(r.status)).length,
    };
  }, [rows]);

  const toggleSort = (field: SortField): void => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir(field === 'sentAt' ? 'desc' : 'asc');
    }
    setPage(0);
  };
  const sortIcon = (field: SortField): JSX.Element | null =>
    sortField !== field ? null : sortDir === 'asc' ? (
      <ArrowUp size={13} />
    ) : (
      <ArrowDown size={13} />
    );

  const view = async (row: OwnerEmailActivityEntry): Promise<void> => {
    setSelected(row);
    setContent('loading');
    setContent((await window.selfos?.emailContent({ personId: row.personId, id: row.id })) ?? null);
  };

  const exportCsv = (): void => {
    // Quote per RFC-4180 AND neutralize spreadsheet formula injection: a field starting with =/+/-/@ (or a
    // tab/CR) is executed as a formula in Excel/Sheets, so prefix it with a `'` (a member's display name is
    // user-controllable — e.g. `=HYPERLINK(...)`).
    const esc = (v: string): string => {
      const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = [
      'Member',
      'Family',
      'Subject',
      'To',
      'Status',
      'Sent',
      'Delivered',
      'Opened',
      'Clicked',
    ];
    const lines = filtered.map((r) =>
      [
        r.personName,
        r.family,
        r.subject,
        r.toAddress,
        r.status,
        when(r.sentAt),
        when(r.deliveredAt),
        when(r.openedAt),
        when(r.clickedAt),
      ]
        .map((v) => esc(String(v)))
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selfos-email-activity.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (selected)
    return <EmailDetail row={selected} content={content} onBack={() => setSelected(null)} />;

  return (
    <Stack gap={3} data-testid="email-activity">
      <div className={styles.head}>
        <Inline gap={2} align="center">
          <Text weight={600}>Email activity</Text>
          <AdminOnlyBadge />
        </Inline>
        {rows.length > 0 ? (
          <Button variant="secondary" onClick={exportCsv}>
            <Inline gap={1} align="center">
              <Download size={15} /> Export CSV
            </Inline>
          </Button>
        ) : null}
      </div>

      {!loaded ? null : rows.length === 0 ? (
        <Text size="sm" tone="secondary">
          No email has been sent yet — once SelfOS emails your household, every message shows here.
        </Text>
      ) : (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Sent</div>
              <div className={styles.statValue}>{stats.sent}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Delivered</div>
              <div className={`${styles.statValue} ${styles.good}`}>{stats.delivered}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Opened</div>
              <div className={styles.statValue}>{stats.opened}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statLabel}>Bounced</div>
              <div className={`${styles.statValue} ${stats.bounced > 0 ? styles.bad : ''}`}>
                {stats.bounced}
              </div>
            </div>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.search}>
              <Search size={16} aria-hidden />
              <TextInput
                aria-label="Search email activity"
                placeholder="Search subject, recipient, member…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Select
              aria-label="Filter by member"
              value={member}
              onChange={(e) => {
                setMember(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All members</option>
              {members.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by family"
              value={family}
              onChange={(e) => {
                setFamily(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All families</option>
              {families.map((f) => (
                <option key={f} value={f}>
                  {FAMILY_LABEL[f] ?? f}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>

          {stats.bounced > 0 ? (
            <Text size="sm" tone="secondary">
              Delivery health: {rows.filter((r) => r.status === 'bounced').length} bounced ·{' '}
              {rows.filter((r) => r.status === 'complained').length} complaints.
            </Text>
          ) : null}

          <div className={styles.card}>
            <div className={`${styles.row} ${styles.rowHead}`}>
              <button className={styles.sortBtn} onClick={() => toggleSort('subject')}>
                Email {sortIcon('subject')}
              </button>
              <button className={styles.sortBtn} onClick={() => toggleSort('personName')}>
                Member {sortIcon('personName')}
              </button>
              <button className={styles.sortBtn} onClick={() => toggleSort('status')}>
                Status {sortIcon('status')}
              </button>
              <button className={styles.sortBtn} onClick={() => toggleSort('sentAt')}>
                Sent {sortIcon('sentAt')}
              </button>
              <span />
            </div>
            {paged.map((r) => (
              <button key={r.id} className={styles.row} onClick={() => void view(r)}>
                <div className={styles.cellMain}>
                  <div className={styles.subject}>{r.subject}</div>
                  <div className={styles.sub}>
                    {FAMILY_LABEL[r.family] ?? r.family} · {r.toAddress}
                  </div>
                </div>
                <div className={styles.member}>
                  <span className={styles.avatar}>{initials(r.personName)}</span>
                  <span className={styles.memberName}>{r.personName}</span>
                </div>
                <div>
                  <span className={`${styles.pill} ${pillClass(r.status)}`}>{r.status}</span>
                </div>
                <div className={styles.when}>{when(r.sentAt)}</div>
                <span className={styles.eye} aria-hidden>
                  <Eye size={16} />
                </span>
              </button>
            ))}
          </div>

          <div className={styles.pager}>
            <span>
              {filtered.length === 0
                ? 'No matches'
                : `${clampedPage * PAGE_SIZE + 1}–${Math.min(filtered.length, clampedPage * PAGE_SIZE + PAGE_SIZE)} of ${filtered.length}`}
            </span>
            <Inline gap={1}>
              <Button
                variant="secondary"
                disabled={clampedPage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={15} />
              </Button>
              <Button
                variant="secondary"
                disabled={clampedPage >= pageCount - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={15} />
              </Button>
            </Inline>
          </div>
        </>
      )}
    </Stack>
  );
}

/** The click-to-view detail: subject, from/to, a delivery timeline, and the exact email (sandboxed iframe). */
function EmailDetail({
  row,
  content,
  onBack,
}: {
  row: OwnerEmailActivityEntry;
  content: EmailContentSnapshot | null | 'loading';
  onBack: () => void;
}): JSX.Element {
  return (
    <Stack gap={3}>
      <Inline gap={2} align="center">
        <Button variant="secondary" onClick={onBack}>
          <Inline gap={1} align="center">
            <ArrowLeft size={15} /> Back
          </Inline>
        </Button>
        <Text weight={600}>{row.subject}</Text>
      </Inline>
      <Text size="sm" tone="secondary">
        To {row.toAddress} · sent to {row.personName} ·{' '}
        <span className={`${styles.pill} ${pillClass(row.status)}`}>{row.status}</span>
      </Text>
      <div className={styles.timeline}>
        {row.sentAt ? <span>Sent {when(row.sentAt)}</span> : null}
        {row.deliveredAt ? <span>Delivered {when(row.deliveredAt)}</span> : null}
        {row.openedAt ? <span>Opened {when(row.openedAt)}</span> : null}
        {row.clickedAt ? <span>Clicked {when(row.clickedAt)}</span> : null}
      </div>
      {content === 'loading' ? (
        <Text size="sm" tone="secondary">
          Loading the email…
        </Text>
      ) : content ? (
        <iframe
          className={styles.frame}
          sandbox=""
          title={`Email: ${row.subject}`}
          srcDoc={content.html}
        />
      ) : (
        <Text size="sm" tone="secondary">
          The content of this email wasn’t stored (it was sent before this view existed, or the
          snapshot is unavailable).
        </Text>
      )}
    </Stack>
  );
}
