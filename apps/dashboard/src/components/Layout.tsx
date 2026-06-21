import { Link, Outlet } from "react-router-dom";
import { OrganizationSwitcher, UserButton } from "@clerk/clerk-react";

/** App chrome for every signed-in route: brand, org switcher, account menu. */
export function Layout() {
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
