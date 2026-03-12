import React from 'react';

interface SafeTableContainerProps {
  children: React.ReactNode;
}

export const SafeTableContainer: React.FC<SafeTableContainerProps> = ({ children }) => {
  return (
    <div className="w-full" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div className="w-full overflow-x-auto scrollbar-thin">
        {children}
      </div>
    </div>
  );
};
