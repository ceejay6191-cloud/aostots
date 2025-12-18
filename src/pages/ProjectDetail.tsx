import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save } from 'lucide-react';
import { useProject, useUpdateProject } from '@/hooks/useProjects';
import { STATUS_LABELS, ProjectStatus } from '@/types/project';

const ALL_STATUSES: ProjectStatus[] = ['templates', 'estimating', 'preliminaries', 'accepted'];

export default function ProjectDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const { data: project, isLoading, error } = useProject(id);
  const updateProject = useUpdateProject();

  // Local form state (simple + beginner-friendly)
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('estimating');
  const [estimatorName, setEstimatorName] = useState('');
  const [notes, setNotes] = useState('');

  // When project loads, populate inputs
  useEffect(() => {
    if (!project) return;
    setName(project.name ?? '');
    setClientName(project.client_name ?? '');
    setClientEmail(project.client_email ?? '');
    setClientPhone(project.client_phone ?? '');
    setStatus(project.status ?? 'estimating');
    setEstimatorName(project.estimator_name ?? '');
    setNotes(project.notes ?? '');
  }, [project]);

  const canSave = useMemo(() => {
    if (!project) return false;
    if (!name.trim()) return false;
    if (!clientName.trim()) return false;
    return true;
  }, [project, name, clientName]);

  async function onSave() {
    if (!project) return;

    await updateProject.mutateAsync({
      id: project.id,
      patch: {
        name: name.trim(),
        client_name: clientName.trim(),
        client_email: clientEmail.trim() || null,
        client_phone: clientPhone.trim() || null,
        status,
        estimator_name: estimatorName.trim() || null,
        notes: notes.trim() || null,
      },
    });
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => navigate('/projects')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>

            <div>
              <h1 className="text-3xl font-display font-bold tracking-tight">Project</h1>
              <p className="text-muted-foreground mt-1">Edit overview details</p>
            </div>
          </div>

          <Button onClick={onSave} disabled={!canSave || updateProject.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {updateProject.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {/* States */}
        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            Loading project…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-white p-6 text-red-700 shadow-sm">
            Failed to load project. ({(error as any)?.message || 'Unknown error'})
          </div>
        ) : !project ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            Project not found (or you don’t have access).
          </div>
        ) : (
          <>
            {/* Overview form */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <div className="text-lg font-semibold">Overview</div>

                <div className="space-y-2">
                  <Label>Project Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Estimator (text for now)</Label>
                  <Input
                    value={estimatorName}
                    onChange={(e) => setEstimatorName(e.target.value)}
                    placeholder="e.g., Ceejay Abne"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <div className="text-lg font-semibold">Client</div>

                <div className="space-y-2">
                  <Label>Client Name</Label>
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Client Email</Label>
                  <Input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Client Phone</Label>
                  <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-2">
              <div className="text-lg font-semibold">Notes</div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add internal notes about the job, scope, assumptions, risks, etc."
                className="min-h-[140px]"
              />
            </div>

            {/* Next sections placeholders */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-lg font-semibold">Next (we will build these)</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                <li>Documents (upload plans for markups/measurements)</li>
                <li>Takeoff (measurements feeding estimating)</li>
                <li>Estimating (Excel-like BOQ connected to takeoff)</li>
                <li>Proposal (print markups + estimate docs)</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
