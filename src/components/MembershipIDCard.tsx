import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Printer, ShieldCheck } from 'lucide-react';
import { OfficialLogo } from './OfficialLogo';
import { exportMembershipCardPDF } from '../lib/exportUtils';

interface MembershipIDCardProps {
  member: {
    full_name: string;
    membership_number: string;
    branch_name: string;
    category_name: string;
    membership_status: string;
    card_valid_until: string | null;
    qr_token: string;
    photo_url?: string | null;
  };
  onOpenVerify?: (token: string) => void;
}

export const MembershipIDCard: React.FC<MembershipIDCardProps> = ({ member, onOpenVerify }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const verifyUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/?verify=${encodeURIComponent(member.qr_token)}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(verifyUrl, {
      width: 240,
      margin: 1,
      color: { dark: '#10242F', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [verifyUrl]);

  const initials = member.full_name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-[440px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Card Top Strip using exact logo palette */}
        <div className="flex items-center justify-between bg-[#10242F] px-5 py-3 text-white border-b-4 border-[#BD5016]">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white p-1 shrink-0">
              <OfficialLogo size="xs" />
            </div>
            <div>
              <p className="font-display text-sm font-bold tracking-tight leading-tight">LASUPADORA</p>
              <p className="text-[11px] text-slate-300">Masqueraders Society · Official ID</p>
            </div>
          </div>
          <span className="font-mono-tabular text-xs font-semibold text-[#E48947]">
            {member.membership_status}
          </span>
        </div>

        {/* Card Body */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              {member.photo_url ? (
                <img
                  src={member.photo_url}
                  alt={member.full_name}
                  referrerPolicy="no-referrer"
                  className="h-20 w-16 rounded-lg border border-slate-200 object-cover shrink-0"
                />
              ) : (
                <div className="flex h-20 w-16 items-center justify-center rounded-lg border border-slate-200 bg-[#053559]/10 font-display text-lg font-bold text-[#053559] shrink-0">
                  {initials}
                </div>
              )}

              <div className="min-w-0 space-y-1">
                <p className="text-base font-bold text-[#10242F] truncate">{member.full_name}</p>
                <p className="font-mono-tabular text-xs font-semibold text-[#AD220B]">{member.membership_number}</p>
                <dl className="pt-1 space-y-0.5 text-xs text-slate-600">
                  <div className="flex gap-1.5">
                    <dt className="text-slate-400">Branch:</dt>
                    <dd className="font-medium text-[#10242F] truncate">{member.branch_name}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-slate-400">Category:</dt>
                    <dd className="font-medium text-[#10242F]">{member.category_name}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-slate-400">Valid Until:</dt>
                    <dd className="font-mono-tabular font-medium text-[#10242F]">
                      {member.card_valid_until || 'Active Standing'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Scannable Non-PII QR Token */}
            <div className="flex flex-col items-center shrink-0">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Credential Verification QR Code" className="h-24 w-24 rounded border border-slate-200 bg-white p-1" />
              ) : (
                <div className="h-24 w-24 rounded border border-slate-200 bg-slate-50" />
              )}
              <span className="mt-1 text-[10px] text-slate-500">Scan to verify</span>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            <span>Wear the Culture. Live the Tradition.</span>
            <span className="font-mono-tabular text-[10px]">Zero-PII Token</span>
          </div>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 no-print">
        <button
          type="button"
          onClick={() =>
            exportMembershipCardPDF({
              ...member,
              qrDataUrl,
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-[#BD5016] px-4 py-2 text-xs font-semibold text-white hover:bg-[#9D4010] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Download Card PDF
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Printer className="h-3.5 w-3.5" />
          Print ID Card
        </button>
        {onOpenVerify && (
          <button
            type="button"
            onClick={() => onOpenVerify(member.qr_token)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-[#053559] hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Test Public Verification
          </button>
        )}
      </div>
    </div>
  );
};
