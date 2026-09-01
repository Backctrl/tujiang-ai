import { useState, useEffect, useCallback } from 'react';
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';

const CREDITS_KEY = 'tujiang_credits';
const INITIAL_CREDITS = 500;

export function useCredits() {
  const [credits, setCredits] = useState<number>(INITIAL_CREDITS);

  useEffect(() => {
    const stored = scopedStorage.getItem(CREDITS_KEY);
    if (stored !== null) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed)) {
        setCredits(parsed);
      }
    } else {
      scopedStorage.setItem(CREDITS_KEY, String(INITIAL_CREDITS));
    }
  }, []);

  const addCredits = useCallback((amount: number) => {
    setCredits((prev) => {
      const next = prev + amount;
      scopedStorage.setItem(CREDITS_KEY, String(next));
      return next;
    });
  }, []);

  const deductCredits = useCallback((amount: number): boolean => {
    let success = false;
    setCredits((prev) => {
      if (prev >= amount) {
        const next = prev - amount;
        scopedStorage.setItem(CREDITS_KEY, String(next));
        success = true;
        return next;
      }
      return prev;
    });
    return success;
  }, []);

  return { credits, addCredits, deductCredits, setCredits };
}
