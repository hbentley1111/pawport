"use client";
import { usePathname } from "next/navigation";
import { NotificationBell } from "./notifications/bell";
import { Brand } from "./brand";
import { AppNavigationLinks } from "./app-navigation-links";
export function AppNavigation() {
  const pathname = usePathname();
  return (
    <>
      <header className="app-global-header">
        <Brand />
        <AppNavigationLinks pathname={pathname} />
        <NotificationBell />
      </header>
      <AppNavigationLinks pathname={pathname} mobile />
    </>
  );
}
