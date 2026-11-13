import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { OfficialLogo } from './OfficialLogo';
import { apiFetch } from '../lib/api';

interface VerificationPayload {
  verified: boolean;
  isValid: boolean;
  card: {
    membership_number: string;
    full_name: string;
    photo_url: string | null;
    membership_status: string;
    card_valid_until: string | null;
    branch_name: string;
    category_name: string;
  };
}

export const QRVerificationView: React.FC<{ token: string; onBack: () => void }> = ({ token, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerificationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<VerificationPayload>(`/api/public/verify/${encodeURIComponent(token)}`)
      .then((res) => setResult(res))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 py-10">
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <OfficialLogo size="md" />
          <h1 className="mt-4 font-display text-2xl font-bold text-[#10242F]">
            Membership Credential Verification
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Official LASUPADORA Masqueraders Society Public Registry Check
          </p>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-6">
          {loading ? (
            <div className="py-8 text-center text-sm text-slate-500">Verifying credential token...</div>
          ) : error || !result ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center">
              <XCircle className="mx-auto h-8 w-8 text-[#AD220B]" />
              <p className="mt-2 font-semibold text-[#AD220B]">Verification Unsuccessful</p>
              <p className="mt-1 text-xs text-slate-600">{error || 'Invalid credential token.'}</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div
                className={`flex items-center justify-center gap-2 rounded-lg border p-3.5 text-sm font-semibold ${
                  result.isValid
                    ? 'border-emerald-200 bg-emerald-50 text-[#146B3A]'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {result.isValid ? (
                  <>
                    <CheckCircle2 className="h-5 w-5" />
                    <span>Valid Active Membership Credential</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5" />
                    <span>Credential Inactive or Expired ({result.card.membership_status})</span>
                  </>
                )}
              </div>

              <dl className="divide-y divide-slate-100 text-sm">
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Member Name</dt>
                  <dd className="font-semibold text-[#10242F]">{result.card.full_name}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Membership Number</dt>
                  <dd className="font-mono-tabular font-semibold text-[#AD220B]">{result.card.membership_number}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Branch</dt>
                  <dd className="font-medium text-[#10242F]">{result.card.branch_name}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Category</dt>
                  <dd className="font-medium text-[#10242F]">{result.card.category_name}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Standing Status</dt>
                  <dd className="font-medium text-[#10242F]">{result.card.membership_status}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Valid Until</dt>
                  <dd className="font-mono-tabular font-medium text-[#10242F]">
                    {result.card.card_valid_until || 'Ongoing'}
                  </dd>
                </div>
              </dl>

              <p className="text-xs text-slate-500 leading-relaxed">
                Privacy notice: Per LASUPADORA data protection policy, public verification displays only minimal credential validity fields and hides residential addresses, phone numbers, and dates of birth.
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onBack}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Return to LASUPADORA 360
        </button>
      </div>
    </div>
  );
};
