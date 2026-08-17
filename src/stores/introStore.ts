import { create } from "zustand";

interface IntroState {
  active: boolean;
  logoPos: { x: number; y: number } | null;
  setActive: (active: boolean) => void;
  setLogoPos: (pos: { x: number; y: number }) => void;
}

export const useIntro = create<IntroState>((set) => ({
  active: false,
  logoPos: null,
  setActive: (active) => set({ active }),
  setLogoPos: (logoPos) => set({ logoPos }),
}));
