import { AppLayout } from '@/components/layout/AppLayout';
import { NewProjectForm } from '@/components/projects/NewProjectForm';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function NewProject() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate('/projects')} className="mb-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
        <NewProjectForm />
      </div>
    </AppLayout>
  );
}
