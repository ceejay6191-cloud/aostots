import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import {
  fetchClientsBilling,
  fetchReminderEmails,
  fetchReminderHistory,
  fetchSettings,
  sendReminder,
} from "@/services/adminService";
import {
  AppUser,
  Client,
  DunningEvent,
  Invoice,
  Payment,
  ReminderEmail,
  Subscription,
} from "@/types/admin";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type InvoiceRow = {
  rowId: string;
  client: Client | null;
  user: AppUser | null;
  subscription: Subscription | null;
  invoice: Invoice | null;
  status: "paid" | "unpaid" | "overdue" | "dueSoon" | "open";
  dueSoon: boolean;
  daysOverdue: number;
  dueDate: string | null;
  displayName: string;
  displayEmail: string | null;
  amountDue: number;
};

const tabOptions = ["invoices", "payments", "dunning", "reminders"] as const;
const invoiceStatusOptions = ["all", "overdue", "dueSoon", "open", "paid"] as const;

export default function AdminBilling() {
  const { canEditBilling } = useAdminAccess();
  const [invoiceRows, setInvoiceRows] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [dunningEvents, setDunningEvents] = useState<DunningEvent[]>([]);
  const [reminders, setReminders] = useState<ReminderEmail[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<(typeof tabOptions)[number]>("invoices");
  const [invoiceFilter, setInvoiceFilter] = useState<(typeof invoiceStatusOptions)[number]>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewClient, setPreviewClient] = useState<InvoiceRow | null>(null);
  const [reminderHistory, setReminderHistory] = useState<ReminderEmail[]>([]);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const { clients, subscriptions, invoices, users, payments, dunningEvents } = await fetchClientsBilling();
        const formatted = buildInvoiceRows(clients, subscriptions, invoices, users);
        const reminderRows = await fetchReminderEmails();
        if (cancelled) return;
        setClients(clients);
        setInvoiceRows(formatted);
        setPayments(payments);
        setDunningEvents(dunningEvents);
        setReminders(reminderRows);
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

  useEffect(() => {
    setSelected(new Set());
  }, [activeTab]);

  const filteredInvoiceRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return invoiceRows.filter((row) => {
      if (invoiceFilter === "overdue" && row.status !== "overdue") return false;
      if (invoiceFilter === "paid" && row.status !== "paid") return false;
      if (invoiceFilter === "open" && row.status !== "open" && row.status !== "unpaid") return false;
      if (invoiceFilter === "dueSoon" && !row.dueSoon) return false;
      if (term) {
        const haystack = `${row.displayName} ${row.displayEmail ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [invoiceRows, invoiceFilter, search]);

  const filteredPayments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return payments.filter((payment) => {
      if (!term) return true;
      return payment.id.toLowerCase().includes(term);
    });
  }, [payments, search]);

  const filteredDunning = useMemo(() => {
    const term = search.trim().toLowerCase();
    return dunningEvents.filter((event) => {
      if (!term) return true;
      return event.stage.toLowerCase().includes(term);
    });
  }, [dunningEvents, search]);

  const filteredReminders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reminders.filter((reminder) => {
      if (!term) return true;
      return reminder.subject.toLowerCase().includes(term);
    });
  }, [reminders, search]);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => map.set(client.id, client.name));
    return map;
  }, [clients]);

  const allSelected = filteredInvoiceRows.length && filteredInvoiceRows.every((row) => selected.has(row.rowId));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(filteredInvoiceRows.map((row) => row.rowId)));
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openReminderPreview = async (row: InvoiceRow) => {
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
      const reminderRows = await fetchReminderEmails();
      setReminders(reminderRows);
    } catch (e: any) {
      toast({ title: "Send failed", description: e?.message, variant: "destructive" });
    }
  };

  const sendBulkReminders = async () => {
    const items = filteredInvoiceRows.filter((row) => selected.has(row.rowId) && row.client);
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
      const reminderRows = await fetchReminderEmails();
      setReminders(reminderRows);
    } catch (e: any) {
      toast({ title: "Bulk send failed", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="text-2xl font-semibold text-slate-900">Billing</div>
          <div className="text-sm text-slate-500">Invoices, payments, dunning, and reminder workflows.</div>
        </div>
        <div className="flex items-center gap-2">
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Button>
            ))}
          </div>
          {activeTab === "invoices" && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={invoiceFilter}
                onChange={(event) => setInvoiceFilter(event.target.value as typeof invoiceFilter)}
              >
                <option value="all">All invoices</option>
                <option value="overdue">Overdue</option>
                <option value="dueSoon">Due soon</option>
                <option value="open">Open</option>
                <option value="paid">Paid</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={!selected.size || !canEditBilling}
                onClick={sendBulkReminders}
              >
                Send bulk reminders
              </Button>
            </div>
          )}
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-10 w-full" />
              ))}
            </div>
          ) : null}

          {!loading && activeTab === "invoices" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Amount due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Days overdue</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoiceRows.map((row) => (
                  <TableRow key={row.rowId}>
                    <TableCell>
                      <Checkbox checked={selected.has(row.rowId)} onCheckedChange={() => toggleOne(row.rowId)} />
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">{row.displayName}</TableCell>
                    <TableCell>{row.invoice?.invoice_number ?? "--"}</TableCell>
                    <TableCell>{row.dueDate ?? "--"}</TableCell>
                    <TableCell>${row.amountDue.toLocaleString()}</TableCell>
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

          {!loading && activeTab === "payments" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid at</TableHead>
                  <TableHead>Failure</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium text-slate-900">{payment.id}</TableCell>
                    <TableCell>{clientNameById.get(payment.client_id) ?? payment.client_id}</TableCell>
                    <TableCell>{payment.invoice_id ?? "--"}</TableCell>
                    <TableCell>
                      ${payment.amount.toLocaleString()} {payment.currency}
                    </TableCell>
                    <TableCell>{payment.status}</TableCell>
                    <TableCell>{payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "--"}</TableCell>
                    <TableCell>{payment.failure_message ?? "--"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!loading && activeTab === "dunning" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Occurred</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDunning.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium text-slate-900">{event.stage}</TableCell>
                    <TableCell>{clientNameById.get(event.client_id) ?? event.client_id}</TableCell>
                    <TableCell>{event.invoice_id ?? "--"}</TableCell>
                    <TableCell>{new Date(event.occurred_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {Object.keys(event.metadata ?? {}).length ? JSON.stringify(event.metadata) : "--"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!loading && activeTab === "reminders" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Sent at</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReminders.map((reminder) => (
                  <TableRow key={reminder.id}>
                    <TableCell className="font-medium text-slate-900">{reminder.subject}</TableCell>
                    <TableCell>{clientNameById.get(reminder.client_id) ?? reminder.client_id}</TableCell>
                    <TableCell>{new Date(reminder.sent_at).toLocaleString()}</TableCell>
                    <TableCell>{reminder.status}</TableCell>
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
            <Textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
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

function buildInvoiceRows(
  clients: Client[],
  subscriptions: Subscription[],
  invoices: Invoice[],
  users: AppUser[]
): InvoiceRow[] {
  const today = new Date();
  const rows: InvoiceRow[] = [];

  for (const client of clients) {
    const subscription = subscriptions.find((sub) => sub.client_id === client.id) ?? null;
    const user = users.find((row) => row.client_id === client.id) ?? null;
    const clientInvoices = invoices.filter((inv) => inv.client_id === client.id);
    if (!clientInvoices.length) {
      const expiresDate = user?.subscription_expires_at ? new Date(user.subscription_expires_at) : null;
      const expiresInDays = expiresDate
        ? Math.ceil((expiresDate.getTime() - today.getTime()) / 86400000)
        : null;
      const dueSoon = expiresInDays !== null && expiresInDays >= 0 && expiresInDays <= 7;
      const overdue = expiresInDays !== null && expiresInDays < 0;
      rows.push({
        rowId: client.id,
        client,
        user,
        subscription,
        invoice: null,
        status: overdue ? "overdue" : dueSoon ? "dueSoon" : "unpaid",
        dueSoon,
        daysOverdue: overdue ? Math.abs(expiresInDays ?? 0) : 0,
        dueDate: user?.subscription_expires_at ?? subscription?.next_due_date ?? null,
        displayName: client.name,
        displayEmail: client.billing_email,
        amountDue: subscription?.amount ?? 0,
      });
      continue;
    }

    for (const invoice of clientInvoices) {
      const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
      const daysOverdue = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86400000) : 0;
      const overdue = invoice.status === "overdue" || daysOverdue > 0;
      const dueSoon = !overdue && dueDate
        ? Math.ceil((dueDate.getTime() - today.getTime()) / 86400000) <= 7
        : false;
      const status: InvoiceRow["status"] = overdue
        ? "overdue"
        : dueSoon
        ? "dueSoon"
        : invoice.status === "paid"
        ? "paid"
        : "open";
      rows.push({
        rowId: invoice.id,
        client,
        user,
        subscription,
        invoice,
        status,
        dueSoon,
        daysOverdue: overdue ? Math.max(1, daysOverdue) : 0,
        dueDate: invoice.due_date,
        displayName: client.name,
        displayEmail: client.billing_email,
        amountDue: invoice.amount_due,
      });
    }
  }

  for (const user of users) {
    if (!user.subscription_expires_at) continue;
    if (user.client_id && clients.some((client) => client.id === user.client_id)) continue;
    const expiresDate = new Date(user.subscription_expires_at);
    const expiresInDays = Math.ceil((expiresDate.getTime() - today.getTime()) / 86400000);
    const dueSoon = expiresInDays >= 0 && expiresInDays <= 7;
    const overdue = expiresInDays < 0;
    rows.push({
      rowId: `user-${user.user_id}`,
      client: null,
      user,
      subscription: null,
      invoice: null,
      status: overdue ? "overdue" : dueSoon ? "dueSoon" : "unpaid",
      dueSoon,
      daysOverdue: overdue ? Math.abs(expiresInDays) : 0,
      dueDate: user.subscription_expires_at,
      displayName: user.full_name ?? user.email,
      displayEmail: user.email,
      amountDue: 0,
    });
  }

  return rows;
}

function applyTemplate(template: string, row: InvoiceRow) {
  const paymentLink = "https://billing.aostots.com/pay";
  const dueDate = row.dueDate ?? "--";
  return template
    .replace(/{{client_name}}/g, row.client?.name ?? row.displayName)
    .replace(/{{amount_due}}/g, `$${row.amountDue}`)
    .replace(/{{due_date}}/g, dueDate)
    .replace(/{{days_overdue}}/g, String(row.daysOverdue))
    .replace(/{{payment_link}}/g, paymentLink)
    .replace(/{{support_email}}/g, "support@aostots.com");
}
