import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateProject } from '@/hooks/useProjects';
import { useAuth } from '@/hooks/useAuth';
import { STATUS_LABELS, ProjectStatus } from '@/types/project';
import { Loader2 } from 'lucide-react';

const formSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100, 'Name too long'),
  client_name: z.string().min(1, 'Client name is required').max(100, 'Name too long'),
  client_email: z.string().email('Invalid email').optional().or(z.literal('')),
  client_phone: z.string().max(20, 'Phone too long').optional().or(z.literal('')),
  status: z.enum(['templates', 'estimating', 'preliminaries', 'accepted']),
});

type FormData = z.infer<typeof formSchema>;

export function NewProjectForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const createProject = useCreateProject();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      client_name: '',
      client_email: '',
      client_phone: '',
      status: 'templates',
    },
  });

  const onSubmit = async (data: FormData) => {
    if (!user) return;

    await createProject.mutateAsync({
      name: data.name,
      client_name: data.client_name,
      client_email: data.client_email || undefined,
      client_phone: data.client_phone || undefined,
      status: data.status as ProjectStatus,
      owner_id: user.id,
    });

    navigate('/projects');
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-display">Create New Project</CardTitle>
        <CardDescription>Fill in the details to create a new project</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter project name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="client_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter client name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="client_email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Email (optional)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="client@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="client_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Client Phone (optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 234 567 890" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial Status</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center gap-3 pt-4 border-t">
              <div className="flex-1 text-sm text-muted-foreground">
                <span className="font-medium">Estimator:</span> {user?.email}
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={() => navigate('/projects')}>
                Cancel
              </Button>
              <Button type="submit" disabled={createProject.isPending}>
                {createProject.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Project
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
