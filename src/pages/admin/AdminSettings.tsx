import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { fetchSettings, saveSettings } from "@/services/adminService";
import { AdminSettings as AdminSettingsType } from "@/types/admin";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { demoSettings } from "@/demo/adminDemoData";

export default function AdminSettings() {
  const { role } = useAdminAccess();
  const [settings, setSettings] = useState<AdminSettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await fetchSettings();
        if (!cancelled) setSettings(data);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load settings.");
          setSettings(demoSettings);
          toast({ title: "Could not load settings", description: e?.message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    try {
      setSaving(true);
      await saveSettings(settings);
      toast({ title: "Settings saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-slate-900">Admin settings</div>
        <div className="text-sm text-slate-500">Templates, defaults, and notification rules.</div>
      </div>

      {error ? (
        <Card className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Settings loaded with defaults because the backend is not ready. Apply the admin migrations and refresh.
        </Card>
      ) : null}

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Reminder email template</div>
        <div className="mt-3 space-y-3">
          <Input
            value={settings.emailTemplate.subject}
            onChange={(e) =>
              setSettings({ ...settings, emailTemplate: { ...settings.emailTemplate, subject: e.target.value } })
            }
          />
          <textarea
            className="h-40 w-full rounded-md border border-input bg-background p-3 text-sm"
            value={settings.emailTemplate.body}
            onChange={(e) =>
              setSettings({ ...settings, emailTemplate: { ...settings.emailTemplate, body: e.target.value } })
            }
          />
          <div className="text-xs text-slate-500">
            Available variables: {"{{client_name}}, {{amount_due}}, {{due_date}}, {{days_overdue}}, {{payment_link}}, {{support_email}}"}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Default roles & approvals</div>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <label className="text-xs uppercase text-slate-500">Default role</label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={settings.approvalRules.defaultRole}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  approvalRules: { ...settings.approvalRules, defaultRole: e.target.value as any },
                })
              }
            >
              <option value="viewer">Viewer</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.approvalRules.autoApprove}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    approvalRules: { ...settings.approvalRules, autoApprove: e.target.checked },
                  })
                }
              />
              Auto-approve new users
            </label>
          </div>
        </Card>

        <Card className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Notifications</div>
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.notificationSettings.overdueRemindersEnabled}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    notificationSettings: {
                      ...settings.notificationSettings,
                      overdueRemindersEnabled: e.target.checked,
                    },
                  })
                }
              />
              Enable overdue reminders
            </label>
            <Input
              type="number"
              value={settings.notificationSettings.daysBeforeDue}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notificationSettings: {
                    ...settings.notificationSettings,
                    daysBeforeDue: Number(e.target.value),
                  },
                })
              }
            />
            <Input
              type="number"
              value={settings.notificationSettings.followUpCadenceDays}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notificationSettings: {
                    ...settings.notificationSettings,
                    followUpCadenceDays: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        </Card>
      </div>

      <Card className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">SMTP / provider integration</div>
        <div className="mt-2 text-sm text-slate-500">
          Provider: {settings.smtpProvider.provider} | Status: {settings.smtpProvider.status}
        </div>
        <Button className="mt-3" variant="outline">
          Configure provider
        </Button>
      </Card>

      {role === "owner" || role === "admin" ? (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save settings"}
          </Button>
        </div>
      ) : (
        <div className="text-xs text-slate-500">Only owners and admins can save settings.</div>
      )}
    </div>
  );
}
