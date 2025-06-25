import {
    LineChart,
    Line,
    CartesianGrid,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
  } from 'recharts';
  
  export default function StockChart({ data }) {
    return (
      <div className="bg-indigo-900 rounded-lg p-6 shadow-lg">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4c51bf" />
            <XAxis dataKey="date" stroke="#facc15" />
            <YAxis stroke="#facc15" />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', borderRadius: '10px', border: 'none' }}
              itemStyle={{ color: '#facc15' }}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#facc15"
              strokeWidth={3}
              dot={{ r: 5, strokeWidth: 2, fill: '#2563eb' }}
              activeDot={{ r: 7 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  