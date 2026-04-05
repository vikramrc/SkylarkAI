import React, { useState } from 'react';
import InlineChart, { type ChartData } from './InlineChart';
import { BarChart2, Table as TableIcon, Copy, Download, Check } from 'lucide-react';
import AnalyticalSummary from './AnalyticalSummary';

interface MdBubbleContentProps {
  content: string;
}

const MdBubbleContent: React.FC<MdBubbleContentProps> = ({ content }) => {
  const [showChartMap, setShowChartMap] = useState<Record<string, boolean>>({});
  const [chartTypeMap, setChartTypeMap] = useState<Record<string, 'bar' | 'pie'>>({});
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});

  if (!content) return null;

  // 🟢 Enhanced Formatter: Bold detector flawlessly flawlessly
  const formatText = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-indigo-900">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const handleCopyTable = (index: string, headers: string[], rows: string[][]) => {
    const tsvContent = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
    navigator.clipboard.writeText(tsvContent);
    setCopiedMap((prev) => ({ ...prev, [index]: true }));
    setTimeout(() => setCopiedMap((prev) => ({ ...prev, [index]: false })), 2000);
  };

  const handleExportCSV = (headers: string[], rows: string[][]) => {
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

  // 🟢 Robust Segment Splitting: Split by top-level tags but allow nesting (e.g. TABLE inside INSIGHT).
  // We remove the peek-ahead lookaheads (?=\[TABLE) and (?=\[INSIGHT) that were causeing nested blocks to split prematurely.
  const segments = content.split(/(\[INSIGHT[\s\S]*?(?:\[\/INSIGHT\]|(?=\[INSIGHT)|$)|\[TABLE[\s\S]*?(?:\[\/TABLE\]|(?=\[TABLE)|$))/g).filter(Boolean);

  return (
    <div className="space-y-4 text-base text-gray-800 leading-relaxed overflow-hidden">
      {segments.map((segment, sIdx) => {
        // 🟢 TABLE block: [TABLE caption="..."] ... pipe table ... [/TABLE]
        // Resilience: Fallback to empty caption and end-of-string if unclosed.
        const tableMatch = segment.match(/\[TABLE(?:\s+caption="([^"]*)")?\]([\s\S]*?)(?:\[\/TABLE\]|$)/);
        if (tableMatch) {
          const [, caption = "", innerContent] = tableMatch;
          const lines = innerContent.trim().split('\n');
          const tableLines = lines.filter(l => l.includes('|'));
          if (tableLines.length >= 1) {
            const headerLine = tableLines[0] || "";
            const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
            if (headers.length === 0) return <p key={`table-fail-${sIdx}`} className="whitespace-pre-wrap">{innerContent}</p>;

            const dataLines = tableLines.slice(1).filter(l => !l.includes('---')); 
            const rows = dataLines.map(line =>
              line.split('|').map(c => c.trim()).filter(Boolean)
            ).filter(r => r.length > 0);
            
            // ... (rest of table logic remains the same but with safer indexing)

            const chartData: ChartData[] = [];
            rows.forEach(row => {
              if (row.length >= 2) {
                const val = parseFloat(row[1]!.replace(/[$,\s]/g, ''));
                if (!isNaN(val)) chartData.push({ label: row[0]!, value: val });
              }
            });
            const key = `table-${sIdx}`;
            const isChartable = chartData.length > 0;
            const isShowingChart = showChartMap[key] || false;
            const activeChartType = chartTypeMap[key] || 'bar';
            const isCopied = copiedMap[key] || false;
            return (
              <div key={key} className="my-4">
                {caption && (
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <TableIcon className="w-3.5 h-3.5 text-indigo-400" />
                    {caption}
                  </p>
                )}
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    {isChartable && (
                      <button onClick={() => setShowChartMap(p => ({ ...p, [key]: !isShowingChart }))}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 ${isShowingChart ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        {isShowingChart ? <TableIcon className="w-3.5 h-3.5" /> : <BarChart2 className="w-3.5 h-3.5" />}
                        {isShowingChart ? 'Show Table' : 'Show Chart'}
                      </button>
                    )}
                    {isShowingChart && isChartable && (
                      <div className="flex p-0.5 bg-gray-100 rounded-lg border border-gray-200">
                        <button onClick={() => setChartTypeMap(p => ({ ...p, [key]: 'bar' }))} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${activeChartType === 'bar' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>Bar</button>
                        <button onClick={() => setChartTypeMap(p => ({ ...p, [key]: 'pie' }))} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${activeChartType === 'pie' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>Pie</button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button onClick={() => handleCopyTable(key, headers, rows)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-xs">
                      {isCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {isCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <button onClick={() => handleExportCSV(headers, rows)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-xs">
                      <Download className="w-3.5 h-3.5" /> Export
                    </button>
                  </div>
                </div>
                {isShowingChart && isChartable ? (
                  <InlineChart type={activeChartType} data={chartData} title={headers[0]!} />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-indigo-100 bg-white/60 shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-indigo-50/50"><tr>{headers.map((h, i) => <th key={i} className="px-4 py-3 text-left font-semibold text-indigo-800 tracking-tight">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-gray-100 bg-white">{rows.map((row, i) => <tr key={i} className="hover:bg-gray-50/50 transition-colors">{row.map((cell, j) => <td key={j} className="px-4 py-3 text-gray-700">{cell}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          }
        }

        // Match [INSIGHT] tags with extreme resilience to missing attributes or unclosed ends.
        const insightMatch = segment.match(/\[INSIGHT(?:\s+title="([^"]*)")?(?:\s+icon="([^"]*)")?(?:\s+color="([^"]*)")?\]([\s\S]*?)(?:\[\/INSIGHT\]|$)/);
        
        if (insightMatch) {
          const [, title = "Analytical Insight", icon = "lightbulb", color = "blue", innerText] = insightMatch;
          return (
            <AnalyticalSummary key={`insight-${sIdx}`} title={title} icon={icon} color={color}>
              <MdBubbleContent content={innerText.trim()} />
            </AnalyticalSummary>
          );
        }

        // Standard Markdown Blocks for this segment
        const blocks = segment.split(/\n\n+/).filter(Boolean);
        return blocks.map((block, bIdx) => {
          const lines = block.split('\n');
          const hasPipeSeparator = lines.some(l => l.includes('|') && l.includes('---'));

          if (hasPipeSeparator) {
            const tableLines = lines.filter(l => l.includes('|'));
            if (tableLines.length < 2) return <p key={`${sIdx}-${bIdx}`} className="whitespace-pre-wrap leading-relaxed">{formatText(block)}</p>;

            const headerLine = tableLines[0];
            const headers = headerLine.split('|').map(h => h.trim());
            if (headers[0] === '') headers.shift();
            if (headers[headers.length - 1] === '') headers.pop();
            
            const dataLines = tableLines.slice(1).filter(l => !l.includes('---'));
            const rows = dataLines.map(line => {
               const cells = line.split('|').map(c => c.trim());
               if (cells[0] === '') cells.shift();
               if (cells[cells.length - 1] === '') cells.pop();
               return cells;
            });

            const chartData: ChartData[] = [];
            rows.forEach(row => {
              if (row.length >= 2) {
                const label = row[0];
                const rawVal = row[1].replace(/[$,\s]/g, '');
                const value = parseFloat(rawVal);
                if (!isNaN(value)) chartData.push({ label, value });
              }
            });

            const key = `${sIdx}-${bIdx}`;
            const isChartable = chartData.length > 0;
            const isShowingChart = showChartMap[key] || false;
            const activeChartType = chartTypeMap[key] || 'bar';
            const isCopied = copiedMap[key] || false;

            return (
              <div key={key} className="my-4 relative">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    {isChartable && (
                      <button
                        onClick={() => setShowChartMap(p => ({ ...p, [key]: !isShowingChart }))}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 ${
                          isShowingChart ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {isShowingChart ? <TableIcon className="w-3.5 h-3.5" /> : <BarChart2 className="w-3.5 h-3.5" />}
                        {isShowingChart ? 'Show Table' : 'Show Chart'}
                      </button>
                    )}
                    {isShowingChart && isChartable && (
                      <div className="flex p-0.5 bg-gray-100 rounded-lg border border-gray-200">
                        <button onClick={() => setChartTypeMap(p => ({ ...p, [key]: 'bar' }))} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${activeChartType === 'bar' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>Bar</button>
                        <button onClick={() => setChartTypeMap(p => ({ ...p, [key]: 'pie' }))} className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${activeChartType === 'pie' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>Pie</button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button onClick={() => handleCopyTable(key, headers, rows)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-xs">
                      {isCopied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {isCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <button onClick={() => handleExportCSV(headers, rows)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-xs">
                      <Download className="w-3.5 h-3.5" /> Export
                    </button>
                  </div>
                </div>
                {isShowingChart && isChartable ? (
                  <InlineChart type={activeChartType} data={chartData} title={headers[0]} />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white/60 shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50/50"><tr>{headers.map((h, i) => <th key={i} className="px-4 py-3 text-left font-semibold text-gray-800 tracking-tight">{h}</th>)}</tr></thead>
                      <tbody className="divide-y divide-gray-100 bg-white">{rows.map((row, i) => <tr key={i} className="hover:bg-gray-50/50 transition-colors">{row.map((cell, j) => <td key={j} className="px-4 py-3 text-gray-700">{cell}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          }

          if (block.trim().startsWith('- ') || block.trim().startsWith('* ') || /^\d+\./.test(block.trim())) {
            const isOrdered = /^\d+\./.test(block.trim());
            const Element = isOrdered ? 'ol' : 'ul';
            const listCls = isOrdered ? 'list-decimal' : 'list-disc';
            return (
              <Element key={`${sIdx}-${bIdx}`} className={`${listCls} pl-6 space-y-2 my-2 text-gray-800`}>
                {block.split('\n').map((line, i) => (
                  <li key={i} className="pl-1 leading-relaxed">{formatText(line.replace(/^-\s|^\*\s|^\d+\.\s/, ''))}</li>
                ))}
              </Element>
            );
          }

          return (
            <p key={`${sIdx}-${bIdx}`} className="whitespace-pre-wrap leading-relaxed">
              {formatText(block)}
            </p>
          );
        });
      })}
    </div>
  );
};

export default MdBubbleContent;
