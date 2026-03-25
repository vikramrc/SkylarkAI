import React from 'react';
import { AlertCircle, Calendar, CheckCircle2, Lightbulb, type LucideIcon } from 'lucide-react';

interface AnalyticalSummaryProps {
  title: string;
  icon?: string;
  color?: string;
  children: React.ReactNode;
}

const ICON_MAP: Record<string, LucideIcon> = {
  alert: AlertCircle,
  calendar: Calendar,
  check: CheckCircle2,
  lightbulb: Lightbulb,
};

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; icon: string; accent: string }> = {
  red: {
    bg: 'bg-red-50/50',
    border: 'border-red-100',
    text: 'text-red-900',
    icon: 'text-red-500',
    accent: 'border-l-red-500',
  },
  amber: {
    bg: 'bg-amber-50/50',
    border: 'border-amber-100',
    text: 'text-amber-900',
    icon: 'text-amber-500',
    accent: 'border-l-amber-500',
  },
  green: {
    bg: 'bg-green-50/50',
    border: 'border-green-100',
    text: 'text-green-900',
    icon: 'text-green-500',
    accent: 'border-l-green-500',
  },
  blue: {
    bg: 'bg-blue-50/50',
    border: 'border-blue-100',
    text: 'text-blue-900',
    icon: 'text-blue-500',
    accent: 'border-l-blue-500',
  },
};

const AnalyticalSummary: React.FC<AnalyticalSummaryProps> = ({ 
  title, 
  icon = 'lightbulb', 
  color = 'blue', 
  children 
}) => {
  const IconComponent = ICON_MAP[icon] || Lightbulb;
  const theme = COLOR_MAP[color] || COLOR_MAP.blue;

  return (
    <div className={`
      my-4 p-5 rounded-2xl border ${theme.border} ${theme.bg} 
      border-l-4 ${theme.accent} backdrop-blur-md shadow-sm
      transition-all duration-300 hover:shadow-md
      animate-fade-in-up
    `}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-xl bg-white shadow-sm ${theme.icon}`}>
          <IconComponent className="w-5 h-5" />
        </div>
        <h3 className={`text-lg font-bold ${theme.text}`} style={{ fontFamily: 'Outfit, sans-serif' }}>
          {title}
        </h3>
      </div>
      
      <div className={`text-sm md:text-base leading-relaxed space-y-2 prose prose-sm max-w-none ${theme.text}`}>
        {children}
      </div>
    </div>
  );
};

export default AnalyticalSummary;
