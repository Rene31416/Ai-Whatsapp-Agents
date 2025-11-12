import { X, Calendar, Clock, User, Phone, Mail, CheckCircle, AlertCircle } from "lucide-react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

interface AppointmentDetailsPanelProps {
  appointmentId: number;
  onClose: () => void;
}

export function AppointmentDetailsPanel({ appointmentId, onClose }: AppointmentDetailsPanelProps) {
  // Mock data - would be fetched based on appointmentId
  const appointment = {
    id: appointmentId,
    patient: "Kelly Fernández",
    doctor: "Dr. Gerardo Martínez",
    date: "11 de Noviembre, 2025",
    time: "09:00 AM",
    phone: "+52 123 456 7890",
    email: "kelly@ejemplo.com",
    status: "confirmed",
    syncStatus: true,
    notes: "Primera consulta. Paciente refiere dolor de cabeza persistente.",
  };

  return (
    <div className="w-[420px] border-l border-neutral-200 bg-white flex flex-col h-full">
      {/* Header */}
      <div className="p-8 border-b border-neutral-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-neutral-900">Detalles de la Cita</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-100 rounded-xl transition-colors"
          >
            <X className="h-5 w-5 text-neutral-500" />
          </button>
        </div>
        <Badge
          variant="outline"
          className={`rounded-lg px-3 py-1 ${
            appointment.status === "confirmed"
              ? "bg-green-100 text-green-700 border-green-200"
              : appointment.status === "pending"
              ? "bg-orange-100 text-orange-700 border-orange-200"
              : "bg-neutral-100 text-neutral-700 border-neutral-200"
          }`}
        >
          {appointment.status === "confirmed" && "Confirmada"}
          {appointment.status === "pending" && "Pendiente de Confirmación"}
          {appointment.status === "cancelled" && "Cancelada"}
        </Badge>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-8 space-y-8">
        {/* Patient Info */}
        <Card className="p-6 bg-neutral-50 rounded-2xl border-0">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-12 h-12 bg-accent-100 rounded-2xl flex items-center justify-center">
              <User className="h-6 w-6 text-accent-600" />
            </div>
            <div>
              <p className="text-neutral-900">{appointment.patient}</p>
              <p className="text-neutral-500">Paciente</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-neutral-600">
              <Phone className="h-4 w-4" />
              <span>{appointment.phone}</span>
            </div>
            <div className="flex items-center gap-3 text-neutral-600">
              <Mail className="h-4 w-4" />
              <span>{appointment.email}</span>
            </div>
          </div>
        </Card>

        {/* Appointment Details */}
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-xl">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-neutral-500">Fecha</p>
              <p className="text-neutral-900">{appointment.date}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 rounded-xl">
              <Clock className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-neutral-500">Hora</p>
              <p className="text-neutral-900">{appointment.time}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 rounded-xl">
              <User className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-neutral-500">Doctor</p>
              <p className="text-neutral-900">{appointment.doctor}</p>
            </div>
          </div>
        </div>

        {/* Sync Status */}
        <Card className="p-6 rounded-2xl border border-neutral-200">
          <div className="flex items-center gap-4">
            {appointment.syncStatus ? (
              <>
                <CheckCircle className="h-6 w-6 text-green-600" />
                <div>
                  <p className="text-neutral-900">Calendario Sincronizado</p>
                  <p className="text-neutral-500">Google Calendar</p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle className="h-6 w-6 text-red-600" />
                <div>
                  <p className="text-neutral-900">Error de Sincronización</p>
                  <p className="text-neutral-500">Se requiere reintento</p>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Notes */}
        {appointment.notes && (
          <div>
            <p className="text-neutral-900 mb-3">Notas</p>
            <Card className="p-6 bg-neutral-50 rounded-2xl border-0">
              <p className="text-neutral-600">{appointment.notes}</p>
            </Card>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-8 border-t border-neutral-200 space-y-3">
        <Button className="w-full bg-accent-600 hover:bg-accent-700 text-white rounded-xl py-6">
          Reagendar
        </Button>
        <Button variant="outline" className="w-full text-red-600 hover:bg-red-50 rounded-xl py-6 border-red-200">
          Cancelar Cita
        </Button>
      </div>
    </div>
  );
}
