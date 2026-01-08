import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import NewProject from "./pages/NewProject";
import NotFound from "./pages/NotFound";
import ProjectDetails from "./pages/ProjectDetails"; // add this import
import ProjectDocumentPages from "@/pages/ProjectDocumentPages";
import TakeoffWorkspace from "@/pages/TakeoffWorkspace";
import EstimatingWorkspace from "@/pages/EstimatingWorkspace";
import ProposalWorkspace from "@/pages/ProposalWorkspace";
import ScanWorkspace from "@/pages/ScanWorkspace";
import Assemblies from "@/pages/Assemblies";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminUserDetails from "@/pages/admin/AdminUserDetails";
import AdminOrganizations from "@/pages/admin/AdminOrganizations";
import AdminOrganizationDetails from "@/pages/admin/AdminOrganizationDetails";
import AdminSubscriptions from "@/pages/admin/AdminSubscriptions";
import AdminPlans from "@/pages/admin/AdminPlans";
import AdminBilling from "@/pages/admin/AdminBilling";
import AdminAnalytics from "@/pages/admin/AdminAnalytics";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminTeams from "@/pages/admin/AdminTeams";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/assemblies" element={<Assemblies />} />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminLayout />
                </AdminRoute>
              }
            >
              <Route index element={<Navigate to="/admin/dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:id" element={<AdminUserDetails />} />
              <Route path="organizations" element={<AdminOrganizations />} />
              <Route path="organizations/:id" element={<AdminOrganizationDetails />} />
              <Route path="subscriptions" element={<AdminSubscriptions />} />
              <Route path="plans" element={<AdminPlans />} />
              <Route path="billing" element={<AdminBilling />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="teams" element={<AdminTeams />} />
            </Route>
            <Route path="/projects/:projectId" element={<ProjectDetails />} />
            <Route path="/projects/new" element={<NewProject />} />
            <Route path="/projects/:projectId/documents/:documentId" element={<ProjectDocumentPages />} />
            <Route path="/projects/:projectId/takeoff" element={<TakeoffWorkspace />} />
            <Route path="/projects/:projectId/estimating" element={<EstimatingWorkspace />} />
            <Route path="/projects/:projectId/proposal" element={<ProposalWorkspace />} />
            <Route path="/projects/:projectId/scan" element={<ScanWorkspace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
