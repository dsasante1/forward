import { Link, Outlet } from "react-router-dom";
import {
  OrganizationSwitcher,
  UserButton,
  useOrganization,
} from "@clerk/react";

/** App chrome for every signed-in route: brand, org switcher, account menu. */
export function Layout() {
  const { membership } = useOrganization();
  const isOrgAdmin =
    membership?.role === "org:admin" || membership?.role === "admin";
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/app" className="brand">
          Forward
        </Link>
        <div className="topbar-right">
          <OrganizationSwitcher
            hidePersonal={false}
            afterCreateOrganizationUrl="/app"
            afterSelectOrganizationUrl="/app"
          />
          {isOrgAdmin && (
            <Link to="/app/org" className="link">
              Org admin
            </Link>
          )}
          <Link to="/app/account" className="link">
            Account
          </Link>
          <UserButton />
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
