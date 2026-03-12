import React from 'react';
import { useTranslation } from 'react-i18next';
import GenericCard from './cards/GenericCard';
import WorkHistoryCard from './cards/WorkHistoryCard';
import DocumentCard from './cards/DocumentCard';
import FormTemplateCard from './cards/FormTemplateCard';
import FormCard from './cards/FormCard';
import ScheduleCard from './cards/ScheduleCard';
import InventoryUsageCard from './cards/InventoryUsageCard';
import PurchaseOrderCard from './cards/PurchaseOrderCard';
import ReplenishOrderCard from './cards/ReplenishOrderCard';
import TagCard from './cards/TagCard';

export type ResultRendererProps = {
  r: any;
  itemType?: string; // classifier-provided type fallback
  onRequestSwitchToTable?: () => void;
};

const registry: Record<string, React.FC<ResultRendererProps>> = {
  work_history: WorkHistoryCard as any,
  document: DocumentCard as any,
  form_template: FormTemplateCard as any,
  form: FormCard as any,
  schedule: ScheduleCard as any,
  inventory_usage: InventoryUsageCard as any,
  purchase_order: PurchaseOrderCard as any,
  replenish_order: ReplenishOrderCard as any,
  tag: TagCard as any,
};

export const ResultRenderer: React.FC<ResultRendererProps> = ({ r, itemType, onRequestSwitchToTable }) => {
  const { t } = useTranslation();
  const type = (itemType && String(itemType)) || (r && typeof r.type === 'string' && r.type) || 'other';
  const Cmp = registry[type] || GenericCard;
  // For GenericCard, pass along the classifier type as displayType for the chip
  if (Cmp === (GenericCard as any)) {
    return <GenericCard r={r} displayType={type} /> as any;
  }
  return <Cmp r={r} onRequestSwitchToTable={onRequestSwitchToTable} />;
};

