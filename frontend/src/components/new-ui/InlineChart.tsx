import React from 'react';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';

export interface ChartData {
  label: string;
  value: number;
}

interface InlineChartProps {
  type: 'bar' | 'pie';
  data: ChartData[];
  title?: string;
}

const InlineChart: React.FC<InlineChartProps> = ({ type, data, title }) => {
  if (!data || data.length === 0) return null;

  // Format data for MUI X Charts
  const labels = data.map((d) => d.label);
  const values = data.map((d) => d.value);

  const colors = [
    '#4f46e5', // Indigo
    '#7c3aed', // Violet
    '#ec4899', // Pink
    '#14b8a6', // Teal
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#3b82f6', // Blue
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm my-4">
      {title && <h4 className="text-sm font-semibold text-gray-800 mb-3">{title}</h4>}
      <div className="flex justify-center h-[260px] w-full">
        {type === 'bar' ? (
          <BarChart
            xAxis={[{ scaleType: 'band', data: labels }]}
            series={[{ data: values, color: '#6366f1' }]}
            height={250}
          />
        ) : (
          <PieChart
            series={[
              {
                data: data.map((d, index) => ({
                  id: index,
                  value: d.value,
                  label: d.label,
                  color: colors[index % colors.length],
                })),
                innerRadius: 30,
                outerRadius: 100,
                paddingAngle: 2,
                cornerRadius: 4,
              },
            ]}
            height={250}
          />
        )}
      </div>
    </div>
  );
};

export default InlineChart;
