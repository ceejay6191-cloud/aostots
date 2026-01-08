import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/demo/isDemo";
import {
  AdminRole,
  AdminSettings,
  AppUser,
  Client,
  Subscription,
  Invoice,
  ReminderEmail,
  Payment,
  DunningEvent,
  AuditLog,
  AdminNote,
  DashboardMetrics,
  DashboardTrends,
  Organization,
  OrgMembership,
  Plan,
  OrgSubscription,
  PaymentMethod,
  ProrationPreview,
} from "@/types/admin";
import {
  demoUsers,
  demoClients,
  demoSubscriptions,
  demoInvoices,
  demoReminders,
  demoAuditLogs,
  demoSettings,
  demoOrganizations,
  demoPlans,
  demoOrgSubscriptions,
  demoOrgMemberships,
  demoPaymentMethods,
  demoPayments,
  demoDunningEvents,
} from "@/demo/adminDemoData";

const db = supabase as any;

const rolePriority: Record<AdminRole, number> = {
  owner: 1,
  admin: 2,
  manager: 3,
  viewer: 4,
};

const allowedPlanNames = new Set(["Company License", "Solo License"]);
const planNameAliases: Record<string, string> = {
  Starter: "Solo License",
  Growth: "Company License",
  Enterprise: "Company License",
  Company: "Company License",
};

function normalizePlan(plan: Plan): Plan {
  const normalizedName = planNameAliases[plan.name] ?? plan.name;
  if (normalizedName === plan.name) return plan;
  return { ...plan, name: normalizedName };
}

function normalizePlans(plans: Plan[]): Plan[] {
  return plans.map(normalizePlan).filter((plan) => allowedPlanNames.has(plan.name));
}

export async function fetchCurrentRole(userId?: string | null): Promise<AdminRole | null> {
  if (isDemoMode()) return "owner";
  if (!userId) return null;
  const { data, error } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error || !data?.length) return null;
  const roles = (data as { role: AdminRole }[]).map((row) => row.role);
  return roles.sort((a, b) => rolePriority[a] - rolePriority[b])[0] ?? null;
}

export async function fetchUsers(params: {
  page: number;
  pageSize: number;
  search?: string;
  role?: AdminRole | "all";
  status?: "active" | "inactive" | "all";
  approval?: "pending" | "approved" | "rejected" | "all";
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ data: AppUser[]; total: number }> {
  if (isDemoMode()) {
    return { data: demoUsers, total: demoUsers.length };
  }

  const { page, pageSize, search, role, status, approval, dateFrom, dateTo } = params;
  let query = db
    .from("app_users")
    .select(
      "user_id,full_name,email,role,status,approval_status,created_at,last_login_at,client_id,subscription_period,subscription_expires_at,client:clients(id,name)",
      { count: "exact" }
    );

  if (search) {
    const term = `%${search}%`;
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
  }
  if (role && role !== "all") query = query.eq("role", role);
  if (status && status !== "all") query = query.eq("status", status);
  if (approval && approval !== "all") query = query.eq("approval_status", approval);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) throw error;

  return { data: (data ?? []) as AppUser[], total: count ?? 0 };
}

