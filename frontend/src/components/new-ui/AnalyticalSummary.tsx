import React from 'react';
import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, Lightbulb, TrendingUp, UserX, XCircle, Info, FileText, Shield, Search, Ship, Paperclip, ClipboardCheck, ShieldAlert, Settings, type LucideIcon, Wrench, Clock, BarChart2, BarChart, Navigation, CheckCircle, Repeat, Target, Activity, Filter, ArrowRight, InfoIcon, History, TriangleAlert, ChartColumn, CalendarCheck, TrendingUpIcon, RefreshCw, User, Book } from 'lucide-react';

interface AnalyticalSummaryProps {
  title: string;
  icon?: string;
  color?: string;
  children: React.ReactNode;
}

const ICON_MAP: Record<string, LucideIcon> = {
  alert: AlertCircle,
  warning: AlertTriangle,
  'alert-triangle': AlertTriangle,
  calendar: Calendar,
  check: CheckCircle2,
  lightbulb: Lightbulb,
  'trending-up': TrendingUp,
  'user-x': UserX,
  cancel: XCircle,
  info: Info,
  file: FileText,
  shield: Shield,
  search: Search,
  ship: Ship,
  paperclip: Paperclip,
  'clipboard-check': ClipboardCheck,
  'shield-alert': ShieldAlert,
  settings: Settings,
  wrench: Wrench,
  clock: Clock,
  'bar-chart-2': BarChart,
  navigation: Navigation,
  'check-circle': CheckCircle,
  repeat: Repeat,
  target: Target,
  activity: Activity,
  chart: BarChart2,
  filter: Filter,
  'arrow-right': ArrowRight,
  'information': Info,
  history:History,
  'triangle-exclamation':TriangleAlert,
  'chart-column': ChartColumn,
  'calendar-check':CalendarCheck,
  'trend-up':TrendingUpIcon,
'refresh-cw':RefreshCw,
'users':User,
training:Book
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
  orange: {
    bg: 'bg-orange-50/50',
    border: 'border-orange-100',
    text: 'text-orange-900',
    icon: 'text-orange-500',
    accent: 'border-l-orange-500',
  },
  purple: {
    bg: 'bg-purple-50/50',
    border: 'border-purple-100',
    text: 'text-purple-900',
    icon: 'text-purple-500',
    accent: 'border-l-purple-500',
  },
  teal: {
    bg: 'bg-teal-50/50',
    border: 'border-teal-100',
    text: 'text-teal-900',
    icon: 'text-teal-500',
    accent: 'border-l-teal-500',
  },
};

const AnalyticalSummary: React.FC<AnalyticalSummaryProps> = React.memo(({ 
  title, 
  icon = 'lightbulb', 
  color = 'blue', 
  children 
}) => {
  const IconComponent = ICON_MAP[icon] || null;
  const theme = COLOR_MAP[color] || COLOR_MAP.blue;
  
  // 🟢 Fallback logic: if icon is not in map and isn't a single character (emoji), use Info
  const FinalIcon = IconComponent || (icon.length > 2 ? Info : null);

  return (
    <div className={`
      my-4 p-5 rounded-2xl border ${theme.border} ${theme.bg} 
      border-l-4 ${theme.accent} backdrop-blur-md shadow-sm
      transition-all duration-300 hover:shadow-md
      animate-fade-in-up
    `}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-xl bg-white shadow-sm font-emoji flex items-center justify-center ${theme.icon}`}>
          {FinalIcon ? <FinalIcon className="w-5 h-5" /> : <span className="text-xl leading-none">{icon}</span>}
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
});

export default AnalyticalSummary;
