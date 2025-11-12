import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

interface CreateAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateAppointmentModal({ isOpen, onClose }: CreateAppointmentModalProps) {
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>Crear Nueva Cita</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Doctor Selection */}
          <div className="space-y-2">
            <Label htmlFor="doctor">Doctor</Label>
            <Select>
              <SelectTrigger id="doctor" className="rounded-xl">
                <SelectValue placeholder="Seleccionar doctor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gerardo">Dr. Gerardo Martínez</SelectItem>
                <SelectItem value="laura">Dra. Laura García</SelectItem>
                <SelectItem value="carlos">Dr. Carlos Rodríguez</SelectItem>
                <SelectItem value="ana">Dra. Ana López</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Fecha</Label>
              <Input id="date" type="date" className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Hora</Label>
              <Input id="time" type="time" className="rounded-xl" />
            </div>
          </div>

          {/* Patient Information */}
          <div className="space-y-4">
            <h3 className="text-neutral-900">Información del Paciente</h3>
            
            <div className="space-y-2">
              <Label htmlFor="patientName">Nombre Completo</Label>
              <Input id="patientName" placeholder="Nombre del paciente" className="rounded-xl" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Número de Teléfono</Label>
              <Input id="phone" type="tel" placeholder="+52 123 456 7890" className="rounded-xl" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Correo Electrónico (opcional)</Label>
              <Input id="email" type="email" placeholder="paciente@ejemplo.com" className="rounded-xl" />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Agregar notas o requisitos especiales..."
              rows={4}
              className="rounded-xl"
            />
          </div>

          {/* WhatsApp Confirmation Toggle */}
          <div className="flex items-center justify-between p-6 bg-accent-50 rounded-2xl">
            <div>
              <Label htmlFor="whatsapp" className="text-neutral-900">Enviar Confirmación por WhatsApp</Label>
              <p className="text-neutral-600 mt-1">
                El paciente recibirá un mensaje de confirmación
              </p>
            </div>
            <Switch
              id="whatsapp"
              checked={sendWhatsApp}
              onCheckedChange={setSendWhatsApp}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-200">
            <Button type="button" variant="outline" onClick={onClose} className="rounded-xl px-6">
              Cancelar
            </Button>
            <Button type="submit" className="bg-accent-600 hover:bg-accent-700 text-white rounded-xl px-6">
              Crear Cita
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
