import { useEffect, useId, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Menu, X } from "lucide-react";
import {
  isNavMenuActive,
  isPrimaryLinkActive,
  PRIMARY_NAV,
  type AppNavItem,
  type AppNavLink,
} from "../lib/appNavigation";

const linkClass = (active: boolean) =>
  `px-2 py-2 rounded text-sm font-medium whitespace-nowrap ${
    active ? "bg-gray-100 text-blue-600" : "text-gray-700 hover:bg-gray-50"
  }`;

const menuItemClass = (active: boolean) =>
  `block w-full text-left px-3 py-2 text-sm rounded-md ${
    active ? "bg-gray-100 text-blue-600 font-medium" : "text-gray-700 hover:bg-gray-50"
  }`;

function NavDropdown({
  item,
  pathname,
}: {
  item: Extract<AppNavItem, { kind: "menu" }>;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const parentActive = isNavMenuActive(pathname, item.children);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (!open) return;
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`${linkClass(parentActive)} inline-flex items-center gap-0.5`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {item.label}
        <ChevronDown className={`h-3.5 w-3.5 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[13rem] rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
        >
          {item.children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              role="menuitem"
              className={menuItemClass(pathActive(pathname, child))}
              onClick={() => setOpen(false)}
            >
              {child.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function pathActive(pathname: string, child: AppNavLink): boolean {
  return pathname === child.to || (child.matchPrefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function MobileNavPanel({
  pathname,
  onClose,
}: {
  pathname: string;
  onClose: () => void;
}) {
  return (
    <div className="lg:hidden border-t border-gray-200 bg-white px-3 py-3 space-y-3">
      {PRIMARY_NAV.map((item) => {
        if (item.kind === "link") {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={`block ${linkClass(isPrimaryLinkActive(pathname, item))}`}
              onClick={onClose}
            >
              {item.label}
            </NavLink>
          );
        }
        const parentActive = isNavMenuActive(pathname, item.children);
        return (
          <div key={item.id} className="space-y-1">
            <p
              className={`px-2 text-xs font-semibold uppercase tracking-wide ${
                parentActive ? "text-blue-600" : "text-gray-500"
              }`}
            >
              {item.label}
            </p>
            <div className="pl-1 space-y-0.5">
              {item.children.map((child) => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  className={menuItemClass(pathActive(pathname, child))}
                  onClick={onClose}
                >
                  {child.label}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AppNav() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileId = useId();

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="lg:hidden inline-flex items-center gap-1 rounded px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          aria-expanded={mobileOpen}
          aria-controls={mobileId}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
          Menu
        </button>
        <nav className="hidden lg:flex flex-wrap items-center gap-x-1 gap-y-1 min-w-0" aria-label="Primary">
          {PRIMARY_NAV.map((item) => {
            if (item.kind === "link") {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => linkClass(isActive)}
                >
                  {item.label}
                </NavLink>
              );
            }
            return <NavDropdown key={item.id} item={item} pathname={pathname} />;
          })}
        </nav>
      </div>
      {mobileOpen && (
        <div id={mobileId}>
          <MobileNavPanel pathname={pathname} onClose={() => setMobileOpen(false)} />
        </div>
      )}
    </div>
  );
}
