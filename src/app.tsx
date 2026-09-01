import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import DashboardPage from "@/pages/DashboardPage/DashboardPage";
import MasterPlanPage from "@/pages/MasterPlanPage/MasterPlanPage";
import CloneMasterPage from "@/pages/CloneMasterPage/CloneMasterPage";
import CreateWorkshopPage from "@/pages/CreateWorkshopPage/CreateWorkshopPage";
import ToolboxPage from "@/pages/ToolboxPage/ToolboxPage";
import StyleLibraryPage from "@/pages/StyleLibraryPage/StyleLibraryPage";
import HistoryPage from "@/pages/HistoryPage/HistoryPage";
import WalletPage from "@/pages/WalletPage/WalletPage";
import ProfilePage from "@/pages/ProfilePage/ProfilePage";
import LoginPage from "@/pages/LoginPage/LoginPage";
import RegisterPage from "@/pages/RegisterPage/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage/ForgotPasswordPage";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";
import { AuthProvider } from "@/context/AuthContext";
import { AdminAuthProvider } from "@/context/AdminAuthContext";
import { AdminLayout } from "@/components/AdminLayout";
import AdminLoginPage from "@/pages/admin/AdminLoginPage";
import AdminDashboardPage from "@/pages/admin/AdminDashboardPage";
import AdminUsersPage from "@/pages/admin/AdminUsersPage";
import AdminFeedbackPage from "@/pages/admin/AdminFeedbackPage";
import AdminOrdersPage from "@/pages/admin/AdminOrdersPage";
import AdminRevenuePage from "@/pages/admin/AdminRevenuePage";
import AdminRefundsPage from "@/pages/admin/AdminRefundsPage";
import AdminStylesPage from "@/pages/admin/AdminStylesPage";
import AdminApiLogsPage from "@/pages/admin/AdminApiLogsPage";
import AdminAnnouncementsPage from "@/pages/admin/AdminAnnouncementsPage";
import AdminAdminsPage from "@/pages/admin/AdminAdminsPage";
import AdminSystemStatusPage from "@/pages/admin/AdminSystemStatusPage";
import AdminPackagesPage from "@/pages/admin/AdminPackagesPage";
import AdminLoginLogsPage from "@/pages/admin/AdminLoginLogsPage";
import AdminApiKeysPage from "@/pages/admin/AdminApiKeysPage";
import AdminServicesPage from "@/pages/admin/AdminServicesPage";
import AdminCasesPage from "@/pages/admin/AdminCasesPage";
import AdminBasicSettingsPage from "@/pages/admin/AdminBasicSettingsPage";
import AdminPointsSettingsPage from "@/pages/admin/AdminPointsSettingsPage";
import AdminEmailTemplatesPage from "@/pages/admin/AdminEmailTemplatesPage";
import AdminSmsTemplatesPage from "@/pages/admin/AdminSmsTemplatesPage";
import AdminRolesPage from "@/pages/admin/AdminRolesPage";
import AdminAuditLogsPage from "@/pages/admin/AdminAuditLogsPage";
import AdminErrorLogsPage from "@/pages/admin/AdminErrorLogsPage";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* 认证页面 - 不带 Sidebar */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* 主应用 - 带 Sidebar + 路由守卫 */}
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="masterplan" element={<MasterPlanPage />} />
          <Route path="clone" element={<CloneMasterPage />} />
          <Route path="create" element={<CreateWorkshopPage />} />
          <Route path="tools" element={<ToolboxPage />} />
          <Route path="style-library" element={<StyleLibraryPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="wallet" element={<WalletPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* 管理后台 */}
        <Route
          path="admin"
          element={
            <AdminAuthProvider>
              <AdminLayout />
            </AdminAuthProvider>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="feedback" element={<AdminFeedbackPage />} />
          <Route path="orders" element={<AdminOrdersPage />} />
          <Route path="revenue" element={<AdminRevenuePage />} />
          <Route path="refunds" element={<AdminRefundsPage />} />
          <Route path="api-keys" element={<AdminApiKeysPage />} />
          <Route path="api-logs" element={<AdminApiLogsPage />} />
          <Route path="services" element={<AdminServicesPage />} />
          <Route path="styles" element={<AdminStylesPage />} />
          <Route path="cases" element={<AdminCasesPage />} />
          <Route path="announcements" element={<AdminAnnouncementsPage />} />
          <Route path="settings/basic" element={<AdminBasicSettingsPage />} />
          <Route path="settings/packages" element={<AdminPackagesPage />} />
          <Route path="settings/points" element={<AdminPointsSettingsPage />} />
          <Route path="settings/email-templates" element={<AdminEmailTemplatesPage />} />
          <Route path="settings/sms-templates" element={<AdminSmsTemplatesPage />} />
          <Route path="admins" element={<AdminAdminsPage />} />
          <Route path="roles" element={<AdminRolesPage />} />
          <Route path="audit-logs" element={<AdminAuditLogsPage />} />
          <Route path="error-logs" element={<AdminErrorLogsPage />} />
          <Route path="login-logs" element={<AdminLoginLogsPage />} />
          <Route path="system-status" element={<AdminSystemStatusPage />} />
        </Route>

        {/* 后台登录页 - 独立布局（Provider 在组件内部） */}
        <Route path="admin/login" element={<AdminLoginPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
