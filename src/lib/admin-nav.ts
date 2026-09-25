export type AdminNavItem = {
  label: string;
  href: string;
};

export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Record Sale", href: "/admin/pos" },
  { label: "Inventory", href: "/admin/inventory" },
  { label: "Products", href: "/admin/products" },
  { label: "Orders", href: "/admin/orders" },
  { label: "Customers", href: "/admin/customers" },
  { label: "Sales", href: "/admin/sales" },
  { label: "Analytics", href: "/admin/analytics" },
  { label: "Settings", href: "/admin/settings" },
];
