import { AppNavigation } from "./app-navigation";
export function AppFrame({
  children,
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <div className="owner-app">
      <AppNavigation />
      {children}
    </div>
  );
}
