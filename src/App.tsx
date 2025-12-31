import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

import { AuthProvider } from "@/hooks/useAuth";

import Index from "@/pages/Index";
import Auth from "@/pages/Auth";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import NewProject from "@/pages/NewProject";
import ProjectDetails from "@/pages/ProjectDetails";
import ProjectDocumentPages from "@/pages/ProjectDocumentPages";
import TakeoffWorkspace from "@/pages/TakeoffWorkspace";
import EstimatingWorkspace from "@/pages/EstimatingWorkspace";
import ProposalWorkspace from "@/pages/ProposalWorkspace";
import ScanWorkspace from "@/pages/ScanWorkspace";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

export default function App() {
  return (
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
              <Route path="/projects/new" element={<NewProject />} />
              <Route path="/projects/:projectId" element={<ProjectDetails />} />

              <Route
                path="/projects/:projectId/documents/:documentId"
                element={<ProjectDocumentPages />}
              />

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
}
