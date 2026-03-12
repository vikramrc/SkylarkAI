import React from 'react';
import { FileText, ClipboardList, Info } from 'lucide-react';

export interface DualViewConfig {
  available: boolean;
  views?: Array<{
    id: string;
    label: string;
    icon: string;
    renderer: string;
    count: number;
    description?: string;
  }>;
  defaultView?: string;
  reason?: string;
  transformationNeeded?: boolean;
}

interface DualViewToggleProps {
  config: DualViewConfig;
  activeView: string;
  onViewChange: (viewId: string) => void;
  showInfoBanner?: boolean;
}

const iconMap: Record<string, React.ComponentType<any>> = {
  FileText,
  ClipboardList,
};

export const DualViewToggle: React.FC<DualViewToggleProps> = ({
  config,
  activeView,
  onViewChange,
  showInfoBanner = true,
}) => {
  if (!config.available || !config.views || config.views.length < 2) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* Info Banner */}
      {showInfoBanner && config.reason && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-800 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{config.reason}. You can switch views below.</span>
        </div>
      )}

      {/* Toggle Buttons */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">View as:</span>
        <div className="inline-flex rounded-lg border border-gray-300 bg-white p-1">
          {config.views.map((view) => {
            const Icon = iconMap[view.icon] || FileText;
            const isActive = activeView === view.id;

            return (
              <button
                key={view.id}
                onClick={() => onViewChange(view.id)}
                title={view.description}
                className={`
                  px-3 py-1.5 text-xs font-medium rounded-md transition-all
                  flex items-center gap-1.5
                  ${
                    isActive
                      ? view.id === 'forms'
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }
                `}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{view.label}</span>
                <span className="text-gray-400">({view.count})</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default DualViewToggle;

