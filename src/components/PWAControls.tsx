import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ variant?: 'light' | 'dark' }> = ({ variant = 'light' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${
          variant === 'dark' ? 'bg-white/10 text-slate-200' : 'border border-slate-200 bg-slate-50 text-slate-600'
        }`}
      >
        App Installed
      </span>
    );
  }

  const buttonClass =
    variant === 'dark'
      ? 'inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer'
      : 'inline-flex items-center gap-2 rounded-lg border border-[#10242F]/20 bg-white px-4 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer';

  if (isInstallable) {
    return (
      <button type="button" onClick={install} className={buttonClass}>
        <Download className="h-3.5 w-3.5" />
        Install App
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={() => setShowGuide(true)} className={buttonClass}>
        {isIOS ? <Smartphone className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
        {isIOS ? 'Install on iOS' : 'Install App'}
      </button>
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowGuide(false)}>
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-[#10242F] shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-[#10242F]">Install LASUPADORA 360 App</h3>
                <p className="mt-0.5 text-xs text-slate-500">Progressive Web App (PWA) for mobile &amp; desktop</p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install guide"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2 text-xs text-slate-700 leading-relaxed">
                <p className="font-semibold text-[#053559]">iPhone / iPad (Safari):</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Open LASUPADORA 360 in a standalone <strong>Safari</strong> tab.</li>
                  <li>Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.</li>
                  <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
                <div>
                  <p className="font-semibold text-[#053559]">Android (Chrome / Edge):</p>
                  <p className="mt-0.5">Open the browser menu (⋮) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
                </div>
                <div>
                  <p className="font-semibold text-[#053559]">Desktop (Chrome / Edge):</p>
                  <p className="mt-0.5">Click the <strong>Install</strong> icon in the browser address bar or select <strong>Apps → Install LASUPADORA 360</strong>.</p>
                </div>
                <p className="rounded-lg border border-slate-200 bg-[#F8F9FA] p-2.5 text-[11px] text-slate-600">
                  If you are viewing inside an embedded preview frame, open the site directly in a standalone browser tab to trigger one-click native installation.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full rounded-lg bg-[#10242F] py-2.5 text-xs font-semibold text-white hover:bg-[#053559] cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-[#AD220B] px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
      <WifiOff className="h-3.5 w-3.5" />
      Offline Mode — Viewing cached data
    </div>
  );
};
