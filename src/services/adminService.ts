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
  AuditLog,
  DashboardMetrics,
  DashboardTrends,
} from "@/types/admin";
import {
  demoUsers,
  demoClients,
  demoSubscriptions,
  demoInvoices,
  demoReminders,
  demoAuditLogs,
  demoSettings,
} from "@/demo/adminDemoData";

const db = supabase as any;

const rolePriority: Record<AdminRole, number> = {
  owner: 1,
  admin: 2,
  manager: 3,
  viewer: 4,
};

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

export async function fetchClientsBilling(): Promise<{
  clients: Client[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  users: AppUser[];
}> {
  if (isDemoMode()) {
    return {
      clients: demoClients,
      subscriptions: demoSubscriptions,
      invoices: demoInvoices,
      users: demoUsers,
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
  return {
    clients: (clients ?? []) as Client[],
    subscriptions: (subscriptions ?? []) as Subscription[],
    invoices: (invoices ?? []) as Invoice[],
    users: (users ?? []) as AppUser[],
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
}> {
  if (isDemoMode()) {
    return {
      metrics: buildMetrics(demoUsers, demoClients, demoSubscriptions, demoInvoices),
      trends: buildTrends(demoUsers, demoSubscriptions, demoInvoices),
      pendingApprovals: demoUsers.filter((u) => u.approval_status === "pending"),
      overdueClients: demoClients.slice(0, 2),
    };
  }

  const { data: users, error: usersError } = await db
    .from("app_users")
    .select("user_id,full_name,email,role,status,approval_status,created_at,last_login_at,client_id,subscription_period,subscription_expires_at");
  if (usersError) throw usersError;

  const { clients, subscriptions, invoices } = await fetchClientsBilling();

  const userRows = (users ?? []) as AppUser[];
  return {
    metrics: buildMetrics(userRows, clients, subscriptions, invoices),
    trends: buildTrends(userRows, subscriptions, invoices),
    pendingApprovals: userRows.filter((u) => u.approval_status === "pending").slice(0, 10),
    overdueClients: buildOverdueClients(clients, subscriptions, invoices).slice(0, 10),
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

export function buildMetrics(
  users: AppUser[],
  clients: Client[],
  subscriptions: Subscription[],
  invoices: Invoice[]
): DashboardMetrics {
  const totalUsers = users.length;
  const activeUsers = users.filter((user) => user.status === "active").length;
  const pendingApprovals = users.filter((user) => user.approval_status === "pending").length;
  const payingCustomers = subscriptions.filter((sub) => sub.status === "active").length;
  const overdueInvoices = invoices.filter((inv) => inv.status === "overdue").length;
  const totalMRR = subscriptions
    .filter((sub) => sub.status === "active")
    .reduce((sum, sub) => sum + (sub.amount || 0), 0);

  return { totalUsers, activeUsers, pendingApprovals, payingCustomers, overdueInvoices, totalMRR };
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