export async function fetchUserById(userId: string): Promise<AppUser | null> {
  if (isDemoMode()) return demoUsers.find((user) => user.user_id === userId) ?? null;
  const { data, error } = await db
    .from("app_users")
    .select(
      "user_id,full_name,email,role,status,approval_status,created_at,last_login_at,client_id,subscription_period,subscription_expires_at,client:clients(id,name)"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as AppUser | null;
}

export async function fetchAuditLogs(params: { entityType?: string; entityId?: string; limit?: number }) {
  if (isDemoMode()) return demoAuditLogs;
  let query = db.from("admin_audit_logs").select("*");
  if (params.entityType) query = query.eq("entity_type", params.entityType);
  if (params.entityId) query = query.eq("entity_id", params.entityId);
  query = query.order("created_at", { ascending: false });
  if (params.limit) query = query.limit(params.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AuditLog[];
}

export async function fetchUserNotes(userId: string): Promise<AdminNote[]> {
  if (isDemoMode()) return [];
  const { data, error } = await db
    .from("admin_notes")
    .select("id,user_id,org_id,note,created_by,created_at,author:app_users(full_name,email)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdminNote[];
}

export async function fetchOrgNotes(orgId: string): Promise<AdminNote[]> {
  if (isDemoMode()) return [];
  const { data, error } = await db
    .from("admin_notes")
    .select("id,user_id,org_id,note,created_by,created_at,author:app_users(full_name,email)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdminNote[];
}

export async function addUserNote(params: { userId: string; note: string }) {
  if (isDemoMode()) return;
  const { error } = await db.from("admin_notes").insert({
    user_id: params.userId,
    note: params.note,
  });
  if (error) throw error;
  await logAdminAction({
    actionType: "note_create",
    entityType: "app_user",
    entityId: params.userId,
    after: { note: params.note },
  });
}

export async function addOrgNote(params: { orgId: string; note: string }) {
  if (isDemoMode()) return;
  const { error } = await db.from("admin_notes").insert({
    org_id: params.orgId,
    note: params.note,
  });
  if (error) throw error;
  await logAdminAction({
    actionType: "note_create",
    entityType: "organization",
    entityId: params.orgId,
    after: { note: params.note },
  });
}

export async function logAdminAction(params: {
  actionType: string;
  entityType: string;
  entityId: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
}) {
  if (isDemoMode()) return;
  const { error } = await db.rpc("admin_log_action", {
    action_type: params.actionType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    before_json: params.before ?? {},
    after_json: params.after ?? {},
  });
  if (error) throw error;
}

export async function fetchClientsBilling(): Promise<{
  clients: Client[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  users: AppUser[];
  payments: Payment[];
  dunningEvents: DunningEvent[];
}> {
  if (isDemoMode()) {
    return {
      clients: demoClients,
      subscriptions: demoSubscriptions,
      invoices: demoInvoices,
      users: demoUsers,
      payments: demoPayments,
      dunningEvents: demoDunningEvents,
    };
  }

  const { data: clients, error: clientsError } = await db.from("clients").select("*");
  if (clientsError) throw clientsError;
  const { data: subscriptions, error: subsError } = await db.from("client_subscriptions").select("*");
  if (subsError) throw subsError;
  const { data: invoices, error: invoicesError } = await db.from("client_invoices").select("*");
  if (invoicesError) throw invoicesError;
  const { data: users, error: usersError } = await db
    .from("app_users")
    .select(
      "user_id,full_name,email,role,status,approval_status,created_at,last_login_at,client_id,subscription_period,subscription_expires_at"
    );
  if (usersError) throw usersError;
  const { data: payments, error: paymentsError } = await db.from("client_payments").select("*");
  if (paymentsError) throw paymentsError;
  const { data: dunningEvents, error: dunningError } = await db.from("client_dunning_events").select("*");
  if (dunningError) throw dunningError;
  return {
    clients: (clients ?? []) as Client[],
    subscriptions: (subscriptions ?? []) as Subscription[],
    invoices: (invoices ?? []) as Invoice[],
    users: (users ?? []) as AppUser[],
    payments: (payments ?? []) as Payment[],
    dunningEvents: (dunningEvents ?? []) as DunningEvent[],
  };
}

export async function fetchReminderHistory(clientId: string) {
  if (isDemoMode()) return demoReminders.filter((row) => row.client_id === clientId);
  const { data, error } = await db
    .from("reminder_emails")
    .select("*")
    .eq("client_id", clientId)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReminderEmail[];
}

export async function fetchReminderEmails(): Promise<ReminderEmail[]> {
  if (isDemoMode()) return demoReminders;
  const { data, error } = await db.from("reminder_emails").select("*").order("sent_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReminderEmail[];
}

export async function updateUser(params: {
  userId: string;
  role?: AdminRole;
  status?: "active" | "inactive";
  approval?: "pending" | "approved" | "rejected";
  subscriptionPeriod?: string | null;
  subscriptionExpiresAt?: string | null;
}) {
  if (isDemoMode()) return;
  const { userId, role, status, approval, subscriptionPeriod, subscriptionExpiresAt } = params;
  const { error } = await db.rpc("admin_update_app_user", {
    target_user_id: userId,
    new_role: role ?? null,
    new_status: status ?? null,
    new_approval: approval ?? null,
    new_subscription_period: subscriptionPeriod ?? null,
    new_subscription_expires_at: subscriptionExpiresAt ?? null,
  });
  if (error) throw error;
}

export async function updateUserProfile(params: {
  userId: string;
  fullName?: string | null;
  email?: string | null;
}) {
  if (isDemoMode()) return;
  const { error } = await db.rpc("admin_update_app_user_profile", {
    target_user_id: params.userId,
    new_full_name: params.fullName ?? null,
    new_email: params.email ?? null,
  });
  if (error) throw error;
}

export async function sendPasswordReset(email: string) {
  if (isDemoMode()) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

export async function sendReminder(params: {
  clientId: string;
  subject: string;
  body: string;
  status?: string;
}) {
  if (isDemoMode()) return;
  const { error } = await db.rpc("admin_send_reminder", {
    target_client_id: params.clientId,
    reminder_subject: params.subject,
    reminder_body: params.body,
    reminder_status: params.status ?? "sent",
  });
  if (error) throw error;
}

export async function fetchSettings(): Promise<AdminSettings> {
  if (isDemoMode()) return demoSettings;
  const { data, error } = await db.from("admin_settings").select("setting_key,value");
  if (error) throw error;

  const map = new Map<string, any>((data ?? []).map((row: any) => [row.setting_key, row.value]));
  return {
    emailTemplate: map.get("email_template") ?? demoSettings.emailTemplate,
    approvalRules: map.get("approval_rules") ?? demoSettings.approvalRules,
    notificationSettings: map.get("notification_settings") ?? demoSettings.notificationSettings,
    smtpProvider: map.get("smtp_provider") ?? demoSettings.smtpProvider,
  };
}

export async function saveSettings(settings: AdminSettings) {
  if (isDemoMode()) return;
  const entries: [string, any][] = [
    ["email_template", settings.emailTemplate],
    ["approval_rules", settings.approvalRules],
    ["notification_settings", settings.notificationSettings],
    ["smtp_provider", settings.smtpProvider],
  ];
  for (const [settingKey, value] of entries) {
    const { error } = await db.rpc("admin_save_setting", {
      setting_key: settingKey,
      setting_value: value,
    });
    if (error) throw error;
  }
}

export async function fetchDashboardData(): Promise<{
  metrics: DashboardMetrics;
  trends: DashboardTrends;
  pendingApprovals: AppUser[];
  overdueClients: Client[];
  expiringTrials: Organization[];
  failedPayments: Payment[];
}> {
  if (isDemoMode()) {
    return {
      metrics: buildMetrics({
        users: demoUsers,
        clients: demoClients,
        subscriptions: demoSubscriptions,
        invoices: demoInvoices,
        organizations: demoOrganizations,
        orgSubscriptions: demoOrgSubscriptions,
        payments: demoPayments,
      }),
      trends: buildTrends(demoUsers, demoSubscriptions, demoInvoices),
      pendingApprovals: demoUsers.filter((u) => u.approval_status === "pending"),
      overdueClients: demoClients.slice(0, 2),
      expiringTrials: demoOrganizations.slice(0, 2),
      failedPayments: demoPayments.filter((p) => p.status === "failed").slice(0, 10),
    };
  }

  const { data: users, error: usersError } = await db
    .from("app_users")
    .select(
      "user_id,full_name,email,role,status,approval_status,created_at,last_login_at,client_id,subscription_period,subscription_expires_at"
    );
  if (usersError) throw usersError;

  const { clients, subscriptions, invoices, payments } = await fetchClientsBilling();
  const organizations = await fetchOrganizations();
  const { subscriptions: orgSubscriptions } = await fetchSubscriptions({ page: 1, pageSize: 200 });

  const userRows = (users ?? []) as AppUser[];
  return {
    metrics: buildMetrics({
      users: userRows,
      clients,
      subscriptions,
      invoices,
      organizations,
      orgSubscriptions,
      payments,
    }),
    trends: buildTrends(userRows, subscriptions, invoices),
    pendingApprovals: userRows.filter((u) => u.approval_status === "pending").slice(0, 10),
    overdueClients: buildOverdueClients(clients, subscriptions, invoices).slice(0, 10),
    expiringTrials: organizations
      .filter((org) =>
        orgSubscriptions.some(
          (sub) => sub.org_id === org.id && sub.status === "trialing" && sub.trial_end_at
        )
      )
      .slice(0, 10),
    failedPayments: payments.filter((payment) => payment.status === "failed").slice(0, 10),
  };
}

export async function searchUsersAndClients(term: string): Promise<{
  users: AppUser[];
  clients: Client[];
}> {
  if (isDemoMode()) {
    const lowered = term.toLowerCase();
    return {
      users: demoUsers.filter(
        (user) =>
          user.email.toLowerCase().includes(lowered) ||
          (user.full_name ?? "").toLowerCase().includes(lowered)
      ),
      clients: demoClients.filter((client) => client.name.toLowerCase().includes(lowered)),
    };
  }

  const query = `%${term}%`;
  const { data: users, error: userError } = await db
    .from("app_users")
    .select("user_id,full_name,email,role,status,approval_status,created_at,last_login_at,client_id,subscription_period,subscription_expires_at")
    .or(`full_name.ilike.${query},email.ilike.${query}`)
    .limit(10);
  if (userError) throw userError;

  const { data: clients, error: clientError } = await db
    .from("clients")
    .select("id,name,billing_email,phone,status,created_at")
    .ilike("name", query)
    .limit(10);
  if (clientError) throw clientError;

  return {
    users: (users ?? []) as AppUser[],
    clients: (clients ?? []) as Client[],
  };
}

export function buildMetrics(params: {
  users: AppUser[];
  clients: Client[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  organizations: Organization[];
  orgSubscriptions: OrgSubscription[];
  payments: Payment[];
}): DashboardMetrics {
  const { users, clients, subscriptions, invoices, organizations, orgSubscriptions, payments } = params;
  const totalUsers = users.length;
  const activeUsers = users.filter((user) => user.status === "active").length;
  const pendingApprovals = users.filter((user) => user.approval_status === "pending").length;
  const payingCustomers = subscriptions.filter((sub) => sub.status === "active").length;
  const overdueInvoices = invoices.filter((inv) => inv.status === "overdue").length;
  const totalMRR =
    orgSubscriptions.length > 0
      ? orgSubscriptions.filter((sub) => sub.status === "active").reduce((sum, sub) => sum + (sub.mrr || 0), 0)
      : subscriptions.filter((sub) => sub.status === "active").reduce((sum, sub) => sum + (sub.amount || 0), 0);

  const totalOrgs = organizations.length;
  const trialsActive = orgSubscriptions.filter((sub) => sub.status === "trialing").length;
  const trialsExpiringSoon = orgSubscriptions.filter((sub) => {
    if (!sub.trial_end_at) return false;
    const end = new Date(sub.trial_end_at);
    const days = Math.ceil((end.getTime() - Date.now()) / 86400000);
    return days >= 0 && days <= 7;
  }).length;
  const activeSubscriptions = orgSubscriptions.filter((sub) => sub.status === "active").length;
  const failedPayments = payments.filter((payment) => payment.status === "failed").length;
  const delinquentAccounts =
    orgSubscriptions.filter((sub) => sub.status === "past_due").length +
    invoices.filter((inv) => inv.status === "overdue").length;

  return {
    totalUsers,
    activeUsers,
    pendingApprovals,
    payingCustomers,
    overdueInvoices,
    totalMRR,
    totalOrgs,
    trialsActive,
    trialsExpiringSoon,
    activeSubscriptions,
    failedPayments,
    delinquentAccounts,
  };
}

export function buildTrends(
  users: AppUser[],
  subscriptions: Subscription[],
  invoices: Invoice[]
): DashboardTrends {
  const newUsers = Array.from({ length: 10 }).map((_, idx) => {
    const start = new Date();
    start.setDate(start.getDate() - (9 - idx) * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const label = `${start.getMonth() + 1}/${start.getDate()}`;
    const value = users.filter((user) => {
      const created = new Date(user.created_at);
      return created >= start && created <= end;
    }).length;
    return { label, value };
  });

  const paid = subscriptions.filter((sub) => sub.status === "active").length;
  const unpaid = subscriptions.filter((sub) => sub.status !== "active").length;

  const overdueBuckets = [
    { label: "0-7", value: 0 },
    { label: "8-14", value: 0 },
    { label: "15-30", value: 0 },
    { label: "31+", value: 0 },
  ];

  const today = new Date();
  invoices
    .filter((inv) => inv.status === "overdue")
    .forEach((inv) => {
      const due = new Date(inv.due_date);
      const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000));
      if (days <= 7) overdueBuckets[0].value += 1;
      else if (days <= 14) overdueBuckets[1].value += 1;
      else if (days <= 30) overdueBuckets[2].value += 1;
      else overdueBuckets[3].value += 1;
    });

  return {
    newUsers,
    paidVsUnpaid: { paid, unpaid },
    overdueBuckets,
  };
}

export function buildOverdueClients(
  clients: Client[],
  subscriptions: Subscription[],
  invoices: Invoice[]
): Client[] {
  const overdueClientIds = new Set(
    invoices.filter((inv) => inv.status === "overdue").map((inv) => inv.client_id)
  );
  const overdueFromSubs = subscriptions
    .filter((sub) => sub.status === "past_due")
    .map((sub) => sub.client_id);
  overdueFromSubs.forEach((id) => overdueClientIds.add(id));
  return clients.filter((client) => overdueClientIds.has(client.id));
}

export async function fetchOrganizations(): Promise<Organization[]> {
  if (isDemoMode()) return demoOrganizations;
  const { data, error } = await db.from("organizations").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Organization[];
}

export async function createOrganizationByEmail(params: {
  name: string;
  ownerEmail: string;
  billingEmail?: string | null;
}): Promise<Organization> {
  if (isDemoMode()) {
    return {
      id: `demo-org-${Date.now()}`,
      name: params.name,
      owner_user_id: "demo-owner",
      billing_email: params.billingEmail ?? null,
      address: null,
      status: "trialing",
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  const { data, error } = await db.rpc("admin_create_organization_by_email", {
    org_name: params.name,
    owner_email: params.ownerEmail,
    billing_email: params.billingEmail ?? null,
  });
  if (error) throw error;
  return data as Organization;
}

export async function fetchOrganizationDetail(orgId: string): Promise<{
  organization: Organization | null;
  subscription: OrgSubscription | null;
  memberships: OrgMembership[];
  paymentMethods: PaymentMethod[];
  plans: Plan[];
}> {
  if (isDemoMode()) {
    return {
      organization: demoOrganizations.find((org) => org.id === orgId) ?? null,
      subscription: demoOrgSubscriptions.find((sub) => sub.org_id === orgId) ?? null,
      memberships: demoOrgMemberships.filter((m) => m.org_id === orgId),
      paymentMethods: demoPaymentMethods.filter((pm) => pm.org_id === orgId),
      plans: demoPlans,
    };
  }

  const { data: org, error: orgError } = await db.from("organizations").select("*").eq("id", orgId).maybeSingle();
  if (orgError) throw orgError;

  const { data: sub, error: subError } = await db
    .from("org_subscriptions")
    .select("*, plan:plans(*)")
    .eq("org_id", orgId)
    .maybeSingle();
  if (subError) throw subError;

  const { data: members, error: memError } = await db
    .from("org_memberships")
    .select("id,org_id,user_id,role,created_at,user:app_users(user_id,full_name,email)")
    .eq("org_id", orgId);
  if (memError) throw memError;

  const { data: paymentMethods, error: pmError } = await db
    .from("org_payment_methods")
    .select("*")
    .eq("org_id", orgId);
  if (pmError) throw pmError;

  const { data: plans, error: plansError } = await db.from("plans").select("*").order("price_monthly");
  if (plansError) throw plansError;

  return {
    organization: org as Organization | null,
    subscription: sub ? ({ ...sub, plan: sub.plan ? normalizePlan(sub.plan) : sub.plan } as OrgSubscription) : null,
    memberships: (members ?? []) as OrgMembership[],
    paymentMethods: (paymentMethods ?? []) as PaymentMethod[],
    plans: normalizePlans((plans ?? []) as Plan[]),
  };
}

export async function fetchSubscriptions(params?: {
  page?: number;
  pageSize?: number;
  status?: OrgSubscription["status"] | "all";
  dateFrom?: string;
  dateTo?: string;
  orgIds?: string[];
  sortBy?: "renewal" | "mrr" | "status";
  sortDir?: "asc" | "desc";
}): Promise<{ subscriptions: OrgSubscription[]; plans: Plan[]; total: number }> {
  if (isDemoMode()) {
    return { subscriptions: demoOrgSubscriptions, plans: demoPlans, total: demoOrgSubscriptions.length };
  }
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;

  let query = db.from("org_subscriptions").select("*, plan:plans(*)", { count: "exact" });
  if (params?.status && params.status !== "all") {
    query = query.eq("status", params.status);
  }
  if (params?.dateFrom) {
    query = query.gte("current_period_end", params.dateFrom);
  }
  if (params?.dateTo) {
    query = query.lte("current_period_end", params.dateTo);
  }
  if (params?.orgIds && params.orgIds.length) {
    query = query.in("org_id", params.orgIds);
  }

  const sortBy = params?.sortBy ?? "renewal";
  const sortDir = params?.sortDir ?? "desc";
  const sortColumn = sortBy === "mrr" ? "mrr" : sortBy === "status" ? "status" : "current_period_end";

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data: subs, error: subsError, count } = await query
    .order(sortColumn, { ascending: sortDir === "asc", nullsFirst: false })
    .range(from, to);
  if (subsError) throw subsError;

  const { data: plans, error: plansError } = await db.from("plans").select("*").order("price_monthly");
  if (plansError) throw plansError;

  return {
    subscriptions: (subs ?? []).map((sub: any) => ({
      ...sub,
      plan: sub.plan ? normalizePlan(sub.plan) : sub.plan,
    })) as OrgSubscription[],
    plans: normalizePlans((plans ?? []) as Plan[]),
    total: count ?? 0,
  };
}

export async function updateOrgSubscriptionStatus(params: {
  subscriptionId: string;
  status: OrgSubscription["status"];
}) {
  if (isDemoMode()) return;
  const { error } = await db
    .from("org_subscriptions")
    .update({ status: params.status })
    .eq("id", params.subscriptionId);
  if (error) throw error;
}

export async function previewProration(params: {
  orgId: string;
  newPlanId: string;
  effectiveDate: string;
}): Promise<ProrationPreview> {
  if (isDemoMode()) {
    return {
      current_plan: "Company License",
      new_plan: "Solo License",
      billing_cycle: "monthly",
      period_start: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString().slice(0, 10),
      period_end: new Date(Date.now() + 1000 * 60 * 60 * 24 * 20).toISOString().slice(0, 10),
      effective_date: params.effectiveDate,
      credit: 120,
      charge: 40,
      total_due: 0,
    };
  }
  const { data, error } = await db.rpc("admin_preview_proration", {
    target_org_id: params.orgId,
    target_plan_id: params.newPlanId,
    effective_date: params.effectiveDate,
  });
  if (error) throw error;
  return data as ProrationPreview;
}

export async function fetchPlans(): Promise<Plan[]> {
  if (isDemoMode()) return demoPlans;
  const { data, error } = await db.from("plans").select("*").order("price_monthly");
  if (error) throw error;
  return normalizePlans((data ?? []) as Plan[]);
}

export async function updatePlan(params: {
  planId: string;
  name?: string;
  priceMonthly?: number;
  priceAnnual?: number;
  currency?: string;
  includedSeats?: number;
  usageLimits?: Record<string, any>;
  entitlements?: Record<string, any>;
  overageRules?: Record<string, any>;
}) {
  if (isDemoMode()) return;
  const { error } = await db
    .from("plans")
    .update({
      name: params.name,
      price_monthly: params.priceMonthly,
      price_annual: params.priceAnnual,
      currency: params.currency,
      included_seats: params.includedSeats,
      usage_limits_json: params.usageLimits,
      entitlements_json: params.entitlements,
      overage_rules_json: params.overageRules,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.planId);
  if (error) throw error;
}
