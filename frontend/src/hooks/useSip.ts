import { useContext } from 'react';
import { SIPContext } from '../context/SIPContext';

export function useSip() {
  const ctx = useContext(SIPContext);
  if (!ctx) throw new Error('useSip must be used within SIPProvider');
  return ctx;
}