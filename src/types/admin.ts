export type AdminRole = "owner" | "admin" | "manager" | "viewer";
export type UserStatus = "active" | "inactive";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export type AppUser = {
  user_id: string;
  full_name: string | null;
  email: string;
  role: AdminRole;
  status: UserStatus;
  approval_status: ApprovalStatus;
  created_at: string;
  last_login_at: string | null;
  client_id: string | null;
  subscription_period?: string | null;
  subscription_expires_at?: string | null;
  client?: { id: string; name: string } | null;
};

export type Client = {
  id: string;
  name: string;
  billing_email: string;
  phone: string | null;
  status: "active" | "inactive";
  created_at: string;
};

export type Subscription = {
  id: string;
  client_id: string;
  plan_name: string;
  amount: number;
  currency: string;
  billing_cycle: string;
  next_due_date: string | null;
  last_paid_date: string | null;
  status: "active" | "trialing" | "past_due" | "canceled";
};

export type Invoice = {
  id: string;
  client_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  amount_due: number;
  amount_paid: number;
  status: "draft" | "open" | "paid" | "overdue" | "void";
};

export type ReminderEmail = {
  id: string;
  client_id: string;
  sender_user_id: string | null;
  subject: string;
  body: string;
  sent_at: string;
  status: string;
  provider_message_id: string | null;
};

export type Payment = {
  id: string;
  client_id: string;
  invoice_id: string | null;
  amount: number;
  currency: string;
  status: "succeeded" | "failed" | "pending";
  paid_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  provider_txn_id: string | null;
  created_at: string;
};

export type DunningEvent = {
  id: string;
  client_id: string;
  invoice_id: string | null;
  stage: "reminder_1" | "reminder_2" | "final_notice" | "restricted" | "canceled" | "recovered";
  occurred_at: string;
  metadata: Record<string, any>;
};

export type AuditLog = {
  id: string;
  actor_user_id: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  before_json: Record<string, any>;
  after_json: Record<string, any>;
  created_at: string;
};

export type AdminNote = {
  id: string;
  user_id: string | null;
  org_id: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
  author?: { full_name: string | null; email: string } | null;
};

export type DashboardMetrics = {
  totalUsers: number;
  activeUsers: number;
  pendingApprovals: number;
  payingCustomers: number;
  overdueInvoices: number;
  totalMRR: number;
  totalOrgs: number;
  trialsActive: number;
  trialsExpiringSoon: number;
  activeSubscriptions: number;
  failedPayments: number;
  delinquentAccounts: number;
};

export type ChartPoint = { label: string; value: number };

export type DashboardTrends = {
  newUsers: ChartPoint[];
  paidVsUnpaid: { paid: number; unpaid: number };
  overdueBuckets: ChartPoint[];
};

export type AdminSettings = {
  emailTemplate: {
    subject: string;
    body: string;
  };
  approvalRules: {
    defaultRole: AdminRole;
    autoApprove: boolean;
  };
  notificationSettings: {
    overdueRemindersEnabled: boolean;
    daysBeforeDue: number;
    followUpCadenceDays: number;
  };
  smtpProvider: {
    provider: string;
    status: "disabled" | "configured";
  };
};

export type Organization = {
  id: string;
  name: string;
  owner_user_id: string;
  billing_email: string | null;
  address: string | null;
  status: "active" | "trialing" | "suspended" | "canceled";
  tags: string[];
  created_at: string;
};

export type OrgMembership = {
  id: string;
  org_id: string;
  user_id: string;
  role: "owner" | "admin" | "manager" | "member";
  created_at: string;
  user?: { user_id: string; full_name: string | null; email: string };
};

export type Plan = {
  id: string;
  name: string;
  price_monthly: number;
  price_annual: number;
  currency: string;
  included_seats: number;
  usage_limits_json: Record<string, any>;
  entitlements_json: Record<string, any>;
  overage_rules_json: Record<string, any>;
};

export type OrgSubscription = {
  id: string;
  org_id: string;
  plan_id: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "paused";
  billing_cycle: string;
  trial_end_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  mrr: number;
  plan?: Plan | null;
};

export type PaymentMethod = {
  id: string;
  org_id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  status: string;
};

export type ProrationPreview = {
  current_plan: string;
  new_plan: string;
  billing_cycle: string;
  period_start: string;
  period_end: string;
  effective_date: string;
  credit: number;
  charge: number;
  total_due: number;
};
