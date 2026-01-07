import { AdminRole, AdminSettings, AppUser, Client, Subscription, Invoice, ReminderEmail, AuditLog } from "@/types/admin";

const now = new Date();

const makeDate = (daysAgo: number) => {
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
};

export const demoUsers: AppUser[] = [
  {
    user_id: "demo-user-1",
    full_name: "Ceejay Abne",
    email: "ceejayabne@gmail.com",
    role: "owner",
    status: "active",
    approval_status: "approved",
    created_at: makeDate(120),
    last_login_at: makeDate(1),
    client_id: "client-1",
    subscription_period: "annual",
    subscription_expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180).toISOString().slice(0, 10),
    client: { id: "client-1", name: "Ceejay Construction" },
  },
  {
    user_id: "demo-user-2",
    full_name: "Mina Lagos",
    email: "mina@northshore.com",
    role: "admin",
    status: "active",
    approval_status: "approved",
    created_at: makeDate(45),
    last_login_at: makeDate(2),
    client_id: "client-2",
    subscription_period: "monthly",
    subscription_expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 24).toISOString().slice(0, 10),
    client: { id: "client-2", name: "Northshore Build" },
  },
  {
    user_id: "demo-user-3",
    full_name: "Leo Park",
    email: "leo@onpoint.co",
    role: "manager",
    status: "active",
    approval_status: "pending",
    created_at: makeDate(3),
    last_login_at: null,
    client_id: "client-3",
    client: { id: "client-3", name: "OnPoint Renovations" },
  },
  {
    user_id: "demo-user-4",
    full_name: "Suri Patel",
    email: "suri@bluearch.com",
    role: "viewer",
    status: "inactive",
    approval_status: "rejected",
    created_at: makeDate(30),
    last_login_at: makeDate(15),
    client_id: "client-4",
    client: { id: "client-4", name: "Blue Arch Studio" },
  },
];

export const demoClients: Client[] = [
  {
    id: "client-1",
    name: "Ceejay Construction",
    billing_email: "billing@ceejayco.com",
    phone: "+1 (415) 882-2111",
    status: "active",
    created_at: makeDate(220),
  },
  {
    id: "client-2",
    name: "Northshore Build",
    billing_email: "finance@northshore.com",
    phone: "+1 (628) 204-0002",
    status: "active",
    created_at: makeDate(150),
  },
  {
    id: "client-3",
    name: "OnPoint Renovations",
    billing_email: "ap@onpoint.co",
    phone: "+1 (310) 552-3000",
    status: "active",
    created_at: makeDate(78),
  },
  {
    id: "client-4",
    name: "Blue Arch Studio",
    billing_email: "accounts@bluearch.com",
    phone: "+1 (212) 990-7788",
    status: "inactive",
    created_at: makeDate(340),
  },
];

export const demoSubscriptions: Subscription[] = [
  {
    id: "sub-1",
    client_id: "client-1",
    plan_name: "Growth",
    amount: 299,
    currency: "USD",
    billing_cycle: "monthly",
    next_due_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString().slice(0, 10),
    last_paid_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 25).toISOString().slice(0, 10),
    status: "active",
  },
  {
    id: "sub-2",
    client_id: "client-2",
    plan_name: "Enterprise",
    amount: 999,
    currency: "USD",
    billing_cycle: "monthly",
    next_due_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString().slice(0, 10),
    last_paid_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 40).toISOString().slice(0, 10),
    status: "past_due",
  },
  {
    id: "sub-3",
    client_id: "client-3",
    plan_name: "Starter",
    amount: 99,
    currency: "USD",
    billing_cycle: "monthly",
    next_due_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString().slice(0, 10),
    last_paid_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 50).toISOString().slice(0, 10),
    status: "past_due",
  },
];

export const demoInvoices: Invoice[] = [
  {
    id: "inv-1",
    client_id: "client-2",
    invoice_number: "INV-2024-099",
    issue_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 25).toISOString().slice(0, 10),
    due_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString().slice(0, 10),
    amount_due: 999,
    amount_paid: 0,
    status: "overdue",
  },
  {
    id: "inv-2",
    client_id: "client-3",
    invoice_number: "INV-2024-103",
    issue_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 35).toISOString().slice(0, 10),
    due_date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString().slice(0, 10),
    amount_due: 99,
    amount_paid: 0,
    status: "overdue",
  },
];

export const demoReminders: ReminderEmail[] = [
  {
    id: "rem-1",
    client_id: "client-2",
    sender_user_id: "demo-user-1",
    subject: "Overdue payment reminder (9 days)",
    body: "Reminder sent to Northshore Build",
    sent_at: makeDate(2),
    status: "sent",
    provider_message_id: "demo-msg-1",
  },
];

export const demoAuditLogs: AuditLog[] = [
  {
    id: "audit-1",
    actor_user_id: "demo-user-1",
    action_type: "user_update",
    entity_type: "app_user",
    entity_id: "demo-user-3",
    before_json: { approval_status: "pending" },
    after_json: { approval_status: "approved" },
    created_at: makeDate(1),
  },
  {
    id: "audit-2",
    actor_user_id: "demo-user-2",
    action_type: "reminder_sent",
    entity_type: "client",
    entity_id: "client-2",
    before_json: {},
    after_json: { subject: "Overdue reminder" },
    created_at: makeDate(2),
  },
];

export const demoSettings: AdminSettings = {
  emailTemplate: {
    subject: "Payment reminder: Invoice due {{due_date}}",
    body:
      "Hello {{client_name}},\n\nThis is a reminder that your invoice for {{amount_due}} was due on {{due_date}}.\n\nPay here: {{payment_link}}\n\nThanks,\nAOSTOTS Billing",
  },
  approvalRules: { defaultRole: "viewer" as AdminRole, autoApprove: false },
  notificationSettings: { overdueRemindersEnabled: true, daysBeforeDue: 5, followUpCadenceDays: 7 },
  smtpProvider: { provider: "SendGrid", status: "configured" },
};
