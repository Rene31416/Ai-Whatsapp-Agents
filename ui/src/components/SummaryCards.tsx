import { Card } from "./ui/card";
import { Clock, CheckCircle, AlertCircle, Calendar } from "lucide-react";

export function SummaryCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Clock className="h-5 w-5 text-blue-600" />
          </div>
          <span className="text-gray-500">This Week</span>
        </div>
        <div>
          <p className="text-gray-900 mb-1">In Progress</p>
          <p className="text-gray-600">12 active tasks</p>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full w-3/4 bg-blue-500 rounded-full"></div>
          </div>
          <span className="text-gray-600">75%</span>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <CheckCircle className="h-5 w-5 text-green-600" />
          </div>
          <span className="text-gray-500">This Month</span>
        </div>
        <div>
          <p className="text-gray-900 mb-1">Completed</p>
          <p className="text-gray-600">47 finished tasks</p>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full w-full bg-green-500 rounded-full"></div>
          </div>
          <span className="text-gray-600">100%</span>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-orange-100 rounded-lg">
            <AlertCircle className="h-5 w-5 text-orange-600" />
          </div>
          <span className="text-gray-500">Urgent</span>
        </div>
        <div>
          <p className="text-gray-900 mb-1">Pending Review</p>
          <p className="text-gray-600">8 items waiting</p>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-orange-500 rounded-full"></div>
          </div>
          <span className="text-gray-600">33%</span>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Calendar className="h-5 w-5 text-purple-600" />
          </div>
          <span className="text-gray-500">Upcoming</span>
        </div>
        <div>
          <p className="text-gray-900 mb-1">Scheduled</p>
          <p className="text-gray-600">23 future tasks</p>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-purple-500 rounded-full"></div>
          </div>
          <span className="text-gray-600">50%</span>
        </div>
      </Card>
    </div>
  );
}
