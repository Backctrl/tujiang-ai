import { useState, useCallback } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AnimatePresence, motion } from 'framer-motion';
import { Toaster } from '@/components/ui/sonner';
import AppSidebar from '@/components/AppSidebar';
import AppBreadcrumb from '@/components/AppBreadcrumb';
import GlobalShortcuts from '@/components/GlobalShortcuts';
import RouteGuard from '@/components/RouteGuard';

function LayoutContent() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <RouteGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex flex-col min-w-0 overflow-x-hidden bg-gradient-to-br from-background via-background to-primary/[0.03]">
          <AppBreadcrumb />
          <main className="flex-1 w-full overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="h-full"
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
            <Toaster position="top-right" closeButton richColors />
          </main>
          <GlobalShortcuts />
        </SidebarInset>
      </SidebarProvider>
    </RouteGuard>
  );
}

export function Layout() {
  return (
    <RouteGuard>
      <LayoutContent />
    </RouteGuard>
  );
}
