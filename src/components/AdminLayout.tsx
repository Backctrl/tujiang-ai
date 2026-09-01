import { useLocation, useOutlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import AdminRouteGuard from '@/components/AdminRouteGuard';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';

function AdminLayoutContent() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset className="flex flex-col min-w-0 overflow-x-hidden bg-slate-50/50">
        <AdminHeader />
        <main className="flex-1 w-full overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="h-full"
            >
              {outlet}
            </motion.div>
          </AnimatePresence>
          <Toaster position="top-right" closeButton richColors />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export function AdminLayout() {
  return (
    <AdminRouteGuard>
      <AdminLayoutContent />
    </AdminRouteGuard>
  );
}
