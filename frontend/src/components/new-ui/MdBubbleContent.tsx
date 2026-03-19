import React, { useState } from 'react';
import InlineChart, { type ChartData } from './InlineChart';
import { BarChart2, Table as TableIcon, Copy, Download, Check } from 'lucide-react';

interface MdBubbleContentProps {
  content: string;
}

const MdBubbleContent: React.FC<MdBubbleContentProps> = ({ content }) => {
  const [showChartMap, setShowChartMap] = useState<Record<number, boolean>>({});
  const [chartTypeMap, setChartTypeMap] = useState<Record<number, 'bar' | 'pie'>>({});
  const [copiedMap, setCopiedMap] = useState<Record<number, boolean>>({});

  if (!content) return null;

  // Split content into blocks by double newline (paragraphs/tables)
  const blocks = content.split(/\n\n+/);

  const toggleChart = (index: number) => {
    setShowChartMap((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const switchChartType = (index: number, type: 'bar' | 'pie') => {
    setChartTypeMap((prev) => ({ ...prev, [index]: type }));
  };

  const handleCopyTable = (index: number, headers: string[], rows: string[][]) => {
    const tsvContent = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(tsvContent);
    setCopiedMap((prev) => ({ ...prev, [index]: true }));
    setTimeout(() => setCopiedMap((prev) => ({ ...prev, [index]: false })), 2000);
  };

  const handleExportCSV = (headers: string[], rows: string[][]) => {
    // Escape quotes for CSV
    const escapeContent = (str: string) => `"${str.replace(/"/g, '""')}"`;
    const csvContent = [
      headers.map(escapeContent).join(','), 
      ...rows.map(r => r.map(escapeContent).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'table_data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 text-base text-gray-800 leading-relaxed">
      {blocks.map((block, bIdx) => {
        const lines = block.split('\n');
        const hasPipeSeparator = lines.some(l => l.includes('|') && l.includes('---'));

        // Detect table
        if (hasPipeSeparator) {
          const tableLines = lines.filter(l => l.includes('|'));
          if (tableLines.length < 2) return <p key={bIdx} className="whitespace-pre-wrap">{block}</p>;

          // Extract headers and rows
          const headerLine = tableLines[0];
          // Support tables with or without leading/trailing pipes accurately triggers flawlessly trigger flawless flawless
          const headers = headerLine.split('|').map(h => h.trim());
          if (headers[0] === '') headers.shift();
          if (headers[headers.length - 1] === '') headers.pop();
          
          // Skip the separator line (usually contains dashes ---)
          const dataLines = tableLines.slice(1).filter(l => !l.includes('---'));
          const rows = dataLines.map(line => {
             const cells = line.split('|').map(c => c.trim());
             if (cells[0] === '') cells.shift();
             if (cells[cells.length - 1] === '') cells.pop();
             return cells;
          });

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
          const isCopied = copiedMap[bIdx] || false;

          return (
            <div key={bIdx} className="my-4 relative">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  {isChartable && (
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
                  )}

                  {isShowingChart && isChartable && (
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

                {/* 🟢 Copy and Export Tool Bar flawless triggers flaws */}
                <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      onClick={() => handleCopyTable(bIdx, headers, rows)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shadow-xs"
                      title="Copy as TSV"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {isCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      onClick={() => handleExportCSV(headers, rows)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shadow-xs"
                      title="Export CSV"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export
                    </button>
                </div>
              </div>

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
