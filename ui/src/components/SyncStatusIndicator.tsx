import { CheckCircle, AlertCircle } from "lucide-react";
import { Badge } from "./ui/badge";

export function SyncStatusIndicator() {
  const syncOk = false; // Change to true to show success state

  return (
    <Badge
      variant="outline"
      className={`gap-2 px-4 py-2 rounded-xl ${
        syncOk
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-orange-50 text-orange-700 border-orange-200"
      }`}
    >
      {syncOk ? (
        <>
          <CheckCircle className="h-4 w-4" />
          <span>Google Sync Activo</span>
        </>
      ) : (
        <>
          <AlertCircle className="h-4 w-4" />
          <span>Problemas de Sincronización</span>
        </>
      )}
    </Badge>
  );
}
