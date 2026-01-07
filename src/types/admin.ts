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

export type DashboardMetrics = {
  totalUsers: number;
  activeUsers: number;
  pendingApprovals: number;
  payingCustomers: number;
  overdueInvoices: number;
  totalMRR: number;
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
