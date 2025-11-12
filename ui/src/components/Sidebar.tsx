import { LayoutDashboard, Calendar, MessageSquare, Settings, Bell } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

interface SidebarProps {
  activeView: "dashboard" | "calendar" | "conversations";
  onViewChange: (view: "dashboard" | "calendar" | "conversations") => void;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "calendar", label: "Calendar", icon: Calendar },
    { id: "conversations", label: "Conversations", icon: MessageSquare, badge: 3 },
  ];

  return (
    <aside className="w-72 bg-white border-r border-neutral-200 flex flex-col">
      {/* Logo/Clinic Name */}
      <div className="p-8 border-b border-neutral-200">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-accent-400 to-accent-600 rounded-2xl flex items-center justify-center shadow-sm">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-neutral-900">Clínica Salud</h2>
            <p className="text-neutral-500">Portal de Gestión</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-6 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id as any)}
              className={`w-full flex items-center gap-3 px-5 py-4 rounded-xl transition-all ${
                isActive
                  ? "bg-accent-50 text-accent-700 shadow-sm"
                  : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge && (
                <Badge className="bg-red-500 text-white rounded-full px-2">{item.badge}</Badge>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="p-6 border-t border-neutral-200 space-y-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-neutral-600 hover:bg-neutral-50 rounded-xl px-5 py-4"
        >
          <Bell className="h-5 w-5" />
          <span>Notifications</span>
          <Badge className="ml-auto bg-red-500 text-white rounded-full px-2">5</Badge>
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-neutral-600 hover:bg-neutral-50 rounded-xl px-5 py-4"
        >
          <Settings className="h-5 w-5" />
          <span>Settings</span>
        </Button>
      </div>
    </aside>
  );
}
