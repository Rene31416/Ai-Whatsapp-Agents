import { Card } from "./ui/card";
import { Calendar, Clock, AlertCircle, MessageSquare, Activity, TrendingUp, Target } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { CreateAppointmentButton } from "./CreateAppointmentButton";
import { SyncStatusIndicator } from "./SyncStatusIndicator";

const conversationsData = [
  { day: "Lun", count: 45 },
  { day: "Mar", count: 52 },
  { day: "Mié", count: 38 },
  { day: "Jue", count: 61 },
  { day: "Vie", count: 55 },
  { day: "Sáb", count: 28 },
  { day: "Dom", count: 15 },
];

const confidenceData = [
  { name: "Alta", value: 65, color: "#14b8a6" },
  { name: "Media", value: 25, color: "#f59e0b" },
  { name: "Baja", value: 10, color: "#ef4444" },
];

const recentActivity = [
  { time: "10:30", message: "Cita creada para Kelly con Dr. Gerardo", type: "appointment" },
  { time: "10:45", message: "Error de sincronización con Google Calendar", type: "error" },
  { time: "11:15", message: "María confirmó su cita para mañana", type: "confirmation" },
  { time: "11:30", message: "Bot escalado a humano - Carlos López", type: "escalation" },
  { time: "12:00", message: "Cita cancelada - Juan Pérez", type: "cancellation" },
];

export function DashboardOverview() {
  const today = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="p-10 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-neutral-900 mb-2">Dashboard</h1>
          <p className="text-neutral-500 capitalize">{today}</p>
        </div>
        <div className="flex items-center gap-4">
          <SyncStatusIndicator />
          <CreateAppointmentButton />
        </div>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-6">
            <div className="p-4 bg-accent-100 rounded-2xl">
              <Calendar className="h-6 w-6 text-accent-600" />
            </div>
          </div>
          <div>
            <p className="text-neutral-500 mb-2">Citas Próximas</p>
            <p className="text-neutral-900 mb-2">24</p>
            <p className="text-neutral-600">Próximas 24 horas</p>
          </div>
        </Card>

        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-6">
            <div className="p-4 bg-orange-100 rounded-2xl">
              <Clock className="h-6 w-6 text-orange-600" />
            </div>
          </div>
          <div>
            <p className="text-neutral-500 mb-2">Confirmaciones Pendientes</p>
            <p className="text-neutral-900 mb-2">12</p>
            <p className="text-neutral-600">Esperando "sí, confirmo"</p>
          </div>
        </Card>

        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-6">
            <div className="p-4 bg-red-100 rounded-2xl">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
          </div>
          <div>
            <p className="text-neutral-500 mb-2">Errores de Sincronización</p>
            <p className="text-neutral-900 mb-2">5</p>
            <p className="text-neutral-600">Requiere atención</p>
          </div>
        </Card>

        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-6">
            <div className="p-4 bg-blue-100 rounded-2xl">
              <MessageSquare className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <div>
            <p className="text-neutral-500 mb-2">Nuevas Conversaciones</p>
            <p className="text-neutral-900 mb-2">18</p>
            <p className="text-neutral-600">Hoy</p>
          </div>
        </Card>
      </div>

      {/* Bot Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-8 lg:col-span-2 rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="mb-8">
            <h3 className="text-neutral-900 mb-2">Conversaciones Gestionadas</h3>
            <p className="text-neutral-500">Últimos 7 días</p>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={conversationsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="day" stroke="#a3a3a3" style={{ fontSize: '14px' }} />
              <YAxis stroke="#a3a3a3" style={{ fontSize: '14px' }} />
              <Tooltip 
                contentStyle={{ 
                  borderRadius: '12px', 
                  border: '1px solid #e5e5e5',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }} 
              />
              <Line 
                type="monotone" 
                dataKey="count" 
                stroke="#14b8a6" 
                strokeWidth={3} 
                dot={{ fill: '#14b8a6', r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="mb-8">
            <h3 className="text-neutral-900 mb-2">Confianza de Intención</h3>
            <p className="text-neutral-500">Distribución</p>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={confidenceData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={90}
                fill="#8884d8"
                dataKey="value"
              >
                {confidenceData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  borderRadius: '12px', 
                  border: '1px solid #e5e5e5',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }} 
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Additional Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-5">
            <div className="p-4 bg-purple-100 rounded-2xl">
              <Activity className="h-6 w-6 text-purple-600" />
            </div>
            <div className="flex-1">
              <p className="text-neutral-500 mb-1">Tiempo de Respuesta Promedio</p>
              <p className="text-neutral-900">2.3s</p>
            </div>
          </div>
        </Card>

        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-5">
            <div className="p-4 bg-orange-100 rounded-2xl">
              <TrendingUp className="h-6 w-6 text-orange-600" />
            </div>
            <div className="flex-1">
              <p className="text-neutral-500 mb-1">Escalaciones a Humano</p>
              <p className="text-neutral-900">8</p>
            </div>
          </div>
        </Card>

        <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-5">
            <div className="p-4 bg-accent-100 rounded-2xl">
              <Target className="h-6 w-6 text-accent-600" />
            </div>
            <div className="flex-1">
              <p className="text-neutral-500 mb-1">Tasa de Éxito</p>
              <p className="text-neutral-900">94.5%</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Activity Feed */}
      <Card className="p-8 rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <h3 className="text-neutral-900 mb-6">Actividad Reciente</h3>
        <div className="space-y-5">
          {recentActivity.map((activity, index) => (
            <div key={index} className="flex items-start gap-5 pb-5 border-b border-neutral-100 last:border-0 last:pb-0">
              <div className="text-neutral-500 min-w-[70px]">{activity.time}</div>
              <div className="flex-1">
                <p className="text-neutral-900">{activity.message}</p>
              </div>
              <div>
                {activity.type === "appointment" && (
                  <span className="inline-flex items-center gap-2 px-3 py-2 bg-accent-100 text-accent-700 rounded-lg">
                    <Calendar className="h-4 w-4" />
                  </span>
                )}
                {activity.type === "error" && (
                  <span className="inline-flex items-center gap-2 px-3 py-2 bg-red-100 text-red-700 rounded-lg">
                    <AlertCircle className="h-4 w-4" />
                  </span>
                )}
                {activity.type === "confirmation" && (
                  <span className="inline-flex items-center gap-2 px-3 py-2 bg-green-100 text-green-700 rounded-lg">
                    <Clock className="h-4 w-4" />
                  </span>
                )}
                {activity.type === "escalation" && (
                  <span className="inline-flex items-center gap-2 px-3 py-2 bg-purple-100 text-purple-700 rounded-lg">
                    <TrendingUp className="h-4 w-4" />
                  </span>
                )}
                {activity.type === "cancellation" && (
                  <span className="inline-flex items-center gap-2 px-3 py-2 bg-neutral-100 text-neutral-700 rounded-lg">
                    <AlertCircle className="h-4 w-4" />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
