import React from 'react';

export const OFFICIAL_LOGO_SRC = '/assets/aistudio/IMG_202604101_090333122_c0dbe07b.png';

interface OfficialLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  framedOnDark?: boolean;
  className?: string;
}

const sizeMap = {
  xs: 'h-9 w-auto',
  sm: 'h-12 w-auto',
  md: 'h-16 w-auto',
  lg: 'h-28 w-auto',
  xl: 'h-44 w-auto',
};

/**
 * Authoritative Official LASUPADORA Logo component.
 * Preserves exact 960x1280 (3:4) aspect ratio, transparency, symbols, and colors unmodified.
 */
export const OfficialLogo: React.FC<OfficialLogoProps> = ({ size = 'sm', framedOnDark = false, className = '' }) => {
  const img = (
    <img
      src={OFFICIAL_LOGO_SRC}
      alt="LASUPADORA Masqueraders Society Official Logo"
      referrerPolicy="no-referrer"
      className={`${sizeMap[size]} aspect-[3/4] object-contain select-none ${className}`}
    />
  );

  if (framedOnDark) {
    return (
      <div className="inline-flex items-center justify-center rounded-xl bg-white p-2 shadow-sm shrink-0">
        {img}
      </div>
    );
  }

  return img;
};
