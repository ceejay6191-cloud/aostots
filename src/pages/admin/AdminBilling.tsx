import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import {
  fetchClientsBilling,
  fetchReminderHistory,
  fetchSettings,
  sendReminder,
} from "@/services/adminService";
import { AppUser, Client, Invoice, ReminderEmail, Subscription } from "@/types/admin";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type BillingRow = {
  rowId: string;
  client: Client | null;
  user: AppUser | null;
  subscription: Subscription | null;
  invoice: Invoice | null;
  status: "paid" | "unpaid" | "overdue" | "dueSoon";
  dueSoon: boolean;
  daysOverdue: number;
  displayDueDate: string | null;
  displayName: string;
  displayEmail: string | null;
};

const tabOptions = ["overdue", "dueSoon", "all"] as const;

export default function AdminBilling() {
  const { canEditBilling } = useAdminAccess();
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<(typeof tabOptions)[number]>("overdue");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewClient, setPreviewClient] = useState<BillingRow | null>(null);
  const [reminderHistory, setReminderHistory] = useState<ReminderEmail[]>([]);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { clients, subscriptions, invoices, users } = await fetchClientsBilling();
        const formatted = buildBillingRows(clients, subscriptions, invoices, users);
        if (!cancelled) setRows(formatted);
      } catch (e: any) {
        if (!cancelled) {
          toast({ title: "Could not load billing", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (activeTab === "overdue" && row.status !== "overdue") return false;
      if (activeTab === "dueSoon" && !row.dueSoon) return false;
      if (term) {
        const haystack = `${row.displayName} ${row.displayEmail ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [rows, activeTab, search]);

  const allSelected = filteredRows.length && filteredRows.every((row) => selected.has(row.rowId));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(filteredRows.map((row) => row.rowId)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openReminderPreview = async (row: BillingRow) => {
    if (!row.client) {
      toast({ title: "Reminder unavailable", description: "No client billing record linked." });
      return;
    }
    const settings = await fetchSettings();
    const subject = applyTemplate(settings.emailTemplate.subject, row);
    const body = applyTemplate(settings.emailTemplate.body, row);
    setEmailSubject(subject);
    setEmailBody(body);
    setPreviewClient(row);
    const history = await fetchReminderHistory(row.client.id);
    setReminderHistory(history);
  };

  const sendReminderNow = async () => {
    if (!previewClient?.client) return;
    try {
      await sendReminder({
        clientId: previewClient.client.id,
        subject: emailSubject,
        body: emailBody,
      });
      toast({ title: "Reminder sent" });
      setPreviewClient(null);
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.message, variant: "destructive" });
    }
  };

  const sendBulkReminders = async () => {
    const items = filteredRows.filter((row) => selected.has(row.rowId) && row.client);
    if (!items.length) return;
    try {
      const settings = await fetchSettings();
      for (const row of items) {
        await sendReminder({
          clientId: row.client!.id,
          subject: applyTemplate(settings.emailTemplate.subject, row),
          body: applyTemplate(settings.emailTemplate.body, row),
        });
      }
      toast({ title: "Bulk reminders sent" });
      setSelected(new Set());
    } catch (e: any) {
      toast({ title: "Bulk send failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">Billing & reminders</div>
          <div className="text-sm text-slate-500">Track overdue accounts and send reminders.</div>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Search clients..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {tabOptions.map((tab) => (
              <Button
                key={tab}
                variant={activeTab === tab ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTab(tab)}
              >
                {tab === "dueSoon" ? "Due soon" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" disabled={!selected.size || !canEditBilling} onClick={sendBulkReminders}>
            Send bulk reminders
          </Button>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Amount due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Days overdue</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.rowId}>
                    <TableCell>
                      <Checkbox checked={selected.has(row.rowId)} onCheckedChange={() => toggleOne(row.rowId)} />
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">{row.displayName}</TableCell>
                    <TableCell>{row.subscription?.plan_name ?? "--"}</TableCell>
                    <TableCell>{row.displayDueDate ?? "--"}</TableCell>
                    <TableCell>${row.subscription?.amount?.toLocaleString() ?? "0"}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                          row.status === "overdue"
                            ? "bg-rose-100 text-rose-700"
                            : row.status === "paid"
                            ? "bg-emerald-100 text-emerald-700"
                            : row.status === "dueSoon"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {row.status === "dueSoon" ? "due soon" : row.status}
                      </span>
                    </TableCell>
                    <TableCell>{row.daysOverdue > 0 ? row.daysOverdue : "--"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => openReminderPreview(row)}>
                        Send reminder
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>

      <Dialog open={!!previewClient} onOpenChange={(open) => !open && setPreviewClient(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Email reminder preview</DialogTitle>
            <DialogDescription>
              Review the email before sending. A copy will be logged to reminder history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            <textarea
              className="h-40 w-full rounded-md border border-input bg-background p-3 text-sm"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">History ({reminderHistory.length})</div>
              <Button onClick={sendReminderNow} disabled={!canEditBilling}>
                Send reminder
              </Button>
            </div>
            <div className="max-h-40 space-y-2 overflow-auto rounded-md border p-2 text-xs text-slate-500">
              {reminderHistory.length ? (
                reminderHistory.map((entry) => (
                  <div key={entry.id} className="rounded-md border p-2">
                    <div className="font-semibold text-slate-900">{entry.subject}</div>
                    <div>{new Date(entry.sent_at).toLocaleString()}</div>
                  </div>
                ))
              ) : (
                <div>No reminders sent yet.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildBillingRows(
  clients: Client[],
  subscriptions: Subscription[],
  invoices: Invoice[],
  users: AppUser[]
): BillingRow[] {
  const today = new Date();
  const rows: BillingRow[] = [];

  for (const client of clients) {
    const subscription = subscriptions.find((sub) => sub.client_id === client.id) ?? null;
    const user = users.find((row) => row.client_id === client.id) ?? null;
    const invoice = invoices.find((inv) => inv.client_id === client.id) ?? null;
    const dueDate = subscription?.next_due_date ? new Date(subscription.next_due_date) : null;
    const expiresDate = user?.subscription_expires_at ? new Date(user.subscription_expires_at) : null;
    const daysOverdue = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86400000) : 0;
    const expiresInDays = expiresDate
      ? Math.ceil((expiresDate.getTime() - today.getTime()) / 86400000)
      : null;
    const overdue = invoice?.status === "overdue" || subscription?.status === "past_due" || daysOverdue > 0;
    const dueSoon = !overdue && expiresInDays !== null && expiresInDays >= 0 && expiresInDays <= 7;
    const status: BillingRow["status"] = overdue
      ? "overdue"
      : dueSoon
      ? "dueSoon"
      : subscription
      ? "unpaid"
      : "paid";
    rows.push({
      rowId: client.id,
      client,
      user,
      subscription,
      invoice,
      status,
      dueSoon,
      daysOverdue: overdue ? Math.max(1, daysOverdue) : 0,
      displayDueDate: subscription?.next_due_date ?? user?.subscription_expires_at ?? null,
      displayName: client.name,
      displayEmail: client.billing_email,
    });
  }

  for (const user of users) {
    if (!user.subscription_expires_at) continue;
    if (user.client_id && clients.some((client) => client.id === user.client_id)) continue;
    const expiresDate = new Date(user.subscription_expires_at);
    const expiresInDays = Math.ceil((expiresDate.getTime() - today.getTime()) / 86400000);
    const dueSoon = expiresInDays >= 0 && expiresInDays <= 7;
    const overdue = expiresInDays < 0;
    const status: BillingRow["status"] = overdue ? "overdue" : dueSoon ? "dueSoon" : "unpaid";
    rows.push({
      rowId: `user-${user.user_id}`,
      client: null,
      user,
      subscription: null,
      invoice: null,
      status,
      dueSoon,
      daysOverdue: overdue ? Math.abs(expiresInDays) : 0,
      displayDueDate: user.subscription_expires_at,
      displayName: user.full_name ?? user.email,
      displayEmail: user.email,
    });
  }

  return rows;
}

function applyTemplate(template: string, row: BillingRow) {
  const paymentLink = "https://billing.aostots.com/pay";
  const dueDate = row.displayDueDate ?? "--";
  return template
    .replace(/{{client_name}}/g, row.client?.name ?? row.displayName)
    .replace(/{{amount_due}}/g, `$${row.subscription?.amount ?? 0}`)
    .replace(/{{due_date}}/g, dueDate)
    .replace(/{{days_overdue}}/g, String(row.daysOverdue))
    .replace(/{{payment_link}}/g, paymentLink)
    .replace(/{{support_email}}/g, "support@aostots.com");
}
