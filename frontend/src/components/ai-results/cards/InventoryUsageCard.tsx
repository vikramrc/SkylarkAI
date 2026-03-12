import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PackagePlus, PackageMinus, ArrowRightLeft, PackageCheck } from 'lucide-react';
import InventoryTransactionViewerDelegate, { type InventoryTransactionViewerHandle } from '../../inventory/InventoryTransactionViewerDelegate';

export default function InventoryUsageCard({ r, onRequestSwitchToTable }: { r: any; onRequestSwitchToTable?: () => void }) {
  const { t } = useTranslation();
  const [showJson, setShowJson] = useState(false);
  const txnViewerRef = useRef<InventoryTransactionViewerHandle>(null);

  const type = (r?.transactionType || r?.type || 'transaction') as string;
  const qty = (r?.quantity ?? r?.quantityUsed ?? r?.quantityReturned) as number | undefined;

  // Extract part information - handle both populated and unpopulated references
  const partObj = typeof r?.partID === 'object' ? r.partID : null;
  const part = partObj?.partName || r?.partName || r?.part_ID?.partName || r?.partCode || (typeof r?.partID === 'string' && r.partID !== '-' ? 'Part' : undefined);
  const partNumber = partObj?.partNumber || r?.partNumber || r?.part_ID?.partNumber || '';

  // Extract location information - handle both populated and unpopulated references
  const fromLocationObj = typeof r?.fromLocationID === 'object' ? r.fromLocationID : null;
  const toLocationObj = typeof r?.toLocationID === 'object' ? r.toLocationID : null;

  const fromLocationName = fromLocationObj?.locationName || r?.fromLocationName || r?.fromLocation_ID?.locationName || '';
  const fromLocationCode = fromLocationObj?.locationCode || r?.fromLocationCode || r?.fromLocation_ID?.locationCode || '';
  const from = fromLocationName || fromLocationCode || (typeof r?.fromLocationID === 'string' && r.fromLocationID !== '-' ? r.fromLocationID.substring(0, 8) + '...' : undefined);

  const toLocationName = toLocationObj?.locationName || r?.toLocationName || r?.toLocation_ID?.locationName || '';
  const toLocationCode = toLocationObj?.locationCode || r?.toLocationCode || r?.toLocation_ID?.locationCode || '';
  const to = toLocationName || toLocationCode || (typeof r?.toLocationID === 'string' && r.toLocationID !== '-' ? r.toLocationID.substring(0, 8) + '...' : undefined);

  const when = (r?.transactionDate || r?.createdAt) as string | undefined;

  const chipClass = toChip(type);
  const title = `${capitalize(type)}${part ? ` · ${String(part)}` : ''}${partNumber ? ` (${partNumber})` : ''}`;
  const { icon: Icon, iconBg, iconText, iconBorder } = getTransactionIcon(type);

  // ID resolution for "View Transaction" button
  function isLikelyObjectId(v: any): boolean {
    return typeof v === 'string' && /^[a-fA-F0-9]{24}$/.test(v);
  }
  const orgId = r?.sourceMeta?.organizationID || r?.organizationID || r?.organization_ID;
  const txnId = r?.sourceMeta?.entities?.inventoryTransactionId || r?._id;
  const hasCanonicalIds = !!(orgId && isLikelyObjectId(txnId));

  return (
    <>
    <div className="border border-[rgba(202,206,214,0.5)] rounded-xl p-4 bg-white hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-start justify-between gap-2">
        <div className="truncate" title={title}>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${iconBg} ${iconText} border ${iconBorder}`}>
              <Icon className="w-3.5 h-3.5" />
            </span>
            <div className="text-sm font-bold text-gray-900 tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>{title}</div>
          </div>
          <div className="text-xs text-gray-600 mt-1 space-y-0.5">
            {qty !== undefined && (<div className="font-medium">{qty} {partObj?.unit || 'units'}</div>)}
            {(from || to) && (<div className="text-gray-500">{from || '-'} → {to || '-'}</div>)}
            {when && (<div className="text-[11px] text-gray-500">{formatDateTime(when)}</div>)}
          </div>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize ${chipClass}`}>{String(type)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className="text-xs underline text-gray-700 hover:text-gray-900" onClick={() => setShowJson(s => !s)}>
            {showJson ? t('aiResults.hide_json') : t('aiResults.view_json')}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm hover:shadow-blue-500/20 transition-all"
            onClick={() => txnViewerRef.current?.open(r)}
            disabled={!hasCanonicalIds}
            title={!hasCanonicalIds ? 'Missing organization or transaction ID' : ''}
          >
            {t('aiResults.view_transaction', 'View Transaction')}
          </button>
        </div>
        {onRequestSwitchToTable && (
          <button className="text-xs underline text-primary-700 hover:text-primary-900" onClick={onRequestSwitchToTable}>
            {t('aiResults.switch_to_table')}
          </button>
        )}
      </div>
      {showJson && (
        <pre className="mt-2 bg-gray-900 text-green-400 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {JSON.stringify(r, null, 2)}
        </pre>
      )}
    </div>
    <InventoryTransactionViewerDelegate ref={txnViewerRef} />
    </>
  );
}

function capitalize(s?: string) { try { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; } catch { return s || ''; } }

function getTransactionIcon(type: string) {
  const k = String(type || '').toLowerCase();
  if (k === 'receipt') {
    return {
      icon: PackagePlus,
      iconBg: 'bg-emerald-50',
      iconText: 'text-emerald-700',
      iconBorder: 'border-emerald-200'
    };
  }
  if (k === 'issue') {
    return {
      icon: PackageMinus,
      iconBg: 'bg-rose-50',
      iconText: 'text-rose-700',
      iconBorder: 'border-rose-200'
    };
  }
  if (k === 'transfer') {
    return {
      icon: ArrowRightLeft,
      iconBg: 'bg-sky-50',
      iconText: 'text-sky-700',
      iconBorder: 'border-sky-200'
    };
  }
  if (k === 'return') {
    return {
      icon: PackageCheck,
      iconBg: 'bg-violet-50',
      iconText: 'text-violet-700',
      iconBorder: 'border-violet-200'
    };
  }
  // Default
  return {
    icon: PackagePlus,
    iconBg: 'bg-gray-50',
    iconText: 'text-gray-700',
    iconBorder: 'border-gray-200'
  };
}

function toChip(t: string) {
  const k = String(t || '').toLowerCase();
  if (k === 'receipt') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (k === 'issue') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (k === 'transfer') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (k === 'return') return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function formatDateTime(v?: string) {
  try { const d = v ? new Date(v) : null; if (d && !isNaN(d as any)) return d.toLocaleString(); } catch {}
  return v || '';
}

