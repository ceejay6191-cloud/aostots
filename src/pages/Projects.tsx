import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProjectsTable } from '@/components/projects/ProjectsTable';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { STATUS_LABELS, ProjectStatus } from '@/types/project';
import { Plus } from 'lucide-react';
import { Link } from "react-router-dom";

export default function Projects() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string>('all');

  const tabs = [
    { value: 'all', label: 'All' },
    { value: 'templates', label: STATUS_LABELS.templates },
    { value: 'estimating', label: STATUS_LABELS.estimating },
    { value: 'preliminaries', label: STATUS_LABELS.preliminaries },
    { value: 'accepted', label: STATUS_LABELS.accepted },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Projects</h1>
            <p className="text-muted-foreground mt-1">Manage your project pipeline</p>
          </div>
          <Button onClick={() => navigate('/projects/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </div>

        {/* Tabs & Table */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-0">
              <ProjectsTable
                statusFilter={tab.value === 'all' ? undefined : (tab.value as ProjectStatus)}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </AppLayout>
  );
}

