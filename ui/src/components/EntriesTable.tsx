import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { MoreHorizontal, ArrowUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const entries = [
  {
    id: "PRJ-001",
    name: "Website Redesign",
    client: "Acme Corp",
    status: "in-progress",
    priority: "high",
    assignee: "Sarah Johnson",
    dueDate: "2025-11-15",
    progress: 65,
  },
  {
    id: "PRJ-002",
    name: "Mobile App Development",
    client: "TechStart Inc",
    status: "in-progress",
    priority: "high",
    assignee: "Mike Chen",
    dueDate: "2025-11-20",
    progress: 45,
  },
  {
    id: "PRJ-003",
    name: "Brand Identity Package",
    client: "Creative Studios",
    status: "completed",
    priority: "medium",
    assignee: "Emily Davis",
    dueDate: "2025-11-10",
    progress: 100,
  },
  {
    id: "PRJ-004",
    name: "Marketing Campaign",
    client: "Growth Co",
    status: "pending",
    priority: "low",
    assignee: "Alex Turner",
    dueDate: "2025-11-25",
    progress: 10,
  },
  {
    id: "PRJ-005",
    name: "Database Migration",
    client: "DataCorp",
    status: "in-progress",
    priority: "high",
    assignee: "James Wilson",
    dueDate: "2025-11-18",
    progress: 80,
  },
  {
    id: "PRJ-006",
    name: "UI/UX Audit",
    client: "Design Hub",
    status: "completed",
    priority: "medium",
    assignee: "Lisa Park",
    dueDate: "2025-11-08",
    progress: 100,
  },
  {
    id: "PRJ-007",
    name: "API Integration",
    client: "Connect Systems",
    status: "in-progress",
    priority: "medium",
    assignee: "Tom Anderson",
    dueDate: "2025-11-22",
    progress: 55,
  },
  {
    id: "PRJ-008",
    name: "Security Audit",
    client: "SecureNet",
    status: "pending",
    priority: "high",
    assignee: "Rachel Kim",
    dueDate: "2025-11-30",
    progress: 5,
  },
];

const statusColors = {
  "in-progress": "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  pending: "bg-gray-100 text-gray-800",
};

const priorityColors = {
  high: "bg-red-100 text-red-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-800",
};

export function EntriesTable() {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-gray-900 mb-1">Recent Projects</h2>
          <p className="text-gray-500">Manage and track all your projects</p>
        </div>
        <Button variant="outline" className="gap-2">
          <ArrowUpDown className="h-4 w-4" />
          Sort
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <span className="text-gray-900">{entry.id}</span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-900">{entry.name}</span>
                </TableCell>
                <TableCell className="text-gray-600">{entry.client}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusColors[entry.status]}>
                    {entry.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={priorityColors[entry.priority]}>
                    {entry.priority}
                  </Badge>
                </TableCell>
                <TableCell className="text-gray-600">{entry.assignee}</TableCell>
                <TableCell className="text-gray-600">{entry.dueDate}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${entry.progress}%` }}
                      ></div>
                    </div>
                    <span className="text-gray-600">{entry.progress}%</span>
                  </div>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>View Details</DropdownMenuItem>
                      <DropdownMenuItem>Edit Project</DropdownMenuItem>
                      <DropdownMenuItem>Assign Team</DropdownMenuItem>
                      <DropdownMenuItem className="text-red-600">
                        Delete Project
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
