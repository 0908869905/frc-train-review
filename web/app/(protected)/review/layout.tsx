import { StepUpGuard } from '@/components/step-up-guard';

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <StepUpGuard scope="reviewer">{children}</StepUpGuard>;
}
