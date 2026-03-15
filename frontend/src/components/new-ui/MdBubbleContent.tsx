import React, { useState } from 'react';
import InlineChart, { type ChartData } from './InlineChart';
import { BarChart2, Table as TableIcon } from 'lucide-react';

interface MdBubbleContentProps {
  content: string;
}

const MdBubbleContent: React.FC<MdBubbleContentProps> = ({ content }) => {
  const [showChartMap, setShowChartMap] = useState<Record<number, boolean>>({});
  const [chartTypeMap, setChartTypeMap] = useState<Record<number, 'bar' | 'pie'>>({});

  if (!content) return null;

  // Split content into blocks by double newline (paragraphs/tables)
  const blocks = content.split(/\n\n+/);

  const toggleChart = (index: number) => {
    setShowChartMap((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const switchChartType = (index: number, type: 'bar' | 'pie') => {
    setChartTypeMap((prev) => ({ ...prev, [index]: type }));
  };

  return (
    <div className="space-y-4 text-base text-gray-800 leading-relaxed">
      {blocks.map((block, bIdx) => {
        // Detect table
        if (block.includes('|') && block.split('\n').some(line => line.trim().startsWith('|'))) {
          const lines = block.split('\n').filter(l => l.trim().startsWith('|'));
          if (lines.length < 2) return <p key={bIdx} className="whitespace-pre-wrap">{block}</p>;

          // Extract headers and rows
          const headerLine = lines[0];
          const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
          
          // Skip the separator line (usually contains dashes ---)
          const dataLines = lines.slice(1).filter(l => !l.includes('---'));
          const rows = dataLines.map(line => line.split('|').map(c => c.trim()).filter(Boolean));

          // Identify chartable numbers (rows should have a label and a number)
          const chartData: ChartData[] = [];
          
          rows.forEach(row => {
            if (row.length >= 2) {
              const label = row[0];
              // Parse value, removing spaces, commas, currency symbols
              const rawVal = row[1].replace(/[$,\s]/g, '');
              const value = parseFloat(rawVal);
              if (!isNaN(value)) {
                chartData.push({ label, value });
              }
            }
          });

          const isChartable = chartData.length > 0;
          const isShowingChart = showChartMap[bIdx] || false;
          const activeChartType = chartTypeMap[bIdx] || 'bar';

          return (
            <div key={bIdx} className="my-4 relative">
              {isChartable && (
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => toggleChart(bIdx)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 ${
                      isShowingChart 
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' 
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {isShowingChart ? <TableIcon className="w-3.5 h-3.5" /> : <BarChart2 className="w-3.5 h-3.5" />}
                    {isShowingChart ? 'Show Table' : 'Show Chart'}
                  </button>

                  {isShowingChart && (
                    <div className="flex p-0.5 bg-gray-100 rounded-lg border border-gray-200">
                      <button 
                        onClick={() => switchChartType(bIdx, 'bar')}
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${activeChartType === 'bar' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        Bar
                      </button>
                      <button 
                        onClick={() => switchChartType(bIdx, 'pie')}
                        className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${activeChartType === 'pie' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        Pie
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isShowingChart && isChartable ? (
                <InlineChart type={activeChartType} data={chartData} title={headers[0]} />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white/60 shadow-sm">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50/50">
                      <tr>
                        {headers.map((h, hIdx) => (
                          <th key={hIdx} className="px-4 py-3 text-left font-semibold text-gray-800 tracking-tight">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-gray-50/50 transition-colors">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-4 py-3 text-gray-700">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        }

        // Detect List
        if (block.trim().startsWith('- ') || block.trim().startsWith('* ') || /^\d+\./.test(block.trim())) {
          const lines = block.split('\n');
          const isOrdered = /^\d+\./.test(block.trim());
          const Element = isOrdered ? 'ol' : 'ul';
          const listCls = isOrdered ? 'list-decimal' : 'list-disc';

          return (
            <Element key={bIdx} className={`${listCls} pl-6 space-y-2 my-2 text-gray-800`}>
              {lines.map((line, lIdx) => (
                <li key={lIdx} className="pl-1">
                  {line.replace(/^-\s|^\*\s|^\d+\.\s/, '')}
                </li>
              ))}
            </Element>
          );
        }

        // Standard Paragraph
        return (
          <p key={bIdx} className="whitespace-pre-wrap">
            {block}
          </p>
        );
      })}
    </div>
  );
};

export default MdBubbleContent;
