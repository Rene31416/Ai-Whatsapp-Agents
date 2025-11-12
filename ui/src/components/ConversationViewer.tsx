import { useState } from "react";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Search, Send, ChevronDown, ChevronUp } from "lucide-react";

const conversations = [
  {
    id: 1,
    name: "Kelly Fernández",
    phone: "+52 123 456 7890",
    lastMessage: "Sí, confirmo mi cita para mañana",
    timestamp: "10:30 AM",
    unread: false,
    status: "resolved",
  },
  {
    id: 2,
    name: "María López",
    phone: "+52 987 654 3210",
    lastMessage: "¿Puedo cambiar mi cita?",
    timestamp: "11:15 AM",
    unread: true,
    status: "open",
  },
  {
    id: 3,
    name: "Carlos Pérez",
    phone: "+52 555 123 4567",
    lastMessage: "Gracias por la información",
    timestamp: "Ayer",
    unread: false,
    status: "resolved",
  },
  {
    id: 4,
    name: "Ana Martínez",
    phone: "+52 444 567 8901",
    lastMessage: "Hola, necesito hacer una cita",
    timestamp: "Ayer",
    unread: false,
    status: "resolved",
  },
];

const chatMessages = [
  { id: 1, sender: "patient", message: "Hola, buenos días", timestamp: "10:25 AM" },
  { id: 2, sender: "bot", message: "¡Hola! Bienvenido a Clínica Salud. ¿En qué puedo ayudarte hoy?", timestamp: "10:25 AM" },
  { id: 3, sender: "patient", message: "Necesito confirmar mi cita", timestamp: "10:26 AM" },
  { id: 4, sender: "bot", message: "Claro, déjame verificar. Tienes una cita programada con Dr. Gerardo Martínez para el 12 de noviembre a las 9:00 AM. ¿Deseas confirmarla?", timestamp: "10:26 AM" },
  { id: 5, sender: "patient", message: "Sí, confirmo", timestamp: "10:30 AM" },
  { id: 6, sender: "bot", message: "¡Perfecto! Tu cita ha sido confirmada. Recibirás un recordatorio 24 horas antes.", timestamp: "10:30 AM" },
];

export function ConversationViewer() {
  const [selectedConversation, setSelectedConversation] = useState(2);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredConversations = conversations.filter(conv =>
    conv.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.phone.includes(searchQuery)
  );

  return (
    <div className="flex h-full">
      {/* Left Column - Chat List */}
      <div className="w-[420px] border-r border-neutral-200 bg-white flex flex-col">
        {/* Search */}
        <div className="p-6 border-b border-neutral-200">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-400" />
            <Input
              placeholder="Buscar conversaciones..."
              className="pl-12 rounded-xl"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <p className="text-neutral-500 mt-4">
            Mostrando conversaciones de Clínica Salud
          </p>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-auto">
          {filteredConversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setSelectedConversation(conv.id)}
              className={`w-full p-6 border-b border-neutral-200 hover:bg-neutral-50 transition-colors text-left ${
                selectedConversation === conv.id ? "bg-accent-50" : ""
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-neutral-900">{conv.name}</p>
                    {conv.status === "open" && (
                      <Badge className="bg-accent-500 text-white rounded-full px-2 py-0.5">
                        Abierto
                      </Badge>
                    )}
                    {conv.status === "resolved" && (
                      <Badge className="bg-neutral-200 text-neutral-700 rounded-full px-2 py-0.5">
                        Resuelto
                      </Badge>
                    )}
                  </div>
                  <p className="text-neutral-500">{conv.phone}</p>
                </div>
                <span className="text-neutral-500">{conv.timestamp}</span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-neutral-600 truncate flex-1">
                  {conv.lastMessage}
                </p>
                {conv.unread && (
                  <div className="w-2.5 h-2.5 bg-accent-500 rounded-full ml-3" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right Pane - Chat Thread */}
      <div className="flex-1 flex flex-col bg-neutral-50">
        {/* Chat Header */}
        <div className="bg-white border-b border-neutral-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-neutral-900 mb-1">María López</h3>
              <p className="text-neutral-500">+52 987 654 3210</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              className="gap-2 rounded-xl"
            >
              {detailsExpanded ? "Ocultar" : "Mostrar"} Detalles
              {detailsExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Quick Metrics Bar */}
          {detailsExpanded && (
            <div className="mt-6 grid grid-cols-3 gap-4">
              <Card className="p-4 bg-neutral-50 rounded-xl border-0">
                <p className="text-neutral-500 mb-1">Doctor</p>
                <p className="text-neutral-900">Dr. Gerardo</p>
              </Card>
              <Card className="p-4 bg-neutral-50 rounded-xl border-0">
                <p className="text-neutral-500 mb-1">Turnos</p>
                <p className="text-neutral-900">6</p>
              </Card>
              <Card className="p-4 bg-neutral-50 rounded-xl border-0">
                <p className="text-neutral-500 mb-1">Primer Mensaje</p>
                <p className="text-neutral-900">Hoy</p>
              </Card>
            </div>
          )}
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-auto p-8 space-y-6">
          {chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === "patient" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[70%] rounded-2xl p-5 ${
                  msg.sender === "patient"
                    ? "bg-accent-600 text-white"
                    : "bg-white text-neutral-900 border border-neutral-200 shadow-sm"
                }`}
              >
                <p className="leading-relaxed">{msg.message}</p>
                <p
                  className={`text-xs mt-3 ${
                    msg.sender === "patient" ? "text-accent-100" : "text-neutral-500"
                  }`}
                >
                  {msg.timestamp}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Message Input */}
        <div className="bg-white border-t border-neutral-200 p-6">
          <div className="flex gap-3">
            <Input
              placeholder="Escribe un mensaje..."
              className="flex-1 rounded-xl"
            />
            <Button className="bg-accent-600 hover:bg-accent-700 text-white rounded-xl px-6">
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
