import { Card } from "./ui/card";
import { TrendingUp, Users, Target, Award } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const performanceData = [
  { month: "Jan", value: 4000 },
  { month: "Feb", value: 3000 },
  { month: "Mar", value: 5000 },
  { month: "Apr", value: 4500 },
  { month: "May", value: 6000 },
  { month: "Jun", value: 5500 },
];

const categoryData = [
  { name: "Design", count: 45 },
  { name: "Development", count: 65 },
  { name: "Marketing", count: 38 },
  { name: "Sales", count: 52 },
];

export function HeroPanel() {
  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-gray-900 mb-2">Welcome back, John!</h1>
          <p className="text-gray-500">
            Here's what's happening with your projects today.
          </p>
        </div>

        {/* Achievement Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex items-start gap-4 p-4 bg-blue-50 rounded-lg">
            <div className="p-3 bg-blue-100 rounded-lg">
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-gray-600">Total Revenue</p>
              <p className="text-gray-900 mt-1">$45,231</p>
              <p className="text-green-600 mt-1">+20.1% from last month</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 bg-purple-50 rounded-lg">
            <div className="p-3 bg-purple-100 rounded-lg">
              <Users className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-gray-600">Active Users</p>
              <p className="text-gray-900 mt-1">2,345</p>
              <p className="text-green-600 mt-1">+15.3% from last month</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 bg-green-50 rounded-lg">
            <div className="p-3 bg-green-100 rounded-lg">
              <Target className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-gray-600">Completed Projects</p>
              <p className="text-gray-900 mt-1">89</p>
              <p className="text-green-600 mt-1">+12.5% from last month</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 bg-orange-50 rounded-lg">
            <div className="p-3 bg-orange-100 rounded-lg">
              <Award className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-gray-600">Success Rate</p>
              <p className="text-gray-900 mt-1">98.5%</p>
              <p className="text-green-600 mt-1">+2.4% from last month</p>
            </div>
          </div>
        </div>

        {/* Data Visualizations */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-gray-900 mb-4">Performance Overview</h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={performanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#3b82f6" fill="#93c5fd" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div>
            <h3 className="text-gray-900 mb-4">Projects by Category</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  );
}
