import React from 'react';

interface StrictTableWrapperProps {
  children: React.ReactNode;
}

export const StrictTableWrapper: React.FC<StrictTableWrapperProps> = ({ children }) => {
  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden">
      {/* 
        Using a grid with minmax(0, 1fr) is a robust way to force 
        children to respect the container width in modern CSS 
      */}
      <div className="grid grid-cols-1 min-w-0">
        {children}
      </div>
    </div>
  );
};
