import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  leftIcon?: React.ReactNode;
  containerClassName?: string;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  leftIcon,
  containerClassName = '',
  className = '',
  ...props
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${containerClassName}`}>
      {leftIcon}
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-[#10242F] focus:outline-none focus:ring-2 focus:ring-[#053559]/30 cursor-pointer"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
};
