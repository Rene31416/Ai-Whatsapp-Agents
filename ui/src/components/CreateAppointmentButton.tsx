import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { CreateAppointmentModal } from "./CreateAppointmentModal";

export function CreateAppointmentButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button 
        onClick={() => setIsOpen(true)} 
        className="gap-2 bg-accent-600 hover:bg-accent-700 text-white rounded-xl px-6 py-3 shadow-sm"
      >
        <Plus className="h-5 w-5" />
        Crear Cita
      </Button>
      <CreateAppointmentModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
