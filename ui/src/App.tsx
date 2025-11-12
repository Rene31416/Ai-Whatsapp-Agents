import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { DashboardOverview } from "./components/DashboardOverview";
import { CalendarView } from "./components/CalendarView";
import { ConversationViewer } from "./components/ConversationViewer";

export default function App() {
  const [activeView, setActiveView] = useState<"dashboard" | "calendar" | "conversations">("dashboard");

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />
      <main className="flex-1 overflow-auto">
        {activeView === "dashboard" && <DashboardOverview />}
        {activeView === "calendar" && <CalendarView />}
        {activeView === "conversations" && <ConversationViewer />}
      </main>
    </div>
  );
}
