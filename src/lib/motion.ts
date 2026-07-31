import type { Transition, Variants } from "motion/react";

export const gentleEase = [0.22, 1, 0.36, 1] as const;

export const quickTransition: Transition = {
  duration: 0.18,
  ease: gentleEase,
};

export const panelTransition: Transition = {
  duration: 0.24,
  ease: gentleEase,
};

export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -5 },
};

export const popoverVariants: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 5, scale: 0.99 },
};
