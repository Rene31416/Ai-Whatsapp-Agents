import { useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppointmentDetailsPanel } from "./AppointmentDetailsPanel";
import { CreateAppointmentButton } from "./CreateAppointmentButton";

const appointments = [
  { id: 1, date: "2025-11-11", time: "09:00", patient: "Kelly Fernández", doctor: "Gerardo", status: "confirmed", doctorColor: "#3b82f6" },
  { id: 2, date: "2025-11-11", time: "10:30", patient: "María López", doctor: "Laura", status: "pending", doctorColor: "#8b5cf6" },
  { id: 3, date: "2025-11-12", time: "11:00", patient: "Carlos Pérez", doctor: "Gerardo", status: "confirmed", doctorColor: "#3b82f6" },
  { id: 4, date: "2025-11-12", time: "14:00", patient: "Ana Martínez", doctor: "Carlos", status: "cancelled", doctorColor: "#10b981" },
  { id: 5, date: "2025-11-13", time: "09:30", patient: "Juan Rodríguez", doctor: "Ana", status: "confirmed", doctorColor: "#f59e0b" },
  { id: 6, date: "2025-11-13", time: "15:00", patient: "Sofia García", doctor: "Laura", status: "pending", doctorColor: "#8b5cf6" },
  { id: 7, date: "2025-11-14", time: "10:00", patient: "Pedro Sánchez", doctor: "Gerardo", status: "confirmed", doctorColor: "#3b82f6" },
  { id: 8, date: "2025-11-15", time: "11:30", patient: "Lucía Torres", doctor: "Carlos", status: "confirmed", doctorColor: "#10b981" },
];

const daysInMonth = 30;
const firstDayOfMonth = 5; // Friday (0 = Sunday, 5 = Friday)

export function CalendarView() {
  const [view, setView] = useState<"month" | "week">("month");
  const [selectedAppointment, setSelectedAppointment] = useState<number | null>(null);

  const getAppointmentsForDay = (day: number) => {
    const dateStr = `2025-11-${String(day).padStart(2, "0")}`;
    return appointments.filter((apt) => apt.date === dateStr);
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 p-10 overflow-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-neutral-900 mb-6">Calendario</h1>
          
          {/* Filters */}
          <Card className="p-6 rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-4">
              <Select defaultValue="all">
                <SelectTrigger className="w-[200px] rounded-xl">
                  <SelectValue placeholder="Seleccionar doctor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los Doctores</SelectItem>
                  <SelectItem value="gerardo">Dr. Gerardo</SelectItem>
                  <SelectItem value="laura">Dra. Laura</SelectItem>
                  <SelectItem value="carlos">Dr. Carlos</SelectItem>
                  <SelectItem value="ana">Dra. Ana</SelectItem>
                </SelectContent>
              </Select>

              <Input type="date" className="w-[200px] rounded-xl" />

              <Select defaultValue="all">
                <SelectTrigger className="w-[200px] rounded-xl">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los Estados</SelectItem>
                  <SelectItem value="confirmed">Confirmadas</SelectItem>
                  <SelectItem value="pending">Pendientes</SelectItem>
                  <SelectItem value="cancelled">Canceladas</SelectItem>
                </SelectContent>
              </Select>

              <div className="ml-auto">
                <CreateAppointmentButton />
              </div>
            </div>
          </Card>
        </div>

        {/* Calendar Header */}
        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" className="rounded-xl">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-neutral-900">Noviembre 2025</h2>
              <Button variant="outline" size="sm" className="rounded-xl">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant={view === "month" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("month")}
                className={`rounded-xl ${view === "month" ? "bg-accent-600 hover:bg-accent-700 text-white" : ""}`}
              >
                Mes
              </Button>
              <Button
                variant={view === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => setView("week")}
                className={`rounded-xl ${view === "week" ? "bg-accent-600 hover:bg-accent-700 text-white" : ""}`}
              >
                Semana
              </Button>
            </div>
          </div>

          {/* Calendar Grid */}
          {view === "month" && (
            <div className="grid grid-cols-7 gap-3">
              {/* Day Headers */}
              {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((day) => (
                <div key={day} className="text-center text-neutral-600 py-3">
                  {day}
                </div>
              ))}

              {/* Empty cells for days before month starts */}
              {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-square border border-neutral-200 rounded-xl bg-neutral-50" />
              ))}

              {/* Calendar Days */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayAppointments = getAppointmentsForDay(day);
                const isToday = day === 11;

                return (
                  <div
                    key={day}
                    className={`aspect-square border rounded-xl p-3 ${
                      isToday ? "border-accent-500 bg-accent-50" : "border-neutral-200 bg-white"
                    }`}
                  >
                    <div className={`mb-3 ${isToday ? "text-accent-600" : "text-neutral-900"}`}>
                      {day}
                    </div>
                    <div className="space-y-1">
                      {dayAppointments.slice(0, 2).map((apt) => (
                        <button
                          key={apt.id}
                          onClick={() => setSelectedAppointment(apt.id)}
                          className="w-full text-left px-2 py-1.5 rounded-lg text-white text-xs hover:opacity-80 transition-opacity"
                          style={{ backgroundColor: apt.doctorColor }}
                        >
                          <div className="truncate">{apt.patient}</div>
                        </button>
                      ))}
                      {dayAppointments.length > 2 && (
                        <div className="text-neutral-500 text-xs px-2">
                          +{dayAppointments.length - 2} más
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Week View */}
          {view === "week" && (
            <div className="space-y-4">
              <p className="text-neutral-500">Semana del 11-17 Nov, 2025</p>
              {appointments.slice(0, 7).map((apt) => (
                <button
                  key={apt.id}
                  onClick={() => setSelectedAppointment(apt.id)}
                  className="w-full p-6 border border-neutral-200 rounded-2xl hover:border-accent-500 hover:bg-accent-50 transition-all text-left"
                >
                  <div className="flex items-center gap-6">
                    <div className="text-neutral-900">
                      {apt.date} a las {apt.time}
                    </div>
                    <div className="flex items-center gap-3">
                      <span 
                        className="w-4 h-4 rounded-full" 
                        style={{ backgroundColor: apt.doctorColor }}
                      />
                      <span className="text-neutral-600">{apt.doctor}</span>
                    </div>
                    <div className="flex-1 text-neutral-900">{apt.patient}</div>
                    <div>
                      {apt.status === "confirmed" && (
                        <span className="px-3 py-2 bg-green-100 text-green-700 rounded-lg">
                          Confirmada
                        </span>
                      )}
                      {apt.status === "pending" && (
                        <span className="px-3 py-2 bg-orange-100 text-orange-700 rounded-lg">
                          Pendiente
                        </span>
                      )}
                      {apt.status === "cancelled" && (
                        <span className="px-3 py-2 bg-neutral-100 text-neutral-700 rounded-lg">
                          Cancelada
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Side Panel */}
      {selectedAppointment && (
        <AppointmentDetailsPanel
          appointmentId={selectedAppointment}
          onClose={() => setSelectedAppointment(null)}
        />
      )}
    </div>
  );
}
